import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { adsMode, signState, verifyState } from "@/server/ads/config";
import { decimalToMicros, setAdsFetchForTests } from "@/server/ads/clients/types";
import { metaClient, mapMetaLead } from "@/server/ads/clients/meta";
import { googleClient } from "@/server/ads/clients/google";
import { simulatedClient } from "@/server/ads/clients/simulated";
import { AdsApiError, AdsAuthError, AdsRateLimitError } from "@/server/ads/errors";
import { leadToInquiryInput, mapGooglePayload, verifyMetaSignature } from "@/server/ads/leads";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
afterEach(() => setAdsFetchForTests(null));

describe("when live ad connections are allowed (D-31)", () => {
  const e = { APP_ENV: "production" as const, ADS_LIVE_ENABLED: true, META_APP_ID: "1", META_APP_SECRET: "s", GOOGLE_OAUTH_CLIENT_ID: undefined, GOOGLE_OAUTH_CLIENT_SECRET: undefined, GOOGLE_ADS_DEVELOPER_TOKEN: undefined };
  it("live only with approval, credentials and a real customer", () => {
    expect(adsMode("meta", "customer", e)).toBe("live");
    expect(adsMode("google", "customer", e)).toBe("unavailable"); // no Google credentials
    expect(adsMode("meta", "customer", { ...e, ADS_LIVE_ENABLED: false })).toBe("unavailable");
    expect(adsMode("meta", "demo_prospect", e)).toBe("simulated");
    expect(adsMode("meta", "customer", { ...e, APP_ENV: "staging", ADS_LIVE_ENABLED: false })).toBe("simulated");
  });
});

describe("sign-in state", () => {
  const s = { c: "co", u: "us", p: "meta" as const, n: "nonce1", e: Date.now() + 60_000 };
  it("accepts only an untampered, unexpired state from the same browser", () => {
    const st = signState(s);
    expect(verifyState(st, "nonce1")).toMatchObject({ c: "co", u: "us", p: "meta" });
    expect(verifyState(st, "other")).toBeNull();
    expect(verifyState(st, null)).toBeNull();
    expect(verifyState(st.replace(/^./, "x"), "nonce1")).toBeNull();
    expect(verifyState(signState({ ...s, e: Date.now() - 1 }), "nonce1")).toBeNull();
    const [body] = st.split(".");
    const forged = Buffer.from(JSON.stringify({ ...s, c: "victim" })).toString("base64url");
    expect(verifyState(`${forged}.${st.split(".")[1]}`, "nonce1")).toBeNull();
    expect(body).toBeTruthy();
  });
});

describe("money and mapping", () => {
  it("converts decimal spend to exact micros", () => {
    expect(decimalToMicros("12.34")).toBe(12_340_000);
    expect(decimalToMicros("0.1")).toBe(100_000);
    expect(decimalToMicros("1234567.891234")).toBe(1_234_567_891_234);
    expect(decimalToMicros(null)).toBe(0);
    expect(decimalToMicros("abc")).toBe(0);
  });
  it("maps lead-form answers to a lead, keeping extra answers and ad ids", () => {
    const l = mapMetaLead({ id: "L1", created_time: "2026-10-01T10:00:00+0000", campaign_id: "C", ad_id: "A", form_id: "F",
      field_data: [{ name: "first_name", values: ["Ann"] }, { name: "last_name", values: ["Lee"] }, { name: "email", values: ["ann@example.com"] }, { name: "when_is_best_to_call?", values: ["Evenings"] }] }, { pageId: "P" });
    const i = leadToInquiryInput(l);
    expect(i).toMatchObject({ fullName: "Ann Lee", email: "ann@example.com", phone: null });
    expect(i.message).toBe("when is best to call?: Evenings");
    expect(i.externalIds).toEqual({ lead_id: "L1", form_id: "F", campaign_id: "C", ad_id: "A", page_id: "P" });
    expect(i.submittedAt!.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    const g = leadToInquiryInput(mapGooglePayload({ lead_id: "G1", campaign_id: 12, gcl_id: "x", user_column_data: [{ column_id: "FULL_NAME", string_value: "Bo" }, { column_id: "PHONE_NUMBER", string_value: "+14155550100" }] }));
    expect(g).toMatchObject({ fullName: "Bo", phone: "+14155550100", tracking: { gclid: "x" }, externalIds: { campaign_id: "12", lead_id: "G1" } });
  });
  it("verifies Meta's webhook signature on the exact body", () => {
    const body = '{"object":"page"}';
    const sig = `sha256=${createHmac("sha256", "s3").update(body).digest("hex")}`;
    expect(verifyMetaSignature("s3", body, sig)).toBe(true);
    expect(verifyMetaSignature("s3", body + " ", sig)).toBe(false);
    expect(verifyMetaSignature("other", body, sig)).toBe(false);
    expect(verifyMetaSignature("s3", body, sig.replace("sha256=", ""))).toBe(false);
  });
});

describe("Meta client over HTTP (faked)", () => {
  it("follows paging links, sends appsecret_proof and maps insights; missing 'actions' means unknown, not zero", async () => {
    const urls: string[] = [];
    setAdsFetchForTests(async (input) => {
      const u = String(input); urls.push(u);
      if (!u.includes("after=")) return json({ data: [{ campaign_id: "1", campaign_name: "A", date_start: "2026-10-01", spend: "10.50", impressions: "1000", clicks: "20", actions: [{ action_type: "lead", value: "3" }] }], paging: { next: "https://graph.facebook.com/v26.0/act_1/insights?after=xyz" } });
      return json({ data: [{ campaign_id: "1", campaign_name: "A", date_start: "2026-10-02", spend: "4", impressions: "10", clicks: "1" }] });
    });
    const rows = await metaClient.fetchDailyCampaignMetrics({ accessToken: "tok" }, { externalId: "act_1", currency: "USD" }, "2026-10-01", "2026-10-02");
    expect(rows).toEqual([
      expect.objectContaining({ day: "2026-10-01", spendMicros: 10_500_000, clicks: 20, platformLeads: 3 }),
      expect.objectContaining({ day: "2026-10-02", spendMicros: 4_000_000, platformLeads: null }),
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("appsecret_proof=");
    expect(urls[0]).toContain("time_increment=1");
  });
  it("classifies errors: expired token, rate limit, other", async () => {
    for (const [code, cls] of [[190, AdsAuthError], [17, AdsRateLimitError], [100, AdsApiError]] as const) {
      setAdsFetchForTests(async () => json({ error: { message: "x", code } }, 400));
      await expect(metaClient.listAdAccounts({ accessToken: "t" })).rejects.toBeInstanceOf(cls);
    }
  });
});

describe("Google Ads client over HTTP (faked)", () => {
  it("pages through GAQL results and keeps costs exact", async () => {
    const bodies: string[] = [];
    setAdsFetchForTests(async (_i, init) => {
      bodies.push(String(init?.body));
      const page = JSON.parse(String(init?.body)).pageToken;
      return json(page ? { results: [{ campaign: { id: "2", name: "B" }, segments: { date: "2026-10-02" }, metrics: { costMicros: "1230000", impressions: "5", clicks: "1" } }] }
        : { results: [{ campaign: { id: "1", name: "A", status: "ENABLED" }, segments: { date: "2026-10-01" }, metrics: { costMicros: "45670000", impressions: "900", clicks: "30", conversions: 2.5 } }], nextPageToken: "p2" });
    });
    const rows = await googleClient.fetchDailyCampaignMetrics({ accessToken: "t" }, { externalId: "123-456-7890", currency: "USD" }, "2026-10-01", "2026-10-02");
    expect(rows).toEqual([
      expect.objectContaining({ campaignId: "1", spendMicros: 45_670_000, platformConversions: 2.5, platformLeads: null }),
      expect.objectContaining({ campaignId: "2", spendMicros: 1_230_000, platformConversions: null }),
    ]);
    expect(bodies[0]).toContain("segments.date BETWEEN '2026-10-01' AND '2026-10-02'");
    await expect(googleClient.fetchDailyCampaignMetrics({ accessToken: "t" }, { externalId: "1", currency: null }, "2026-10-01' OR '1'='1", "x")).rejects.toThrow(/Bad date/);
  });
  it("maps 401 to reconnect and RESOURCE_EXHAUSTED to wait", async () => {
    setAdsFetchForTests(async () => json({ error: { message: "bad", status: "UNAUTHENTICATED" } }, 401));
    await expect(googleClient.listAdAccounts({ accessToken: "t" })).rejects.toBeInstanceOf(AdsAuthError);
    setAdsFetchForTests(async () => json({ error: { message: "slow", status: "RESOURCE_EXHAUSTED" } }, 429));
    await expect(googleClient.listAdAccounts({ accessToken: "t" })).rejects.toBeInstanceOf(AdsRateLimitError);
  });
});

describe("simulated platform", () => {
  it("is deterministic and labeled", async () => {
    const c = simulatedClient("google", "co1");
    const a = await c.fetchDailyCampaignMetrics({ accessToken: "x" }, { externalId: "9990001001", currency: "USD" }, "2026-09-01", "2026-09-03");
    const b = await c.fetchDailyCampaignMetrics({ accessToken: "x" }, { externalId: "9990001001", currency: "USD" }, "2026-09-01", "2026-09-03");
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    expect(a.every((r) => /simulated/.test(r.campaignName))).toBe(true);
    expect((await simulatedClient("meta", "co1").listPages({ accessToken: "x" }))[0]!.externalId).not.toBe((await simulatedClient("meta", "co2").listPages({ accessToken: "x" }))[0]!.externalId);
  });
});
