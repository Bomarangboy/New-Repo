import { and, desc, eq, sql } from "drizzle-orm";
import { withPlatformDb } from "@/lib/db/context";
import { companies, jobs, messages, messageStatusEvents } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { env, isSimulatedEnvironment } from "@/lib/env";
import type { PlatformContext } from "@/lib/authz/context-types";

/** Administrator Health & Recovery data (Stage 3 portion: jobs and messaging). */
export async function healthSnapshot(ctx: PlatformContext) {
  const t0 = Date.now();
  return withPlatformDb(ctx, async (tx) => {
    await tx.execute(sql`select 1`);
    const dbMs = Date.now() - t0;
    const [q] = await tx.execute<{ queued: number; due: number; oldest_due: Date | null; running: number; dead: number }>(sql`
      select count(*) filter (where status = 'queued')::int as queued,
             count(*) filter (where status = 'queued' and run_at <= now())::int as due,
             min(run_at) filter (where status = 'queued' and run_at <= now()) as oldest_due,
             count(*) filter (where status = 'running')::int as running,
             count(*) filter (where status = 'dead')::int as dead
      from app.jobs where kind <> 'system_marker'`);
    const [maint] = await tx.execute<{ v: string | null }>(sql`select result as v from app.jobs where idempotency_key = 'system:maintenance:last'`);
    const msg24 = await tx.execute<{ status: string; transport: string; n: number }>(sql`
      select status, transport, count(*)::int as n from app.messages where direction = 'outbound' and created_at > now() - interval '24 hours' group by 1, 2 order by 1`);
    const deadJobs = await tx.select({ id: jobs.id, kind: jobs.kind, attempts: jobs.attempts, lastError: jobs.lastError, updatedAt: jobs.updatedAt, company: companies.name })
      .from(jobs).leftJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.status, "dead")).orderBy(desc(jobs.updatedAt)).limit(50);
    const unknown = await tx.select({ id: messages.id, channel: messages.channel, to: messages.toAddress, transport: messages.transport, reason: messages.statusReason, providerId: messages.providerMessageId, createdAt: messages.createdAt, company: companies.name })
      .from(messages).innerJoin(companies, eq(companies.id, messages.companyId)).where(eq(messages.status, "unknown")).orderBy(desc(messages.createdAt)).limit(50);
    const adProblems = await tx.execute<{ company: string; platform: string; status: string; last_error: string | null; last_sync_ok_at: Date | null; failed_leads: number }>(sql`
      select co.name as company, c.platform, c.status, c.last_error, c.last_sync_ok_at,
        (select count(*)::int from app.ad_lead_events e where e.company_id = c.company_id and e.platform = c.platform and e.status = 'failed' and e.received_at > now() - interval '7 days') as failed_leads
      from app.ad_connections c join app.companies co on co.id = c.company_id
      where c.status <> 'disconnected' and (c.status <> 'connected' or c.last_error is not null
        or exists (select 1 from app.ad_lead_events e where e.company_id = c.company_id and e.platform = c.platform and e.status = 'failed' and e.received_at > now() - interval '7 days'))
      order by co.name limit 50`);
    const e = env();
    return {
      adProblems: adProblems.map((r) => ({ ...r, lastSyncOkAt: r.last_sync_ok_at ? new Date(r.last_sync_ok_at) : null })),
      ads: { live: e.ADS_LIVE_ENABLED, metaApp: Boolean(e.META_APP_ID && e.META_APP_SECRET), googleApp: Boolean(e.GOOGLE_OAUTH_CLIENT_ID && e.GOOGLE_ADS_DEVELOPER_TOKEN) },
      dbMs,
      queue: { queued: q!.queued, due: q!.due, oldestDueSeconds: q!.oldest_due ? Math.round((Date.now() - new Date(q!.oldest_due).getTime()) / 1000) : null, running: q!.running, dead: q!.dead },
      lastMaintenance: maint?.v ? new Date(maint.v) : null,
      lastMaintenanceMinutesAgo: maint?.v ? (Date.now() - new Date(maint.v).getTime()) / 60000 : null,
      messages24h: msg24,
      deadJobs, unknown,
      sending: { appEnv: e.APP_ENV, liveSwitch: e.LIVE_SENDING_ENABLED, simulated: isSimulatedEnvironment() },
    };
  });
}

/**
 * Resolving an "unconfirmed" message after checking the provider's own log.
 * Nothing is re-sent from here; if it wasn't sent, a person decides whether to contact the lead.
 */
export async function resolveUnknownMessage(ctx: PlatformContext, messageId: string, outcome: "submitted" | "failed", note: string, requestId?: string) {
  if (note.trim().length < 5) throw new UserError("Note what the provider's log showed.");
  return withPlatformDb(ctx, async (tx) => {
    const [m] = await tx.update(messages).set({ status: outcome, statusReason: `Resolved by Bluewater: ${note.trim().slice(0, 200)}`, statusUpdatedAt: new Date(), ...(outcome === "failed" ? { failedAt: new Date() } : { submittedAt: new Date() }) })
      .where(and(eq(messages.id, messageId), eq(messages.status, "unknown"))).returning();
    if (!m) throw new UserError("That message isn't waiting for review.");
    await tx.insert(messageStatusEvents).values({ companyId: m.companyId, messageId, status: outcome, providerStatus: "manual_resolution", applied: true, occurredAt: new Date() });
    await audit(tx, { companyId: m.companyId, actorUserId: ctx.userId, actorType: "platform_admin", action: "messaging.unknown_resolved", targetType: "message", targetId: messageId, details: { outcome, note }, requestId });
  });
}
