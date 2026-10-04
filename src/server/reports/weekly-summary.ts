import { and, eq, sql } from "drizzle-orm";
import { withCompanyDb, withSystemCompanyDb, withSystemDb } from "@/lib/db/context";
import { roleCan } from "@/lib/authz/permissions";
import { UserError } from "@/lib/errors";
import type { CompanyContext } from "@/lib/authz/context-types";
import { companies, memberships, messagingSettings, notifications, users } from "@/lib/db/schema";
import { accountPolicy } from "@/lib/authz/account-policy";
import { hasFeature } from "@/lib/authz/entitlements";
import { env } from "@/lib/env";
import { localDateKey, zonedMidnight } from "@/lib/periods";
import { sendSystemEmail } from "@/lib/system-email";
import { enqueue, type JobOutcome, type JobRow } from "@/server/jobs/queue";

/**
 * Package 3 weekly owner summary (D-36): every Monday from 8:00 local time, owners receive last week's
 * Monday–Sunday numbers by email. Same definitions as the Overview and Reports (docs/METRICS.md); simulated
 * numbers are labeled; nothing is shown as zero when it's unknown. One email per owner per week (unique key).
 */
const DAY = 86_400_000;

function localParts(now: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday as string, hour: Number(p.hour) };
}

/** Last week's Monday 00:00 → this Monday 00:00 in the company's timezone, plus the date keys. */
export function lastWeek(now: Date, tz: string) {
  const todayKey = localDateKey(now, tz);
  const [y, m, d] = todayKey.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const thisMon = new Date(Date.UTC(y, m - 1, d - ((dow + 6) % 7)));
  const lastMon = new Date(thisMon.getTime() - 7 * DAY);
  const key = (x: Date) => x.toISOString().slice(0, 10);
  const start = zonedMidnight(lastMon.getUTCFullYear(), lastMon.getUTCMonth() + 1, lastMon.getUTCDate(), tz);
  const end = zonedMidnight(thisMon.getUTCFullYear(), thisMon.getUTCMonth() + 1, thisMon.getUTCDate(), tz);
  return { start, end, fromDay: key(lastMon), toDay: key(new Date(thisMon.getTime() - DAY)), weekKey: key(lastMon) };
}

export async function scheduleWeeklySummaries(now = new Date()): Promise<number> {
  const rows = await withSystemDb("weekly summary: candidates", (tx) =>
    tx.select({ c: companies, enabled: messagingSettings.weeklySummaryEnabled }).from(companies)
      .leftJoin(messagingSettings, eq(messagingSettings.companyId, companies.id)));
  let n = 0;
  await withSystemDb("weekly summary: schedule", async (tx) => {
    for (const { c, enabled } of rows) {
      if (!hasFeature(c.package, "scheduled_summaries") || enabled === false) continue;
      if (accountPolicy(c, now).login === "none") continue;
      const lp = localParts(now, c.timezone);
      if (lp.weekday !== "Mon" || lp.hour < 8) continue;
      await enqueue(tx, { companyId: c.id, kind: "weekly_summary", key: `weekly:${c.id}:${lastWeek(now, c.timezone).weekKey}`, payload: {} });
      n++;
    }
  });
  return n;
}

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export async function buildWeeklySummary(companyId: string, now = new Date()) {
  return withSystemCompanyDb(companyId, "weekly summary: numbers", async (tx) => {
    const [c] = await tx.select().from(companies).where(eq(companies.id, companyId));
    const w = lastWeek(now, c!.timezone);
    const [leads] = await tx.execute<{ n: number; booked: number; won: number }>(sql`
      select count(*)::int as n, count(*) filter (where stage in ('booked','won'))::int as booked, count(*) filter (where stage = 'won')::int as won
      from app.inquiries where submitted_at >= ${w.start.toISOString()} and submitted_at < ${w.end.toISOString()}`);
    const [sales] = await tx.execute<{ cents: number; count: number; missing: number }>(sql`
      select coalesce(sum(sale_value_cents), 0)::float8 as cents, count(*)::int as count, count(*) filter (where sale_value_cents is null)::int as missing
      from app.inquiries where stage = 'won' and won_at >= ${w.start.toISOString()} and won_at < ${w.end.toISOString()}`);
    const [acks] = await tx.execute<{ sent: number; simulated: number }>(sql`
      select count(*) filter (where status in ('submitted','delivered'))::int as sent, count(*) filter (where transport = 'simulated')::int as simulated
      from app.messages where kind = 'acknowledgment' and created_at >= ${w.start.toISOString()} and created_at < ${w.end.toISOString()}`);
    const [waiting] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.conversations where needs_reply`);
    const [appts] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.appointments where status = 'scheduled' and starts_at >= ${now.toISOString()} and starts_at < ${new Date(now.getTime() + 7 * DAY).toISOString()}`);
    const spend = await tx.execute<{ currency: string; micros: number; simulated: boolean }>(sql`
      select currency, sum(spend_micros)::float8 as micros, bool_or(mode = 'simulated') as simulated from app.ad_daily_metrics
      where day between ${w.fromDay} and ${w.toDay} group by 1`);
    const [credited] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from app.inquiries where source in ('meta_lead_form','google_lead_form') and external_ids ? 'campaign_id'
      and submitted_at >= ${w.start.toISOString()} and submitted_at < ${w.end.toISOString()}`);
    return { company: c!, week: w, leads: leads!, sales: sales!, acks: acks!, waiting: waiting!.n, upcoming: appts!.n, spend, credited: credited!.n };
  });
}

export function summaryText(s: Awaited<ReturnType<typeof buildWeeklySummary>>): { subject: string; text: string } {
  const lines = [
    `Week of ${s.week.fromDay} to ${s.week.toDay} (${s.company.timezone})`, "",
    `New leads: ${s.leads.n}  (now booked or won: ${s.leads.booked}; won: ${s.leads.won})`,
    `Automatic acknowledgments sent: ${s.acks.sent}${s.acks.simulated ? " (simulated — not delivered to real people)" : ""}`,
    `Sales recorded on leads won last week: ${s.sales.count ? usd(s.sales.cents) : "none recorded"}${s.sales.missing ? ` (${s.sales.missing} won without a value — total incomplete)` : ""}`,
    ...(s.spend.length
      ? s.spend.map((x) => `Ad spend (${x.currency}): ${new Intl.NumberFormat("en-US", { style: "currency", currency: x.currency, maximumFractionDigits: 0 }).format(x.micros / 1e6)}${x.simulated ? " (sample numbers from simulated ad accounts)" : ""}`)
      : ["Ad spend: no connected ad account data for last week"]),
    `Ad lead-form leads credited to a campaign: ${s.credited}`,
    "", `Right now: ${s.waiting} conversation(s) waiting for your reply · ${s.upcoming} appointment(s) in the next 7 days`,
    "", `Full details: ${env().APP_BASE_URL}/app/reports?days=7`,
    "How each number is calculated: Help → How numbers are calculated. To stop these emails: Settings → Weekly summary.",
  ];
  return { subject: `${s.company.name}: your week in Bluewater (${s.week.fromDay})`, text: lines.join("\n") };
}

export async function handleWeeklySummary(job: JobRow, now = new Date()): Promise<JobOutcome> {
  const companyId = job.companyId!;
  const s = await buildWeeklySummary(companyId, now);
  if (!hasFeature(s.company.package, "scheduled_summaries")) return { status: "cancelled", result: "Package doesn't include summaries" };
  const owners = await withSystemCompanyDb(companyId, "weekly summary: owners", (tx) =>
    tx.select({ id: users.id, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.companyId, companyId), eq(memberships.role, "owner"), eq(memberships.status, "active"), eq(users.status, "active"))));
  const { subject, text } = summaryText(s);
  let sent = 0;
  for (const o of owners) {
    const fresh = await withSystemCompanyDb(companyId, "weekly summary: record", (tx) =>
      tx.insert(notifications).values({ companyId, userId: o.id, kind: "weekly_summary", refKey: s.week.weekKey, title: subject, emailStatus: "pending" }).onConflictDoNothing().returning({ id: notifications.id }));
    if (!fresh[0]) continue; // already sent to this owner for this week
    let status = "sent";
    try { await sendSystemEmail({ to: o.email, subject, text }); sent++; } catch { status = "failed"; }
    await withSystemCompanyDb(companyId, "weekly summary: status", (tx) => tx.update(notifications).set({ emailStatus: status }).where(eq(notifications.id, fresh[0]!.id)));
  }
  return { status: "succeeded", result: `${sent} sent` };
}

/** Owner setting: weekly summary on/off (Package 3). */
export async function setWeeklySummaryEnabled(ctx: CompanyContext, on: boolean) {
  if (!roleCan(ctx.role, "settings.manage") || ctx.policy.login !== "full") throw new UserError("You don't have permission to do that.");
  if (!hasFeature(ctx.package, "scheduled_summaries")) throw new UserError("Weekly summaries are part of Bluewater Insight.");
  await withCompanyDb(ctx, async (tx) => {
    await tx.insert(messagingSettings).values({ companyId: ctx.companyId, weeklySummaryEnabled: on })
      .onConflictDoUpdate({ target: messagingSettings.companyId, set: { weeklySummaryEnabled: on, updatedAt: new Date() } });
  });
}

export async function weeklySummaryEnabled(ctx: CompanyContext): Promise<boolean | null> {
  if (!hasFeature(ctx.package, "scheduled_summaries")) return null;
  return withCompanyDb(ctx, async (tx) => (await tx.select({ on: messagingSettings.weeklySummaryEnabled }).from(messagingSettings).where(eq(messagingSettings.companyId, ctx.companyId)))[0]?.on ?? true);
}
