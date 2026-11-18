import { describe, it, expect } from "vitest";
import { INR_NUMFMT, formatDate, formatDateTimeIst, formatDayKey, formatInr, groupIndian, toPaise } from "./format";

describe("formatInr", () => {
  it.each([
    [0, "0.00"],
    [5, "5.00"],
    [999, "999.00"],
    [1000, "1,000.00"],
    [12345, "12,345.00"],
    [99999.99, "99,999.99"],
    [100000, "1,00,000.00"],
    [123456, "1,23,456.00"],
    [1234567.8, "12,34,567.80"],
    [12345678.9, "1,23,45,678.90"],
    [1234567890.12, "1,23,45,67,890.12"],
    [-1234.5, "-1,234.50"],
    [-123456, "-1,23,456.00"],
    [1.005, "1.01"],
    [2.675, "2.68"],
    [0.1 + 0.2, "0.30"],
    [-0.004, "0.00"],
    [1e-7, "0.00"],
  ])("%s → %s", (n, s) => expect(formatInr(n)).toBe(s));

  it("adds the rupee symbol after the sign", () => {
    expect(formatInr(123456, { symbol: true })).toBe("₹1,23,456.00");
    expect(formatInr(-5, { symbol: true })).toBe("-₹5.00");
  });

  it("refuses non-finite and unsafe amounts", () => {
    expect(() => formatInr(NaN)).toThrow(RangeError);
    expect(() => formatInr(Infinity)).toThrow(RangeError);
    expect(() => formatInr("12" as unknown as number)).toThrow(RangeError);
    expect(() => formatInr(1e17)).toThrow(/too large/);
  });
});

describe("groupIndian / toPaise", () => {
  it("groups digit strings", () => {
    expect(groupIndian("1")).toBe("1");
    expect(groupIndian("1234")).toBe("1,234");
    expect(groupIndian("123456789")).toBe("12,34,56,789");
    expect(() => groupIndian("12a")).toThrow();
  });
  it("rounds half away from zero in paise", () => {
    expect(toPaise(1.005)).toBe(101);
    expect(toPaise(-1.005)).toBe(-101);
    expect(toPaise(1e21)).toBe(1e23);
  });
});

describe("dates", () => {
  it("formats day keys and IST days", () => {
    expect(formatDayKey("2028-02-29")).toBe("29 Feb 2028");
    expect(formatDate("2026-11-05")).toBe("05 Nov 2026");
    // 31 Mar 2027 20:00 UTC is already 1 Apr 2027 in IST
    expect(formatDate(new Date("2027-03-31T20:00:00Z"))).toBe("01 Apr 2027");
    expect(() => formatDayKey("2026-13-01")).toThrow();
    expect(() => formatDayKey("5 Nov")).toThrow();
    expect(() => formatDate(new Date("nope"))).toThrow(RangeError);
  });
  it("formats IST date-times as DD MMM YYYY HH:mm", () => {
    expect(formatDateTimeIst(new Date("2026-11-05T09:00:00Z"))).toBe("05 Nov 2026 14:30");
    expect(formatDateTimeIst(new Date("2026-12-31T18:45:00Z"))).toBe("01 Jan 2027 00:15");
    expect(() => formatDateTimeIst(new Date(NaN))).toThrow(RangeError);
  });
});

describe("INR_NUMFMT", () => {
  it("has crore and lakh sections with escaped literal commas", () => {
    const [crore, lakh, rest] = INR_NUMFMT.split(";");
    expect(crore).toBe("[>=10000000]##\\,##\\,##\\,##0.00");
    expect(lakh).toBe("[>=100000]##\\,##\\,##0.00");
    expect(rest).toBe("##,##0.00");
  });
});
