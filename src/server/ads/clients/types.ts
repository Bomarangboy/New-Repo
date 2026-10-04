import type { AdPlatform } from "../config";

export interface TokenSet { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; scopes?: string[]; label?: string | null }
export interface AdAccountInfo { externalId: string; name: string; currency: string | null; timezone: string | null; selectable: boolean; note?: string }
export interface PageInfo { externalId: string; name: string; pageToken: string | null }
export interface DailyRow {
  campaignId: string; campaignName: string; campaignStatus?: string | null; day: string;
  spendMicros: number; impressions: number; clicks: number; platformLeads: number | null; platformConversions: number | null;
}
/** One answer on a lead form, as the platform labels it. */
export interface LeadAnswer { key: string; label?: string | null; value: string }
export interface LeadData {
  externalLeadId: string; createdAt: Date | null; answers: LeadAnswer[];
  formId?: string | null; formName?: string | null; campaignId?: string | null; adsetId?: string | null; adId?: string | null;
  pageId?: string | null; clickId?: string | null; isOrganic?: boolean | null;
}

/**
 * The connector contract every ad platform implements (real or simulated). Clients never touch the
 * database; the services in this folder do, under the company's row-level security.
 */
export interface AdPlatformClient {
  readonly platform: AdPlatform;
  readonly mode: "live" | "simulated";
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenSet>;
  /** Google: new access token from the refresh token. Meta has no refresh; it needs a new sign-in. */
  refresh(t: TokenSet): Promise<TokenSet | null>;
  listAdAccounts(t: TokenSet): Promise<AdAccountInfo[]>;
  /** Meta only: Facebook Pages whose lead forms can be received. */
  listPages(t: TokenSet): Promise<PageInfo[]>;
  subscribePage(page: PageInfo): Promise<void>;
  fetchLead(pageToken: string | null, leadId: string): Promise<LeadData>;
  /** Missed-lead reconciliation: leads created on this Page since `since`. */
  listRecentLeads(pageToken: string | null, pageId: string, since: Date): Promise<LeadData[]>;
  /** Campaign-by-day numbers for [from, to] (inclusive, the account's own dates). Handles paging internally. */
  fetchDailyCampaignMetrics(t: TokenSet, account: { externalId: string; currency: string | null }, from: string, to: string): Promise<DailyRow[]>;
  revoke(t: TokenSet): Promise<void>;
}

/** fetch used by live clients; tests replace it to simulate the platform's HTTP responses. */
let fetchImpl: typeof fetch = (...a) => fetch(...a);
export const adsFetch: typeof fetch = (...a) => fetchImpl(...a);
export function setAdsFetchForTests(f: typeof fetch | null) { fetchImpl = f ?? ((...a) => fetch(...a)); }

/** "12.34" → 12340000 without floating-point error. */
export function decimalToMicros(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return 0;
  const frac = (m[3] ?? "").padEnd(6, "0").slice(0, 6);
  const n = Number(m[2]) * 1_000_000 + Number(frac);
  return m[1] ? -n : n;
}
