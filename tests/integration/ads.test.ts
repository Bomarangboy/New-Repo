import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { closeDb } from "@/lib/db/client";
import { withSystemDb } from "@/lib/db/context";
import { adAccounts, adConnections, adDailyMetrics, adLeadEvents, adLeadSources, adSyncRuns, inquiries, jobs } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import { resolveCompanyContext } from "@/lib/authz/resolve";
import type { CompanyContext } from "@/lib/authz/context-types";
import { runDueJobs } from "@/server/jobs/runner";
import { HANDLERS } from "@/server/jobs/handlers";
import { recordSale } from "@/server/crm/leads";
import { adsOverview, beginConnect, finishOAuth, selectAdAccounts, setPageReceiving, setUpGoogleLeadWebhook, disconnectPlatform } from "@/server/ads/connections";
import { googleLeadWebhook, metaVerify, metaWebhook, sendSimulatedAdLead } from "@/server/ads/leads";
import { scheduleAdWork } from "@/server/ads/sync";
import { signState } from "@/server/ads/config";
import { adReport } from "@/server/ads/reports";
import { setAdsFetchForTests } from "@/server/ads/clients/types";
import { addMember, identityFor, makeCompany, makeUser } from "../helpers";

type Pkg = "instant_response" | "follow_up_booking" | "performance_reporting";
async function setup(pkg: Pkg = "performance_reporting") {
  const c = await makeCompany({ lifecycleStatus: "active", package: pkg, name: `Ads Co ${Math.random().toString(36).slice(2, 7)}` });
  const o = await makeUser(), e = await makeUser();
  await addMember(c.id, o.id, "owner");
  await addMember(c.id, e.id, "employee");
  const owner = await resolveCompanyContext({ user: o, identity: identityFor(o), requestedCompanyId: c.id, action: "workspace.view" });
  const employee = await resolveCompanyContext({ user: e, identity: identityFor(e), requestedCompanyId: c.id, action: "workspace.view" });
  return { id: c.id, owner, employee };
}
type Co = Awaited<ReturnType<typeof setup>>;

/** Runs only this company's ad jobs (other test files' jobs stay untouched). */
async function runAdJobs(companyId: string) {
  for (let i = 0; i < 5; i++) {
    const due = await withSystemDb("t", (tx) => tx.select().from(jobs).where(and(eq(jobs.companyId, companyId), eq(jobs.status, "queued"), sql`${jobs.kind} like 'ad_%'`, sql`${jobs.runAt} <= now()`)));
    if (!due.length) return;
    for (const j of due) {
      await withSystemDb("t", (tx) => tx.update(jobs).set({ status: "running", attempts: j.attempts + 1 }).where(eq(jobs.id, j.id)));
      const out = await HANDLERS[j.kind]!({ ...j, attempts: j.attempts + 1 });
      const status = out.status === "succeeded" ? "succeeded" : out.status === "cancelled" ? "cancelled" : out.status === "reschedule" ? "queued" : "queued";
      await withSystemDb("t", (tx) => tx.update(jobs).set({ status, result: "result" in out ? out.result ?? null : null, lastError: out.status === "retry" ? out.error : null,
        runAt: out.status === "reschedule" ? out.runAt : out.status === "retry" ? new Date(Date.now() + 3600_000) : j.runAt }).where(eq(jobs.id, j.id)));
    }
  }
}
const sum = async (companyId: string) => (await withSystemDb("t", (tx) => tx.select({ s: sql<number>`coalesce(sum(spend_micros),0)::float8`, n: sql<number>`count(*)::int` }).from(adDailyMetrics).where(eq(adDailyMetrics.companyId, companyId))))[0]!;

/** A Meta Page connected in LIVE mode (as if the owner had signed in), with Meta's API faked over HTTP. */
async function livePage(co: Co, pageId: string) {
  return withSystemDb("t", async (tx) => {
    const [conn] = await tx.insert(adConnections).values({ companyId: co.id, platform: "meta", mode: "live", status: "connected", accessTokenEnc: encrypt("user-token"), connectedAt: new Date() }).returning();
    const [src] = await tx.insert(adLeadSources).values({ companyId: co.id, connectionId: conn!.id, platform: "meta", kind: "meta_page", externalId: pageId, name: "Harbor Page", mode: "live", pageTokenEnc: encrypt(`page-token-${pageId}`), active: true, lastCheckedAt: new Date(Date.now() - 3600_000) }).returning();
    return { conn: conn!, src: src! };
  });
}
const signMeta = (body: string) => `sha256=${createHmac("sha256", "test-meta-app-secret").update(body).digest("hex")}`;
const leadNotification = (pageId: string, leadId: string) => JSON.stringify({ object: "page", entry: [{ id: pageId, time: 1, changes: [{ field: "leadgen", value: { leadgen_id: leadId, page_id: pageId, form_id: "f1" } }] }] });

function fakeMeta(leads: Record<string, unknown>, calls: string[] = []) {
  setAdsFetchForTests(async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname + "?" + url.searchParams.toString());
    const id = url.pathname.split("/").pop()!;
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/leadgen_forms")) return json({ data: [{ id: "f1", name: "Quote form" }] });
    if (url.pathname.endsWith("/leads")) return json({ data: Object.values(leads) });
    if (id === "f1") return json({ id: "f1", name: "Quote form" });
    if (leads[id] === "expired") return json({ error: { message: "Error validating access token", code: 190 } }, 400);
    if (leads[id] === "slow") return json({ error: { message: "Application request limit reached", code: 4 } }, 400);
    if (leads[id]) return json(leads[id]);
    return json({ error: { message: "Unsupported get request", code: 100 } }, 400);
  });
}
const metaLead = (id: string, name: string, email: string, campaign = "cmp_9") => ({ id, created_time: new Date().toISOString(), form_id: "f1", campaign_id: campaign, adset_id: "as1", ad_id: "ad1",
  field_data: [{ name: "full_name", values: [name] }, { name: "email", values: [email] }, { name: "phone_number", values: ["+14155550177"] }, { name: "what_service_do_you_need?", values: ["Roof repair"] }] });

let co: Co;
beforeAll(async () => { co = await setup(); });
afterEach(() => setAdsFetchForTests(null));
afterAll(closeDb);

describe("connecting (simulated in this environment)", () => {
  it("connects with sample accounts, imports 90 days, and re-imports without double counting", async () => {
    const r = await beginConnect(co.owner, "meta");
    expect(r.kind).toBe("connected");
    const ov = await adsOverview(co.owner);
    const meta = ov.find((x) => x.platform === "meta")!;
    expect(meta.connection).toMatchObject({ mode: "simulated", status: "connected" });
    expect(meta.accounts).toHaveLength(1);
    expect(meta.accounts[0]!.selected).toBe(true); // the only account is selected for reports
    expect(meta.sources[0]).toMatchObject({ kind: "meta_page", active: false });
    expect(JSON.stringify(ov)).not.toMatch(/sim_token|page_token/);

    await runAdJobs(co.id);
    const first = await sum(co.id);
    expect(first.n).toBe(90 * 2); // 90 days × 2 sample campaigns
    await withSystemDb("t", (tx) => tx.update(adConnections).set({ lastSyncOkAt: null }).where(eq(adConnections.companyId, co.id)));
    const conn = (await adsOverview(co.owner)).find((x) => x.platform === "meta")!.connection!;
    await HANDLERS.ad_metrics_sync!({ id: crypto.randomUUID(), companyId: co.id, kind: "ad_metrics_sync", payload: { connectionId: conn.id }, attempts: 1, maxAttempts: 5 } as never);
    expect(await sum(co.id)).toEqual(first); // last 7 days replaced, not added
    const runs = await withSystemDb("t", (tx) => tx.select().from(adSyncRuns).where(eq(adSyncRuns.companyId, co.id)));
    expect(runs.every((x) => x.status === "succeeded")).toBe(true);
  });

  it("the report adds up, keeps platform numbers apart from Bluewater's, and credits leads only by campaign id", async () => {
    const meta = (await adsOverview(co.owner)).find((x) => x.platform === "meta")!;
    await setPageReceiving(co.owner, meta.sources[0]!.id, true);
    await sendSimulatedAdLead(co.owner, meta.sources[0]!.id);
    await runAdJobs(co.id);
    const [lead] = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(and(eq(inquiries.companyId, co.id), eq(inquiries.source, "meta_lead_form"))));
    expect(lead).toMatchObject({ automationOrigin: "eligible" });
    expect(lead!.sourceLabel).toMatch(/simulated/);
    expect(lead!.externalIds.campaign_id).toBe("sim_meta_c1");
    await recordSale(co.owner, lead!.id, "1500");

    const rep = await adReport(co.owner, 30);
    expect(rep.simulated).toBe(true);
    const c1 = rep.campaigns.find((c) => c.campaignId === "sim_meta_c1")!;
    expect(c1).toMatchObject({ leads: 1, won: 1, salesCents: 150000, currency: "USD" });
    const s = (await withSystemDb("t", (tx) => tx.select({ s: sql<number>`sum(spend_micros)::float8` }).from(adDailyMetrics)
      .where(and(eq(adDailyMetrics.companyId, co.id), sql`${adDailyMetrics.day} between ${rep.period.fromDay} and ${rep.period.toDay}`))))[0]!.s;
    expect(rep.totals[0]!.spendMicros).toBe(s);
    expect(rep.campaigns.reduce((a, c) => a + c.spendMicros, 0)).toBe(s);

    // Not credited to any campaign: a lead-form lead without a campaign id, and a website lead with only a click id.
    await withSystemDb("t", async (tx) => {
      const [ct] = await tx.execute<{ id: string }>(sql`insert into app.contacts (company_id, full_name, email, email_normalized) values (${co.id}, 'No Camp', 'nocamp@example.com', 'nocamp@example.com') returning id`);
      await tx.insert(inquiries).values({ companyId: co.id, contactId: ct!.id, source: "meta_lead_form", submittedAt: new Date(), externalIds: { lead_id: "x1" } });
      await tx.insert(inquiries).values({ companyId: co.id, contactId: ct!.id, source: "website_form", submittedAt: new Date(), tracking: { gclid: "abc" }, externalIds: { campaign_id: "sim_meta_c1" } });
    });
    const rep2 = await adReport(co.owner, 30);
    expect(rep2.adFormNoCampaign).toBe(1);
    expect(rep2.adUnknownCampaign).toBe(1);
    expect(rep2.campaigns.find((c) => c.campaignId === "sim_meta_c1")!.leads).toBe(1); // unchanged
  });

  it("Package 1 can receive lead-form leads but has no ad reporting", async () => {
    const p1 = await setup("instant_response");
    await beginConnect(p1.owner, "meta");
    const ov = await adsOverview(p1.owner);
    expect(ov[0]!.reportingIncluded).toBe(false);
    await expect(selectAdAccounts(p1.owner, "meta", [])).rejects.toThrow(/Bluewater Insight/);
    await expect(adReport(p1.owner, 30)).rejects.toThrow(/Bluewater Insight/);
    await runAdJobs(p1.id);
    expect((await sum(p1.id)).n).toBe(0);
    await expect(beginConnect(p1.employee, "meta")).rejects.toThrow(/permission/);
  });

  it("a sign-in return that doesn't match the request is refused", async () => {
    await expect(finishOAuth(co.owner, "meta", "code", "forged.state", "nonce")).rejects.toThrow(/expired or wasn't started here/);
    // Correctly signed, but started for another company / another user / another platform.
    const other = await setup();
    const st = (x: Partial<{ c: string; u: string; p: "meta" | "google" }>) => signState({ c: co.id, u: co.owner.userId, p: "meta", n: "n1", e: Date.now() + 60_000, ...x });
    for (const bad of [st({ c: other.id }), st({ u: other.owner.userId }), st({ p: "google" })]) {
      await expect(finishOAuth(co.owner, "meta", "code", bad, "n1")).rejects.toThrow(/expired or wasn't started here/);
    }
  });

  it("the import job itself refuses companies without ad reporting (not just the screens)", async () => {
    const p2 = await setup("follow_up_booking");
    await beginConnect(p2.owner, "google");
    await withSystemDb("t", (tx) => tx.update(adAccounts).set({ selected: true }).where(eq(adAccounts.companyId, p2.id)));
    const [conn] = await withSystemDb("t", (tx) => tx.select().from(adConnections).where(eq(adConnections.companyId, p2.id)));
    const out = await HANDLERS.ad_metrics_sync!({ id: crypto.randomUUID(), companyId: p2.id, kind: "ad_metrics_sync", payload: { connectionId: conn!.id }, attempts: 1, maxAttempts: 5 } as never);
    expect(out).toMatchObject({ status: "cancelled" });
    expect((await sum(p2.id)).n).toBe(0);
  });
});

describe("Meta lead webhooks", () => {
  it("verifies the subscription handshake only with the right token", () => {
    expect(metaVerify("subscribe", "test-verify-token", "123")).toEqual({ status: 200, body: "123" });
    expect(metaVerify("subscribe", "wrong-verify-tokenX", "123").status).toBe(403);
  });

  it("records a signed lead once, with its campaign ids; rejects bad signatures; ignores unknown Pages", async () => {
    const live = await setup("follow_up_booking");
    await livePage(live, "page_live_1");
    const calls: string[] = [];
    fakeMeta({ lead_1: metaLead("lead_1", "Pat Rivers", "pat.rivers@example.com") }, calls);
    const body = leadNotification("page_live_1", "lead_1");
    expect((await metaWebhook(body, "sha256=" + "0".repeat(64))).status).toBe(401);
    expect(await metaWebhook(body, signMeta(body))).toEqual({ status: 200, queued: 1 });
    expect(await metaWebhook(body, signMeta(body))).toEqual({ status: 200, queued: 0 }); // Meta retries
    const other = leadNotification("page_nobody", "lead_x");
    expect(await metaWebhook(other, signMeta(other))).toEqual({ status: 200, queued: 0 });
    await runAdJobs(live.id);
    const rows = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.companyId, live.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "meta_lead_form", sourceLabel: "Quote form", serviceRequested: "Roof repair" });
    expect(rows[0]!.externalIds).toMatchObject({ lead_id: "lead_1", campaign_id: "cmp_9", form_id: "f1" });
    expect(calls.some((c) => c.includes("appsecret_proof="))).toBe(true);
    const [ev] = await withSystemDb("t", (tx) => tx.select().from(adLeadEvents).where(eq(adLeadEvents.externalLeadId, "lead_1")));
    expect(ev).toMatchObject({ status: "recorded", payload: null });
  });

  it("an expired token marks the connection for reconnecting; rate limits wait instead of failing", async () => {
    const live = await setup();
    const { conn } = await livePage(live, "page_live_2");
    fakeMeta({ lead_exp: "expired", lead_slow: "slow" });
    for (const id of ["lead_exp", "lead_slow"]) { const b = leadNotification("page_live_2", id); await metaWebhook(b, signMeta(b)); }
    await runAdJobs(live.id);
    const [c] = await withSystemDb("t", (tx) => tx.select().from(adConnections).where(eq(adConnections.id, conn.id)));
    expect(c).toMatchObject({ status: "needs_reconnect" });
    expect(c!.lastError).toMatch(/sign in again/);
    const [slowJob] = await withSystemDb("t", (tx) => tx.select().from(jobs).where(and(eq(jobs.companyId, live.id), eq(jobs.result, "Rate limited"))));
    expect(slowJob!.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("missed leads are found by the hourly check, without duplicating ones already recorded", async () => {
    const live = await setup();
    await livePage(live, "page_live_3");
    const leads = { lead_a: metaLead("lead_a", "Ann A", "ann.a@example.com"), lead_b: metaLead("lead_b", "Bo B", "bo.b@example.com") };
    fakeMeta(leads);
    const b = leadNotification("page_live_3", "lead_a");
    await metaWebhook(b, signMeta(b)); // only lead_a was notified
    await runAdJobs(live.id);
    await scheduleAdWork();
    await runAdJobs(live.id);
    const rows = await withSystemDb("t", (tx) => tx.select({ id: inquiries.externalIds }).from(inquiries).where(eq(inquiries.companyId, live.id)));
    expect(rows.map((r) => r.id.lead_id).sort()).toEqual(["lead_a", "lead_b"]);
    const [ev] = await withSystemDb("t", (tx) => tx.select().from(adLeadEvents).where(eq(adLeadEvents.externalLeadId, "lead_b")));
    expect(ev!.via).toBe("reconcile");
  });

  it("a Facebook Page can send leads to only one company", async () => {
    const a = await setup(), b = await setup();
    await livePage(a, "page_shared"); // company A receives this Page's leads
    // Someone at company B also has admin access to the same Page and tries to turn it on there.
    const [bConn] = await withSystemDb("t", (tx) => tx.insert(adConnections).values({ companyId: b.id, platform: "meta", mode: "live", status: "connected", accessTokenEnc: encrypt("t") }).returning());
    const [bSrc] = await withSystemDb("t", (tx) => tx.insert(adLeadSources).values({ companyId: b.id, connectionId: bConn!.id, platform: "meta", kind: "meta_page", externalId: "page_shared", name: "Same Page", mode: "live", pageTokenEnc: encrypt("pt"), active: false }).returning());
    setAdsFetchForTests(async () => new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } }));
    await expect(setPageReceiving(b.owner, bSrc!.id, true)).rejects.toThrow(/another Bluewater account/);
    const body = leadNotification("page_shared", "lead_shared");
    fakeMeta({ lead_shared: metaLead("lead_shared", "Shay", "shay@example.com") });
    await metaWebhook(body, signMeta(body));
    await runAdJobs(a.id);
    await runAdJobs(b.id);
    expect(await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.companyId, a.id)))).toHaveLength(1);
    expect(await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.companyId, b.id)))).toHaveLength(0);
  });
});

describe("Google lead-form webhook", () => {
  it("checks the key, treats Google's test data as a test, and records each real lead once", async () => {
    const g = await setup("instant_response");
    const { url, key } = await setUpGoogleLeadWebhook(g.owner);
    const path = url.split("/").pop()!;
    const lead = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ lead_id: id, api_version: "1.0", form_id: 77, campaign_id: 555, adgroup_id: 9, creative_id: 3, gcl_id: "gclid-abc", google_key: key,
      user_column_data: [{ column_id: "FULL_NAME", column_name: "Full Name", string_value: "Gail Green" }, { column_id: "EMAIL", string_value: "gail@example.com" }, { column_id: "PHONE_NUMBER", string_value: "+14155550188" }, { column_id: "POSTAL_CODE", column_name: "Zip", string_value: "94110" }], ...extra });
    expect((await googleLeadWebhook(path, lead("g1", { google_key: "wrong" }))).status).toBe(401);
    expect((await adsOverview(g.owner))[1]!.sources[0]!.lastError).toMatch(/wrong key/);
    expect(await googleLeadWebhook(path, lead("gtest", { is_test: true }))).toEqual({ status: 200, queued: true });
    expect((await adsOverview(g.owner))[1]!.sources[0]!.verifiedAt).not.toBeNull();
    expect((await googleLeadWebhook(path, lead("g1"))).queued).toBe(true);
    expect((await googleLeadWebhook(path, lead("g1"))).queued).toBe(false);
    expect((await googleLeadWebhook("A".repeat(32), lead("g2"))).status).toBe(404);
    await runAdJobs(g.id);
    const rows = await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.companyId, g.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "google_lead_form", tracking: { gclid: "gclid-abc" } });
    expect(rows[0]!.externalIds).toMatchObject({ campaign_id: "555", lead_id: "g1" });
    expect(rows[0]!.message).toContain("Zip: 94110");
  });

  it("an account whose service ended doesn't record new ad leads", async () => {
    const g = await setup("instant_response");
    const { url, key } = await setUpGoogleLeadWebhook(g.owner);
    await withSystemDb("t", (tx) => tx.execute(sql`update app.companies set lifecycle_status = 'churned' where id = ${g.id}`));
    await googleLeadWebhook(url.split("/").pop()!, JSON.stringify({ lead_id: "late1", google_key: key, user_column_data: [{ column_id: "EMAIL", string_value: "late@example.com" }] }));
    await runAdJobs(g.id);
    expect(await withSystemDb("t", (tx) => tx.select().from(inquiries).where(eq(inquiries.companyId, g.id)))).toHaveLength(0);
    const [ev] = await withSystemDb("t", (tx) => tx.select().from(adLeadEvents).where(eq(adLeadEvents.companyId, g.id)));
    expect(ev!.status).toBe("rejected");
  });
});

describe("isolation", () => {
  it("another company can't see or use this company's ad connections, leads or numbers", async () => {
    const other = await setup();
    const mine = (await adsOverview(co.owner))[0]!;
    const theirs = await adsOverview(other.owner);
    expect(theirs[0]!.connection).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain(mine.connection!.id);
    await expect(setPageReceiving(other.owner, mine.sources[0]!.id, false)).rejects.toThrow(/not found/);
    await expect(sendSimulatedAdLead(other.owner, mine.sources[0]!.id)).rejects.toThrow(/Turn on this lead source/);
    await expect(selectAdAccounts(other.owner, "meta", [mine.accounts[0]!.id])).rejects.toThrow(/Connect the platform first/);
    expect((await adReport(other.owner, 90)).campaigns).toHaveLength(0);
    const [mineStill] = await withSystemDb("t", (tx) => tx.select().from(adAccounts).where(eq(adAccounts.id, mine.accounts[0]!.id)));
    expect(mineStill!.selected).toBe(true);
  });

  it("disconnecting removes tokens and stops receiving, but keeps history", async () => {
    const d = await setup();
    await beginConnect(d.owner, "meta");
    await runAdJobs(d.id);
    const before = await sum(d.id);
    await disconnectPlatform(d.owner, "meta");
    const [c] = await withSystemDb("t", (tx) => tx.select().from(adConnections).where(eq(adConnections.companyId, d.id)));
    expect(c).toMatchObject({ status: "disconnected", accessTokenEnc: null });
    expect(await sum(d.id)).toEqual(before);
    expect((await adsOverview(d.owner))[0]!.connection).toBeNull();
  });
});
