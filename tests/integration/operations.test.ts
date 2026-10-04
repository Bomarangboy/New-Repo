import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withCompanyDb, withPlatformDb, withSystemDb } from "@/lib/db/context";
import { auditLog, companies, companyBilling, dataDeletions, devOutbox, inquiries, invoices, jobs, memberships, messages, notifications, opsAlerts, sequenceEnrollments, supportTicketMessages, users } from "@/lib/db/schema";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import type { CompanyContext } from "@/lib/authz/context-types";
import { createIntakeSource } from "@/server/intake/sources";
import { receiveWebsiteSubmission } from "@/server/intake/website";
import { runDueJobs } from "@/server/jobs/runner";
import { enqueue, JOB_PRIORITY, type JobRow } from "@/server/jobs/queue";
import { updateAutomationSettings } from "@/server/messaging/settings";
import { createSequence, setSequenceState } from "@/server/sequences/manage";
import { createNotice, createTicket, getMyTicket, getTicketAdmin, listMyTickets, replyAsBluewater, replyToMyTicket, sendNotice } from "@/server/support";
import { recordInvoice, saveCompanyBilling, setInvoiceStatus } from "@/server/billing";
import { runOpsChecks } from "@/server/ops/alerts";
import { adminSetAutomationPause, diagnostics } from "@/server/ops/controls";
import { deleteCompanyData, purgeCompanyData } from "@/server/retention";
import { cleanupExpiredProspects, createProspect, presentationControl, resetProspect, revokeProspect, switchProspectPackage } from "@/server/demo/prospects";
import { handleWeeklySummary } from "@/server/reports/weekly-summary";
import { addMember, adminCtx, expectDbError, identityFor, makeCompany, makeUser, setCompany } from "../helpers";

async function ownerOf(pkg: "instant_response" | "follow_up_booking" | "performance_reporting" = "instant_response", name?: string) {
  const c = await makeCompany({ lifecycleStatus: "active", package: pkg, ...(name ? { name } : {}) });
  const o = await makeUser();
  await addMember(c.id, o.id, "owner");
  const ctx = await resolveCompanyContext({ user: o, identity: identityFor(o), requestedCompanyId: c.id, action: "workspace.view" });
  return { c, o, ctx };
}

async function submit(key: string, fields: Record<string, string>) {
  const r = await receiveWebsiteSubmission({ publicKey: key, rawBody: JSON.stringify(fields), contentType: "application/json", origin: null, signature: null, timestamp: null, idempotencyKey: null, ip: "198.51.100.9", userAgent: "test" });
  expect(r.status).toBe(201);
  const [ev] = await withSystemDb("t", (tx) => tx.execute<{ inquiry_id: string }>(sql`select inquiry_id from app.intake_events where id = ${String(r.body.id)}`));
  return ev!.inquiry_id;
}
const mailsTo = (email: string) => withSystemDb("t", (tx) => tx.select().from(devOutbox).where(eq(devOutbox.toAddress, email)).orderBy(asc(devOutbox.createdAt)));

let admin: Awaited<ReturnType<typeof makeUser>>;
beforeAll(async () => { admin = await makeUser({ admin: true }); });
afterAll(closeDb);

describe("support tickets", () => {
  it("gives a reference, keeps internal notes hidden from the client by the database, and isolates companies", async () => {
    const a = await ownerOf(), b = await ownerOf();
    const t = await createTicket(a.ctx, { subject: "Texts not going out", category: "urgent", body: "Since 9am." });
    expect(t.reference).toMatch(/^BW-\d{4,}$/);
    expect((await mailsTo(admin.email)).some((m) => m.subject.includes(t.reference) && m.subject.startsWith("URGENT"))).toBe(true);

    await replyAsBluewater(adminCtx(admin), t.id, { body: "Customer seems frustrated; check Twilio", internal: true, status: "open" });
    await replyAsBluewater(adminCtx(admin), t.id, { body: "Fixed — please check.", internal: false, status: "waiting_on_customer" });

    const mine = await getMyTicket(a.ctx, t.id);
    expect(mine!.messages.map((m) => m.m.body)).toEqual(["Since 9am.", "Fixed — please check."]);
    expect(mine!.ticket.status).toBe("waiting_on_customer");
    expect((await getTicketAdmin(adminCtx(admin), t.id))!.messages).toHaveLength(3);
    expect((await mailsTo(a.o.email)).filter((m) => m.subject.includes(t.reference))).toHaveLength(1); // the note was not emailed

    // The client can't write an internal note even by going around the screen.
    await expectDbError(withCompanyDb(a.ctx, (tx) => tx.insert(supportTicketMessages).values({ companyId: a.c.id, ticketId: t.id, authorType: "customer", body: "x", internal: true })), /row-level security/);
    await expectDbError(withCompanyDb(a.ctx, (tx) => tx.insert(supportTicketMessages).values({ companyId: a.c.id, ticketId: t.id, authorType: "bluewater", body: "x" })), /row-level security/);

    // Another company sees nothing.
    expect(await getMyTicket(b.ctx, t.id)).toBeNull();
    expect((await listMyTickets(b.ctx)).some((x) => x.id === t.id)).toBe(false);
    await expect(replyToMyTicket(b.ctx, t.id, "hi")).rejects.toThrow(/not found/i);

    await replyToMyTicket(a.ctx, t.id, "Works now, thanks");
    expect((await getMyTicket(a.ctx, t.id))!.ticket.status).toBe("open");
  });
});

describe("Stage 7 tables are isolated between companies", () => {
  it("a client sees only its own billing terms and invoices, can't change them, and never sees platform-only tables", async () => {
    const a = await ownerOf(), b = await ownerOf();
    await saveCompanyBilling(adminCtx(admin), a.c.id, { monthlyPriceCents: 19900, billingEmail: null, smsMonthlyLimit: null, emailMonthlyLimit: null, limitMode: "warn", graceDays: 14, notes: "private" });
    await recordInvoice(adminCtx(admin), a.c.id, { periodStart: "2026-09-01", periodEnd: "2026-09-30", amountCents: 19900, dueDate: null, notes: null });
    const see = (ctx: CompanyContext) => withCompanyDb(ctx, async (tx) => ({
      billing: (await tx.select().from(companyBilling).where(eq(companyBilling.companyId, a.c.id))).length,
      invoices: (await tx.select().from(invoices).where(eq(invoices.companyId, a.c.id))).length,
    }));
    expect(await see(a.ctx)).toEqual({ billing: 1, invoices: 1 });
    expect(await see(b.ctx)).toEqual({ billing: 0, invoices: 0 });
    // No write policy for clients: the update matches no rows, so nothing changes.
    expect(await withCompanyDb(a.ctx, (tx) => tx.update(companyBilling).set({ smsMonthlyLimit: 999999 }).where(eq(companyBilling.companyId, a.c.id)).returning())).toEqual([]);
    expect((await withSystemDb("t", (tx) => tx.select().from(companyBilling).where(eq(companyBilling.companyId, a.c.id))))[0]!.smsMonthlyLimit).toBeNull();
    await expectDbError(withCompanyDb(a.ctx, (tx) => tx.insert(invoices).values({ companyId: a.c.id, reference: `INV-FAKE-${Date.now()}`, periodStart: "2026-09-01", periodEnd: "2026-09-30", amountCents: 1, status: "paid" })), /row-level security|permission denied/);
    expect(await withCompanyDb(a.ctx, (tx) => tx.select().from(opsAlerts))).toEqual([]);
    expect(await withCompanyDb(a.ctx, (tx) => tx.select().from(dataDeletions))).toEqual([]);
  });
});

describe("service notices", () => {
  it("sends only after the reviewed recipient count is confirmed, and only once", async () => {
    const a = await ownerOf();
    const id = await createNotice(adminCtx(admin), { title: "Maintenance tonight", body: "10–11pm ET.", audience: "selected", companyIds: [a.c.id] });
    await expect(sendNotice(adminCtx(admin), id, 2)).rejects.toThrow(/changed since you reviewed/);
    expect((await mailsTo(a.o.email)).filter((m) => m.subject.includes("Maintenance tonight"))).toHaveLength(0);
    expect(await sendNotice(adminCtx(admin), id, 1)).toBe(1);
    expect((await mailsTo(a.o.email)).filter((m) => m.subject.includes("Maintenance tonight"))).toHaveLength(1);
    await expect(sendNotice(adminCtx(admin), id, 1)).rejects.toThrow(/already sent/);
  });
});

describe("usage limits and billing records", () => {
  it("at the text limit, automatic replies switch to email; lead capture continues", async () => {
    const a = await ownerOf();
    await updateAutomationSettings(a.ctx, { ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440, windowDays: [0, 1, 2, 3, 4, 5, 6], notifyUserIds: [] });
    const src = await createIntakeSource(a.ctx, { name: "Site", allowedOrigins: [] });
    await saveCompanyBilling(adminCtx(admin), a.c.id, { monthlyPriceCents: 29900, billingEmail: null, smsMonthlyLimit: 1, emailMonthlyLimit: null, limitMode: "pause_automatic", graceDays: 14, notes: null });
    const lead = (n: number) => ({ name: `Limit ${n}`, phone: `415-555-${String(7100 + n)}`, email: `limit${n}.${a.c.id.slice(0, 6)}@example.com`, consent_sms: "on", consent_text: "Text me" });
    const first = await submit(src.publicKey, lead(1));
    await runDueJobs();
    const second = await submit(src.publicKey, lead(2));
    await runDueJobs();
    const ack = (id: string) => withSystemDb("t", (tx) => tx.select().from(messages).where(and(eq(messages.inquiryId, id), eq(messages.kind, "acknowledgment"))));
    expect((await ack(first))[0]?.channel).toBe("sms");
    expect((await ack(second))[0]?.channel).toBe("email");
  });

  it("a failed invoice marks billing past due and raises one alert; payment resolves it with one recovery email", async () => {
    const a = await ownerOf("instant_response", `Overdue Co ${Date.now()}`);
    const ref = await recordInvoice(adminCtx(admin), a.c.id, { periodStart: "2026-09-01", periodEnd: "2026-09-30", amountCents: 29900, dueDate: "2026-10-01", notes: null });
    expect(ref).toMatch(/^INV-\d{6}-\d{3}$/);
    const [inv] = await withSystemDb("t", (tx) => tx.select().from(invoices).where(eq(invoices.reference, ref)));
    await setInvoiceStatus(adminCtx(admin), inv!.id, "failed");
    expect((await withSystemDb("t", (tx) => tx.select().from(companies).where(eq(companies.id, a.c.id))))[0]!.billingStatus).toBe("manual_past_due");

    const key = `billing:overdue:${a.c.id}`;
    const alertMails = async (word: string) => (await mailsTo(admin.email)).filter((m) => m.textBody.includes(`${a.c.name}: payment overdue`) && m.textBody.includes(word)).length;
    await runOpsChecks();
    await runOpsChecks();
    const open = await withSystemDb("t", (tx) => tx.select().from(opsAlerts).where(and(eq(opsAlerts.key, key), eq(opsAlerts.status, "open"))));
    expect(open).toHaveLength(1);
    expect(await alertMails("NEW PROBLEMS")).toBe(1); // no repeat while it lasts

    await setInvoiceStatus(adminCtx(admin), inv!.id, "paid");
    expect((await withSystemDb("t", (tx) => tx.select().from(companies).where(eq(companies.id, a.c.id))))[0]!.billingStatus).toBe("manual_current");
    await runOpsChecks();
    await runOpsChecks();
    expect(await withSystemDb("t", (tx) => tx.select().from(opsAlerts).where(and(eq(opsAlerts.key, key), eq(opsAlerts.status, "open"))))).toHaveLength(0);
    expect(await alertMails("RECOVERED")).toBe(1);
    // Invoices can't be deleted by the application.
    await expectDbError(withPlatformDb(adminCtx(admin), (tx) => tx.delete(invoices).where(eq(invoices.id, inv!.id))), /permission denied/);
  });
});

describe("background work", () => {
  it("lead-critical jobs outrank reports", async () => {
    const a = await ownerOf();
    const far = new Date(Date.UTC(2099, 0, 1));
    await withSystemDb("t", async (tx) => {
      await enqueue(tx, { companyId: a.c.id, kind: "weekly_summary", key: `prio-w:${a.c.id}`, payload: {}, runAt: far });
      await enqueue(tx, { companyId: a.c.id, kind: "send_acknowledgment", key: `prio-a:${a.c.id}`, payload: {}, runAt: far });
    });
    const rows = await withSystemDb("t", (tx) => tx.select({ kind: jobs.kind, p: jobs.priority }).from(jobs).where(eq(jobs.companyId, a.c.id)));
    expect(rows.find((r) => r.kind === "send_acknowledgment")!.p).toBe(1);
    expect(rows.find((r) => r.kind === "weekly_summary")!.p).toBe(8);
    expect(JOB_PRIORITY.ad_lead_record).toBeLessThan(JOB_PRIORITY.ad_metrics_sync!);
    await withSystemDb("t", (tx) => tx.update(jobs).set({ status: "cancelled" }).where(eq(jobs.companyId, a.c.id)));
  });

  it("a follow-up step more than a day late is paused for a person instead of being sent", async () => {
    const a = await ownerOf("follow_up_booking");
    await updateAutomationSettings(a.ctx, { ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440, windowDays: [0, 1, 2, 3, 4, 5, 6], notifyUserIds: [] });
    const src = await createIntakeSource(a.ctx, { name: "Site", allowedOrigins: [] });
    const seq = await createSequence(a.ctx, "Follow-up");
    await setSequenceState(a.ctx, seq, { on: true, autoEnroll: true });
    const id = await submit(src.publicKey, { name: "Late Step", phone: "415-555-7301", email: `late.${a.c.id.slice(0, 6)}@example.com`, consent_sms: "on", consent_text: "Text me" });
    await runDueJobs();
    const [e] = await withSystemDb("t", (tx) => tx.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.inquiryId, id)));
    await withSystemDb("t", (tx) => tx.update(jobs).set({ runAt: new Date(Date.now() - 25 * 3600_000) })
      .where(and(eq(jobs.kind, "sequence_step"), eq(jobs.status, "queued"), sql`${jobs.payload}->>'enrollmentId' = ${e!.id}`)));
    await runDueJobs();
    const [after] = await withSystemDb("t", (tx) => tx.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.id, e!.id)));
    expect(after!.status).toBe("paused");
    expect(after!.pauseReason).toMatch(/couldn't be sent on time/);
    expect(await withSystemDb("t", (tx) => tx.select().from(messages).where(and(eq(messages.inquiryId, id), eq(messages.kind, "follow_up"))))).toHaveLength(0);
  });

  it("weekly summary emails each owner once per week, even if the job runs twice", async () => {
    const a = await ownerOf("performance_reporting", `Weekly Co ${Date.now()}`);
    const job = { id: crypto.randomUUID(), companyId: a.c.id, kind: "weekly_summary", payload: {}, runAt: new Date() } as unknown as JobRow;
    const monday = new Date("2026-10-05T14:00:00Z");
    await handleWeeklySummary(job, monday);
    await handleWeeklySummary(job, monday);
    const mails = (await mailsTo(a.o.email)).filter((m) => m.subject.includes("your week in Bluewater"));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toContain("2026-09-28");
    expect(mails[0]!.textBody).toMatch(/New leads: 0/);
    const [{ n }] = (await withSystemDb("t", (tx) => tx.select({ n: count() }).from(notifications).where(and(eq(notifications.companyId, a.c.id), eq(notifications.kind, "weekly_summary"))))) as [{ n: number }];
    expect(n).toBe(1);
  });
});

describe("recovery controls", () => {
  it("diagnostics are redacted, and Bluewater's automation pause stops a client's automatic messages", async () => {
    const a = await ownerOf("follow_up_booking", `Diag Co ${Date.now()}`);
    await updateAutomationSettings(a.ctx, { ackEnabled: true, windowStartMinute: 0, windowEndMinute: 1440, windowDays: [0, 1, 2, 3, 4, 5, 6], notifyUserIds: [] });
    const src = await createIntakeSource(a.ctx, { name: "Site", allowedOrigins: [] });
    await submit(src.publicKey, { name: "Secret Person", phone: "415-555-7401", email: `secret.${a.c.id.slice(0, 6)}@example.com`, message: "my private message" });
    const d = JSON.stringify(await diagnostics(adminCtx(admin), a.c.id));
    expect(d).not.toMatch(/Secret Person|secret\.|555-7401|private message|@/);

    await adminSetAutomationPause(adminCtx(admin), a.c.id, true, "Twilio incident");
    const second = await submit(src.publicKey, { name: "During Pause", email: `pause.${a.c.id.slice(0, 6)}@example.com` });
    await runDueJobs();
    expect(await withSystemDb("t", (tx) => tx.select().from(messages).where(and(eq(messages.inquiryId, second), eq(messages.kind, "acknowledgment"))))).toHaveLength(0);
    expect((await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.id, second))))).toHaveLength(1); // the lead is still captured
  });
});

describe("company data deletion", () => {
  it("is refused unless archived and the exact name is typed; keeps billing, history and the activity log", async () => {
    const a = await ownerOf("instant_response", `Delete Me ${Date.now()}`);
    const other = await makeCompany({ lifecycleStatus: "active" });
    const shared = await makeUser();
    await addMember(a.c.id, shared.id, "employee");
    await addMember(other.id, shared.id, "employee");
    const src = await createIntakeSource(a.ctx, { name: "Site", allowedOrigins: [] });
    await submit(src.publicKey, { name: "Gone Soon", email: `gone.${a.c.id.slice(0, 6)}@example.com` });
    await recordInvoice(adminCtx(admin), a.c.id, { periodStart: "2026-09-01", periodEnd: "2026-09-30", amountCents: 10000, dueDate: null, notes: null });
    const leadCount = async () => (await withSystemDb("t", (tx) => tx.select({ n: count() }).from(inquiries).where(eq(inquiries.companyId, a.c.id))))[0]!.n;

    await expect(deleteCompanyData(adminCtx(admin), a.c.id, { confirmName: a.c.name, reason: "Client asked" })).rejects.toThrow(/Archive the company first/);
    // The database itself refuses too, whatever the caller does.
    await expectDbError(withPlatformDb(adminCtx(admin), (tx) => purgeCompanyData(tx, a.c.id)), /must be archived/);
    await expectDbError(withCompanyDb(a.ctx, (tx) => purgeCompanyData(tx, a.c.id)), /not allowed in this scope/);
    expect(await leadCount()).toBe(1);

    await setCompany(a.c.id, { lifecycleStatus: "archived" });
    await expect(deleteCompanyData(adminCtx(admin), a.c.id, { confirmName: a.c.name.toLowerCase(), reason: "Client asked" })).rejects.toThrow(/doesn't match/);
    const rec = await deleteCompanyData(adminCtx(admin), a.c.id, { confirmName: a.c.name, reason: "Written request from owner" });
    expect(rec.summary.inquiries).toBe(1);
    expect(await leadCount()).toBe(0);

    await withSystemDb("t", async (tx) => {
      expect(await tx.select().from(companies).where(eq(companies.id, a.c.id))).toHaveLength(1);
      expect(await tx.select().from(invoices).where(eq(invoices.companyId, a.c.id))).toHaveLength(1);
      expect(await tx.select().from(dataDeletions).where(eq(dataDeletions.companyId, a.c.id))).toHaveLength(1);
      expect((await tx.select().from(auditLog).where(and(eq(auditLog.companyId, a.c.id), eq(auditLog.action, "company.data_deleted")))).length).toBe(1);
      expect(await tx.select().from(memberships).where(eq(memberships.companyId, a.c.id))).toHaveLength(0);
      const [owner] = await tx.select().from(users).where(eq(users.id, a.o.id));
      const [sharedU] = await tx.select().from(users).where(eq(users.id, shared.id));
      expect(owner!.status).toBe("disabled"); // belonged only to the deleted company
      expect(sharedU!.status).toBe("active"); // still works for the other company
    });
  });

  it("covers every company table: each is either deleted or deliberately kept", async () => {
    const KEPT = ["audit_log", "invoices", "company_billing", "data_deletions", "lifecycle_history", "package_history", "support_access_grants", "ops_alerts", "suppressions"];
    const [def] = await withSystemDb("t", (tx) => tx.execute<{ d: string }>(sql`select pg_get_functiondef('app.purge_company_data(uuid, boolean)'::regprocedure) as d`));
    const purged = [...def!.d.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).filter((t) => !["platform", "system"].includes(t));
    const tables = await withSystemDb("t", (tx) => tx.execute<{ t: string }>(sql`select table_name as t from information_schema.columns where table_schema = 'app' and column_name = 'company_id'
      and table_name in (select table_name from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE')`));
    const missing = tables.map((r) => r.t).filter((t) => !KEPT.includes(t) && !purged.includes(t));
    expect(missing, "New company table: add it to app.purge_company_data (new migration) or to the KEPT list in docs/RETENTION.md").toEqual([]);
  });
});

describe("sales-demo prospect workspaces", () => {
  it("are created with sample data, presented, reset, revoked and cleaned up", async () => {
    const ctx = adminCtx(admin);
    const c = await createProspect(ctx, { name: "Coastal Roofing", package: "follow_up_booking", days: 14, timezone: "America/New_York" });
    expect(c.kind).toBe("demo_prospect");
    const leads = async () => (await withSystemDb("t", (tx) => tx.select({ n: count() }).from(inquiries).where(eq(inquiries.companyId, c.id))))[0]!.n;
    const initial = await leads();
    expect(initial).toBeGreaterThan(20);

    const prospect = await makeUser();
    await addMember(c.id, prospect.id, "owner");
    expect(await presentationControl(ctx, c.id, "lead")).toMatch(/New sample lead/);
    expect(await leads()).toBe(initial + 1);
    await expect(presentationControl(ctx, crypto.randomUUID(), "lead")).rejects.toThrow(/not found/);
    await switchProspectPackage(ctx, c.id, "performance_reporting");
    // A real customer can't be driven by the demo controls.
    const real = await makeCompany({ kind: "customer" });
    await expect(switchProspectPackage(ctx, real.id, "performance_reporting")).rejects.toThrow(/not found/);
    await expect(resetProspect(ctx, real.id)).rejects.toThrow(/not found/);

    await resetProspect(ctx, c.id);
    expect(await withSystemDb("t", (tx) => tx.select().from(memberships).where(eq(memberships.companyId, c.id)))).toHaveLength(1); // sign-in kept
    expect(await leads()).toBeGreaterThan(20);

    await revokeProspect(ctx, c.id);
    await expect(presentationControl(ctx, c.id, "lead")).rejects.toThrow(/expired/);
    expect(await cleanupExpiredProspects()).toBeGreaterThanOrEqual(0); // inside the grace period: kept
    expect(await leads()).toBeGreaterThan(0);

    await setCompany(c.id, { demoExpiresAt: new Date(Date.now() - 8 * 86_400_000) });
    await cleanupExpiredProspects();
    expect(await leads()).toBe(0);
    const [after] = await withSystemDb("t", (tx) => tx.select().from(companies).where(eq(companies.id, c.id)));
    expect(after!.lifecycleStatus).toBe("archived");
    const [d] = await withSystemDb("t", (tx) => tx.select().from(dataDeletions).where(eq(dataDeletions.companyId, c.id)).orderBy(desc(dataDeletions.deletedAt)));
    expect(d!.reason).toMatch(/Demo workspace expired/);
    expect((await withSystemDb("t", (tx) => tx.select().from(users).where(eq(users.id, prospect.id))))[0]!.status).toBe("disabled");
  });
});
