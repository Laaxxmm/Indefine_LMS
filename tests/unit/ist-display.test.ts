// src/lib/ist.ts display helpers: IST calendar day, and "Sep" (not en-IN's "Sept") for September.
import { describe, expect, it } from "vitest";
import { SHORT_MONTHS, formatIst, istLabel } from "@/lib/ist";
import { formatDate } from "@/lib/agents/core/format";

describe("istLabel / formatIst", () => {
  it("writes September as Sep in every short-month format", () => {
    const d = new Date("2026-09-05T06:30:00Z");
    expect(istLabel(d, { day: "numeric", month: "short" })).toBe("5 Sep");
    expect(istLabel(d, { day: "2-digit", month: "short", year: "numeric" })).toBe("05 Sep 2026");
    expect(formatIst(d)).toMatch(/^Sat, 05 Sep 2026, 12:00\s?pm IST$/iu); // ICU puts a narrow no-break space before pm
    expect(formatIst(d)).not.toContain("Sept");
  });

  it("takes the month from the IST calendar day, not UTC", () => {
    // 31 Aug 20:00 UTC is 1 Sep 01:30 IST.
    expect(istLabel(new Date("2026-08-31T20:00:00Z"), { day: "numeric", month: "short", year: "numeric" })).toBe("1 Sep 2026");
    expect(istLabel(new Date("2026-08-31T18:00:00Z"), { day: "numeric", month: "short" })).toBe("31 Aug");
  });

  it("leaves long months to the locale (September) and every month's short name is three letters", () => {
    expect(istLabel(new Date("2026-09-15T06:00:00Z"), { month: "long", day: "numeric" })).toContain("September");
    expect(SHORT_MONTHS.every((m) => m.length === 3)).toBe(true);
  });

  it("agrees with the Firm OS formatter (DD MMM YYYY)", () => {
    const d = new Date("2026-09-30T19:00:00Z"); // 1 Oct 00:30 IST
    expect(formatDate(d)).toBe("01 Oct 2026");
    expect(istLabel(d, { day: "2-digit", month: "short", year: "numeric" })).toBe(formatDate(d));
  });
});
