import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { oauthRedirectUri } from "../config";
import { AdsApiError, AdsAuthError, AdsRateLimitError } from "../errors";
import { adsFetch, decimalToMicros, type AdAccountInfo, type AdPlatformClient, type DailyRow, type LeadData, type PageInfo, type TokenSet } from "./types";

/**
 * Meta Graph / Marketing API client — AWAITING LIVE VERIFICATION (needs Meta App Review for
 * leads_retrieval, pages_manage_metadata, pages_show_list, pages_read_engagement, ads_read, and business verification).
 * Version from META_GRAPH_VERSION (default v26.0). Every call sends appsecret_proof, so a stolen token alone
 * can't be used with Bluewater's app.
 */
export const META_SCOPES = ["leads_retrieval", "pages_show_list", "pages_read_engagement", "pages_manage_metadata", "ads_read", "business_management"];

const base = () => `https://graph.facebook.com/${env().META_GRAPH_VERSION}`;
const proof = (token: string) => createHmac("sha256", env().META_APP_SECRET ?? "").update(token).digest("hex");

interface GraphError { error?: { message?: string; code?: number; error_subcode?: number; type?: string } }

async function graph<T>(path: string, token: string | null, init: { method?: string; params?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${base()}${path}`);
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
  if (token && !url.searchParams.has("appsecret_proof")) url.searchParams.set("appsecret_proof", proof(token));
  const res = await adsFetch(url, { method: init.method ?? "GET", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || body.error) {
    const code = body.error?.code;
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (code === 190 || code === 102 || res.status === 401) throw new AdsAuthError(msg);
    if (code === 4 || code === 17 || code === 32 || code === 613 || (code != null && code >= 80000 && code <= 80014) || res.status === 429) throw new AdsRateLimitError(msg);
    throw new AdsApiError(msg);
  }
  return body;
}

/** Follows `paging.next` links (Meta's cursor pagination), with a safety cap. */
async function all<T>(path: string, token: string, params: Record<string, string>, cap = 50): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = null;
  let first = true;
  for (let i = 0; i < cap && (first || next); i++) {
    const page: { data?: T[]; paging?: { next?: string } } = first ? await graph(path, token, { params }) : await graph(next!, token);
    first = false;
    out.push(...(page.data ?? []));
    next = page.paging?.next ?? null;
  }
  return out;
}

interface RawLead { id: string; created_time?: string; field_data?: { name: string; values?: string[] }[]; ad_id?: string; adset_id?: string; campaign_id?: string; form_id?: string; is_organic?: boolean }
export function mapMetaLead(r: RawLead, extra: { pageId?: string | null; formName?: string | null } = {}): LeadData {
  return {
    externalLeadId: r.id, createdAt: r.created_time ? new Date(r.created_time) : null,
    answers: (r.field_data ?? []).map((f) => ({ key: f.name, value: (f.values ?? []).join(", ") })),
    formId: r.form_id ?? null, formName: extra.formName ?? null, campaignId: r.campaign_id ?? null, adsetId: r.adset_id ?? null, adId: r.ad_id ?? null,
    pageId: extra.pageId ?? null, isOrganic: r.is_organic ?? null,
  };
}

const LEAD_FIELDS = "created_time,field_data,ad_id,adset_id,campaign_id,form_id,is_organic";

export const metaClient: AdPlatformClient = {
  platform: "meta",
  mode: "live",
  authorizeUrl(state) {
    const u = new URL(`https://www.facebook.com/${env().META_GRAPH_VERSION}/dialog/oauth`);
    u.searchParams.set("client_id", env().META_APP_ID ?? "");
    u.searchParams.set("redirect_uri", oauthRedirectUri("meta"));
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", META_SCOPES.join(","));
    return u.toString();
  },
  async exchangeCode(code) {
    const e = env();
    const short = await graph<{ access_token: string }>("/oauth/access_token", null, { params: { client_id: e.META_APP_ID ?? "", client_secret: e.META_APP_SECRET ?? "", redirect_uri: oauthRedirectUri("meta"), code } });
    // Exchange for a long-lived (~60 day) user token.
    const long = await graph<{ access_token: string; expires_in?: number }>("/oauth/access_token", null, { params: { grant_type: "fb_exchange_token", client_id: e.META_APP_ID ?? "", client_secret: e.META_APP_SECRET ?? "", fb_exchange_token: short.access_token } });
    const me = await graph<{ id: string; name?: string }>("/me", long.access_token, { params: { fields: "id,name" } });
    const perms = await graph<{ data?: { permission: string; status: string }[] }>("/me/permissions", long.access_token);
    return {
      accessToken: long.access_token, refreshToken: null, label: me.name ?? `Facebook user ${me.id}`,
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
      scopes: (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission),
    };
  },
  async refresh() { return null; },
  async listAdAccounts(t) {
    const rows = await all<{ account_id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number }>("/me/adaccounts", t.accessToken, { fields: "account_id,name,currency,timezone_name,account_status", limit: "100" });
    return rows.map((a) => ({ externalId: `act_${a.account_id}`, name: a.name ?? `Ad account ${a.account_id}`, currency: a.currency ?? null, timezone: a.timezone_name ?? null, selectable: true }));
  },
  async listPages(t) {
    const rows = await all<{ id: string; name?: string; access_token?: string }>("/me/accounts", t.accessToken, { fields: "id,name,access_token", limit: "100" });
    return rows.map((p) => ({ externalId: p.id, name: p.name ?? `Page ${p.id}`, pageToken: p.access_token ?? null }));
  },
  async subscribePage(page) {
    if (!page.pageToken) throw new AdsAuthError("No Page access was granted for this Page.");
    await graph(`/${encodeURIComponent(page.externalId)}/subscribed_apps`, page.pageToken, { method: "POST", params: { subscribed_fields: "leadgen" } });
  },
  async fetchLead(pageToken, leadId) {
    if (!pageToken) throw new AdsAuthError("No Page access token.");
    const r = await graph<RawLead>(`/${encodeURIComponent(leadId)}`, pageToken, { params: { fields: LEAD_FIELDS } });
    let formName: string | null = null;
    if (r.form_id) formName = (await graph<{ name?: string }>(`/${encodeURIComponent(r.form_id)}`, pageToken, { params: { fields: "name" } }).catch(() => ({ name: undefined }))).name ?? null;
    return mapMetaLead({ ...r, id: r.id ?? leadId }, { formName });
  },
  async listRecentLeads(pageToken, pageId, since) {
    if (!pageToken) throw new AdsAuthError("No Page access token.");
    const forms = await all<{ id: string; name?: string }>(`/${encodeURIComponent(pageId)}/leadgen_forms`, pageToken, { fields: "id,name", limit: "100" });
    const out: LeadData[] = [];
    for (const f of forms) {
      const leads = await all<RawLead>(`/${encodeURIComponent(f.id)}/leads`, pageToken, {
        fields: LEAD_FIELDS, limit: "100",
        filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(since.getTime() / 1000) }]),
      });
      out.push(...leads.map((l) => mapMetaLead({ ...l, form_id: l.form_id ?? f.id }, { pageId, formName: f.name ?? null })));
    }
    return out;
  },
  async fetchDailyCampaignMetrics(t, account, from, to) {
    const rows = await all<{ campaign_id: string; campaign_name?: string; date_start: string; spend?: string; impressions?: string; clicks?: string; actions?: { action_type: string; value: string }[] }>(
      `/${encodeURIComponent(account.externalId)}/insights`, t.accessToken,
      { level: "campaign", time_increment: "1", fields: "campaign_id,campaign_name,spend,impressions,clicks,actions", time_range: JSON.stringify({ since: from, until: to }), limit: "500" }, 200);
    return rows.map((r): DailyRow => {
      const lead = r.actions?.find((a) => a.action_type === "lead") ?? r.actions?.find((a) => a.action_type === "onsite_conversion.lead_grouped");
      return {
        campaignId: r.campaign_id, campaignName: r.campaign_name ?? r.campaign_id, day: r.date_start, spendMicros: decimalToMicros(r.spend),
        impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
        // No "actions" at all = Meta didn't report conversions for that row (unknown, not zero).
        platformLeads: r.actions ? Math.round(Number(lead?.value ?? 0)) : null, platformConversions: null,
      };
    });
  },
  async revoke(t) {
    await graph("/me/permissions", t.accessToken, { method: "DELETE" }).catch(() => undefined);
  },
};

export type { AdAccountInfo, PageInfo };
