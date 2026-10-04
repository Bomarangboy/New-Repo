import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { CompanyKind } from "@/lib/authz/account-policy";

export type AdPlatform = "meta" | "google";
export const PLATFORMS: AdPlatform[] = ["meta", "google"];
export const PLATFORM_NAMES: Record<AdPlatform, string> = { meta: "Meta (Facebook & Instagram)", google: "Google Ads" };

/**
 * How a company may connect an ad platform (D-31):
 *  - live: real sign-in and real data — only when Bluewater's app credentials exist, the owner has switched
 *    on ADS_LIVE_ENABLED (staging/production only) and the company is a real customer;
 *  - simulated: sample accounts and numbers, clearly labeled — development, test, demo, and demo/test companies;
 *  - unavailable: a real customer in production while live connections aren't approved yet.
 * A simulated connection is never offered to a real customer in production.
 */
export type AdsMode = "live" | "simulated" | "unavailable";

type EnvLike = Pick<ReturnType<typeof env>, "APP_ENV" | "ADS_LIVE_ENABLED" | "META_APP_ID" | "META_APP_SECRET" | "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET" | "GOOGLE_ADS_DEVELOPER_TOKEN">;

export function liveCredentialsPresent(p: AdPlatform, e: EnvLike = env()): boolean {
  return p === "meta" ? Boolean(e.META_APP_ID && e.META_APP_SECRET) : Boolean(e.GOOGLE_OAUTH_CLIENT_ID && e.GOOGLE_OAUTH_CLIENT_SECRET && e.GOOGLE_ADS_DEVELOPER_TOKEN);
}

export function adsMode(p: AdPlatform, companyKind: CompanyKind, e: EnvLike = env()): AdsMode {
  if (e.ADS_LIVE_ENABLED && liveCredentialsPresent(p, e) && companyKind === "customer") return "live";
  if (e.APP_ENV !== "production" || companyKind !== "customer") return "simulated";
  return "unavailable";
}

export const oauthRedirectUri = (p: AdPlatform) => `${env().APP_BASE_URL}/api/oauth/${p}/callback`;

/* ---------------- OAuth "state": signed, short-lived, bound to company, user and browser ---------------- */

const stateKey = () => Buffer.concat([Buffer.from(env().ENCRYPTION_KEY, "base64"), Buffer.from("ads-oauth-state")]);

export interface OAuthState { c: string; u: string; p: AdPlatform; n: string; e: number }

export function signState(s: OAuthState): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${createHmac("sha256", stateKey()).update(body).digest("base64url")}`;
}

/** Returns the state only if the signature is valid, it hasn't expired and the browser nonce matches. */
export function verifyState(raw: string | null | undefined, nonceCookie: string | null | undefined, now = Date.now()): OAuthState | null {
  if (!raw || !nonceCookie) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(createHmac("sha256", stateKey()).update(body).digest("base64url"));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let s: OAuthState;
  try { s = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!s || s.e < now || s.n !== nonceCookie || (s.p !== "meta" && s.p !== "google")) return null;
  return s;
}

export const OAUTH_NONCE_COOKIE = "bw_ads_oauth";
