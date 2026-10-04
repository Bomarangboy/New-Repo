import { describe, expect, it } from "vitest";
import { lastWeek } from "@/server/reports/weekly-summary";

describe("weekly summary period", () => {
  it("is last Monday to Sunday in the company's timezone", () => {
    const w = lastWeek(new Date("2026-10-05T14:00:00Z"), "America/New_York"); // Monday 10am ET
    expect(w).toMatchObject({ fromDay: "2026-09-28", toDay: "2026-10-04", weekKey: "2026-09-28" });
    expect(w.start.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-05T04:00:00.000Z");
  });
  it("uses the local date, not UTC (Sunday night in Los Angeles is already Monday in UTC)", () => {
    const w = lastWeek(new Date("2026-10-05T03:00:00Z"), "America/Los_Angeles"); // Sunday 8pm PT
    expect(w.fromDay).toBe("2026-09-21");
    expect(w.toDay).toBe("2026-09-27");
  });
  it("handles the daylight-saving change (the week of 1 Nov 2026 is 169 hours long in New York)", () => {
    const w = lastWeek(new Date("2026-11-09T15:00:00Z"), "America/New_York");
    expect(w.fromDay).toBe("2026-11-02");
    const w2 = lastWeek(new Date("2026-11-02T15:00:00Z"), "America/New_York");
    expect((w2.end.getTime() - w2.start.getTime()) / 3600_000).toBe(169);
  });
});
