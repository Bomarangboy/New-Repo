import { and, eq, gte, lte, sql } from "drizzle-orm";
import { withCompanyDb } from "@/lib/db/context";
import { adAccounts, adCampaigns, adConnections, adDailyMetrics, inquiries } from "@/lib/db/schema";
import { UserError } from "@/lib/errors";
import { roleCan } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { periodFor } from "@/lib/periods";

/**
 * Package 3 reporting. Definitions are in docs/METRICS.md ("Advertising"). Key rules:
 *  - platform numbers (spend, clicks, the platform's own lead/conversion counts) are shown as the platform reports
 *    them, in the ad account's currency and calendar days; currencies are never added together;
 *  - a Bluewater lead is credited to a campaign ONLY when the campaign id arrived with the lead (ad lead forms).
 *    Website leads with ad click ids but no campaign id are counted as "from ads, campaign unknown";
 *  - recorded sales are values your team entered on Won leads; "attributed sales" are those on credited leads.
 */
export const STALE_AFTER_HOURS = 30;
const AD_SOURCES = ["meta_lead_form", "google_lead_form"];

export interface CampaignRow {
  platform: string; accountName: string; campaignId: string; name: string; currency: string;
  spendMicros: number; impressions: number; clicks: number; platformLeads: number | null; platformConversions: number | null;
  leads: number; booked: number; won: number; salesCents: number; wonWithoutValue: number;
}

export async function adReport(ctx: CompanyContext, days: number) {
  if (!roleCan(ctx.role, "report.view")) throw new UserError("You don't have permission to do that.");
  if (!hasFeature(ctx.package, "ad_reporting")) throw new UserError("Advertising reports are part of Bluewater Insight.");
  const p = periodFor(days, ctx.timezone);
  const fromDay = p.dayKeys[0]!, toDay = p.dayKeys[p.dayKeys.length - 1]!;
  return withCompanyDb(ctx, async (tx) => {
    const conns = await tx.select().from(adConnections).where(sql`${adConnections.status} <> 'disconnected'`);
    const metricWhere = and(gte(adDailyMetrics.day, fromDay), lte(adDailyMetrics.day, toDay));

    const byCampaign = await tx.select({
      platform: adDailyMetrics.platform, accountName: adAccounts.name, campaignId: adDailyMetrics.campaignExternalId, name: adCampaigns.name, currency: adDailyMetrics.currency,
      spendMicros: sql<number>`sum(${adDailyMetrics.spendMicros})::float8`, impressions: sql<number>`sum(${adDailyMetrics.impressions})::float8`, clicks: sql<number>`sum(${adDailyMetrics.clicks})::float8`,
      platformLeads: sql<number | null>`sum(${adDailyMetrics.platformLeads})::float8`, platformConversions: sql<number | null>`sum(${adDailyMetrics.platformConversions})::float8`,
      simulated: sql<boolean>`bool_or(${adDailyMetrics.mode} = 'simulated')`,
    }).from(adDailyMetrics).innerJoin(adAccounts, eq(adAccounts.id, adDailyMetrics.adAccountId))
      .leftJoin(adCampaigns, and(eq(adCampaigns.adAccountId, adDailyMetrics.adAccountId), eq(adCampaigns.externalId, adDailyMetrics.campaignExternalId)))
      .where(metricWhere).groupBy(adDailyMetrics.platform, adAccounts.name, adDailyMetrics.campaignExternalId, adCampaigns.name, adDailyMetrics.currency);

    const daily = await tx.select({ day: adDailyMetrics.day, currency: adDailyMetrics.currency, spendMicros: sql<number>`sum(${adDailyMetrics.spendMicros})::float8` })
      .from(adDailyMetrics).where(metricWhere).groupBy(adDailyMetrics.day, adDailyMetrics.currency).orderBy(adDailyMetrics.day);

    // Leads received in the period, with their outcome today.
    const leadRows = await tx.select({
      source: inquiries.source, campaignId: sql<string | null>`${inquiries.externalIds}->>'campaign_id'`,
      fromAds: sql<boolean>`(${inquiries.tracking} ?| array['gclid','gbraid','wbraid','fbclid','msclkid']) or lower(coalesce(${inquiries.tracking}->>'utm_medium','')) in ('cpc','ppc','paid','paid_social','paidsocial')`,
      n: sql<number>`count(*)::int`,
      booked: sql<number>`count(*) filter (where ${inquiries.stage} in ('booked','won'))::int`,
      won: sql<number>`count(*) filter (where ${inquiries.stage} = 'won')::int`,
      salesCents: sql<number>`coalesce(sum(${inquiries.saleValueCents}) filter (where ${inquiries.stage} = 'won'), 0)::float8`,
      wonWithoutValue: sql<number>`count(*) filter (where ${inquiries.stage} = 'won' and ${inquiries.saleValueCents} is null)::int`,
    }).from(inquiries).where(and(gte(inquiries.submittedAt, p.start), lte(inquiries.submittedAt, p.end))).groupBy(sql`1`, sql`2`, sql`3`);

    const platformOf = (source: string) => (source === "meta_lead_form" ? "meta" : source === "google_lead_form" ? "google" : null);
    const credited = new Map<string, { leads: number; booked: number; won: number; salesCents: number; wonWithoutValue: number }>();
    let adUnknownCampaign = 0, adFormNoCampaign = 0;
    for (const r of leadRows) {
      const plat = platformOf(r.source);
      if (plat && r.campaignId) {
        const k = `${plat}:${r.campaignId}`;
        const c = credited.get(k) ?? { leads: 0, booked: 0, won: 0, salesCents: 0, wonWithoutValue: 0 };
        credited.set(k, { leads: c.leads + r.n, booked: c.booked + r.booked, won: c.won + r.won, salesCents: c.salesCents + r.salesCents, wonWithoutValue: c.wonWithoutValue + r.wonWithoutValue });
      } else if (plat) adFormNoCampaign += r.n;
      else if (r.fromAds) adUnknownCampaign += r.n;
    }

    const campaigns: CampaignRow[] = byCampaign.map((c) => {
      const cr = credited.get(`${c.platform}:${c.campaignId}`) ?? { leads: 0, booked: 0, won: 0, salesCents: 0, wonWithoutValue: 0 };
      credited.delete(`${c.platform}:${c.campaignId}`);
      return { platform: c.platform, accountName: c.accountName, campaignId: c.campaignId, name: c.name ?? c.campaignId, currency: c.currency,
        spendMicros: c.spendMicros, impressions: c.impressions, clicks: c.clicks, platformLeads: c.platformLeads, platformConversions: c.platformConversions, ...cr };
    }).sort((a, b) => b.spendMicros - a.spendMicros);
    // Leads credited to a campaign we have no spend for (e.g. account not selected): still shown, spend unknown.
    const unmatched = [...credited.entries()].map(([k, v]) => ({ platform: k.split(":")[0]!, campaignId: k.split(":").slice(1).join(":"), ...v }));

    const totals = new Map<string, { currency: string; spendMicros: number; impressions: number; clicks: number; platformLeads: number | null; leads: number; won: number; salesCents: number }>();
    for (const c of campaigns) {
      const t = totals.get(c.currency) ?? { currency: c.currency, spendMicros: 0, impressions: 0, clicks: 0, platformLeads: null, leads: 0, won: 0, salesCents: 0 };
      totals.set(c.currency, { ...t, spendMicros: t.spendMicros + c.spendMicros, impressions: t.impressions + c.impressions, clicks: t.clicks + c.clicks,
        platformLeads: c.platformLeads == null ? t.platformLeads : (t.platformLeads ?? 0) + c.platformLeads, leads: t.leads + c.leads, won: t.won + c.won, salesCents: t.salesCents + c.salesCents });
    }

    const bySource = new Map<string, { source: string; leads: number; booked: number; won: number; salesCents: number; wonWithoutValue: number }>();
    for (const r of leadRows) {
      const s = bySource.get(r.source) ?? { source: r.source, leads: 0, booked: 0, won: 0, salesCents: 0, wonWithoutValue: 0 };
      bySource.set(r.source, { source: r.source, leads: s.leads + r.n, booked: s.booked + r.booked, won: s.won + r.won, salesCents: s.salesCents + r.salesCents, wonWithoutValue: s.wonWithoutValue + r.wonWithoutValue });
    }

    const now = Date.now();
    return {
      period: { days, fromDay, toDay, start: p.start, end: p.end },
      connections: conns.map((c) => ({
        platform: c.platform, mode: c.mode, status: c.status, lastSyncOkAt: c.lastSyncOkAt, lastError: c.lastError,
        stale: !c.lastSyncOkAt || now - c.lastSyncOkAt.getTime() > STALE_AFTER_HOURS * 3600_000,
      })),
      simulated: byCampaign.some((c) => c.simulated),
      totals: [...totals.values()], campaigns, unmatched, daily,
      adFormNoCampaign, adUnknownCampaign,
      sources: [...bySource.values()].sort((a, b) => b.leads - a.leads),
      anyAdSourceLeads: leadRows.some((r) => AD_SOURCES.includes(r.source)),
    };
  });
}

/** Small summary for the Overview (Package 3): spend and cost per credited lead per currency. */
export async function adSpendSummary(ctx: CompanyContext, days: number) {
  if (!roleCan(ctx.role, "report.view") || !hasFeature(ctx.package, "ad_reporting")) return null;
  const r = await adReport(ctx, days);
  return { totals: r.totals, connected: r.connections.length > 0, stale: r.connections.some((c) => c.stale), simulated: r.simulated, lastSyncOkAt: r.connections.map((c) => c.lastSyncOkAt).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime()).at(-1) ?? null };
}
