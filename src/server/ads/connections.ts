import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { withCompanyDb } from "@/lib/db/context";
import { adAccounts, adConnections, adLeadEvents, adLeadSources, adSyncRuns } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { decrypt, encrypt, newToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { roleCan, type Action } from "@/lib/authz/permissions";
import { hasFeature } from "@/lib/authz/entitlements";
import type { CompanyContext } from "@/lib/authz/context-types";
import { webhookKeyHash } from "@/server/messaging/webhooks";
import { enqueue } from "@/server/jobs/queue";
import { adsMode, PLATFORM_NAMES, signState, verifyState, type AdPlatform } from "./config";
import { clientFor } from "./clients";
import type { AdAccountInfo, PageInfo, TokenSet } from "./clients/types";
import { describeAdsError } from "./errors";

function need(ctx: CompanyContext, action: Action) {
  if (!roleCan(ctx.role, action)) throw new UserError("You don't have permission to do that.");
  if (!action.endsWith(".view") && ctx.policy.login !== "full") throw new UserError("This account is read-only right now, so changes can't be saved.");
}
const actorType = (ctx: CompanyContext) => (ctx.supportGrantId ? "support" : "user") as "support" | "user";
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const asPlatform = (p: string): AdPlatform => { if (p !== "meta" && p !== "google") throw new UserError("Unknown platform."); return p; };

/* ---------------- Reading (never returns tokens or key hashes) ---------------- */

export async function adsOverview(ctx: CompanyContext) {
  need(ctx, "integration.view");
  return withCompanyDb(ctx, async (tx) => {
    const conns = await tx.select().from(adConnections);
    const accounts = await tx.select().from(adAccounts).orderBy(asc(adAccounts.name));
    const sources = await tx.select().from(adLeadSources).orderBy(asc(adLeadSources.name));
    const problems = await tx.select({ sourceId: adLeadEvents.leadSourceId, n: count() }).from(adLeadEvents)
      .where(and(eq(adLeadEvents.status, "failed"), sql`${adLeadEvents.receivedAt} > now() - interval '30 days'`)).groupBy(adLeadEvents.leadSourceId);
    const recentLeads = await tx.select({ sourceId: adLeadEvents.leadSourceId, n: count() }).from(adLeadEvents)
      .where(and(eq(adLeadEvents.status, "recorded"), sql`${adLeadEvents.receivedAt} > now() - interval '7 days'`)).groupBy(adLeadEvents.leadSourceId);
    const lastRuns = await tx.select().from(adSyncRuns).orderBy(desc(adSyncRuns.startedAt)).limit(10);
    return (["meta", "google"] as AdPlatform[]).map((p) => {
      const c = conns.find((x) => x.platform === p && x.status !== "disconnected") ?? null;
      return {
        platform: p, name: PLATFORM_NAMES[p], mode: adsMode(p, ctx.companyKind),
        reportingIncluded: hasFeature(ctx.package, "ad_reporting"),
        connection: c && {
          id: c.id, mode: c.mode, status: c.status, accountLabel: c.accountLabel, connectedAt: c.connectedAt, tokenExpiresAt: c.tokenExpiresAt,
          expiresSoon: Boolean(c.tokenExpiresAt && c.tokenExpiresAt.getTime() - Date.now() < 14 * 86_400_000),
          lastSyncAt: c.lastSyncAt, lastSyncOkAt: c.lastSyncOkAt, lastError: c.lastError, lastErrorAt: c.lastErrorAt, scopes: c.scopes,
        },
        accounts: c ? accounts.filter((a) => a.connectionId === c.id).map((a) => ({ id: a.id, externalId: a.externalId, name: a.name, currency: a.currency, timezone: a.timezone, selected: a.selected })) : [],
        sources: sources.filter((s) => s.platform === p && (s.kind === "google_webhook" || (c && s.connectionId === c.id))).map((s) => ({
          id: s.id, kind: s.kind, name: s.name, mode: s.mode, active: s.active, verifiedAt: s.verifiedAt, lastLeadAt: s.lastLeadAt, lastError: s.lastError,
          failed: problems.find((x) => x.sourceId === s.id)?.n ?? 0, last7Days: recentLeads.find((x) => x.sourceId === s.id)?.n ?? 0,
        })),
        lastRun: c ? lastRuns.find((r) => r.connectionId === c.id) ?? null : null,
      };
    });
  });
}

/* ---------------- Connecting ---------------- */

/** Live: returns the platform's sign-in address (state bound to this company, user and browser). Simulated: connects now. */
export async function beginConnect(ctx: CompanyContext, platformRaw: string): Promise<{ kind: "redirect"; url: string; nonce: string } | { kind: "connected" }> {
  need(ctx, "integration.manage");
  const platform = asPlatform(platformRaw);
  const mode = adsMode(platform, ctx.companyKind);
  if (mode === "unavailable") throw new UserError(`${PLATFORM_NAMES[platform]} connections aren't available yet — Bluewater is waiting for the platform's approval.`);
  const client = clientFor(platform, mode, ctx.companyId);
  if (mode === "simulated") {
    await completeConnect(ctx, platform, await client.exchangeCode("simulated"));
    return { kind: "connected" };
  }
  const nonce = newToken(16);
  const state = signState({ c: ctx.companyId, u: ctx.userId, p: platform, n: nonce, e: Date.now() + 10 * 60_000 });
  return { kind: "redirect", url: client.authorizeUrl(state), nonce };
}

/** The platform sent the person back. Everything is re-verified: state signature, expiry, browser, company and user. */
export async function finishOAuth(ctx: CompanyContext, platformRaw: string, code: string | null, state: string | null, nonceCookie: string | null) {
  need(ctx, "integration.manage");
  const platform = asPlatform(platformRaw);
  const s = verifyState(state, nonceCookie);
  if (!s || s.p !== platform || s.c !== ctx.companyId || s.u !== ctx.userId) throw new UserError("That sign-in link expired or wasn't started here. Please press Connect again.");
  if (!code) throw new UserError("The connection was cancelled on the platform's page. Nothing was changed.");
  if (adsMode(platform, ctx.companyKind) !== "live") throw new UserError("Live connections aren't switched on.");
  const tokens = await clientFor(platform, "live").exchangeCode(code);
  await completeConnect(ctx, platform, tokens);
}

/** Saves tokens (encrypted) and what the connection can see. Platform calls happen before the database transaction. */
export async function completeConnect(ctx: CompanyContext, platform: AdPlatform, tokens: TokenSet, requestId?: string) {
  const mode = adsMode(platform, ctx.companyKind) === "live" ? "live" : "simulated";
  const client = clientFor(platform, mode, ctx.companyId);
  const accounts: AdAccountInfo[] = await client.listAdAccounts(tokens);
  const pages: PageInfo[] = platform === "meta" ? await client.listPages(tokens) : [];
  const reporting = hasFeature(ctx.package, "ad_reporting");
  return withCompanyDb(ctx, async (tx) => {
    const now = new Date();
    const values = {
      mode, status: "connected", accountLabel: tokens.label ?? null, accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null, tokenExpiresAt: tokens.expiresAt ?? null, scopes: tokens.scopes ?? [],
      connectedByUserId: ctx.userId, connectedAt: now, lastError: null, lastErrorAt: null, disconnectedAt: null, updatedAt: now,
    };
    const [conn] = await tx.insert(adConnections).values({ companyId: ctx.companyId, platform, ...values })
      .onConflictDoUpdate({ target: [adConnections.companyId, adConnections.platform], set: values }).returning();
    for (const a of accounts) {
      await tx.insert(adAccounts).values({ companyId: ctx.companyId, connectionId: conn!.id, platform, externalId: a.externalId, name: a.name.slice(0, 200), currency: a.currency, timezone: a.timezone })
        .onConflictDoUpdate({ target: [adAccounts.companyId, adAccounts.platform, adAccounts.externalId], set: { connectionId: conn!.id, name: a.name.slice(0, 200), currency: a.currency, timezone: a.timezone, updatedAt: now } });
    }
    const selectable = accounts.filter((a) => a.selectable);
    if (reporting && selectable.length === 1) {
      await tx.update(adAccounts).set({ selected: true }).where(and(eq(adAccounts.platform, platform), eq(adAccounts.externalId, selectable[0]!.externalId)));
    }
    for (const p of pages) {
      const [existing] = await tx.select({ id: adLeadSources.id }).from(adLeadSources).where(and(eq(adLeadSources.kind, "meta_page"), eq(adLeadSources.externalId, p.externalId)));
      const patch = { connectionId: conn!.id, name: p.name.slice(0, 200), mode, pageTokenEnc: p.pageToken ? encrypt(p.pageToken) : null, updatedAt: now };
      if (existing) await tx.update(adLeadSources).set(patch).where(eq(adLeadSources.id, existing.id));
      else await tx.insert(adLeadSources).values({ companyId: ctx.companyId, platform, kind: "meta_page", externalId: p.externalId, active: false, ...patch });
    }
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "ads.connected", targetType: "ad_connection", targetId: conn!.id,
      details: { platform, mode, accounts: accounts.length, pages: pages.length }, requestId });
    if (reporting) await enqueue(tx, { companyId: ctx.companyId, kind: "ad_metrics_sync", key: `adsync:${conn!.id}:connect:${now.getTime()}`, payload: { connectionId: conn!.id } });
    return conn!.id;
  });
}

/** Package 3: which ad accounts are included in reports. */
export async function selectAdAccounts(ctx: CompanyContext, platformRaw: string, accountIds: string[], requestId?: string) {
  need(ctx, "integration.manage");
  const platform = asPlatform(platformRaw);
  if (!hasFeature(ctx.package, "ad_reporting")) throw new UserError("Ad reporting is part of Package 3.");
  const ids = accountIds.filter(isId);
  return withCompanyDb(ctx, async (tx) => {
    const [conn] = await tx.select().from(adConnections).where(and(eq(adConnections.platform, platform), sql`${adConnections.status} <> 'disconnected'`));
    if (!conn) throw new UserError("Connect the platform first.");
    await tx.update(adAccounts).set({ selected: false, updatedAt: new Date() }).where(eq(adAccounts.connectionId, conn.id));
    if (ids.length) await tx.update(adAccounts).set({ selected: true, updatedAt: new Date() }).where(and(eq(adAccounts.connectionId, conn.id), inArray(adAccounts.id, ids)));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "ads.accounts_selected", targetType: "ad_connection", targetId: conn.id, details: { platform, selected: ids.length }, requestId });
    await enqueue(tx, { companyId: ctx.companyId, kind: "ad_metrics_sync", key: `adsync:${conn.id}:select:${Date.now()}`, payload: { connectionId: conn.id } });
  });
}

/** Turn lead receiving on/off for a Facebook Page. A Page can feed only one Bluewater company. */
export async function setPageReceiving(ctx: CompanyContext, sourceId: string, on: boolean, requestId?: string) {
  need(ctx, "integration.manage");
  if (!isId(sourceId)) throw new UserError("Page not found.");
  const src = await withCompanyDb(ctx, async (tx) => (await tx.select().from(adLeadSources).where(and(eq(adLeadSources.id, sourceId), eq(adLeadSources.kind, "meta_page"))))[0] ?? null);
  if (!src) throw new UserError("Page not found.");
  if (on) {
    // Tell Meta to send this Page's lead notifications to Bluewater (live), before marking it active.
    await clientFor("meta", src.mode).subscribePage({ externalId: src.externalId!, name: src.name, pageToken: src.pageTokenEnc ? decrypt(src.pageTokenEnc) : null });
  }
  try {
    await withCompanyDb(ctx, async (tx) => {
      await tx.update(adLeadSources).set({ active: on, verifiedAt: on ? new Date() : src.verifiedAt, lastCheckedAt: on && !src.lastCheckedAt ? new Date() : src.lastCheckedAt, lastError: null, updatedAt: new Date() }).where(eq(adLeadSources.id, src.id));
      await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: on ? "ads.page_receiving_on" : "ads.page_receiving_off", targetType: "ad_lead_source", targetId: src.id, details: { name: src.name }, requestId });
    });
  } catch (e) {
    const text = `${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ""}`;
    if (/ad_lead_sources_meta_page_key|duplicate key/.test(text)) throw new UserError("This Facebook Page already sends its leads to another Bluewater account. Contact Bluewater if it should move here.");
    throw e;
  }
}

/** Stops syncing and receiving; history (leads and imported numbers) stays. Live: also tells the platform. */
export async function disconnectPlatform(ctx: CompanyContext, platformRaw: string, requestId?: string) {
  need(ctx, "integration.manage");
  const platform = asPlatform(platformRaw);
  const conn = await withCompanyDb(ctx, async (tx) => (await tx.select().from(adConnections).where(eq(adConnections.platform, platform)))[0] ?? null);
  if (!conn || conn.status === "disconnected") throw new UserError("Not connected.");
  if (conn.accessTokenEnc) {
    await clientFor(platform, conn.mode).revoke({ accessToken: decrypt(conn.accessTokenEnc), refreshToken: conn.refreshTokenEnc ? decrypt(conn.refreshTokenEnc) : null });
  }
  await withCompanyDb(ctx, async (tx) => {
    await tx.update(adConnections).set({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, disconnectedAt: new Date(), updatedAt: new Date() }).where(eq(adConnections.id, conn.id));
    await tx.update(adLeadSources).set({ active: false, pageTokenEnc: null, updatedAt: new Date() }).where(eq(adLeadSources.connectionId, conn.id));
    await tx.update(adAccounts).set({ selected: false }).where(eq(adAccounts.connectionId, conn.id));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "ads.disconnected", targetType: "ad_connection", targetId: conn.id, details: { platform }, requestId });
  });
}

/**
 * Google lead forms deliver leads by webhook (no Google Ads API approval needed). Bluewater generates the address
 * and the "key" the client pastes into the lead form's webhook settings; both are shown once, only hashes are kept.
 */
export async function setUpGoogleLeadWebhook(ctx: CompanyContext, requestId?: string): Promise<{ url: string; key: string }> {
  need(ctx, "integration.manage");
  const path = newToken(24), key = newToken(24);
  await withCompanyDb(ctx, async (tx) => {
    const [existing] = await tx.select({ id: adLeadSources.id }).from(adLeadSources).where(eq(adLeadSources.kind, "google_webhook"));
    const patch = { webhookKeyHash: webhookKeyHash(path), googleKeyHash: webhookKeyHash(key), active: true, verifiedAt: null, lastError: null, updatedAt: new Date() };
    if (existing) await tx.update(adLeadSources).set(patch).where(eq(adLeadSources.id, existing.id));
    else await tx.insert(adLeadSources).values({ companyId: ctx.companyId, platform: "google", kind: "google_webhook", name: "Google Ads lead forms", mode: "live", ...patch });
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: existing ? "ads.google_webhook_replaced" : "ads.google_webhook_created", targetType: "ad_lead_source", requestId });
  });
  return { url: `${env().APP_BASE_URL}/api/webhooks/google-leads/${path}`, key };
}

export async function turnOffGoogleLeadWebhook(ctx: CompanyContext, requestId?: string) {
  need(ctx, "integration.manage");
  await withCompanyDb(ctx, async (tx) => {
    await tx.update(adLeadSources).set({ active: false, webhookKeyHash: null, googleKeyHash: null, updatedAt: new Date() }).where(eq(adLeadSources.kind, "google_webhook"));
    await audit(tx, { companyId: ctx.companyId, actorUserId: ctx.userId, actorType: actorType(ctx), action: "ads.google_webhook_off", targetType: "ad_lead_source", requestId });
  });
}

/** Records a failure on the connection in plain language (used by jobs). */
export async function recordConnectionProblem(tx: Tx, connectionId: string, e: unknown, needsReconnect: boolean) {
  await tx.update(adConnections).set({ lastError: describeAdsError(e), lastErrorAt: new Date(), ...(needsReconnect ? { status: "needs_reconnect" } : {}), updatedAt: new Date() }).where(eq(adConnections.id, connectionId));
}
