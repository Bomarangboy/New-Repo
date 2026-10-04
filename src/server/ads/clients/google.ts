import { env } from "@/lib/env";
import { oauthRedirectUri } from "../config";
import { AdsApiError, AdsAuthError, AdsRateLimitError } from "../errors";
import { adsFetch, type AdPlatformClient, type DailyRow, type TokenSet } from "./types";

/**
 * Google Ads API (REST) client — AWAITING LIVE VERIFICATION (needs a Google Ads API developer token with
 * Basic access, and Google's OAuth app verification for the adwords scope). Version from
 * GOOGLE_ADS_API_VERSION (default v25). Lead forms do NOT use this client: Google delivers them by webhook
 * (see leads.ts), which works without API approval.
 */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/adwords"];

const api = () => `https://googleads.googleapis.com/${env().GOOGLE_ADS_API_VERSION}`;

function headers(t: TokenSet): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${t.accessToken}`, "developer-token": env().GOOGLE_ADS_DEVELOPER_TOKEN ?? "", "Content-Type": "application/json" };
  if (env().GOOGLE_ADS_LOGIN_CUSTOMER_ID) h["login-customer-id"] = env().GOOGLE_ADS_LOGIN_CUSTOMER_ID!;
  return h;
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await adsFetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || body.error?.status === "UNAUTHENTICATED" || body.error?.status === "PERMISSION_DENIED") throw new AdsAuthError(msg);
    if (res.status === 429 || body.error?.status === "RESOURCE_EXHAUSTED") throw new AdsRateLimitError(msg);
    throw new AdsApiError(msg);
  }
  return body;
}

async function token(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }> {
  const e = env();
  return call("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: e.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: e.GOOGLE_OAUTH_CLIENT_SECRET ?? "", ...params }).toString(),
  });
}

/** GAQL search with nextPageToken paging. */
export async function gaqlSearch<T>(t: TokenSet, customerId: string, query: string, cap = 100): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < cap; i++) {
    const r = await call<{ results?: T[]; nextPageToken?: string }>(`${api()}/customers/${customerId}/googleAds:search`, {
      method: "POST", headers: headers(t), body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
    });
    out.push(...(r.results ?? []));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

const digits = (s: string) => s.replace(/\D/g, "");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const googleClient: AdPlatformClient = {
  platform: "google",
  mode: "live",
  authorizeUrl(state) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", env().GOOGLE_OAUTH_CLIENT_ID ?? "");
    u.searchParams.set("redirect_uri", oauthRedirectUri("google"));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("state", state);
    return u.toString();
  },
  async exchangeCode(code) {
    const r = await token({ code, grant_type: "authorization_code", redirect_uri: oauthRedirectUri("google") });
    if (!r.refresh_token) throw new AdsAuthError("Google didn't grant ongoing access. Please try connecting again and approve access.");
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null, scopes: r.scope?.split(" ") ?? GOOGLE_SCOPES, label: "Google Ads" };
  },
  async refresh(t) {
    if (!t.refreshToken) return null;
    const r = await token({ grant_type: "refresh_token", refresh_token: t.refreshToken });
    return { ...t, accessToken: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null };
  },
  async listAdAccounts(t) {
    const r = await call<{ resourceNames?: string[] }>(`${api()}/customers:listAccessibleCustomers`, { method: "GET", headers: headers(t) });
    const out = [];
    for (const rn of (r.resourceNames ?? []).slice(0, 50)) {
      const id = digits(rn.split("/")[1] ?? "");
      const [row] = await gaqlSearch<{ customer?: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string; manager?: boolean } }>(
        t, id, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1", 1).catch(() => []);
      const c = row?.customer;
      out.push({
        externalId: id, name: c?.descriptiveName || `Google Ads ${id.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}`, currency: c?.currencyCode ?? null, timezone: c?.timeZone ?? null,
        selectable: !c?.manager, note: c?.manager ? "Manager account — select the client accounts under it instead" : undefined,
      });
    }
    return out;
  },
  async listPages() { return []; },
  async subscribePage() { /* not used for Google */ },
  async fetchLead() { throw new AdsApiError("Google lead-form leads arrive by webhook."); },
  async listRecentLeads() { return []; },
  async fetchDailyCampaignMetrics(t, account, from, to) {
    if (!isDate(from) || !isDate(to)) throw new AdsApiError("Bad date range");
    const rows = await gaqlSearch<{ campaign?: { id?: string; name?: string; status?: string }; segments?: { date?: string }; metrics?: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number } }>(
      t, digits(account.externalId),
      `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`);
    return rows.map((r): DailyRow => ({
      campaignId: String(r.campaign?.id ?? ""), campaignName: r.campaign?.name ?? String(r.campaign?.id ?? ""), campaignStatus: r.campaign?.status ?? null,
      day: r.segments?.date ?? from, spendMicros: Number(r.metrics?.costMicros ?? 0), impressions: Number(r.metrics?.impressions ?? 0), clicks: Number(r.metrics?.clicks ?? 0),
      platformLeads: null, platformConversions: r.metrics?.conversions == null ? null : Number(r.metrics.conversions),
    })).filter((r) => r.campaignId);
  },
  async revoke(t) {
    const tok = t.refreshToken ?? t.accessToken;
    await adsFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: "POST" }).catch(() => undefined);
  },
};
