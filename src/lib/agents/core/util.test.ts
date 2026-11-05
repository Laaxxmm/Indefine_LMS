import { describe, expect, it } from "vitest";
import { addDays, addMonthsClamped, addYears, dayNumber, daysBetween, divRoundHalfUp, fyEndKey, fyStart, fyStartKey, isDayKey, optPaise, parseCsv, roundToRupee, rupeesToPaise, yes } from "./util";

describe("rupeesToPaise", () => {
  it.each([
    ["10,00,000", 100000000],
    ["1,000,000.5", 100000050],
    ["₹ 1,23,456.78", 12345678],
    ["Rs. 500", 50000],
    ["(1,234.00)", -123400],
    ["-99.99", -9999],
    ["0", 0],
    [1234.5, 123450],
    [0.07, 7],
    [100000000, 10000000000],
  ])("%s → %d paise", (v, want) => {
    expect(rupeesToPaise(v)).toBe(want);
  });

  it.each([["1.234"], ["abc"], [""], ["1,2,3.4.5"], [Number.NaN], [1e21], [null], [{}]])("rejects %s", (v) => {
    expect(() => rupeesToPaise(v, "x")).toThrow(/x/);
  });

  it("optPaise treats blank as zero", () => {
    expect(optPaise(undefined)).toBe(0);
    expect(optPaise(null)).toBe(0);
    expect(optPaise("  ")).toBe(0);
    expect(optPaise("5")).toBe(500);
  });
});

describe("days", () => {
  it("validates day keys", () => {
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2026-9-1")).toBe(false);
    expect(isDayKey(20260901)).toBe(false);
  });
  it("adds and counts days", () => {
    expect(addDays("2026-09-25", 29)).toBe("2026-10-24");
    expect(daysBetween("2026-10-24", "2026-11-10")).toBe(17);
    expect(() => addDays("bad", 1)).toThrow();
  });
  it("adds months clamped to the month end", () => {
    expect(addMonthsClamped("2026-03-31", 6)).toBe("2026-09-30");
    expect(addMonthsClamped("2026-03-31", 9)).toBe("2026-12-31");
    expect(addMonthsClamped("2025-06-20", 15)).toBe("2026-09-20");
    expect(addMonthsClamped("2027-11-30", 3)).toBe("2028-02-29");
    expect(addYears("2027-04-01", -1)).toBe("2026-04-01");
  });
  it("FY helpers", () => {
    expect(fyStart("2025-26")).toBe(2025);
    expect(fyEndKey("2025-26")).toBe("2026-03-31");
    expect(fyStartKey("2025-26")).toBe("2025-04-01");
    expect(() => fyStart("2025-27")).toThrow(/FY/);
    expect(dayNumber("2026-09-30")).toBe(20260930);
    expect(dayNumber(null)).toBe(0);
  });
});

describe("integers", () => {
  it("rounds half up exactly", () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(() => divRoundHalfUp(1, 0)).toThrow();
    expect(roundToRupee(12350)).toBe(12400);
    expect(roundToRupee(12349)).toBe(12300);
  });
});

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, CRLF and a BOM", () => {
    const rows = parseCsv('﻿Name,Amount\r\n"Rao, Asha","1,20,000"\r\n"Say ""hi""",5\r\n\r\n');
    expect(rows).toEqual([
      { name: "Rao, Asha", amount: "1,20,000" },
      { name: 'Say "hi"', amount: "5" },
    ]);
  });
  it("handles a last line without newline and empty input", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
    expect(parseCsv("")).toEqual([]);
  });
  it("refuses an unquoted amount that splits into extra fields", () => {
    expect(() => parseCsv("vendor,amount\nX,1,20,000")).toThrow(/quote amounts/);
  });
  it("yes()", () => {
    expect(yes("Yes")).toBe(true);
    expect(yes(true)).toBe(true);
    expect(yes("no")).toBe(false);
    expect(yes(undefined)).toBe(false);
  });
});
