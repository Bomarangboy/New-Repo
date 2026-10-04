import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withCompanyDb, withSystemDb } from "@/lib/db/context";
import { devOutbox, inquiries, jobs, messages, messageStatusEvents, notifications, suppressions } from "@/lib/db/schema";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import type { CompanyContext } from "@/lib/authz/context-types";
import { createIntakeSource } from "@/server/intake/sources";
import { receiveWebsiteSubmission } from "@/server/intake/website";
import { runDueJobs, runMaintenance } from "@/server/jobs/runner";
import { claimDueJobs, enqueue, finishJob, recoverStaleJobs } from "@/server/jobs/queue";
import { HANDLERS } from "@/server/jobs/handlers";
import { handleSendAcknowledgment } from "@/server/messaging/acknowledgment";
import { applyStatusUpdate, deliver, markInterruptedSendsUnknown } from "@/server/messaging/send";
import { handleInbound } from "@/server/messaging/inbound";
import { getConversation, listConversations, recordOptOut, sendManualMessage, simulateIncomingReply } from "@/server/messaging/inbox";
import { setEmergencyPause, updateAutomationSettings, saveTemplate } from "@/server/messaging/settings";
import { changeStage, createLeadManually } from "@/server/crm/leads";
import { addMember, identityFor, makeCompany, makeUser, setCompany } from "../helpers";

interface Co { id: string; owner: CompanyContext; employee: CompanyContext; ownerEmail: string; key: string }

async function setupCompany(opts: { lifecycleStatus?: "active" | "onboarding"; tz?: string } = {}): Promise<Co> {
  const c = await makeCompany({ lifecycleStatus: "active", timezone: opts.tz ?? "America/New_York", name: `Msg Co ${Math.random().toString(36).slice(2, 7)}` });
  const o = await makeUser(), e = await makeUser();
  await addMember(c.id, o.id, "owner");
  await addMember(c.id, e.id, "employee");
  const owner = await resolveCompanyContext({ user: o, identity: identityFor(o), requestedCompanyId: c.id, action: "workspace.view" });
  const employee = await resolveCompanyContext({ user: e, identity: identityFor(e), requestedCompanyId: c.id, action: "workspace.view" });
  // Always-open window so tests don't depend on the clock (window behavior is tested explicitly).
  await updateAutomationSettings(owner, { ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440, windowDays: [0, 1, 2, 3, 4, 5, 6], notifyUserIds: [] });
  const s = await createIntakeSource(owner, { name: "Site form", allowedOrigins: [] });
  if (opts.lifecycleStatus && opts.lifecycleStatus !== "active") await setCompany(c.id, { lifecycleStatus: opts.lifecycleStatus });
  return { id: c.id, owner, employee, ownerEmail: o.email, key: s.publicKey };
}

async function submit(co: Co, fields: Record<string, string>) {
  const r = await receiveWebsiteSubmission({ publicKey: co.key, rawBody: JSON.stringify(fields), contentType: "application/json", origin: null, signature: null, timestamp: null, idempotencyKey: null, ip: "198.51.100.7", userAgent: "test" });
  expect(r.status).toBe(201);
  const [ev] = await withSystemDb("t", (tx) => tx.execute<{ inquiry_id: string }>(sql`select inquiry_id from app.intake_events where id = ${String(r.body.id)}`));
  return ev!.inquiry_id;
}

async function msgsFor(companyId: string, inquiryId?: string) {
  return withSystemDb("t", (tx) => tx.select().from(messages).where(inquiryId ? and(eq(messages.companyId, companyId), eq(messages.inquiryId, inquiryId)) : eq(messages.companyId, companyId)).orderBy(desc(messages.createdAt)));
}
async function jobFor(key: string) {
  const [j] = await withSystemDb("t", (tx) => tx.select().from(jobs).where(eq(jobs.idempotencyKey, key)));
  return j!;
}
let n = 0;
const phone = () => `415-555-${String(2000 + n++).padStart(4, "0")}`;

let co: Co;
beforeAll(async () => { co = await setupCompany(); });
afterAll(closeDb);

describe("automatic acknowledgment", () => {
  it("texts a new website lead who gave text permission, and alerts the owner", async () => {
    const id = await submit(co, { name: "Ana Torres", phone: phone(), email: "ana@example.com", service: "roof repair", consent_sms: "on", consent_text: "Text me" });
    await runDueJobs();
    const [m] = await msgsFor(co.id, id);
    expect(m).toMatchObject({ channel: "sms", kind: "acknowledgment", status: "delivered", transport: "simulated", templateVersion: 0 });
    expect(m!.body).toContain("Hi Ana");
    expect(m!.body).toContain("roof repair");
    expect(m!.body).toContain("STOP");
    const alerts = await withSystemDb("t", (tx) => tx.select().from(notifications).where(eq(notifications.inquiryId, id)));
    expect(alerts.map((a) => a.kind)).toEqual(["new_lead"]);
    expect(alerts[0]!.emailStatus).toBe("sent");
    const [mail] = await withSystemDb("t", (tx) => tx.select().from(devOutbox).where(eq(devOutbox.toAddress, co.ownerEmail)).orderBy(desc(devOutbox.createdAt)).limit(1));
    expect(mail!.subject).toContain("New lead");
  });

  it("emails instead when there is no text permission", async () => {
    const id = await submit(co, { name: "Ben", phone: phone(), email: "ben@example.com" });
    await runDueJobs();
    const [m] = await msgsFor(co.id, id);
    expect(m).toMatchObject({ channel: "email", status: "delivered" });
    expect(m!.subject).toContain(co.owner.companyName);
  });

  it("sends nothing when it can't, and tells the team to reach out personally", async () => {
    const id = await submit(co, { name: "Cal", phone: phone() }); // phone only, no permission
    await runDueJobs();
    expect(await msgsFor(co.id, id)).toHaveLength(0);
    expect((await jobFor(`ack:${id}`)).status).toBe("cancelled");
    const alerts = await withSystemDb("t", (tx) => tx.select().from(notifications).where(eq(notifications.inquiryId, id)));
    expect(alerts.map((a) => a.kind).sort()).toEqual(["ack_problem", "new_lead"]);
  });

  it("never sends twice: duplicate job runs and re-enqueueing produce one message", async () => {
    const id = await submit(co, { name: "Dee", email: "dee@example.com" });
    await withSystemDb("t", (tx) => enqueue(tx, { companyId: co.id, kind: "send_acknowledgment", key: `ack:${id}`, payload: { inquiryId: id } }));
    await runDueJobs();
    const job = await jobFor(`ack:${id}`);
    await handleSendAcknowledgment(job); // a second worker running the same job
    await handleSendAcknowledgment(job);
    expect(await msgsFor(co.id, id)).toHaveLength(1);
  });

  it("three workers running the same acknowledgment at the same moment send exactly one message", async () => {
    const id = await submit(co, { name: "Racer", email: "racer@example.com" });
    const job = await jobFor(`ack:${id}`);
    const results = await Promise.all([handleSendAcknowledgment(job), handleSendAcknowledgment(job), handleSendAcknowledgment(job)]);
    expect(results.every((r) => r.status === "succeeded" || r.status === "cancelled")).toBe(true);
    expect((await msgsFor(co.id, id)).filter((m) => m.kind === "acknowledgment")).toHaveLength(1);
  });

  it("the database itself allows only one message per idempotency key", async () => {
    const id = await submit(co, { name: "Keyed", email: "keyed@example.com" });
    const { createOutbound } = await import("@/server/messaging/send");
    const contactId = (await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id))))[0]!.contactId;
    const make = () => withSystemDb("t", (tx) => createOutbound(tx, { companyId: co.id, contactId, channel: "email", kind: "manual", to: "keyed@example.com", body: "x", idempotencyKey: "manual:same-key-123", transport: "simulated" }));
    const a = await make(), b = await make();
    expect([a.created, b.created]).toEqual([true, false]);
    expect(b.message.id).toBe(a.message.id);
  });

  it("stands down when the lead replied first, or a person already moved the lead", async () => {
    const p = phone();
    const id = await submit(co, { name: "Eve", phone: p, consent_sms: "on" });
    await handleInbound({ companyId: co.id, channel: "sms", from: `+1${p.replace(/\D/g, "")}`, body: "Can you come Tuesday?", transport: "simulated", providerMessageId: `in-${id}` });
    await runDueJobs();
    expect((await msgsFor(co.id, id)).filter((m) => m.direction === "outbound")).toHaveLength(0);
    expect((await jobFor(`ack:${id}`)).result).toMatch(/already replied/);

    const id2 = await submit(co, { name: "Fay", email: "fay@example.com" });
    await changeStage(co.employee, id2, "contacted");
    await runDueJobs();
    expect(await msgsFor(co.id, id2)).toHaveLength(0);
  });

  it("respects opt-outs: an opted-out number falls back to email", async () => {
    const p = phone();
    await handleInbound({ companyId: co.id, channel: "sms", from: `+1${p.replace(/\D/g, "")}`, body: "STOP", transport: "simulated", providerMessageId: `stop-${p}` });
    const id = await submit(co, { name: "Gus", phone: p, email: "gus@example.com", consent_sms: "on" });
    await runDueJobs();
    const [m] = await msgsFor(co.id, id);
    expect(m!.channel).toBe("email");
  });

  it("emergency pause cancels pending acknowledgments (they are not sent later)", async () => {
    const c2 = await setupCompany();
    await setEmergencyPause(c2.owner, true, "Wrong template");
    const id = await submit(c2, { name: "Hal", email: "hal@example.com" });
    await runDueJobs();
    await setEmergencyPause(c2.owner, false, "");
    await runDueJobs();
    expect(await msgsFor(c2.id, id)).toHaveLength(0);
    expect((await jobFor(`ack:${id}`)).status).toBe("cancelled");
  });

  it("onboarding accounts store leads and alert the team but never acknowledge automatically", async () => {
    const c3 = await setupCompany({ lifecycleStatus: "onboarding" });
    const id = await submit(c3, { name: "Ivy", email: "ivy@example.com" });
    await runDueJobs();
    expect(await msgsFor(c3.id, id)).toHaveLength(0);
    const ack = await withSystemDb("t", (tx) => tx.select().from(jobs).where(eq(jobs.idempotencyKey, `ack:${id}`)));
    expect(ack).toHaveLength(0);
    expect((await jobFor(`notify:new_lead:${id}`)).status).toBe("succeeded");
  });

  it("waits for the sending window, and skips inquiries that would be acknowledged too late", async () => {
    const c4 = await setupCompany({ tz: "America/Chicago" });
    await updateAutomationSettings(c4.owner, { ackEnabled: true, windowStartMinute: 9 * 60, windowEndMinute: 17 * 60, windowDays: [1, 2, 3, 4, 5], notifyUserIds: [] });
    const id = await submit(c4, { name: "Jo", email: "jo@example.com" });
    const job = await jobFor(`ack:${id}`);
    const [inq] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id)));
    // Pretend the lead arrived Friday 6pm Chicago: the window next opens Monday 9am, > 24h later → stale.
    await withSystemDb("t", (tx) => tx.update(inquiries).set({ receivedAt: new Date("2026-10-09T23:00:00Z") }).where(eq(inquiries.id, inq!.id)));
    const friday = await handleSendAcknowledgment(job, new Date("2026-10-09T23:05:00Z"));
    expect(friday).toMatchObject({ status: "cancelled" });
    // Arrived Tuesday 7:30am → wait until 9:00am Chicago (14:00 UTC).
    await withSystemDb("t", (tx) => tx.update(inquiries).set({ receivedAt: new Date("2026-10-06T12:30:00Z") }).where(eq(inquiries.id, inq!.id)));
    const early = await handleSendAcknowledgment(job, new Date("2026-10-06T12:31:00Z"));
    expect(early).toEqual({ status: "reschedule", runAt: new Date("2026-10-06T14:00:00.000Z"), result: "Outside the sending window" });
    const inWindow = await handleSendAcknowledgment(job, new Date("2026-10-06T14:00:30Z"));
    expect(inWindow.status).toBe("succeeded");
  });

  it("a rejected send is recorded as failed and the team is told", async () => {
    const id = await submit(co, { name: "Kim", email: "fail-kim@example.com" });
    await runDueJobs();
    const [m] = await msgsFor(co.id, id);
    expect(m).toMatchObject({ status: "failed", errorCode: "SIMULATED_REJECTION" });
    expect((await jobFor(`notify:ack_problem:${id}`)).status).toBe("succeeded");
  });

  it("uses the latest saved template version and records which version was sent", async () => {
    const c5 = await setupCompany();
    await expect(saveTemplate(c5.owner, "ack_sms", { body: "Hi {{first_nam}}" })).rejects.toThrow(/isn't a field/);
    await expect(saveTemplate(c5.owner, "ack_sms", { body: "Hi {{first_name}} thanks" })).rejects.toThrow(/STOP/);
    await expect(saveTemplate(c5.employee, "ack_sms", { body: "Hi {{first_name}}. Reply STOP to opt out." })).rejects.toThrow(/permission/);
    const v = await saveTemplate(c5.owner, "ack_sms", { body: "Hello {{first_name|friend}} from {{company_name}}. Reply STOP to opt out." });
    expect(v).toBe(1);
    const id = await submit(c5, { name: "", phone: phone(), consent_sms: "yes", email: "lou@example.com" });
    await runDueJobs();
    const [m] = await msgsFor(c5.id, id);
    expect(m).toMatchObject({ templateVersion: 1 });
    expect(m!.body.startsWith("Hello friend from")).toBe(true);
  });
});

describe("crash safety and provider reports", () => {
  it("a send interrupted mid-flight becomes 'unknown' and is never re-sent", async () => {
    const id = await submit(co, { name: "Max", email: "max@example.com" });
    // Simulate a worker that claimed the send and then died before recording the result.
    const { createOutbound } = await import("@/server/messaging/send");
    const contactId = (await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id))))[0]!.contactId;
    const { message } = await withSystemDb("t", (tx) => createOutbound(tx, { companyId: co.id, contactId, inquiryId: id, channel: "email", kind: "acknowledgment", to: "max@example.com", body: "x", idempotencyKey: `ack:${id}`, transport: "simulated" }));
    await withSystemDb("t", (tx) => tx.update(messages).set({ status: "sending", sendingStartedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(messages.id, message.id)));
    expect(await markInterruptedSendsUnknown()).toBeGreaterThanOrEqual(1);
    await runDueJobs(); // the ack job runs now: it must find the existing message and NOT send again
    expect((await deliver(co.id, message.id)).status).toBe("unknown");
    const all = await msgsFor(co.id, id);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("unknown");
  });

  it("out-of-order and duplicate provider reports never move a message backwards", async () => {
    const id = await submit(co, { name: "Ned", email: "ned@example.com" });
    await runDueJobs();
    const [m] = await msgsFor(co.id, id);
    expect(m!.status).toBe("delivered");
    const late = await applyStatusUpdate({ transport: "simulated", providerMessageId: m!.providerMessageId!, status: "submitted", providerStatus: "sent" });
    const dup = await applyStatusUpdate({ transport: "simulated", providerMessageId: m!.providerMessageId!, status: "failed", providerStatus: "undelivered" });
    expect([late.applied, dup.applied]).toEqual([false, false]);
    expect((await msgsFor(co.id, id))[0]!.status).toBe("delivered");
    const events = await withSystemDb("t", (tx) => tx.select().from(messageStatusEvents).where(eq(messageStatusEvents.messageId, m!.id)));
    expect(events.filter((e) => !e.applied)).toHaveLength(2); // still recorded for the audit trail
    expect((await applyStatusUpdate({ transport: "twilio", providerMessageId: "nope", status: "delivered", providerStatus: "delivered" })).applied).toBe(false);
  });
});

describe("inbox, replies and opt-outs", () => {
  it("a reply from an unknown number creates a conversation that needs a reply; duplicate webhooks are ignored", async () => {
    const r1 = await handleInbound({ companyId: co.id, channel: "sms", from: "+14155559988", body: "Do you do gutters?", transport: "simulated", providerMessageId: "dup-1" });
    const r2 = await handleInbound({ companyId: co.id, channel: "sms", from: "+14155559988", body: "Do you do gutters?", transport: "simulated", providerMessageId: "dup-1" });
    expect([r1.stored, r2.stored]).toEqual([true, false]);
    const list = await listConversations(co.employee, "needs_reply");
    expect(list.some((c) => c.id === r1.conversationId)).toBe(true);
    expect((await jobFor(`notify:reply:${(await getConversation(co.owner, r1.conversationId))!.thread[0]!.m.id}`)).status).toBe("queued");
  });

  it("STOP and opt-out phrases suppress; START lifts a keyword opt-out", async () => {
    const from = "+14155559977";
    await handleInbound({ companyId: co.id, channel: "sms", from, body: "Please stop texting me", transport: "simulated", providerMessageId: "p-1" });
    let sup = await withSystemDb("t", (tx) => tx.select().from(suppressions).where(and(eq(suppressions.companyId, co.id), eq(suppressions.address, from))));
    expect(sup.filter((s) => !s.liftedAt)).toHaveLength(1);
    await handleInbound({ companyId: co.id, channel: "sms", from, body: "START", transport: "simulated", providerMessageId: "p-2" });
    sup = await withSystemDb("t", (tx) => tx.select().from(suppressions).where(and(eq(suppressions.companyId, co.id), eq(suppressions.address, from))));
    expect(sup.filter((s) => !s.liftedAt)).toHaveLength(0);
  });

  it("manual replies: one message per click, permission rules, and the lead moves to Contacted", async () => {
    const p = phone();
    const id = await submit(co, { name: "Ola", phone: p, email: "ola@example.com" }); // no text permission
    await runDueJobs();
    const conv = (await withSystemDb("t", (tx) => tx.select().from(messages).where(eq(messages.inquiryId, id))))[0]!.conversationId;
    await expect(sendManualMessage(co.employee, { conversationId: conv, channel: "sms", body: "Hi!", clientKey: "click-aaaaaaaa" })).rejects.toThrow(/no recorded permission to text/);
    const a = await sendManualMessage(co.employee, { conversationId: conv, channel: "email", body: "Hi Ola, when works for you?", clientKey: "click-bbbbbbbb" });
    const b = await sendManualMessage(co.employee, { conversationId: conv, channel: "email", body: "Hi Ola, when works for you?", clientKey: "click-bbbbbbbb" });
    expect([a, b]).toEqual(["delivered", "delivered"]);
    const sent = (await msgsFor(co.id)).filter((m) => m.kind === "manual" && m.conversationId === conv);
    expect(sent).toHaveLength(1);
    const [inq] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id)));
    expect(inq!.stage).toBe("contacted");
    // Once they text us, texting back is allowed.
    await simulateIncomingReply(co.owner, conv, "sms", "Text me instead");
    expect(await sendManualMessage(co.employee, { conversationId: conv, channel: "sms", body: "Sure!", clientKey: "click-cccccccc" })).toBe("delivered");
    // Staff-recorded opt-out blocks further texts.
    await recordOptOut(co.employee, conv, "sms", "Asked on the phone not to be texted");
    await expect(sendManualMessage(co.owner, { conversationId: conv, channel: "sms", body: "x", clientKey: "click-dddddddd" })).rejects.toThrow(/opted out/);
  });

  it("read-only accounts can't send", async () => {
    const c6 = await setupCompany();
    const id = await submit(c6, { name: "Pia", email: "pia@example.com" });
    await runDueJobs();
    const conv = (await msgsFor(c6.id, id))[0]!.conversationId;
    await setCompany(c6.id, { suspended: true });
    const ro = await resolveCompanyContext({ user: { ...(await makeUser()) }, identity: identityFor(await makeUser()), requestedCompanyId: c6.id, action: "workspace.view" }).catch(() => null);
    expect(ro).toBeNull(); // a stranger can't get in at all
    const owner = { ...c6.owner, policy: { ...c6.owner.policy, manualSending: false } };
    await expect(sendManualMessage(owner, { conversationId: conv, channel: "email", body: "x", clientKey: "click-eeeeeeee" })).rejects.toThrow(/paused/);
  });

  it("one company cannot see or write into another company's conversations", async () => {
    const other = await setupCompany();
    const id = await submit(other, { name: "Quinn", email: "quinn@example.com" });
    await runDueJobs();
    const conv = (await msgsFor(other.id, id))[0]!.conversationId;
    expect(await getConversation(co.owner, conv)).toBeNull();
    await expect(sendManualMessage(co.owner, { conversationId: conv, channel: "email", body: "hi", clientKey: "click-ffffffff" })).rejects.toThrow(/not found/);
    await withCompanyDb(co.owner, async (tx) => {
      const rows = await tx.select().from(messages);
      expect(rows.every((m) => m.companyId === co.id)).toBe(true);
    });
  });
});

describe("job engine", () => {
  it("retries with backoff and stops as 'dead' after the maximum attempts", async () => {
    HANDLERS.test_always_fails = async () => { throw new Error("boom"); };
    await withSystemDb("t", (tx) => enqueue(tx, { companyId: co.id, kind: "test_always_fails", key: "test:fail:1", maxAttempts: 2 }));
    await runDueJobs({ limit: 50 });
    let j = await jobFor("test:fail:1");
    expect(j).toMatchObject({ status: "queued", attempts: 1, lastError: "boom" });
    expect(j.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    await withSystemDb("t", (tx) => tx.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, j.id)));
    await runDueJobs({ limit: 50 });
    j = await jobFor("test:fail:1");
    expect(j.status).toBe("dead");
    delete HANDLERS.test_always_fails;
  });

  it("a job whose worker vanished is picked up again", async () => {
    HANDLERS.test_ok = async () => ({ status: "succeeded" });
    await withSystemDb("t", (tx) => enqueue(tx, { companyId: co.id, kind: "test_ok", key: "test:stale:1" }));
    const claimed = await claimDueJobs(50);
    const mine = claimed.find((c) => c.idempotencyKey === "test:stale:1")!;
    for (const c of claimed.filter((x) => x.id !== mine.id)) await finishJob(c, { status: "reschedule", runAt: new Date() });
    expect(await recoverStaleJobs(new Date(Date.now() + 5 * 60_000))).toBeGreaterThanOrEqual(1);
    await runDueJobs({ limit: 50 });
    expect((await jobFor("test:stale:1")).status).toBe("succeeded");
    delete HANDLERS.test_ok;
  });

  it("shares turns fairly: a busy company can't starve another", async () => {
    HANDLERS.test_ok = async () => ({ status: "succeeded" });
    const busy = await setupCompany(), quiet = await setupCompany();
    await runDueJobs({ limit: 200 }); // clear setup jobs
    await withSystemDb("t", async (tx) => {
      for (let i = 0; i < 20; i++) await enqueue(tx, { companyId: busy.id, kind: "test_ok", key: `test:busy:${i}`, runAt: new Date(Date.now() - 60_000) });
      await enqueue(tx, { companyId: quiet.id, kind: "test_ok", key: "test:quiet:1" });
    });
    const batch = await claimDueJobs(25);
    expect(batch.some((j) => j.companyId === quiet.id)).toBe(true);
    expect(batch.filter((j) => j.companyId === busy.id).length).toBeLessThanOrEqual(5);
    for (const j of batch) await finishJob(j, { status: "succeeded" });
    await runDueJobs({ limit: 200 });
    delete HANDLERS.test_ok;
  });

  it("maintenance runs at most once a minute", async () => {
    const t = new Date(Date.now() + 3600_000);
    expect((await runMaintenance(t)).ran).toBe(true);
    expect((await runMaintenance(new Date(t.getTime() + 1000))).ran).toBe(false);
  });

  it("company contexts cannot see other companies' jobs; platform jobs are invisible to companies", async () => {
    await withCompanyDb(co.owner, async (tx) => {
      const rows = await tx.select().from(jobs);
      expect(rows.every((j) => j.companyId === co.id)).toBe(true);
    });
  });
});

describe("manual leads never trigger automatic messages", () => {
  it("adding a lead by hand queues nothing", async () => {
    const r = await createLeadManually(co.owner, { fullName: "Hand Entered", email: "hand@example.com" });
    const q = await withSystemDb("t", (tx) => tx.select().from(jobs).where(sql`${jobs.idempotencyKey} like ${"%" + r.inquiry.id}`));
    expect(q).toHaveLength(0);
  });
});

describe("messaging metrics", () => {
  it("count acknowledgments for inquiries in the period and keep automatic and human response times separate", async () => {
    const { overviewMetrics } = await import("@/server/metrics");
    const c = await setupCompany();
    const a = await submit(c, { name: "M1", email: "m1@example.com" });
    await submit(c, { name: "M2", email: "fail-m2@example.com" });
    await submit(c, { name: "M3", phone: "415-555-3333" }); // no channel → nothing sent
    await runDueJobs();
    let m = await overviewMetrics(c.owner, 7);
    expect(m.messaging).toMatchObject({ acksSent: 1, acksFailed: 1, acksSimulated: true, medianFirstHumanSeconds: null });
    expect(m.messaging.medianAckSeconds).not.toBeNull();
    const conv = (await msgsFor(c.id, a))[0]!.conversationId;
    await sendManualMessage(c.employee, { conversationId: conv, channel: "email", body: "Hello!", clientKey: "metric-key-1" });
    m = await overviewMetrics(c.owner, 7);
    expect(m.messaging.medianFirstHumanSeconds).not.toBeNull(); // the acknowledgment doesn't count as a human response
    expect(m.messaging.lastAlertAt).not.toBeNull();
  });
});
