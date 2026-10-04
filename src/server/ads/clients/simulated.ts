import { createHash } from "node:crypto";
import type { AdPlatform } from "../config";
import type { AdPlatformClient, DailyRow, LeadData } from "./types";

/**
 * SIMULATED ad platforms for development, test and the demo. Deterministic (the same day and campaign always
 * give the same numbers), labeled "(simulated)" in every name, and never contacts Meta or Google.
 */
const h = (s: string) => createHash("sha256").update(s).digest().readUInt32BE(0) / 0xffffffff;

export const SIM_CAMPAIGNS: Record<AdPlatform, { id: string; name: string; dailyBudget: number; cpc: number }[]> = {
  meta: [
    { id: "sim_meta_c1", name: "Spring offer — lead form (simulated)", dailyBudget: 28, cpc: 1.1 },
    { id: "sim_meta_c2", name: "Retargeting — website visitors (simulated)", dailyBudget: 12, cpc: 0.8 },
  ],
  google: [
    { id: "sim_google_c1", name: "Search — emergency repairs (simulated)", dailyBudget: 35, cpc: 4.2 },
    { id: "sim_google_c2", name: "Search — brand (simulated)", dailyBudget: 8, cpc: 1.6 },
  ],
};

const FIRST = ["Avery", "Jordan", "Riley", "Casey", "Morgan", "Quinn", "Rowan", "Sage"];
const LAST = ["Nguyen", "Garcia", "Patel", "Kim", "Brooks", "Diaz", "Walsh", "Reed"];

export function simulatedLead(platform: AdPlatform, leadId: string, pageId: string | null): LeadData {
  const r = (k: string) => h(`${leadId}:${k}`);
  const first = FIRST[Math.floor(r("f") * FIRST.length)]!, last = LAST[Math.floor(r("l") * LAST.length)]!;
  const camp = SIM_CAMPAIGNS[platform][0]!;
  return {
    externalLeadId: leadId, createdAt: new Date(),
    answers: [
      { key: "full_name", value: `${first} ${last}` },
      { key: "email", value: `${first}.${last}.${leadId.slice(-6)}@example.com`.toLowerCase() },
      // Reserved fictional range 555-0100…0199.
      { key: "phone_number", value: `+141555501${String(Math.floor(r("p") * 100)).padStart(2, "0")}` },
      { key: "what_service_do_you_need?", label: "What service do you need?", value: ["Roof repair", "Gutter cleaning", "Furnace repair"][Math.floor(r("s") * 3)]! },
    ],
    formId: `sim_${platform}_form1`, formName: platform === "meta" ? "Free estimate form (simulated)" : "Google lead form (simulated)",
    campaignId: camp.id, adsetId: `${camp.id}_set1`, adId: `${camp.id}_ad1`, pageId,
  };
}

/** `seed` (the company id) keeps each company's sample Page distinct — a Page can feed only one company. */
export function simulatedClient(platform: AdPlatform, seed = "sample"): AdPlatformClient {
  const pageId = `sim_page_${seed.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
  return {
    platform,
    mode: "simulated",
    authorizeUrl() { return ""; },
    async exchangeCode() { return { accessToken: `sim_token_${platform}`, refreshToken: null, expiresAt: null, scopes: ["simulated"], label: "Sample account (simulated)" }; },
    async refresh(t) { return t; },
    async listAdAccounts() {
      return platform === "meta"
        ? [{ externalId: "act_sim_1001", name: "Sample ad account (simulated)", currency: "USD", timezone: "America/New_York", selectable: true }]
        : [{ externalId: "9990001001", name: "Sample Google Ads account (simulated)", currency: "USD", timezone: "America/New_York", selectable: true }];
    },
    async listPages() { return platform === "meta" ? [{ externalId: pageId, name: "Sample Facebook Page (simulated)", pageToken: "sim_page_token" }] : []; },
    async subscribePage() { /* nothing to do */ },
    async fetchLead(_t, leadId) { return simulatedLead(platform, leadId, pageId); },
    async listRecentLeads() { return []; },
    async fetchDailyCampaignMetrics(_t, account, from, to) {
      const rows: DailyRow[] = [];
      for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
        const day = d.toISOString().slice(0, 10);
        for (const c of SIM_CAMPAIGNS[platform]) {
          const x = h(`${account.externalId}:${c.id}:${day}`);
          const weekday = d.getUTCDay();
          const spend = c.dailyBudget * (0.65 + x * 0.5) * (weekday === 0 ? 0.6 : 1);
          const clicks = Math.max(0, Math.round(spend / c.cpc));
          rows.push({
            campaignId: c.id, campaignName: c.name, campaignStatus: "ENABLED", day,
            spendMicros: Math.round(spend * 100) * 10_000, impressions: Math.round(clicks * (28 + x * 40)), clicks,
            platformLeads: platform === "meta" ? Math.floor(clicks * 0.06 + x) : null,
            platformConversions: platform === "google" ? Math.round(clicks * 0.08 * 10) / 10 : null,
          });
        }
      }
      return rows;
    },
    async revoke() { /* nothing to do */ },
  };
}
