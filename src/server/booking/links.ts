/**
 * Personalized booking links. Each lead gets the business's booking page with a short reference that
 * Cal.com passes back in the booking's webhook (`metadata[bw]=…`), so the booking attaches to the right
 * inquiry. The reference only identifies an inquiry INSIDE the company whose signed webhook carries it
 * (lookups run under that company's row-level security), so it can't attach a booking to another company.
 * Prefill (name/email) is added to email links only, keeping texts short and personal details out of SMS.
 * AWAITING LIVE VERIFICATION against a real Cal.com account.
 */
export function refFromInquiryId(id: string): string {
  return Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url");
}

export function inquiryIdFromRef(ref: unknown): string | null {
  if (typeof ref !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(ref)) return null;
  const hex = Buffer.from(ref, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function bookingLinkFor(bookingUrl: string | null | undefined, inquiryId: string, prefill?: { name?: string | null; email?: string | null }): string | null {
  if (!bookingUrl) return null;
  let u: URL;
  try { u = new URL(bookingUrl); } catch { return null; }
  if (prefill?.name) u.searchParams.set("name", prefill.name);
  if (prefill?.email) u.searchParams.set("email", prefill.email);
  // Built by hand so the brackets stay readable in a text message (Cal.com accepts either form).
  const q = u.searchParams.toString();
  return `${u.origin}${u.pathname}?${q ? q + "&" : ""}metadata[bw]=${refFromInquiryId(inquiryId)}`;
}

/** Only real web addresses, so a typo can't put something odd into customers' messages. */
export function validBookingUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** "Tue, Oct 6 at 2:00 PM EDT" in the business's timezone. */
export function formatAppointmentTime(d: Date, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.month} ${p.day} at ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}
