import { describe, it, expect } from "vitest";
import {
  CalendarRuleSchema,
  dueDatesFor,
  dueDatesForFy,
  holidaysFrom,
  isWorkingDay,
  onOrBeforeWorkingDay,
  packDueDates,
  parseCalendarPack,
  parseFy,
  parsePeriod,
  periodsFor,
  shiftDayKey,
  type CalendarRule,
  type DueContext,
  type DueOptions,
  type DueResult,
} from "./calendar";
import { DEFAULT_CALENDAR, defaultCalendarJson } from "./calendar-defaults";

const pack = DEFAULT_CALENDAR;
const due = (ruleId: string, ctx: DueContext, opts: DueOptions = {}) => packDueDates(pack, ruleId, ctx, opts);
const dates = (r: DueResult) => (r.ok ? [r.statutoryDue, r.internalDue] : r.code);
const FY = "2026-27";

describe("default pack", () => {
  it("validates and covers every required form", () => {
    expect(pack.bufferDays).toBe(3);
    expect(pack.rules.map((r) => r.id)).toEqual([
      "gstr-1", "gstr-3b", "gstr-9", "gstr-9c", "tds-24q", "tds-26q", "advance-tax", "itr", "aoc-4", "mgt-7", "adt-1", "dir-3-kyc", "msme-1",
    ]);
    expect(pack.rules.every((r) => r.source.length > 10)).toBe(true);
    expect(parseCalendarPack(defaultCalendarJson())).toMatchObject({ ok: true });
  });

  it("puts each GST state code in at most one QRMP group, with Karnataka on the 22nd", () => {
    const g22 = pack.stateGroups["qrmp-3b-22"];
    const g24 = pack.stateGroups["qrmp-3b-24"];
    expect(g22).toContain("29");
    expect(g24).toContain("07");
    expect(g22.filter((c) => g24.includes(c))).toEqual([]);
    expect(g22.length + g24.length).toBe(37);
  });
});

describe("GSTR-1", () => {
  it("monthly: 11th of next month; internal rolls back from Sunday to Friday", () => {
    const r = due("gstr-1", { fy: FY, period: "2026-10" });
    expect(r).toMatchObject({
      ok: true,
      form: "GSTR-1",
      variantId: null,
      statutoryDue: "2026-11-11",
      internalDue: "2026-11-06",
      bufferDays: 3,
      rolledBackDays: 2,
      statutoryOnNonWorkingDay: false,
      basis: "11th of the month after the period (period ends Oct 2026)",
    });
    if (r.ok) {
      expect(r.statutoryDueAt.toISOString()).toBe("2026-11-10T18:30:00.000Z"); // 00:00 IST
      expect(r.internalDueAt.toISOString()).toBe("2026-11-05T18:30:00.000Z");
    }
  });

  it("March return falls in the next FY (FY boundary) on a Sunday", () => {
    expect(due("gstr-1", { fy: FY, period: "2027-03" })).toMatchObject({ statutoryDue: "2027-04-11", internalDue: "2027-04-08", statutoryOnNonWorkingDay: true });
  });

  it("QRMP quarterly: 13th after the quarter", () => {
    expect(due("gstr-1", { fy: FY, period: "Q3", qrmp: true })).toMatchObject({ variantId: "qrmp-quarterly", statutoryDue: "2027-01-13", internalDue: "2027-01-08" });
  });

  it("IFF: 13th for months 1-2 of the quarter, nothing for month 3", () => {
    expect(due("gstr-1", { fy: FY, period: "2026-10", qrmp: true })).toMatchObject({ variantId: "iff", statutoryDue: "2026-11-13", internalDue: "2026-11-10" });
    expect(due("gstr-1", { fy: FY, period: "2026-11", qrmp: true })).toMatchObject({ variantId: "iff", statutoryDue: "2026-12-13" });
    expect(due("gstr-1", { fy: FY, period: "2026-12", qrmp: true })).toMatchObject({ ok: false, code: "NOT_APPLICABLE" });
  });

  it("a monthly filer has no quarterly GSTR-1", () => {
    expect(dates(due("gstr-1", { fy: FY, period: "Q2" }))).toBe("NOT_APPLICABLE");
  });

  it("leap year: January 2028 return is due 11 Feb 2028", () => {
    expect(dates(due("gstr-1", { fy: "2027-28", period: "2028-01" }))).toEqual(["2028-02-11", "2028-02-08"]);
  });
});

describe("GSTR-3B", () => {
  it("monthly: 20th", () => {
    expect(dates(due("gstr-3b", { fy: FY, period: "2026-10" }))).toEqual(["2026-11-20", "2026-11-17"]);
    expect(dates(due("gstr-3b", { fy: "2027-28", period: "2028-01" }))).toEqual(["2028-02-20", "2028-02-17"]);
  });

  it("QRMP 22nd group (Karnataka)", () => {
    expect(due("gstr-3b", { fy: FY, period: "Q3", qrmp: true, state: "29" })).toMatchObject({ variantId: "qrmp-22", statutoryDue: "2027-01-22", internalDue: "2027-01-19" });
  });

  it("QRMP 24th group (Delhi), statutory on a Sunday", () => {
    expect(due("gstr-3b", { fy: FY, period: "Q3", qrmp: true, state: "07" })).toMatchObject({
      variantId: "qrmp-24",
      statutoryDue: "2027-01-24",
      internalDue: "2027-01-21",
      statutoryOnNonWorkingDay: true,
    });
  });

  it("QRMP needs a known state", () => {
    expect(due("gstr-3b", { fy: FY, period: "Q3", qrmp: true })).toMatchObject({ ok: false, code: "STATE_REQUIRED" });
    expect(due("gstr-3b", { fy: FY, period: "Q3", qrmp: true, state: "99" })).toMatchObject({ ok: false, code: "UNKNOWN_STATE" });
  });

  it("QRMP has no monthly GSTR-3B; monthly filers have no quarterly one", () => {
    expect(dates(due("gstr-3b", { fy: FY, period: "2026-10", qrmp: true }))).toBe("NOT_APPLICABLE");
    expect(dates(due("gstr-3b", { fy: FY, period: "Q1" }))).toBe("NOT_APPLICABLE");
  });

  it("generates the year's monthly schedule", () => {
    const year = dueDatesForFy(pack.rules[1], { fy: FY, periodKind: "monthly" }, { stateGroups: pack.stateGroups });
    expect(year).toHaveLength(12);
    expect(year.map((r) => (r.ok ? r.statutoryDue : r.code))).toEqual([
      "2026-05-20", "2026-06-20", "2026-07-20", "2026-08-20", "2026-09-20", "2026-10-20",
      "2026-11-20", "2026-12-20", "2027-01-20", "2027-02-20", "2027-03-20", "2027-04-20",
    ]);
  });

  it("IFF schedule skips the third month of each quarter", () => {
    const year = dueDatesForFy(pack.rules[0], { fy: FY, periodKind: "monthly", qrmp: true });
    expect(year.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.message.split(":")[0]))).toEqual(["GSTR-1 2026-06", "GSTR-1 2026-09", "GSTR-1 2026-12", "GSTR-1 2027-03"]);
  });
});

describe("GSTR-9 / 9C", () => {
  it.each(["gstr-9", "gstr-9c"])("%s: 31 Dec after the FY", (id) => {
    expect(dates(due(id, { fy: FY, period: "Annual" }))).toEqual(["2027-12-31", "2027-12-28"]);
    expect(dates(due(id, { fy: "2027-28", period: "Annual" }))).toEqual(["2028-12-31", "2028-12-28"]);
  });

  it("is annual only", () => {
    expect(due("gstr-9", { fy: FY, period: "Q1" })).toMatchObject({ ok: false, code: "PERIOD_KIND_NOT_SUPPORTED" });
  });
});

describe("TDS 24Q / 26Q", () => {
  it.each(["tds-24q", "tds-26q"])("%s: 31 Jul / 31 Oct / 31 Jan / 31 May", (id) => {
    expect(dates(due(id, { fy: FY, period: "Q1" }))).toEqual(["2026-07-31", "2026-07-28"]);
    expect(dates(due(id, { fy: FY, period: "Q2" }))).toEqual(["2026-10-31", "2026-10-28"]);
    expect(dates(due(id, { fy: FY, period: "Q3" }))).toEqual(["2027-01-31", "2027-01-28"]);
    expect(dates(due(id, { fy: FY, period: "Q4" }))).toEqual(["2027-05-31", "2027-05-28"]);
  });

  it("Q4 explains the two-month offset", () => {
    expect(due("tds-24q", { fy: FY, period: "Q4" })).toMatchObject({ basis: "31st of the 2nd month after the period (period ends Mar 2027)" });
    expect(due("tds-24q", { fy: FY, period: "Q1" })).toMatchObject({ basis: "last day of the month after the period (period ends Jun 2026)" });
  });
});

describe("advance tax", () => {
  it("15 Jun / 15 Sep / 15 Dec / 15 Mar; Saturday internal dates roll to Friday", () => {
    expect(dates(due("advance-tax", { fy: FY, period: "Q1" }))).toEqual(["2026-06-15", "2026-06-12"]);
    expect(due("advance-tax", { fy: FY, period: "Q2" })).toMatchObject({ statutoryDue: "2026-09-15", internalDue: "2026-09-11", rolledBackDays: 1 });
    expect(dates(due("advance-tax", { fy: FY, period: "Q3" }))).toEqual(["2026-12-15", "2026-12-11"]);
    expect(dates(due("advance-tax", { fy: FY, period: "Q4" }))).toEqual(["2027-03-15", "2027-03-12"]);
    expect(due("advance-tax", { fy: FY, period: "Q1" })).toMatchObject({ basis: "15th of the period's last month (period ends Jun 2026)" });
  });

  it("presumptive: a single instalment by 15 March", () => {
    expect(due("advance-tax", { fy: FY, period: "Q4", category: "presumptive" })).toMatchObject({ variantId: "presumptive", statutoryDue: "2027-03-15" });
    expect(dates(due("advance-tax", { fy: FY, period: "Q1", category: "presumptive" }))).toBe("NOT_APPLICABLE");
  });
});

describe("ITR", () => {
  it("non-audit (default) 31 Jul, audit 31 Oct, transfer pricing 30 Nov", () => {
    expect(due("itr", { fy: FY, period: "Annual" })).toMatchObject({ variantId: null, statutoryDue: "2027-07-31", internalDue: "2027-07-28" });
    expect(dates(due("itr", { fy: FY, period: "Annual", category: "non-audit" }))).toEqual(["2027-07-31", "2027-07-28"]);
    expect(dates(due("itr", { fy: FY, period: "Annual", category: "audit" }))).toEqual(["2027-10-31", "2027-10-28"]);
    expect(due("itr", { fy: FY, period: "Annual", category: "transfer-pricing" })).toMatchObject({ statutoryDue: "2027-11-30", internalDue: "2027-11-26", rolledBackDays: 1 });
  });

  it("rejects an unknown category", () => {
    expect(due("itr", { fy: FY, period: "Annual", category: "huf" })).toMatchObject({ ok: false, code: "UNKNOWN_CATEGORY" });
  });
});

describe("AGM-relative ROC forms", () => {
  const agm = "2027-09-30";
  it("AOC-4: 30 days from AGM (AGM 30 Sep → 29 Oct)", () => {
    expect(due("aoc-4", { fy: FY, period: "Annual", agmDate: agm })).toMatchObject({
      statutoryDue: "2027-10-29",
      internalDue: "2027-10-26",
      basis: "30 days from the AGM (AGM day counted as day 1)",
    });
  });
  it("MGT-7: 60 days from AGM (→ 28 Nov, a Sunday)", () => {
    expect(due("mgt-7", { fy: FY, period: "Annual", agmDate: agm })).toMatchObject({ statutoryDue: "2027-11-28", internalDue: "2027-11-25", statutoryOnNonWorkingDay: true });
  });
  it("ADT-1: 15 days from AGM (→ 14 Oct)", () => {
    expect(dates(due("adt-1", { fy: FY, period: "Annual", agmDate: agm }))).toEqual(["2027-10-14", "2027-10-11"]);
  });
  it("crosses month and year ends", () => {
    expect(due("aoc-4", { fy: FY, period: "Annual", agmDate: "2027-12-15" })).toMatchObject({ statutoryDue: "2028-01-13" });
    expect(due("mgt-7", { fy: FY, period: "Annual", agmDate: "2027-12-15" })).toMatchObject({ statutoryDue: "2028-02-12" });
  });
  it("leap year: ADT-1 after a mid-February AGM", () => {
    expect(due("adt-1", { fy: "2026-27", period: "Annual", agmDate: "2028-02-15" })).toMatchObject({ statutoryDue: "2028-02-29" });
    expect(due("adt-1", { fy: "2025-26", period: "Annual", agmDate: "2027-02-15" })).toMatchObject({ statutoryDue: "2027-03-01" });
  });
  it("accepts a Date AGM as its IST day", () => {
    expect(due("aoc-4", { fy: FY, period: "Annual", agmDate: new Date("2027-09-29T20:00:00Z") })).toMatchObject({ statutoryDue: "2027-10-29" });
  });
  it("needs a valid AGM date", () => {
    expect(due("aoc-4", { fy: FY, period: "Annual" })).toMatchObject({ ok: false, code: "AGM_DATE_REQUIRED" });
    expect(due("aoc-4", { fy: FY, period: "Annual", agmDate: "2027-02-30" })).toMatchObject({ ok: false, code: "INVALID_AGM_DATE" });
    expect(due("aoc-4", { fy: FY, period: "Annual", agmDate: "30/09/2027" })).toMatchObject({ ok: false, code: "INVALID_AGM_DATE" });
    expect(due("aoc-4", { fy: FY, period: "Annual", agmDate: new Date(NaN) })).toMatchObject({ ok: false, code: "INVALID_AGM_DATE" });
  });
  it("countAgmDay false counts from the day after the AGM", () => {
    const rule: CalendarRule = { ...pack.rules.find((r) => r.id === "adt-1")!, due: { anchor: "agm", days: 15, countAgmDay: false } };
    expect(dueDatesFor(rule, { fy: FY, period: "Annual", agmDate: agm })).toMatchObject({ statutoryDue: "2027-10-15", basis: "15 days from the AGM" });
  });
});

describe("DIR-3 KYC and MSME-1", () => {
  it("DIR-3 KYC: 30 Sep after the FY", () => {
    expect(dates(due("dir-3-kyc", { fy: FY, period: "Annual" }))).toEqual(["2027-09-30", "2027-09-27"]);
  });
  it("MSME-1: 31 Oct and 30 Apr", () => {
    expect(dates(due("msme-1", { fy: FY, period: "H1" }))).toEqual(["2026-10-31", "2026-10-28"]);
    expect(dates(due("msme-1", { fy: FY, period: "H2" }))).toEqual(["2027-04-30", "2027-04-27"]);
  });
});

describe("internal due: buffer, weekends and holidays", () => {
  it("bufferDays 0 keeps the statutory day when it is a working day", () => {
    expect(dates(due("gstr-3b", { fy: FY, period: "2026-10" }, { bufferDays: 0 }))).toEqual(["2026-11-20", "2026-11-20"]);
  });
  it("caller buffer overrides the pack buffer", () => {
    expect(due("gstr-3b", { fy: FY, period: "2026-10" }, { bufferDays: 5 })).toMatchObject({ internalDue: "2026-11-13", bufferDays: 5, rolledBackDays: 2 });
  });
  it("uses 3 days when no buffer is given", () => {
    expect(dueDatesFor(pack.rules[1], { fy: FY, period: "2026-10" })).toMatchObject({ internalDue: "2026-11-17", bufferDays: 3 });
  });
  it("rejects a bad buffer", () => {
    expect(due("gstr-3b", { fy: FY, period: "2026-10" }, { bufferDays: -1 })).toMatchObject({ ok: false, code: "INVALID_BUFFER" });
    expect(due("gstr-3b", { fy: FY, period: "2026-10" }, { bufferDays: 1.5 })).toMatchObject({ ok: false, code: "INVALID_BUFFER" });
  });
  it("skips holidays from the hook, then the weekend", () => {
    const isHoliday = holidaysFrom(["2026-11-17", "2026-11-16"]);
    expect(due("gstr-3b", { fy: FY, period: "2026-10" }, { isHoliday })).toMatchObject({ internalDue: "2026-11-13", rolledBackDays: 4 });
  });
  it("flags a statutory date on a holiday without moving it", () => {
    expect(due("gstr-3b", { fy: FY, period: "2026-10" }, { isHoliday: holidaysFrom(["2026-11-20"]) })).toMatchObject({
      statutoryDue: "2026-11-20",
      statutoryOnNonWorkingDay: true,
    });
  });
  it("supports a Sunday-only weekend", () => {
    expect(due("gstr-1", { fy: FY, period: "2026-10" }, { weekendDays: [0] })).toMatchObject({ internalDue: "2026-11-07", rolledBackDays: 1 });
  });
  it("internal due crosses February in leap and non-leap years", () => {
    const rule: CalendarRule = CalendarRuleSchema.parse({
      id: "custom-1st",
      form: "X",
      title: "1st of next month",
      service: "Books",
      periodKinds: ["monthly"],
      due: { anchor: "period-end", addMonths: 1, day: 1 },
      source: "test",
    });
    expect(dates(dueDatesFor(rule, { fy: "2027-28", period: "2028-02" }))).toEqual(["2028-03-01", "2028-02-25"]);
    expect(dates(dueDatesFor(rule, { fy: "2026-27", period: "2027-02" }))).toEqual(["2027-03-01", "2027-02-26"]);
  });
  it("clamps a day past month end (30 Feb → 29 Feb in 2028, 28 Feb in 2027) and supports 'last'", () => {
    const base = { id: "custom-30", form: "X", title: "30th", service: "Books", periodKinds: ["monthly"], source: "test" };
    const r30 = CalendarRuleSchema.parse({ ...base, due: { anchor: "period-end", addMonths: 1, day: 30 } });
    const rLast = CalendarRuleSchema.parse({ ...base, due: { anchor: "period-end", addMonths: 1, day: "last" } });
    expect(due30(r30, "2027-28", "2028-01")).toBe("2028-02-29");
    expect(due30(r30, "2026-27", "2027-01")).toBe("2027-02-28");
    expect(due30(rLast, "2027-28", "2028-01")).toBe("2028-02-29");
    expect(due30(r30, "2026-27", "2026-11")).toBe("2026-12-30");
  });
  const due30 = (rule: CalendarRule, fy: string, period: string) => {
    const r = dueDatesFor(rule, { fy, period });
    return r.ok ? r.statutoryDue : r.code;
  };
});

describe("input validation", () => {
  it.each([
    [{ fy: "2026-28", period: "2026-10" }, "INVALID_FY"],
    [{ fy: "26-27", period: "2026-10" }, "INVALID_FY"],
    [{ fy: FY, period: "2027-04" }, "INVALID_PERIOD"],
    [{ fy: FY, period: "2026-03" }, "INVALID_PERIOD"],
    [{ fy: FY, period: "2026-13" }, "INVALID_PERIOD"],
    [{ fy: FY, period: "2026-00" }, "INVALID_PERIOD"],
    [{ fy: FY, period: "Q5" }, "INVALID_PERIOD"],
    [{ fy: FY, period: "H1" }, "PERIOD_KIND_NOT_SUPPORTED"],
  ] as [DueContext, string][])("%o → %s", (ctx, code) => {
    expect(due("gstr-3b", ctx)).toMatchObject({ ok: false, code });
  });

  it("unknown rule id", () => {
    expect(due("gstr-99", { fy: FY, period: "Annual" })).toEqual({ ok: false, ruleId: "gstr-99", code: "UNKNOWN_RULE", message: 'no calendar rule "gstr-99"' });
  });
});

describe("periods", () => {
  it("parseFy", () => {
    expect(parseFy("2026-27")).toBe(2026);
    expect(parseFy("2099-00")).toBe(2099);
    expect(parseFy("2026-2027")).toBeNull();
  });
  it("parsePeriod gives the last month of each period", () => {
    expect(parsePeriod(FY, "2026-04")).toEqual({ label: "2026-04", kind: "monthly", endYear: 2026, endMonth: 4, monthOfQuarter: 1 });
    expect(parsePeriod(FY, "2027-03")).toMatchObject({ endYear: 2027, monthOfQuarter: 3 });
    expect(parsePeriod(FY, "Q4")).toEqual({ label: "Q4", kind: "quarterly", endYear: 2027, endMonth: 3, monthOfQuarter: null });
    expect(parsePeriod(FY, "H1")).toMatchObject({ kind: "half-yearly", endYear: 2026, endMonth: 9 });
    expect(parsePeriod(FY, "Annual")).toMatchObject({ kind: "annual", endYear: 2027, endMonth: 3 });
    expect(parsePeriod("bad", "Q1")).toBeNull();
  });
  it("periodsFor", () => {
    expect(periodsFor("monthly", FY)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(periodsFor("quarterly", FY)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(periodsFor("half-yearly", FY)).toEqual(["H1", "H2"]);
    expect(periodsFor("annual", FY)).toEqual(["Annual"]);
    expect(() => periodsFor("annual", "2026")).toThrow(/invalid FY/);
  });
});

describe("day helpers", () => {
  it("shiftDayKey crosses month, year and leap day", () => {
    expect(shiftDayKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDayKey("2027-02-28", 1)).toBe("2027-03-01");
    expect(shiftDayKey("2027-01-01", -1)).toBe("2026-12-31");
    expect(() => shiftDayKey("2027-1-1", 1)).toThrow();
  });
  it("isWorkingDay / onOrBeforeWorkingDay", () => {
    expect(isWorkingDay("2026-11-07")).toBe(false); // Saturday
    expect(isWorkingDay("2026-11-09")).toBe(true);
    expect(onOrBeforeWorkingDay("2026-11-08")).toBe("2026-11-06");
    expect(() => isWorkingDay("nope")).toThrow();
    expect(() => onOrBeforeWorkingDay("2026-11-08", { isHoliday: () => true })).toThrow(/no working day/);
  });
});

describe("CalendarPackSchema", () => {
  const rule = {
    id: "r-1",
    form: "F",
    title: "T",
    service: "GST",
    periodKinds: ["monthly"],
    due: { anchor: "period-end", addMonths: 1, day: 10 },
    source: "s",
  };
  const ok = (j: unknown) => parseCalendarPack(j);

  it("applies defaults", () => {
    expect(ok({ schemaVersion: 1, rules: [rule] })).toMatchObject({ ok: true, pack: { bufferDays: 3, stateGroups: {} } });
  });

  it.each([
    ["duplicate ids", { schemaVersion: 1, rules: [rule, rule] }, "duplicate rule id r-1"],
    ["unknown state group", { schemaVersion: 1, rules: [{ ...rule, variants: [{ id: "v", when: { stateGroup: "g" }, due: rule.due }] }] }, "unknown state group g"],
    ["state in two groups", { schemaVersion: 1, stateGroups: { a: ["29"], b: ["29"] }, rules: [] }, "state 29 is in both a and b"],
    ["variant with both due and notApplicable", { schemaVersion: 1, rules: [{ ...rule, variants: [{ id: "v", when: {}, due: rule.due, notApplicable: "x" }] }] }, "exactly one of due / notApplicable"],
    ["variant with neither", { schemaVersion: 1, rules: [{ ...rule, variants: [{ id: "v", when: {} }] }] }, "exactly one of due / notApplicable"],
    ["category not declared", { schemaVersion: 1, rules: [{ ...rule, variants: [{ id: "v", when: { category: "x" }, due: rule.due }] }] }, "category x not in rule categories"],
    ["bad day", { schemaVersion: 1, rules: [{ ...rule, due: { anchor: "period-end", addMonths: 1, day: 32 } }] }, "rules.0.due.day"],
    ["unknown field", { schemaVersion: 1, rules: [{ ...rule, hardcoded: true }] }, "Unrecognized key"],
    ["bad state code", { schemaVersion: 1, stateGroups: { a: ["KA"] }, rules: [] }, "stateGroups.a.0"],
  ])("rejects %s", (_n, json, msg) => {
    const r = ok(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" | ")).toContain(msg);
  });

  it("reports a non-object as a root error", () => {
    expect(ok("calendar")).toMatchObject({ ok: false, errors: [expect.stringMatching(/^\(root\):/)] });
  });
});
