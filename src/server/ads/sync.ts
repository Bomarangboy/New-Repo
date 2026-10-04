import { and, between, eq, sql } from "drizzle-orm";
import { withSystemCompanyDb, withSystemDb } from "@/lib/db/context";
import { adAccounts, adCampaigns, adConnections, adDailyMetrics, adSyncRuns, companies } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { hasFeature } from "@/lib/authz/entitlements";
import { localDateKey } from "@/lib/periods";
import { enqueue, type JobOutcome, type JobRow } from "@/server/jobs/queue";
import type { AdPlatform } from "./config";
import { clientFor } from "./clients";
import type { TokenSet } from "./clients/types";
import { AdsAuthError, AdsRateLimitError } from "./errors";
import { recordConnectionProblem } from "./connections";

/**
 * Ad reporting import (Package 3). docs/ADS.md:
 *  - first import: the last 90 days; afterwards: the last 7 days every 6 hours (platforms revise recent days);
 *  - each import REPLACES the account's rows for the dates it covers, in one transaction, so re-imports never
 *    double count and a day revised down to nothing disappears;
 *  - dates are the ad account's own calendar days; amounts stay in the account's currency.
 */
export const BACKFILL_DAYS = 90;
export const REFRESH_DAYS = 7;
const DAY = 86_400_000;

const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Valid tokens for the connection, refreshing Google's access token when it's about to expire. */
async function tokensFor(conn: typeof adConnections.$inferSelect): Promise<TokenSet> {
  if (!conn.accessTokenEnc) throw new AdsAuthError("No access token — the connection was removed.");
  let t: TokenSet = { accessToken: decrypt(conn.accessTokenEnc), refreshToken: conn.refreshTokenEnc ? decrypt(conn.refreshTokenEnc) : null, expiresAt: conn.tokenExpiresAt };
  if (conn.mode === "live" && t.expiresAt && t.expiresAt.getTime() < Date.now() + 5 * 60_000) {
    const r = await clientFor(conn.platform as AdPlatform, conn.mode).refresh(t);
    if (!r) throw new AdsAuthError("The access expired and must be renewed by signing in again.");
    t = r;
    await withSystemCompanyDb(conn.companyId, "ads: store refreshed token", (tx) =>
      tx.update(adConnections).set({ accessTokenEnc: encrypt(t.accessToken), tokenExpiresAt: t.expiresAt ?? null, updatedAt: new Date() }).where(eq(adConnections.id, conn.id)));
  }
  return t;
}

export async function handleAdMetricsSync(job: JobRow, now = new Date()): Promise<JobOutcome> {
  const companyId = job.companyId!;
  const connectionId = String(job.payload.connectionId);
  const ctx = await withSystemCompanyDb(companyId, "ads: load connection", async (tx) => {
    const [conn] = await tx.select().from(adConnections).where(eq(adConnections.id, connectionId));
    const [company] = await tx.select({ package: companies.package }).from(companies).where(eq(companies.id, companyId));
    const accounts = conn ? await tx.select().from(adAccounts).where(and(eq(adAccounts.connectionId, conn.id), eq(adAccounts.selected, true))) : [];
    return { conn: conn ?? null, pkg: company?.package, accounts };
  });
  const { conn, accounts } = ctx;
  if (!conn || conn.status === "disconnected") return { status: "cancelled", result: "Not connected" };
  if (!ctx.pkg || !hasFeature(ctx.pkg, "ad_reporting")) return { status: "cancelled", result: "Package doesn't include ad reporting" };
  if (!accounts.length) return { status: "succeeded", result: "No ad accounts selected" };

  const client = clientFor(conn.platform as AdPlatform, conn.mode);
  let total = 0;
  try {
    const tokens = await tokensFor(conn);
    for (const acct of accounts) {
      const tz = acct.timezone ?? "UTC";
      const today = localDateKey(now, tz);
      const has = await withSystemCompanyDb(companyId, "ads: any metrics yet", async (tx) =>
        (await tx.select({ n: sql<number>`count(*)::int` }).from(adDailyMetrics).where(eq(adDailyMetrics.adAccountId, acct.id)))[0]!.n > 0);
      const from = typeof job.payload.from === "string" ? job.payload.from : addDays(today, -((has ? REFRESH_DAYS : BACKFILL_DAYS) - 1));
      const to = typeof job.payload.to === "string" ? job.payload.to : today;
      const runId = await withSystemCompanyDb(companyId, "ads: start run", async (tx) =>
        (await tx.insert(adSyncRuns).values({ companyId, connectionId: conn.id, kind: "metrics", status: "running", rangeFrom: from, rangeTo: to }).returning({ id: adSyncRuns.id }))[0]!.id);
      const rows = await client.fetchDailyCampaignMetrics(tokens, { externalId: acct.externalId, currency: acct.currency }, from, to);
      await withSystemCompanyDb(companyId, "ads: replace metrics", async (tx) => {
        await tx.delete(adDailyMetrics).where(and(eq(adDailyMetrics.adAccountId, acct.id), between(adDailyMetrics.day, from, to)));
        const seen = new Map<string, { name: string; status: string | null }>();
        for (const r of rows) {
          if (r.day < from || r.day > to) continue;
          seen.set(r.campaignId, { name: r.campaignName, status: r.campaignStatus ?? null });
          await tx.insert(adDailyMetrics).values({
            companyId, adAccountId: acct.id, platform: conn.platform, campaignExternalId: r.campaignId, day: r.day, currency: acct.currency ?? "USD",
            spendMicros: r.spendMicros, impressions: r.impressions, clicks: r.clicks, platformLeads: r.platformLeads, platformConversions: r.platformConversions, mode: conn.mode, fetchedAt: now,
          }).onConflictDoUpdate({ target: [adDailyMetrics.companyId, adDailyMetrics.adAccountId, adDailyMetrics.campaignExternalId, adDailyMetrics.day],
            set: { spendMicros: r.spendMicros, impressions: r.impressions, clicks: r.clicks, platformLeads: r.platformLeads, platformConversions: r.platformConversions, fetchedAt: now } });
        }
        for (const [id, c] of seen) {
          await tx.insert(adCampaigns).values({ companyId, adAccountId: acct.id, platform: conn.platform, externalId: id, name: c.name.slice(0, 300), status: c.status })
            .onConflictDoUpdate({ target: [adCampaigns.companyId, adCampaigns.adAccountId, adCampaigns.externalId], set: { name: c.name.slice(0, 300), status: c.status, updatedAt: now } });
        }
        await tx.update(adSyncRuns).set({ status: "succeeded", rows: rows.length, finishedAt: new Date() }).where(eq(adSyncRuns.id, runId));
      });
      total += rows.length;
    }
    await withSystemCompanyDb(companyId, "ads: sync ok", (tx) =>
      tx.update(adConnections).set({ lastSyncAt: now, lastSyncOkAt: now, lastError: null, lastErrorAt: null, status: "connected", updatedAt: now }).where(eq(adConnections.id, conn.id)));
    return { status: "succeeded", result: `${total} rows` };
  } catch (e) {
    await withSystemCompanyDb(companyId, "ads: sync failed", async (tx) => {
      await tx.update(adSyncRuns).set({ status: "failed", error: (e as Error).message.slice(0, 300), finishedAt: new Date() })
        .where(and(eq(adSyncRuns.connectionId, conn.id), eq(adSyncRuns.status, "running")));
      await tx.update(adConnections).set({ lastSyncAt: now }).where(eq(adConnections.id, conn.id));
      await recordConnectionProblem(tx, conn.id, e, e instanceof AdsAuthError);
    });
    if (e instanceof AdsAuthError) return { status: "cancelled", result: "Needs reconnect" };
    if (e instanceof AdsRateLimitError) return { status: "reschedule", runAt: new Date(now.getTime() + e.retryAfterMs), result: "Rate limited" };
    return { status: "retry", error: (e as Error).message };
  }
}

/**
 * Maintenance (every minute, cheap): queue a metrics import per Package 3 connection every 6 hours, and a
 * missed-lead check per Meta connection every hour. Keys are per time bucket, so each is queued once.
 */
export async function scheduleAdWork(now = new Date()): Promise<number> {
  const conns = await withSystemDb("ads: connections to schedule", (tx) =>
    tx.select({ id: adConnections.id, companyId: adConnections.companyId, platform: adConnections.platform, pkg: companies.package })
      .from(adConnections).innerJoin(companies, eq(companies.id, adConnections.companyId)).where(eq(adConnections.status, "connected")));
  const hour = now.toISOString().slice(0, 13);
  const sixHour = `${now.toISOString().slice(0, 11)}${String(Math.floor(now.getUTCHours() / 6) * 6).padStart(2, "0")}`;
  let n = 0;
  await withSystemDb("ads: schedule", async (tx) => {
    for (const c of conns) {
      if (hasFeature(c.pkg, "ad_reporting")) { await enqueue(tx, { companyId: c.companyId, kind: "ad_metrics_sync", key: `adsync:${c.id}:${sixHour}`, payload: { connectionId: c.id } }); n++; }
      if (c.platform === "meta") { await enqueue(tx, { companyId: c.companyId, kind: "ad_lead_reconcile", key: `adrecon:${c.id}:${hour}`, payload: { connectionId: c.id } }); n++; }
    }
  });
  return n;
}
