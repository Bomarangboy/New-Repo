import { and, eq, sql } from "drizzle-orm";
import { withPlatformDb } from "@/lib/db/context";
import { adConnections, adLeadEvents, companies, intakeEvents, messagingSettings, opsRecords } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import type { PlatformContext } from "@/lib/authz/context-types";
import { enqueue } from "@/server/jobs/queue";
import { processIntakeEvent } from "@/server/intake/website";
import { stopEnrollments } from "@/server/sequences/stop";

/**
 * Safe recovery controls for administrators (Health & Recovery Center). Each one says what it does before it
 * runs (see the Health page copy) and re-uses the normal code paths, so every check still applies: a retried
 * lead is still de-duplicated, a re-import still replaces rather than adds, nothing old is sent in bulk.
 */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Re-processes website submissions that were stored but failed to become leads (each at most once). */
export async function retryFailedIntake(ctx: PlatformContext, requestId?: string): Promise<{ processed: number; still: number }> {
  const ids = await withPlatformDb(ctx, (tx) => tx.select({ id: intakeEvents.id }).from(intakeEvents).where(eq(intakeEvents.status, "failed")).limit(200));
  let processed = 0, still = 0;
  for (const { id } of ids) (await processIntakeEvent(id)).status === "processed" ? processed++ : still++;
  await withPlatformDb(ctx, (tx) => audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "ops.intake_retried", details: { processed, still }, requestId }));
  return { processed, still };
}

/** Puts failed ad lead-form leads back in the queue (still recorded only once per platform lead id). */
export async function retryFailedAdLeads(ctx: PlatformContext, requestId?: string): Promise<number> {
  return withPlatformDb(ctx, async (tx) => {
    const failed = await tx.update(adLeadEvents).set({ status: "received", error: null }).where(eq(adLeadEvents.status, "failed")).returning({ id: adLeadEvents.id, companyId: adLeadEvents.companyId });
    for (const f of failed) await enqueue(tx, { companyId: f.companyId, kind: "ad_lead_record", key: `adlead:${f.id}:retry:${Date.now()}`, payload: { eventId: f.id }, maxAttempts: 8 });
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "ops.ad_leads_retried", details: { count: failed.length }, requestId });
    return failed.length;
  });
}

/** Re-imports ad numbers for a date range (replaces those days; at most 90 days). */
export async function reimportAdRange(ctx: PlatformContext, companyId: string, platform: string, from: string, to: string, requestId?: string) {
  if (!isId(companyId) || (platform !== "meta" && platform !== "google")) throw new UserError("Choose a company and platform.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new UserError("Enter a valid date range.");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 89) throw new UserError("Re-import at most 90 days at a time.");
  return withPlatformDb(ctx, async (tx) => {
    const [c] = await tx.select().from(adConnections).where(and(eq(adConnections.companyId, companyId), eq(adConnections.platform, platform), eq(adConnections.status, "connected")));
    if (!c) throw new UserError("That company has no working connection for this platform.");
    await enqueue(tx, { companyId, kind: "ad_metrics_sync", key: `adsync:${c.id}:range:${from}:${to}:${Date.now()}`, payload: { connectionId: c.id, from, to } });
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "ops.ad_reimport", targetType: "ad_connection", targetId: c.id, details: { platform, from, to }, requestId });
  });
}

/** The client's emergency stop, used by Bluewater (e.g. a provider incident). Stopped follow-ups never restart. */
export async function adminSetAutomationPause(ctx: PlatformContext, companyId: string, paused: boolean, reason: string, requestId?: string) {
  if (!isId(companyId)) throw new UserError("Company not found.");
  if (paused && reason.trim().length < 3) throw new UserError("Give a reason (it's shown to the client).");
  return withPlatformDb(ctx, async (tx) => {
    const [co] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    if (!co) throw new UserError("Company not found.");
    await tx.insert(messagingSettings).values({ companyId }).onConflictDoNothing();
    await tx.update(messagingSettings).set({ automationPaused: paused, automationPausedReason: paused ? `Paused by Bluewater: ${reason.trim().slice(0, 200)}` : null, automationPausedAt: paused ? new Date() : null, updatedAt: new Date() })
      .where(eq(messagingSettings.companyId, companyId));
    const stopped = paused ? await stopEnrollments(tx, companyId, { allInCompany: true }, "paused_all", `Paused by Bluewater: ${reason.trim().slice(0, 200)}`, { userId: ctx.userId, type: "system" }) : 0;
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: paused ? "automation.paused" : "automation.resumed", details: { reason, by: "bluewater", stoppedFollowUps: stopped }, requestId });
  });
}

/**
 * Redacted diagnostics for one company: counts, statuses and error messages only — no names, emails, phone
 * numbers, message text or tokens — so it can be shared with a developer or provider support.
 */
export async function diagnostics(ctx: PlatformContext, companyId: string) {
  if (!isId(companyId)) throw new UserError("Company not found.");
  return withPlatformDb(ctx, async (tx) => {
    const [co] = await tx.select({ id: companies.id, package: companies.package, kind: companies.kind, lifecycle: companies.lifecycleStatus, suspended: companies.suspended, timezone: companies.timezone }).from(companies).where(eq(companies.id, companyId));
    if (!co) throw new UserError("Company not found.");
    const q = async <T>(s: ReturnType<typeof sql>) => tx.execute<T & Record<string, unknown>>(s);
    const counts = await q<{ t: string; n: number }>(sql`
      select 'contacts' as t, count(*)::int as n from app.contacts where company_id = ${companyId}
      union all select 'inquiries', count(*)::int from app.inquiries where company_id = ${companyId}
      union all select 'messages', count(*)::int from app.messages where company_id = ${companyId}
      union all select 'enrollments_open', count(*)::int from app.sequence_enrollments where company_id = ${companyId} and status in ('active','paused')
      union all select 'appointments_upcoming', count(*)::int from app.appointments where company_id = ${companyId} and status = 'scheduled' and starts_at > now()
      union all select 'suppressions', count(*)::int from app.suppressions where company_id = ${companyId} and lifted_at is null`);
    const jobsByKind = await q<{ kind: string; status: string; n: number }>(sql`select kind, status, count(*)::int as n from app.jobs where company_id = ${companyId} and updated_at > now() - interval '7 days' group by 1, 2 order by 1, 2`);
    const jobErrors = await q<{ kind: string; status: string; error: string | null; at: Date }>(sql`select kind, status, last_error as error, updated_at as at from app.jobs where company_id = ${companyId} and last_error is not null order by updated_at desc limit 20`);
    const messages7d = await q<{ channel: string; status: string; transport: string; n: number }>(sql`select channel, status, transport, count(*)::int as n from app.messages where company_id = ${companyId} and direction = 'outbound' and created_at > now() - interval '7 days' group by 1, 2, 3`);
    const intake = await q<{ status: string; n: number }>(sql`select status, count(*)::int as n from app.intake_events where company_id = ${companyId} and received_at > now() - interval '7 days' group by 1`);
    const ads = await q<{ platform: string; mode: string; status: string; last_sync_ok_at: Date | null; last_error: string | null }>(sql`select platform, mode, status, last_sync_ok_at, last_error from app.ad_connections where company_id = ${companyId}`);
    const booking = await q<{ status: string; last_event_at: Date | null; last_error: string | null }>(sql`select status, last_event_at, last_error from app.booking_settings where company_id = ${companyId}`);
    const senders = await q<{ channel: string; status: string }>(sql`select channel, status from app.company_senders where company_id = ${companyId}`);
    await audit(tx, { companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "ops.diagnostics_exported" });
    return {
      generatedAt: new Date().toISOString(), environment: env().APP_ENV, note: "Redacted: no names, contact details, message text or credentials.",
      company: co, counts, jobsByKind, jobErrors, messages7d, intake7d: intake, adConnections: ads, booking, senders,
    };
  });
}

/** Evidence of an operational check (backup verified, restore test, load test, deployment check). */
export async function recordOpsCheck(ctx: PlatformContext, input: { kind: string; result: string; summary: string; details?: Record<string, unknown> }, requestId?: string) {
  if (!["backup_check", "restore_test", "load_test", "deploy_check"].includes(input.kind)) throw new UserError("Choose what was checked.");
  if (!["passed", "failed", "partial"].includes(input.result)) throw new UserError("Choose the result.");
  if (input.summary.trim().length < 10) throw new UserError("Describe what was checked and what you saw (a sentence or two).");
  return withPlatformDb(ctx, async (tx) => {
    await tx.insert(opsRecords).values({ kind: input.kind, result: input.result, environment: env().APP_ENV, summary: input.summary.trim().slice(0, 2000), details: input.details ?? {}, recordedByUserId: ctx.userId });
    await audit(tx, { companyId: null, actorUserId: ctx.userId, actorType: "platform_admin", action: "ops.check_recorded", details: { kind: input.kind, result: input.result }, requestId });
  });
}
