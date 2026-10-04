import { describe, expect, it } from "vitest";
import { localDateKey, percentChange, periodFor, zonedMidnight } from "@/lib/periods";
import { parseImportDate } from "@/server/crm/imports";
import { csvSafe, normalizePhone } from "@/lib/contact-normalize";

describe("reporting periods in the company's timezone", () => {
  it("finds local midnight, including across daylight-saving changes", () => {
    expect(zonedMidnight(2026, 3, 8, "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z"); // DST starts at 2am
    expect(zonedMidnight(2026, 3, 9, "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(zonedMidnight(2026, 11, 1, "America/Los_Angeles").toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(zonedMidnight(2026, 11, 2, "America/Los_Angeles").toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(zonedMidnight(2026, 7, 1, "America/Phoenix").toISOString()).toBe("2026-07-01T07:00:00.000Z"); // no DST
  });

  it("'last 7 days' covers 7 local calendar days ending now; previous period is adjacent", () => {
    const p = periodFor(7, "America/Chicago", new Date("2026-03-10T15:00:00Z"));
    expect(p.dayKeys).toEqual(["2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(p.start.toISOString()).toBe("2026-03-04T06:00:00.000Z");
    expect(p.prevStart.toISOString()).toBe("2026-02-25T06:00:00.000Z");
    expect(localDateKey(new Date("2026-03-10T04:59:00Z"), "America/Chicago")).toBe("2026-03-09");
  });

  it("percent change has no value without a base", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(5, 10)).toBe(-50);
  });
});

describe("import and contact parsing", () => {
  it("parses ISO and US dates; rejects impossible or future dates", () => {
    expect((parseImportDate("2026-03-31") as Date).toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect((parseImportDate("3/31/2026") as Date).toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect(parseImportDate("2/30/2026")).toBe("invalid");
    expect(parseImportDate("31/12/2026")).toBe("invalid");
    expect(parseImportDate("2099-01-01")).toBe("invalid");
    expect(parseImportDate("")).toBeNull();
  });
  it("normalizes US phone formats to one value", () => {
    for (const p of ["(415) 555-0150", "415.555.0150", "+1 415 555 0150", "1-415-555-0150"]) {
      expect(normalizePhone(p)).toMatchObject({ e164: "+14155550150" });
    }
    expect(normalizePhone("555-1234")).toBe("invalid");
  });
  it("guards CSV cells against formulas", () => {
    expect(csvSafe("=1+1")).toBe("'=1+1");
    expect(csvSafe("-5")).toBe("'-5");
    expect(csvSafe('a,"b"')).toBe('"a,""b"""');
    expect(csvSafe(null)).toBe("");
  });
});
