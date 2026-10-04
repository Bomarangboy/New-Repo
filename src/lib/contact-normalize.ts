import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

/** Trims, collapses whitespace, strips control characters, and caps length. */
export function cleanText(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/** Like cleanText but keeps line breaks (messages, notes). */
export function cleanMultiline(v: unknown, max = 5000): string | null {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s ? s.slice(0, max) : null;
}

const emailSchema = z.email();

export function normalizeEmail(raw: unknown): { display: string; normalized: string } | null | "invalid" {
  const s = cleanText(raw, 254);
  if (!s) return null;
  if (!emailSchema.safeParse(s).success) return "invalid";
  return { display: s, normalized: s.toLowerCase() };
}

/** US-first phone parsing (launch market). Returns E.164 or "invalid". */
export function normalizePhone(raw: unknown): { display: string; e164: string } | null | "invalid" {
  const s = cleanText(raw, 40);
  if (!s) return null;
  const p = parsePhoneNumberFromString(s, "US");
  if (!p || !p.isValid()) return "invalid";
  return { display: p.country === "US" ? p.formatNational() : p.formatInternational(), e164: p.number };
}

export const TRACKING_KEYS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "landing_page", "referrer",
] as const;

export function pickTracking(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of TRACKING_KEYS) {
    const v = cleanText(input[k], 500);
    if (v) out[k] = v;
  }
  return out;
}

/** Prevents spreadsheet formula injection when exporting values to CSV. */
export function csvSafe(v: unknown): string {
  const s = v == null ? "" : String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
