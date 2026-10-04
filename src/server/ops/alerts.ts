import { and, eq, inArray, sql } from "drizzle-orm";
import { withSystemDb } from "@/lib/db/context";
import { opsAlerts, platformSettings, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { sendSystemEmail } from "@/lib/system-email";

/**
 * Operational alerts (docs/MONITORING.md). Each minute the maintenance step measures a few things; a problem
 * OPENS an alert (one email to the administrators), stays open while it lasts (no repeat emails), and RESOLVES
 * by itself when the measurement is healthy again (one "recovered" email). Alerts are grouped by key, so a
 * burst of 50 failures is one alert, not 50 emails.
 *
 * The one thing the app can't watch is itself being down: that's the external uptime monitor's job,
 * pointed at /api/health (independent alert route).
 */
export interface Finding { key: string; severity: "warning" | "critical"; title: string; detail: string; companyId?: string | null }

export const THRESHOLDS = {
  queueDelayMinutes: 10,
  messageFailurePct: 20,
  messageFailureMin: 10,
  /** Supabase Pro includes 8 GB; warn well before. Changeable in platform settings ("db_warn_gb"). */
  dbWarnGb: 6,
};

/** Takes the measurements. Pure SQL; no external calls. */
export async function measure(now = new Date()): Promise<Finding[]> {
  return withSystemDb("ops: measure", async (tx) => {
    const f: Finding[] = [];
    const [q] = await tx.execute<{ oldest: Date | null; dead: number }>(sql`
      select min(run_at) filter (where status = 'queued' and run_at <= now()) as oldest,
             count(*) filter (where status = 'dead' and updated_at > now() - interval '7 days')::int as dead
      from app.jobs where kind <> 'system_marker'`);
    const delay = q?.oldest ? (now.getTime() - new Date(q.oldest).getTime()) / 60_000 : 0;
    if (delay > THRESHOLDS.queueDelayMinutes) f.push({ key: "queue:delayed", severity: "critical", title: "Background work is delayed", detail: `The oldest waiting job has waited ${Math.round(delay)} minutes. Leads are stored; acknowledgments and alerts may be late.` });
    if ((q?.dead ?? 0) > 0) f.push({ key: "jobs:dead", severity: "warning", title: "Some background jobs gave up", detail: `${q!.dead} job(s) failed repeatedly in the last 7 days. Review them on Health.` });

    const [intake] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.intake_events where status = 'failed' and received_at > now() - interval '24 hours'`);
    if ((intake?.n ?? 0) > 0) f.push({ key: "intake:failed", severity: "warning", title: "Website submissions waiting to be processed", detail: `${intake!.n} submission(s) were stored but not yet turned into leads. Retry them on Health.` });

    const [unk] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.messages where status = 'unknown'`);
    if ((unk?.n ?? 0) > 0) f.push({ key: "messages:unknown", severity: "warning", title: "Messages with an unconfirmed result", detail: `${unk!.n} message(s) may or may not have reached the person. Check with the provider and resolve on Health.` });

    const [mf] = await tx.execute<{ total: number; failed: number }>(sql`
      select count(*)::int as total, count(*) filter (where status = 'failed')::int as failed
      from app.messages where direction = 'outbound' and created_at > now() - interval '1 hour' and transport <> 'simulated'`);
    if ((mf?.total ?? 0) >= THRESHOLDS.messageFailureMin && (mf!.failed / mf!.total) * 100 > THRESHOLDS.messageFailurePct) {
      f.push({ key: "messages:failure_rate", severity: "critical", title: "Many messages are failing", detail: `${mf!.failed} of ${mf!.total} real messages failed in the last hour. Check the provider dashboards (Twilio/Postmark) and consider pausing automation.` });
    }

    const ads = await tx.execute<{ company_id: string; name: string; platform: string }>(sql`
      select c.company_id, co.name, c.platform from app.ad_connections c join app.companies co on co.id = c.company_id where c.status = 'needs_reconnect'`);
    for (const a of ads) f.push({ key: `ads:reconnect:${a.company_id}:${a.platform}`, severity: "warning", companyId: a.company_id, title: `${a.name}: ${a.platform === "meta" ? "Meta" : "Google Ads"} needs reconnecting`, detail: "Leads from that platform may not arrive until the client signs in again (Connected Accounts)." });

    const adLeads = await tx.execute<{ company_id: string; name: string; n: number }>(sql`
      select e.company_id, co.name, count(*)::int as n from app.ad_lead_events e join app.companies co on co.id = e.company_id
      where e.status = 'failed' and e.received_at > now() - interval '24 hours' group by 1, 2`);
    for (const a of adLeads) f.push({ key: `ads:leads_failed:${a.company_id}`, severity: "warning", companyId: a.company_id, title: `${a.name}: ad leads couldn't be recorded`, detail: `${a.n} lead-form lead(s) failed in the last 24 hours.` });

    const usage = await tx.execute<{ company_id: string; name: string; used: number; lim: number }>(sql`
      select b.company_id, co.name, coalesce(sum(m.segments), 0)::int as used, b.sms_monthly_limit as lim
      from app.company_billing b join app.companies co on co.id = b.company_id
      left join app.messages m on m.company_id = b.company_id and m.direction = 'outbound' and m.channel = 'sms'
        and m.status in ('submitted','delivered','sending','unknown') and m.created_at >= date_trunc('month', now())
      where b.sms_monthly_limit is not null group by 1, 2, 4`);
    for (const u of usage) {
      if (u.used >= u.lim) f.push({ key: `usage:sms:${u.company_id}:100`, severity: "warning", companyId: u.company_id, title: `${u.name}: monthly text limit reached`, detail: `${u.used} of ${u.lim} text segments used this month.` });
      else if (u.used >= u.lim * 0.8) f.push({ key: `usage:sms:${u.company_id}:80`, severity: "warning", companyId: u.company_id, title: `${u.name}: 80% of the monthly text limit used`, detail: `${u.used} of ${u.lim} text segments used this month.` });
    }

    const overdue = await tx.execute<{ company_id: string; name: string; n: number }>(sql`
      select i.company_id, co.name, count(*)::int as n from app.invoices i join app.companies co on co.id = i.company_id
      left join app.company_billing b on b.company_id = i.company_id
      where i.status = 'failed' or (i.status = 'sent' and i.due_date is not null and i.due_date + coalesce(b.grace_days, 14) < current_date)
      group by 1, 2`);
    for (const o of overdue) f.push({ key: `billing:overdue:${o.company_id}`, severity: "warning", companyId: o.company_id, title: `${o.name}: payment overdue`, detail: `${o.n} invoice(s) failed or past the grace period. Service is not paused automatically — decide whether to contact the client or suspend.` });

    const [db] = await tx.execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`);
    const [setting] = await tx.select().from(platformSettings).where(eq(platformSettings.key, "db_warn_gb"));
    const warnGb = Number((setting?.value as { gb?: number } | undefined)?.gb ?? THRESHOLDS.dbWarnGb);
    const gb = Number(db?.bytes ?? 0) / 1024 ** 3;
    if (gb > warnGb) f.push({ key: "db:size", severity: "warning", title: "Database is getting full", detail: `The database uses ${gb.toFixed(1)} GB (warning at ${warnGb} GB). Plan an upgrade or apply the retention policy.` });
    return f;
  });
}

/** Opens new alerts, refreshes ongoing ones, resolves the ones no longer measured. Emails only on changes. */
export async function runOpsChecks(now = new Date()): Promise<{ opened: number; resolved: number }> {
  const findings = await measure(now);
  const changes = await withSystemDb("ops: reconcile alerts", async (tx) => {
    const open = await tx.select().from(opsAlerts).where(eq(opsAlerts.status, "open"));
    const keys = new Set(findings.map((x) => x.key));
    const opened: Finding[] = [];
    for (const x of findings) {
      const cur = open.find((a) => a.key === x.key);
      if (cur) await tx.update(opsAlerts).set({ lastSeenAt: now, detail: x.detail }).where(eq(opsAlerts.id, cur.id));
      else {
        const [row] = await tx.insert(opsAlerts).values({ key: x.key, severity: x.severity, title: x.title, detail: x.detail, companyId: x.companyId ?? null, firstSeenAt: now, lastSeenAt: now })
          .onConflictDoNothing().returning({ id: opsAlerts.id });
        if (row) opened.push(x);
      }
    }
    const gone = open.filter((a) => !keys.has(a.key));
    if (gone.length) await tx.update(opsAlerts).set({ status: "resolved", resolvedAt: now }).where(inArray(opsAlerts.id, gone.map((g) => g.id)));
    return { opened, resolved: gone };
  });
  if (changes.opened.length || changes.resolved.length) await notifyAdmins(changes.opened, changes.resolved.map((r) => ({ key: r.key, title: r.title, since: r.firstSeenAt })), now);
  return { opened: changes.opened.length, resolved: changes.resolved.length };
}

async function notifyAdmins(opened: Finding[], resolved: { key: string; title: string; since: Date }[], now: Date) {
  const admins = await withSystemDb("ops: admins", (tx) => tx.select({ email: users.email }).from(users).where(and(eq(users.isPlatformAdmin, true), eq(users.status, "active"))));
  const lines: string[] = [];
  if (opened.length) lines.push("NEW PROBLEMS", ...opened.map((o) => `• [${o.severity}] ${o.title}\n  ${o.detail}`), "");
  if (resolved.length) lines.push("RECOVERED", ...resolved.map((r) => `• ${r.title} (since ${r.since.toISOString().slice(0, 16).replace("T", " ")} UTC)`), "");
  const subject = opened.length ? `Bluewater alert: ${opened[0]!.title}${opened.length > 1 ? ` (+${opened.length - 1} more)` : ""}` : `Bluewater recovered: ${resolved[0]!.title}${resolved.length > 1 ? ` (+${resolved.length - 1} more)` : ""}`;
  for (const a of admins) {
    await sendSystemEmail({ to: a.email, subject, text: `${lines.join("\n")}\nDetails: ${env().APP_BASE_URL}/admin/health\n(${env().APP_ENV}, ${now.toISOString()})` }).catch(() => undefined);
  }
  await withSystemDb("ops: mark notified", async (tx) => {
    if (opened.length) await tx.update(opsAlerts).set({ notifiedAt: now }).where(and(eq(opsAlerts.status, "open"), inArray(opsAlerts.key, opened.map((o) => o.key))));
    if (resolved.length) await tx.update(opsAlerts).set({ recoveryNotifiedAt: now }).where(and(eq(opsAlerts.status, "resolved"), inArray(opsAlerts.key, resolved.map((o) => o.key)), sql`${opsAlerts.recoveryNotifiedAt} is null`));
  });
}

/** Minimal public status for the external uptime monitor. Reveals nothing about clients. */
export async function publicHealth(now = new Date()): Promise<{ status: "ok" | "degraded" | "down"; checks: Record<string, "ok" | "late" | "failed"> }> {
  try {
    const last = await withSystemDb("health: public", async (tx) => {
      const r = await tx.execute<{ v: string | null }>(sql`select result as v from app.jobs where idempotency_key = 'system:maintenance:last'`);
      return r[0]?.v ? new Date(r[0].v) : null;
    });
    const scheduler = last && now.getTime() - last.getTime() < 5 * 60_000 ? "ok" : "late";
    return { status: scheduler === "ok" ? "ok" : "degraded", checks: { database: "ok", scheduler } };
  } catch {
    return { status: "down", checks: { database: "failed", scheduler: "failed" } };
  }
}
