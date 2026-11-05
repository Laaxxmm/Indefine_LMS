import { describe, expect, it } from "vitest";
import {
  GstParseError,
  addDays,
  addTax,
  dayAfterFyEnd,
  dayOfNextMonth,
  daysBetween,
  fyOfDay,
  minTax,
  mulDivRound,
  parseAmount,
  parseDay,
  parseRateBps,
  periodInfo,
  plainRupees,
  rupeesToPaise,
  subTax,
  sumTax,
  taxAt,
  taxTotal,
  zeroTax,
} from "./money";

describe("parseAmount → integer paise", () => {
  it.each([
    ["1,23,456.78", 12345678],
    ["₹ 1,234", 123400],
    ["Rs. 50.5", 5050],
    ["INR 10", 1000],
    ["(500.00)", -50000],
    ["-12.5", -1250],
    ["+7", 700],
    ["1,234.00 Cr", 123400],
    ["99.995", 10000], // third decimal rounds half up
    ["99.994", 9999],
    [1234.5, 123450],
    [118000.1, 11800010],
    [-0.01, -1],
  ])("%s → %i", (raw, paise) => expect(parseAmount(raw)).toBe(paise));

  it("blank, dash and null are null", () => {
    for (const v of ["", "  ", "-", "—", null, undefined]) expect(parseAmount(v)).toBeNull();
  });

  it("garbage and non-finite numbers throw GstParseError", () => {
    expect(() => parseAmount("12a")).toThrow(GstParseError);
    expect(() => parseAmount(Number.NaN)).toThrow(GstParseError);
    expect(() => parseAmount("9".repeat(20))).toThrow(/too large/);
  });

  it("rupeesToPaise treats null as 0", () => {
    expect(rupeesToPaise(null)).toBe(0);
    expect(rupeesToPaise("5401.01")).toBe(540101);
  });
});

describe("rates, rounding, tax", () => {
  it("parseRateBps reads percentages only", () => {
    expect(parseRateBps("18%")).toBe(1800);
    expect(parseRateBps(18)).toBe(1800);
    expect(parseRateBps("0.25")).toBe(25);
    expect(parseRateBps("")).toBeNull();
    expect(parseRateBps(null)).toBeNull();
  });

  it("mulDivRound rounds half away from zero, exactly, beyond 2^53 intermediates", () => {
    expect(mulDivRound(5, 1, 2)).toBe(3);
    expect(mulDivRound(-5, 1, 2)).toBe(-3);
    expect(mulDivRound(4, 1, 3)).toBe(1);
    expect(mulDivRound(9_000_000_000_000, 9_000, 10_000)).toBe(8_100_000_000_000);
    expect(mulDivRound(720000, 18000, 3650000)).toBe(3551); // 3550.68
    expect(mulDivRound(10, 1, -4)).toBe(-3);
    expect(() => mulDivRound(1, 1, 0)).toThrow(RangeError);
  });

  it("taxAt splits intra into equal rounded halves and inter into IGST", () => {
    expect(taxAt(5000000, 1800, false)).toEqual({ igst: 0, cgst: 450000, sgst: 450000, cess: 0 });
    expect(taxAt(8474577, 1800, true)).toEqual({ igst: 1525424, cgst: 0, sgst: 0, cess: 0 }); // 15254.2386 → 15254.24
    expect(taxAt(101, 500, false)).toEqual({ igst: 0, cgst: 3, sgst: 3, cess: 0 }); // 2.525 → 3 each
  });

  it("tax split arithmetic", () => {
    const a = { igst: 1, cgst: 2, sgst: 3, cess: 4 };
    const b = { igst: 4, cgst: 1, sgst: 3, cess: 0 };
    expect(addTax(a, b)).toEqual({ igst: 5, cgst: 3, sgst: 6, cess: 4 });
    expect(subTax(a, b)).toEqual({ igst: -3, cgst: 1, sgst: 0, cess: 4 });
    expect(minTax(a, b)).toEqual({ igst: 1, cgst: 1, sgst: 3, cess: 0 });
    expect(sumTax([a, b, zeroTax()])).toEqual(addTax(a, b));
    expect(taxTotal(a)).toBe(10);
    expect(plainRupees(-123456)).toBe("-1234.56");
    expect(plainRupees(5)).toBe("0.05");
  });
});

describe("dates", () => {
  it.each([
    ["2026-10-05", "2026-10-05"],
    ["05-10-2026", "2026-10-05"],
    ["5/10/26", "2026-10-05"],
    ["05.10.2026", "2026-10-05"],
    ["05-Oct-2026", "2026-10-05"],
    ["5 Oct 2026", "2026-10-05"],
    ["5 Sept 2026", "2026-09-05"],
    ["2026-10-05T10:00:00", "2026-10-05"],
    [46300, "2026-10-05"], // Excel serial (1900 system, epoch 30 Dec 1899)
    [new Date("2026-10-05T00:00:00Z"), "2026-10-05"],
  ])("parseDay(%s) = %s", (raw, key) => expect(parseDay(raw)).toBe(key));

  it("day-first, never month-first; invalid days throw", () => {
    expect(parseDay("02/03/2026")).toBe("2026-03-02");
    expect(() => parseDay("31-02-2026")).toThrow(GstParseError);
    expect(() => parseDay("13/13/2026")).toThrow(GstParseError);
    expect(() => parseDay("05-Foo-2026")).toThrow(GstParseError);
    expect(() => parseDay(0)).toThrow(GstParseError);
    expect(() => parseDay(new Date("x"))).toThrow(GstParseError);
    expect(parseDay("")).toBeNull();
    expect(parseDay(null)).toBeNull();
  });

  it("day arithmetic and FY", () => {
    expect(daysBetween("2026-05-03", "2026-10-31")).toBe(181);
    expect(daysBetween("2026-05-04", "2026-10-31")).toBe(180);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(fyOfDay("2026-03-31")).toBe("2025-26");
    expect(fyOfDay("2026-04-01")).toBe("2026-27");
    expect(dayAfterFyEnd("2024-25", "11-30")).toBe("2025-11-30");
  });

  it("periods: monthly, quarterly (QRMP), leap year, bad input", () => {
    expect(periodInfo("2026-10", "2026-27")).toMatchObject({ kind: "monthly", start: "2026-10-01", end: "2026-10-31" });
    expect(periodInfo("2028-02", "2027-28").end).toBe("2028-02-29");
    expect(periodInfo("Q3", "2026-27")).toMatchObject({ kind: "quarterly", start: "2026-10-01", end: "2026-12-31" });
    expect(periodInfo("Q4", "2026-27")).toMatchObject({ start: "2027-01-01", end: "2027-03-31" });
    expect(() => periodInfo("Annual", "2026-27")).toThrow(/monthly/);
    expect(() => periodInfo("2026-13", "2026-27")).toThrow(GstParseError);
  });

  it("dayOfNextMonth clamps to the month length and wraps the year", () => {
    expect(dayOfNextMonth("2026-10-31", 20)).toBe("2026-11-20");
    expect(dayOfNextMonth("2026-12-31", 20)).toBe("2027-01-20");
    expect(dayOfNextMonth("2027-01-31", 30)).toBe("2027-02-28");
  });
});
