import { describe, expect, it } from "vitest";
import { dateInputValue, nextMonth, startOfDay, tomorrow } from "../../src/web/snooze.ts";

describe("the Defer menu's dates (#0017)", () => {
  it("keeps the time of day for tomorrow and next month", () => {
    const now = new Date(2026, 10, 12, 15, 30);
    expect(tomorrow(now)).toEqual(new Date(2026, 10, 13, 15, 30));
    expect(nextMonth(now)).toEqual(new Date(2026, 11, 12, 15, 30));
    expect(nextMonth(new Date(2026, 11, 5, 9, 0))).toEqual(new Date(2027, 0, 5, 9, 0));
  });

  it("stops at the end of a shorter month", () => {
    expect(nextMonth(new Date(2027, 0, 31, 8, 0))).toEqual(new Date(2027, 1, 28, 8, 0));
    expect(nextMonth(new Date(2028, 0, 30, 8, 0))).toEqual(new Date(2028, 1, 29, 8, 0));
  });

  it("reads a picked day as its start, in local time", () => {
    expect(startOfDay("2026-11-20")).toEqual(new Date(2026, 10, 20));
    expect(startOfDay("2026-02-30")).toBeUndefined();
    expect(startOfDay("")).toBeUndefined();
    expect(dateInputValue(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
