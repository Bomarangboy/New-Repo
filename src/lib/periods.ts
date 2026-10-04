/**
 * Reporting periods are defined in the COMPANY's timezone (docs/METRICS.md):
 * "Last 30 days" = from local midnight 29 days ago until now. The previous period is
 * the same length immediately before it. DST changes are handled by resolving local
 * midnight through the timezone database rather than adding 24-hour blocks.
 */

function partsInZone(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

/** Offset (ms) of `tz` from UTC at instant `d`. */
function offsetMs(d: Date, tz: string): number {
  const p = partsInZone(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight for the calendar date (y, m, d) in `tz`. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz); // second pass settles DST transitions
  return new Date(t);
}

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDateKey(d: Date, tz: string): string {
  const p = partsInZone(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export const PERIOD_OPTIONS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIOD_OPTIONS)[number];

export function parsePeriod(raw: unknown): PeriodDays {
  const n = Number(raw);
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? (n as PeriodDays) : 30;
}

export interface Period {
  days: number;
  start: Date;
  end: Date;
  prevStart: Date;
  /** Local date keys, oldest first, one per day in the period. */
  dayKeys: string[];
}

export function periodFor(days: number, tz: string, now = new Date()): Period {
  const today = partsInZone(now, tz);
  const startCal = new Date(Date.UTC(today.y, today.m - 1, today.d - (days - 1)));
  const start = zonedMidnight(startCal.getUTCFullYear(), startCal.getUTCMonth() + 1, startCal.getUTCDate(), tz);
  const prevCal = new Date(Date.UTC(today.y, today.m - 1, today.d - (2 * days - 1)));
  const prevStart = zonedMidnight(prevCal.getUTCFullYear(), prevCal.getUTCMonth() + 1, prevCal.getUTCDate(), tz);
  const dayKeys: string[] = [];
  for (let i = 0; i < days; i++) {
    const c = new Date(Date.UTC(startCal.getUTCFullYear(), startCal.getUTCMonth(), startCal.getUTCDate() + i));
    dayKeys.push(`${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, "0")}-${String(c.getUTCDate()).padStart(2, "0")}`);
  }
  return { days, start, end: now, prevStart, dayKeys };
}

/** Percent change, or null when there's no meaningful base (never "infinite" or a fake 0%). */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
