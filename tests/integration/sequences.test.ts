import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withSystemDb } from "@/lib/db/context";
import { inquiries, inquiryEvents, jobs, messages, sequenceEnrollments, tasks } from "@/lib/db/schema";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import type { CompanyContext } from "@/lib/authz/context-types";
import { createIntakeSource } from "@/server/intake/sources";
import { receiveWebsiteSubmission } from "@/server/intake/website";
import { runDueJobs } from "@/server/jobs/runner";
import { HANDLERS } from "@/server/jobs/handlers";
import { handleInbound } from "@/server/messaging/inbound";
import { getConversation, sendManualMessage } from "@/server/messaging/inbox";
import { setEmergencyPause, updateAutomationSettings } from "@/server/messaging/settings";
import { changeStage, createLeadManually } from "@/server/crm/leads";
import { changePackage } from "@/server/companies";
import {
  createSequence, enrollLead, enrollmentForInquiry, getSequence, listSequences, pauseEnrollment, resumeEnrollment, saveSequence, setSequenceState, stopEnrollment,
} from "@/server/sequences/manage";
import { addMember, adminCtx, identityFor, makeCompany, makeUser } from "../helpers";

interface Co { id: string; owner: CompanyContext; employee: CompanyContext; key: string; seqId: string }

async function setup(opts: { pkg?: "follow_up_booking" | "instant_response"; autoSequence?: boolean } = {}): Promise<Co> {
  const c = await makeCompany({ lifecycleStatus: "active", package: opts.pkg ?? "follow_up_booking", name: `Seq Co ${Math.random().toString(36).slice(2, 7)}` });
  const o = await makeUser(), e = await makeUser();
  await addMember(c.id, o.id, "owner");
  await addMember(c.id, e.id, "employee");
  const owner = await resolveCompanyContext({ user: o, identity: identityFor(o), requestedCompanyId: c.id, action: "workspace.view" });
  const employee = await resolveCompanyContext({ user: e, identity: identityFor(e), requestedCompanyId: c.id, action: "workspace.view" });
  await updateAutomationSettings(owner, { ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440, windowDays: [0, 1, 2, 3, 4, 5, 6], notifyUserIds: [] });
  const s = await createIntakeSource(owner, { name: "Site form", allowedOrigins: [] });
  let seqId = "";
  if ((opts.pkg ?? "follow_up_booking") === "follow_up_booking") {
    seqId = await createSequence(owner, "New lead follow-up");
    if (opts.autoSequence !== false) await setSequenceState(owner, seqId, { on: true, autoEnroll: true });
  }
  return { id: c.id, owner, employee, key: s.publicKey, seqId };
}

async function submit(co: Co, fields: Record<string, string>) {
  const r = await receiveWebsiteSubmission({ publicKey: co.key, rawBody: JSON.stringify(fields), contentType: "application/json", origin: null, signature: null, timestamp: null, idempotencyKey: null, ip: "198.51.100.9", userAgent: "test" });
  expect(r.status).toBe(201);
  const [ev] = await withSystemDb("t", (tx) => tx.execute<{ inquiry_id: string }>(sql`select inquiry_id from app.intake_events where id = ${String(r.body.id)}`));
  return ev!.inquiry_id;
}

async function enrollmentOf(inquiryId: string) {
  const [e] = await withSystemDb("t", (tx) => tx.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.inquiryId, inquiryId)));
  return e ?? null;
}
async function followUps(inquiryId: string) {
  return withSystemDb("t", (tx) => tx.select().from(messages).where(and(eq(messages.inquiryId, inquiryId), eq(messages.kind, "follow_up"))).orderBy(asc(messages.createdAt)));
}
async function stepJobs(enrollmentId: string) {
  return withSystemDb("t", (tx) => tx.select().from(jobs).where(and(eq(jobs.kind, "sequence_step"), sql`${jobs.payload}->>'enrollmentId' = ${enrollmentId}`)).orderBy(asc(jobs.createdAt)));
}
/** Makes this enrollment's waiting step due now, then runs the queue (one step at a time: the next is ≥1 hour away). */
async function advance(enrollmentId: string) {
  await withSystemDb("t", (tx) => tx.update(jobs).set({ runAt: new Date(Date.now() - 1000) })
    .where(and(eq(jobs.kind, "sequence_step"), eq(jobs.status, "queued"), sql`${jobs.payload}->>'enrollmentId' = ${enrollmentId}`)));
  await runDueJobs();
}

let n = 0;
const phone = () => `415-555-${String(3000 + n++).padStart(4, "0")}`;
const textingLead = (name: string) => ({ name, phone: phone(), email: `${name.toLowerCase()}.${n}@example.com`, service: "gutters", consent_sms: "on", consent_text: "Text me" });

let co: Co;
beforeAll(async () => { co = await setup(); });
afterAll(closeDb);

describe("automatic follow-up", () => {
  it("enrolls a new website lead, sends each step on schedule, then hands the lead to a person", async () => {
    const id = await submit(co, textingLead("Fern"));
    await runDueJobs(); // acknowledgment + alert
    const e = await enrollmentOf(id);
    expect(e).toMatchObject({ status: "active", nextStep: 0, origin: "auto" });
    expect(e!.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000); // first step a day later
    expect(await followUps(id)).toHaveLength(0);

    await advance(e!.id);
    let sent = await followUps(id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "sms", status: "delivered", transport: "simulated", idempotencyKey: `seq:${e!.id}:0` });
    expect(sent[0]!.body).toContain("Fern");
    expect(sent[0]!.body).toContain("Just reply here."); // no booking page yet → fallback wording
    expect((await enrollmentOf(id))!.nextStep).toBe(1);

    await advance(e!.id);
    expect(await followUps(id)).toHaveLength(2);
    expect((await enrollmentOf(id))!.status).toBe("active");
    await advance(e!.id);
    sent = await followUps(id);
    expect(sent).toHaveLength(3);
    const done = await enrollmentOf(id);
    expect(done).toMatchObject({ status: "completed", nextRunAt: null });
    const t = await withSystemDb("t", (tx) => tx.select().from(tasks).where(eq(tasks.inquiryId, id)));
    expect(t[0]!.title).toMatch(/Call Fern — automatic follow-up finished/);
    const ev = await withSystemDb("t", (tx) => tx.select({ type: inquiryEvents.type }).from(inquiryEvents).where(eq(inquiryEvents.inquiryId, id)));
    expect(ev.map((x) => x.type)).toEqual(expect.arrayContaining(["follow_up_started", "follow_up_completed"]));
  });

  it("running the same step twice (retry, duplicate worker) sends one message", async () => {
    const id = await submit(co, textingLead("Gil"));
    const e = await enrollmentOf(id);
    const [job] = await stepJobs(e!.id);
    await Promise.all([HANDLERS.sequence_step!(job!), HANDLERS.sequence_step!(job!), HANDLERS.sequence_step!(job!)]);
    await HANDLERS.sequence_step!(job!);
    expect(await followUps(id)).toHaveLength(1);
    expect((await enrollmentOf(id))!.nextStep).toBe(1);
  });

  it("a worker that crashed after saving a step's message (before sending it) finishes the send on retry", async () => {
    const id = await submit(co, textingLead("Crash"));
    const e = await enrollmentOf(id);
    const [job] = await stepJobs(e!.id);
    await HANDLERS.sequence_step!(job!);
    const [m] = await followUps(id);
    // Pretend the send never happened: the message is saved and the enrollment already moved on.
    await withSystemDb("t", (tx) => tx.update(messages).set({ status: "queued", providerMessageId: null, submittedAt: null, deliveredAt: null }).where(eq(messages.id, m!.id)));
    await HANDLERS.sequence_step!(job!);
    const after = await followUps(id);
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe("delivered");
  });

  it("a reply stops the follow-up immediately and cancels the waiting step", async () => {
    const id = await submit(co, textingLead("Hana"));
    const e = await enrollmentOf(id);
    const [i] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id)));
    const conv = await getConversation(co.owner, (await withSystemDb("t", (tx) => tx.execute<{ id: string }>(sql`select id from app.conversations where contact_id = ${i!.contactId}`)))[0]?.id ?? "00000000-0000-0000-0000-000000000000");
    const from = conv?.contact.phoneE164 ?? (await withSystemDb("t", (tx) => tx.execute<{ phone_e164: string }>(sql`select phone_e164 from app.contacts where id = ${i!.contactId}`)))[0]!.phone_e164;
    await handleInbound({ companyId: co.id, channel: "sms", from, body: "Yes please, call me", transport: "simulated", providerMessageId: `in-${id}` });
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "replied" });
    expect((await stepJobs(e!.id)).every((j) => j.status === "cancelled")).toBe(true);
    await advance(e!.id);
    expect(await followUps(id)).toHaveLength(0);
  });

  it("the pre-send check catches a reply even if the stop hook never ran", async () => {
    const id = await submit(co, textingLead("Ivo"));
    const e = await enrollmentOf(id);
    const [i] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id)));
    // Write an inbound message directly, bypassing handleInbound's stop hook.
    await withSystemDb("t", async (tx) => {
      const [conv] = await tx.execute<{ id: string }>(sql`insert into app.conversations (company_id, contact_id) values (${co.id}, ${i!.contactId}) on conflict (company_id, contact_id) do update set updated_at = now() returning id`);
      await tx.insert(messages).values({ companyId: co.id, conversationId: conv!.id, contactId: i!.contactId, direction: "inbound", channel: "sms", kind: "inbound", status: "received", toAddress: "", body: "hi", transport: "simulated" });
    });
    expect((await enrollmentOf(id))!.status).toBe("active");
    await advance(e!.id);
    expect(await followUps(id)).toHaveLength(0);
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "replied" });
  });

  it("STOP ends the follow-up", async () => {
    const lead = textingLead("Jo");
    const id = await submit(co, lead);
    await handleInbound({ companyId: co.id, channel: "sms", from: `+1${lead.phone.replace(/\D/g, "")}`, body: "STOP", transport: "simulated", providerMessageId: `stop-${id}` });
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "opted_out" });
  });

  it("a team member's message stops it when the sequence says so, and not otherwise", async () => {
    const id = await submit(co, textingLead("Kai"));
    const [i] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id)));
    const [c] = await withSystemDb("t", (tx) => tx.execute<{ id: string }>(sql`insert into app.conversations (company_id, contact_id) values (${co.id}, ${i!.contactId}) on conflict (company_id, contact_id) do update set updated_at = now() returning id`));
    await sendManualMessage(co.employee, { conversationId: c!.id, channel: "sms", body: "Hi Kai, calling you shortly", clientKey: `k-${id.slice(0, 8)}` });
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "manual_message" });

    const other = await setup({ autoSequence: false });
    const s = await getSequence(other.owner, other.seqId);
    await saveSequence(other.owner, other.seqId, { name: "Keep going", stopOnManualMessage: false, handoffTask: false, steps: s!.steps.map((x) => ({ ...x, channel: x.channel as "sms_or_email" })) });
    await setSequenceState(other.owner, other.seqId, { on: true, autoEnroll: true });
    const id2 = await submit(other, textingLead("Lee"));
    const [i2] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, id2)));
    const [c2] = await withSystemDb("t", (tx) => tx.execute<{ id: string }>(sql`insert into app.conversations (company_id, contact_id) values (${other.id}, ${i2!.contactId}) on conflict (company_id, contact_id) do update set updated_at = now() returning id`));
    await sendManualMessage(other.employee, { conversationId: c2!.id, channel: "sms", body: "Quick note", clientKey: `k-${id2.slice(0, 8)}` });
    const e2 = await enrollmentOf(id2);
    expect(e2!.status).toBe("active");
    await advance(e2!.id);
    expect(await followUps(id2)).toHaveLength(1);
  });

  it("marking the lead Won/Lost or Booked stops it", async () => {
    const id = await submit(co, textingLead("Mo"));
    await changeStage(co.employee, id, "won");
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "closed" });
    const id2 = await submit(co, textingLead("Nia"));
    await changeStage(co.employee, id2, "booked");
    expect(await enrollmentOf(id2)).toMatchObject({ status: "stopped", stopCode: "booked" });
  });

  it("a step with no permitted channel is skipped (not sent another way)", async () => {
    const other = await setup({ autoSequence: false });
    const s = await getSequence(other.owner, other.seqId);
    await saveSequence(other.owner, other.seqId, { name: "Texts only", stopOnManualMessage: true, handoffTask: false, steps: s!.steps.map((x) => ({ ...x, channel: "sms" as const })) });
    await setSequenceState(other.owner, other.seqId, { on: true, autoEnroll: true });
    const id = await submit(other, { name: "Ola", phone: phone(), email: "ola.skip@example.com" }); // no text permission
    const e = await enrollmentOf(id);
    await advance(e!.id);
    expect(await followUps(id)).toHaveLength(0);
    expect((await enrollmentOf(id))!.nextStep).toBe(1);
    const ev = await withSystemDb("t", (tx) => tx.select().from(inquiryEvents).where(and(eq(inquiryEvents.inquiryId, id), eq(inquiryEvents.type, "follow_up_step_skipped"))));
    expect(String(ev[0]!.details.reason)).toMatch(/no text permission/);
  });

  it("waits for the sending window instead of sending at night", async () => {
    const other = await setup();
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    const start = ((hour + 6) % 24) * 60; // a window that is closed right now
    await updateAutomationSettings(other.owner, { ackEnabled: true, windowStartMinute: Math.min(start, 1380), windowEndMinute: Math.min(start, 1380) + 60, windowDays: [0, 1, 2, 3, 4, 5, 6], notifyUserIds: [] });
    const id = await submit(other, textingLead("Pat"));
    const e = await enrollmentOf(id);
    await advance(e!.id);
    expect(await followUps(id)).toHaveLength(0);
    const [job] = (await stepJobs(e!.id)).filter((j) => j.status === "queued");
    expect(job!.runAt.getTime()).toBeGreaterThan(Date.now());
    expect((await enrollmentOf(id))!.nextRunAt!.getTime()).toBe(job!.runAt.getTime());
  });
});

describe("controls", () => {
  it("pause holds the next step; resume continues where it left off", async () => {
    const id = await submit(co, textingLead("Quin"));
    const e = await enrollmentOf(id);
    await pauseEnrollment(co.employee, e!.id);
    await advance(e!.id); // nothing is due: the waiting step was cancelled by the pause
    expect(await followUps(id)).toHaveLength(0);
    await resumeEnrollment(co.employee, e!.id);
    expect((await enrollmentOf(id))!.status).toBe("active");
    await advance(e!.id);
    expect(await followUps(id)).toHaveLength(1);
    await stopEnrollment(co.employee, e!.id);
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "stopped_by_user" });
  });

  it("the emergency stop ends follow-ups; turning automation back on doesn't restart them", async () => {
    const other = await setup();
    const id = await submit(other, textingLead("Ray"));
    await setEmergencyPause(other.owner, true, "Checking wording");
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "paused_all" });
    await setEmergencyPause(other.owner, false, "");
    await advance((await enrollmentOf(id))!.id);
    expect(await followUps(id)).toHaveLength(0);
  });

  it("downgrading to Package 1 stops follow-ups, and Package 1 can't use them at all", async () => {
    const other = await setup();
    const id = await submit(other, textingLead("Sol"));
    const admin = await makeUser({ admin: true });
    await changePackage(adminCtx(admin), other.id, "instant_response", "test");
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "package" });
    const p1 = await setup({ pkg: "instant_response" });
    await expect(createSequence(p1.owner, "Nope")).rejects.toThrow(/Package 2/);
    await expect(listSequences(p1.owner)).rejects.toThrow(/Package 2/);
    const id2 = await submit(p1, textingLead("Tia"));
    expect(await enrollmentOf(id2)).toBeNull();
  });

  it("turning a sequence off stops everyone in it; only one sequence can start automatically", async () => {
    const other = await setup();
    const id = await submit(other, textingLead("Uma"));
    const second = await createSequence(other.owner, "Second");
    await expect(setSequenceState(other.owner, second, { on: true, autoEnroll: true })).rejects.toThrow(/already starts automatically/);
    const r = await setSequenceState(other.owner, other.seqId, { on: false, autoEnroll: false });
    expect(r.stopped).toBe(1);
    expect(await enrollmentOf(id)).toMatchObject({ status: "stopped", stopCode: "sequence_off" });
  });

  it("people already enrolled finish the version they started; new leads get the edited wording", async () => {
    const other = await setup();
    const first = await submit(other, textingLead("Vic"));
    const s = await getSequence(other.owner, other.seqId);
    const edited = s!.steps.map((x, k) => ({ ...x, channel: x.channel as "sms_or_email", smsBody: k === 0 ? "{{company_name}}: NEW WORDING for {{first_name}}. Reply STOP to opt out." : x.smsBody }));
    const r = await saveSequence(other.owner, other.seqId, { name: s!.sequence.name, stopOnManualMessage: true, handoffTask: true, steps: edited });
    expect(r).toEqual({ version: 2, stepsChanged: true });
    expect((await saveSequence(other.owner, other.seqId, { name: "Renamed", stopOnManualMessage: true, handoffTask: true, steps: edited })).stepsChanged).toBe(false);
    const second = await submit(other, textingLead("Wes"));
    await advance((await enrollmentOf(first))!.id);
    await advance((await enrollmentOf(second))!.id);
    expect((await followUps(first))[0]!.body).not.toContain("NEW WORDING");
    expect((await followUps(second))[0]!.body).toContain("NEW WORDING for Wes");
  });

  it("checks wording and timing before saving", async () => {
    const s = await getSequence(co.owner, co.seqId);
    const base = s!.steps.map((x) => ({ ...x, channel: x.channel as "sms_or_email" }));
    await expect(saveSequence(co.owner, co.seqId, { name: "x", stopOnManualMessage: true, handoffTask: true, steps: [{ ...base[0]!, smsBody: "Hi {{first_name}}" }] })).rejects.toThrow(/Step 1 text: .*STOP/);
    await expect(saveSequence(co.owner, co.seqId, { name: "x", stopOnManualMessage: true, handoffTask: true, steps: [{ ...base[0]!, delayMinutes: 5 }] })).rejects.toThrow(/at least 1 hour/);
    await expect(saveSequence(co.owner, co.seqId, { name: "x", stopOnManualMessage: true, handoffTask: true, steps: [{ ...base[0]!, emailSubject: "" }] })).rejects.toThrow(/subject/);
    await expect(saveSequence(co.employee, co.seqId, { name: "x", stopOnManualMessage: true, handoffTask: true, steps: base })).rejects.toThrow(/permission/);
  });

  it("starting a follow-up by hand: imports and manual leads need confirmation; one per person", async () => {
    const other = await setup({ autoSequence: false });
    await setSequenceState(other.owner, other.seqId, { on: true, autoEnroll: false });
    const lead = await createLeadManually(other.employee, { fullName: "Xan", email: "xan@example.com", phone: "", serviceRequested: "roof", message: "" });
    const leadId = lead.inquiry.id;
    await expect(enrollLead(other.employee, leadId, other.seqId, false)).rejects.toThrow(/Confirm the person asked/);
    const eid = await enrollLead(other.employee, leadId, other.seqId, true);
    expect(eid).toBeTruthy();
    await expect(enrollLead(other.employee, leadId, other.seqId, true)).rejects.toThrow(/already in a follow-up/);
    const view = await enrollmentForInquiry(other.employee, leadId);
    expect(view!.enrollment!.status).toBe("active");
  });
});

describe("isolation", () => {
  it("another company can't see, change or enroll into this company's follow-ups", async () => {
    const other = await setup();
    const id = await submit(co, textingLead("Yara"));
    const e = await enrollmentOf(id);
    expect(await getSequence(other.owner, co.seqId)).toBeNull();
    expect((await listSequences(other.owner)).map((s) => s.id)).not.toContain(co.seqId);
    await expect(pauseEnrollment(other.owner, e!.id)).rejects.toThrow(/not found/);
    await expect(stopEnrollment(other.owner, e!.id)).rejects.toThrow(/not found/);
    await expect(enrollLead(other.owner, id, other.seqId, true)).rejects.toThrow(/not found/);
    await expect(saveSequence(other.owner, co.seqId, { name: "x", stopOnManualMessage: true, handoffTask: true, steps: [] })).rejects.toThrow();
    expect(await enrollmentForInquiry(other.owner, id)).toBeNull();
    expect((await enrollmentOf(id))!.status).toBe("active");
  });
});
