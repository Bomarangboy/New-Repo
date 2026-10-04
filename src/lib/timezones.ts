/** US-focused timezone choices (launch market: United States). Any valid IANA zone is accepted. */
export const US_TIMEZONES = [
  { id: "America/New_York", label: "Eastern (New York)" },
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Phoenix", label: "Mountain – no DST (Phoenix)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska (Anchorage)" },
  { id: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
] as const;

export function timezoneLabel(tz: string): string {
  return US_TIMEZONES.find((t) => t.id === tz)?.label ?? tz;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz.includes("/") || tz === "UTC";
  } catch {
    return false;
  }
}

export function formatInZone(d: Date | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(d);
}
