import { and, count, desc, eq, gte, isNull, lt, sql, sum } from "drizzle-orm";
import { withCompanyDb } from "@/lib/db/context";
import { contacts, inquiries, intakeSources, users } from "@/lib/db/schema";
import { hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { percentChange, periodFor, type Period } from "@/lib/periods";
import { STAGES, type Stage } from "@/server/crm/leads";

/**
 * Overview metrics. Every number is computed from stored records at request time;
 * definitions live in docs/METRICS.md. Values with no data source yet are returned
 * as null (shown as "No data yet"), never as zero.
 */
export interface OverviewMetrics {
  period: Period;
  timezone: string;
  inquiries: { current: number; previous: number; changePct: number | null };
  daily: { date: string; count: number }[];
  bySource: { source: string; label: string | null; count: number }[];
  pipeline: Record<Stage, number> | null;
  sales: { recordedCents: number; wonCount: number; wonWithoutValue: number } | null;
  recent: { id: string; name: string; source: string; sourceLabel: string | null; stage: Stage; submittedAt: Date; assigned: string | null }[];
  sources: { id: string; name: string; active: boolean; lastReceivedAt: Date | null }[];
  unassignedOpen: number;
  messaging: {
    acksSent: number;
    acksFailed: number;
    acksUncertain: number;
    acksSimulated: boolean;
    /** Median seconds from Bluewater receiving the inquiry to the provider accepting the acknowledgment. */
    medianAckSeconds: number | null;
    /** Median seconds from receipt to the first message a PERSON sent (calls are not tracked). */
    medianFirstHumanSeconds: number | null;
    needsReply: number;
    lastAlertAt: Date | null;
    failedAlerts: number;
  };
  computedAt: Date;
}

export async function overviewMetrics(ctx: CompanyContext, days: number, now = new Date()): Promise<OverviewMetrics> {
  const period = periodFor(days, ctx.timezone, now);
  const inPeriod = and(gte(inquiries.submittedAt, period.start), lt(inquiries.submittedAt, period.end));

  return withCompanyDb(ctx, async (tx) => {
    const [{ current }] = (await tx.select({ current: count() }).from(inquiries).where(inPeriod)) as [{ current: number }];
    const [{ previous }] = (await tx.select({ previous: count() }).from(inquiries)
      .where(and(gte(inquiries.submittedAt, period.prevStart), lt(inquiries.submittedAt, period.start)))) as [{ previous: number }];

    const dayExpr = sql<string>`to_char(${inquiries.submittedAt} at time zone ${ctx.timezone}, 'YYYY-MM-DD')`;
    const dailyRows = await tx.select({ day: dayExpr, n: count() }).from(inquiries).where(inPeriod).groupBy(sql`1`);
    const byDay = new Map(dailyRows.map((r) => [r.day, r.n]));
    const daily = period.dayKeys.map((d) => ({ date: d, count: byDay.get(d) ?? 0 }));

    const bySource = await tx.select({ source: inquiries.source, label: inquiries.sourceLabel, count: count() }).from(inquiries)
      .where(inPeriod).groupBy(inquiries.source, inquiries.sourceLabel).orderBy(desc(count()));

    let pipeline: OverviewMetrics["pipeline"] = null;
    if (hasFeature(ctx.package, "pipeline_board")) {
      const rows = await tx.select({ stage: inquiries.stage, n: count() }).from(inquiries).where(inPeriod).groupBy(inquiries.stage);
      pipeline = Object.fromEntries(STAGES.map((s) => [s, rows.find((r) => r.stage === s)?.n ?? 0])) as Record<Stage, number>;
    }

    let sales: OverviewMetrics["sales"] = null;
    if (hasFeature(ctx.package, "outcome_reporting")) {
      const wonInPeriod = and(eq(inquiries.stage, "won"), gte(inquiries.wonAt, period.start), lt(inquiries.wonAt, period.end));
      const [s] = await tx.select({ cents: sum(inquiries.saleValueCents), won: count() }).from(inquiries).where(wonInPeriod);
      const [{ nov }] = (await tx.select({ nov: count() }).from(inquiries).where(and(wonInPeriod, isNull(inquiries.saleValueCents)))) as [{ nov: number }];
      sales = { recordedCents: Number(s?.cents ?? 0), wonCount: s?.won ?? 0, wonWithoutValue: nov };
    }

    const recent = await tx.select({
      id: inquiries.id, name: contacts.fullName, email: contacts.email, phone: contacts.phone, source: inquiries.source, sourceLabel: inquiries.sourceLabel,
      stage: inquiries.stage, submittedAt: inquiries.submittedAt, assigned: users.fullName,
    }).from(inquiries).innerJoin(contacts, eq(contacts.id, inquiries.contactId)).leftJoin(users, eq(users.id, inquiries.assignedUserId))
      .orderBy(desc(inquiries.submittedAt)).limit(5);

    const sources = await tx.select({ id: intakeSources.id, name: intakeSources.name, active: intakeSources.active, lastReceivedAt: intakeSources.lastReceivedAt })
      .from(intakeSources).orderBy(desc(intakeSources.active), intakeSources.name);

    const [{ unassignedOpen }] = (await tx.select({ unassignedOpen: count() }).from(inquiries)
      .where(and(isNull(inquiries.assignedUserId), sql`${inquiries.stage} in ('new','contacted')`))) as [{ unassignedOpen: number }];

    const ackRows = await tx.execute<{ sent: number; failed: number; uncertain: number; simulated: number; median: number | null }>(sql`
      select count(*) filter (where m.status in ('submitted','delivered'))::int as sent,
             count(*) filter (where m.status = 'failed')::int as failed,
             count(*) filter (where m.status = 'unknown')::int as uncertain,
             count(*) filter (where m.transport = 'simulated')::int as simulated,
             percentile_cont(0.5) within group (order by extract(epoch from (m.submitted_at - i.received_at))) filter (where m.submitted_at is not null) as median
      from app.messages m join app.inquiries i on i.id = m.inquiry_id
      where m.kind = 'acknowledgment' and i.submitted_at >= ${period.start.toISOString()} and i.submitted_at < ${period.end.toISOString()}`);
    const human = await tx.execute<{ median: number | null }>(sql`
      select percentile_cont(0.5) within group (order by secs) as median from (
        select extract(epoch from (min(m.created_at) - i.received_at)) as secs
        from app.inquiries i join app.messages m on m.contact_id = i.contact_id and m.kind = 'manual' and m.created_at >= i.received_at
        where i.submitted_at >= ${period.start.toISOString()} and i.submitted_at < ${period.end.toISOString()} and i.source <> 'csv_import'
        group by i.id, i.received_at) t`);
    const [{ needsReply }] = (await tx.execute<{ needsReply: number }>(sql`select count(*)::int as "needsReply" from app.conversations where needs_reply`)) as unknown as [{ needsReply: number }];
    const [alerts] = await tx.execute<{ last: Date | null; failed: number }>(sql`
      select max(created_at) as last, count(*) filter (where email_status = 'failed' and created_at >= ${period.start.toISOString()})::int as failed from app.notifications`);
    const a = ackRows[0]!;
    const messaging = {
      acksSent: a.sent, acksFailed: a.failed, acksUncertain: a.uncertain, acksSimulated: a.simulated > 0,
      medianAckSeconds: a.median == null ? null : Math.round(Number(a.median)),
      medianFirstHumanSeconds: human[0]?.median == null ? null : Math.round(Number(human[0].median)),
      needsReply, lastAlertAt: alerts?.last ? new Date(alerts.last) : null, failedAlerts: alerts?.failed ?? 0,
    };

    return {
      period, timezone: ctx.timezone, messaging,
      inquiries: { current, previous, changePct: percentChange(current, previous) },
      daily, bySource, pipeline, sales,
      recent: recent.map((r) => ({ ...r, name: r.name || r.email || r.phone || "Unnamed" })),
      sources, unassignedOpen, computedAt: new Date(),
    };
  });
}
