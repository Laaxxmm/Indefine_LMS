// Hand-computed expectations (working in each comment). Amounts in paise; ₹1 = 100.
import { describe, expect, it } from "vitest";
import {
  advanceTaxInterest,
  capitalGains,
  classifyGain,
  interest234A,
  lateFee234F,
  monthsOrPart,
  msmeDisallowance,
  pct,
  presumptiveIncome,
  roundIncomeTo10,
  roundPayableTo10,
  slabTax,
  taxOnIncome,
  type TaxContext,
} from "./compute";
import { TAX_RULESETS, ruleSetFor, taxVerifyNotes } from "./data";
import type { CgRow, MsmeRow } from "./parse";

const R = TAX_RULESETS["2025-26"];
const rs = (n: number) => Math.round(n * 100); // rupees → paise in test literals
const ctx = (o: Partial<TaxContext> = {}): TaxContext => ({ entity: "individual", regime: "new", ageBand: "below60", resident: true, companyRegime: "115BAA", companyTurnoverPy2Paise: 0, ...o });
const normal = (n: number) => ({ normal: rs(n), s111A: 0, s112: 0, s112A: 0 });

describe("integer helpers", () => {
  it("pct rounds half up to the paisa", () => {
    expect(pct(1, 5000)).toBe(1); // 0.5 paisa → 1
    expect(pct(3, 1250)).toBe(0); // 0.375 → 0
    expect(pct(-5, 1000)).toBe(0);
    expect(pct(rs(1_00_00_00_000), 3000)).toBe(rs(30_00_00_000)); // ₹100 crore x 30%
  });
  it("s.288A / 288B rounding to ₹10", () => {
    expect(roundIncomeTo10(rs(14_75_004))).toBe(rs(14_75_000));
    expect(roundIncomeTo10(rs(14_75_005))).toBe(rs(14_75_010));
    expect(roundPayableTo10(rs(39))).toBe(rs(40));
    expect(roundPayableTo10(rs(-5_004))).toBe(rs(-5_000));
  });
});

describe("rule sets", () => {
  it("FY 2025-26 is verified (1961 Act); tax year 2026-27 (2025 Act) is refused until verified", () => {
    expect(ruleSetFor("2025-26")).toMatchObject({ ok: true });
    const t = ruleSetFor("2026-27");
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toMatch(/Income-tax Act, 2025.*not verified/);
    expect(ruleSetFor("2019-20")).toMatchObject({ ok: false });
    expect(taxVerifyNotes(R).every((n) => n.verify.length > 20)).toBe(true);
  });
});

describe("slab tax", () => {
  it("new regime 14,75,000 = 20,000 + 40,000 + 41,250", () => {
    expect(slabTax(rs(14_75_000), R.slabs.newRegime)).toBe(rs(1_01_250));
  });
  it("zero and below the exemption", () => {
    expect(slabTax(0, R.slabs.newRegime)).toBe(0);
    expect(slabTax(rs(4_00_000), R.slabs.newRegime)).toBe(0);
  });
});

describe("tax on income — individuals", () => {
  it("new regime: TI exactly 12,00,000 → 60,000 fully rebated", () => {
    const t = taxOnIncome(normal(12_00_000), rs(12_00_000), R, ctx());
    expect(t).toMatchObject({ normalTax: rs(60_000), rebate: rs(60_000), total: 0 });
  });
  it("new regime marginal relief: TI 12,00,010 → tax 60,001.50, rebate 59,991.50, cess 0.40, total ₹10", () => {
    const t = taxOnIncome(normal(12_00_010), rs(12_00_010), R, ctx());
    expect(t.normalTax).toBe(6000150);
    expect(t.rebate).toBe(5999150);
    expect(t.cess).toBe(40);
    expect(t.total).toBe(rs(10));
  });
  it("old regime 87A boundary at 5,00,000", () => {
    expect(taxOnIncome(normal(5_00_000), rs(5_00_000), R, ctx({ regime: "old" })).total).toBe(0);
    // 12,500 + 10 x 20% = 12,502; cess 500.08; 13,002.08 → 13,002
    expect(taxOnIncome(normal(5_00_010), rs(5_00_010), R, ctx({ regime: "old" })).total).toBe(rs(13_002));
  });
  it("senior and super-senior slabs (old regime)", () => {
    expect(taxOnIncome(normal(5_00_000), rs(5_00_000), R, ctx({ regime: "old", ageBand: "senior" })).normalTax).toBe(rs(10_000));
    // super senior 7,00,000: 2,00,000 x 20% = 40,000; cess 1,600
    expect(taxOnIncome(normal(7_00_000), rs(7_00_000), R, ctx({ regime: "old", ageBand: "superSenior" })).total).toBe(rs(41_600));
    // non-resident senior gets the below-60 exemption: 2.5-5L 5% 12,500 + 5-7L 20% 40,000; no 87A
    expect(taxOnIncome(normal(7_00_000), rs(7_00_000), R, ctx({ regime: "old", ageBand: "senior", resident: false })).normalTax).toBe(rs(52_500));
  });
  it("surcharge with marginal relief just above ₹50 lakh (new regime)", () => {
    // tax 10,83,000; surcharge 1,08,300; at 50L 10,80,000 + excess 10,000 = 10,90,000 cap → relief 1,01,300; cess 43,600
    const t = taxOnIncome(normal(50_10_000), rs(50_10_000), R, ctx());
    expect(t).toMatchObject({ normalTax: rs(10_83_000), surcharge: rs(1_08_300), marginalRelief: rs(1_01_300), cess: rs(43_600), total: rs(11_33_600) });
  });
  it("new regime surcharge capped at 25%; old regime 37% above ₹5 crore", () => {
    // new: 3,00,000 + 5,76,00,000 x 30% = 1,75,80,000; 25% = 43,95,000
    expect(taxOnIncome(normal(6_00_00_000), rs(6_00_00_000), R, ctx()).surcharge).toBe(rs(43_95_000));
    // old: 1,12,500 + 5,90,00,000 x 30% = 1,78,12,500; 37% = 65,90,625
    expect(taxOnIncome(normal(6_00_00_000), rs(6_00_00_000), R, ctx({ regime: "old" })).surcharge).toBe(rs(65_90_625));
  });
  it("surcharge on s.111A capped at 15%", () => {
    // non-resident, 111A 2,10,00,000: tax 42,00,000; surcharge 15% (not 25%) 6,30,000; cess 1,93,200
    const t = taxOnIncome({ normal: 0, s111A: rs(2_10_00_000), s112: 0, s112A: 0 }, rs(2_10_00_000), R, ctx({ regime: "old", resident: false }));
    expect(t).toMatchObject({ t111A: rs(42_00_000), surcharge: rs(6_30_000), marginalRelief: 0, total: rs(50_23_200) });
  });
  it("basic-exemption shortfall against 111A for residents only; no new-regime rebate on special-rate tax", () => {
    // resident: shortfall 4L - 1L = 3L → 111A taxable 2L x 20% = 40,000; rebate limited to slab tax (nil); cess 1,600
    const res = taxOnIncome({ normal: rs(1_00_000), s111A: rs(5_00_000), s112: 0, s112A: 0 }, rs(6_00_000), R, ctx());
    expect(res).toMatchObject({ exemptionAdjusted: rs(3_00_000), t111A: rs(40_000), rebate: 0, total: rs(41_600) });
    // non-resident: 5L x 20% = 1,00,000; cess 4,000
    expect(taxOnIncome({ normal: rs(1_00_000), s111A: rs(5_00_000), s112: 0, s112A: 0 }, rs(6_00_000), R, ctx({ resident: false })).total).toBe(rs(1_04_000));
  });
  it("old-regime 87A is not available against s.112A tax; s.112 at 12.5%", () => {
    // normal 2L (nil), shortfall 50,000 → 112A 3L - 50k - 1.25L = 1,25,000 x 12.5% = 15,625; rebate nil; cess 625
    expect(taxOnIncome({ normal: rs(2_00_000), s111A: 0, s112: 0, s112A: rs(3_00_000) }, rs(5_00_000), R, ctx({ regime: "old" })).total).toBe(rs(16_250));
    expect(taxOnIncome({ normal: rs(10_00_000), s111A: 0, s112: rs(1_00_000), s112A: 0 }, rs(11_00_000), R, ctx()).t112).toBe(rs(12_500));
  });
  it("HUF gets no 87A rebate", () => {
    expect(taxOnIncome(normal(7_00_000), rs(7_00_000), R, ctx({ entity: "huf" })).rebate).toBe(0);
  });
});

describe("tax on income — firms and companies", () => {
  it("firm: 30%, surcharge 12% above ₹1 crore with marginal relief", () => {
    // 1,00,10,000 x 30% = 30,03,000; sc 3,60,360; cap 30,00,000 + 10,000 → relief 3,53,360; cess 1,20,400
    expect(taxOnIncome(normal(1_00_10_000), rs(1_00_10_000), R, ctx({ entity: "firm" }))).toMatchObject({ marginalRelief: rs(3_53_360), total: rs(31_30_400) });
  });
  it("company: 115BAA 22% + 10% + 4%; normal 30% / 25% by turnover with 7% surcharge", () => {
    expect(taxOnIncome(normal(50_00_000), rs(50_00_000), R, ctx({ entity: "company" })).total).toBe(rs(12_58_400));
    const big = ctx({ entity: "company", companyRegime: "normal", companyTurnoverPy2Paise: rs(400_00_00_000) + 100 });
    expect(taxOnIncome(normal(2_00_00_000), rs(2_00_00_000), R, big).total).toBe(rs(66_76_800));
    const small = ctx({ entity: "company", companyRegime: "normal", companyTurnoverPy2Paise: rs(400_00_00_000) });
    expect(taxOnIncome(normal(2_00_00_000), rs(2_00_00_000), R, small).total).toBe(rs(55_64_000));
  });
});

describe("capital gains", () => {
  const row = (o: Partial<CgRow>): CgRow => ({ asset: "x", assetType: "listed-equity", acquiredOn: "2024-11-15", soldOn: "2025-11-15", saleValuePaise: 0, costPaise: 0, expensesPaise: 0, ...o });
  it("holding period boundary: exactly 12 months is short-term; a day more is long-term", () => {
    expect(classifyGain(row({}), R)).toBe("stcg111A");
    expect(classifyGain(row({ soldOn: "2025-11-16" }), R)).toBe("ltcg112A");
    expect(classifyGain(row({ assetType: "other", acquiredOn: "2023-11-15", soldOn: "2025-11-15" }), R)).toBe("stcgOther");
    expect(classifyGain(row({ assetType: "other", acquiredOn: "2023-11-15", soldOn: "2025-11-16" }), R)).toBe("ltcg112");
  });
  it("set-off: LT loss only against LT; ST loss against slab, 111A, then LT", () => {
    const r = capitalGains(
      [
        row({ assetType: "other", acquiredOn: "2025-04-01", soldOn: "2025-06-01", saleValuePaise: rs(50_000), costPaise: rs(1_00_000) }),
        row({ acquiredOn: "2025-04-01", soldOn: "2025-06-01", saleValuePaise: rs(1_30_000), costPaise: rs(1_00_000) }),
        row({ assetType: "other", acquiredOn: "2020-04-01", soldOn: "2025-06-01", saleValuePaise: rs(2_00_000), costPaise: rs(90_000), expensesPaise: rs(10_000) }),
        row({ acquiredOn: "2020-04-01", soldOn: "2025-06-01", saleValuePaise: rs(80_000), costPaise: rs(1_00_000) }),
      ],
      R,
    );
    expect(r.buckets).toEqual({ stcgOther: 0, stcg111A: 0, ltcg112: rs(60_000), ltcg112A: 0 });
    expect(r.lossCarriedForwardPaise).toBe(0);
    expect(r.rows.map((x) => x.gainPaise)).toEqual([rs(-50_000), rs(30_000), rs(1_00_000), rs(-20_000)]);
  });
  it("unabsorbed loss is carried forward", () => {
    expect(capitalGains([row({ saleValuePaise: rs(90_000), costPaise: rs(1_00_000) })], R).lossCarriedForwardPaise).toBe(rs(10_000));
  });
});

describe("presumptive income and s.43B(h)", () => {
  it("44AD 6% digital + 8% rest; 44ADA 50%", () => {
    expect(presumptiveIncome("44AD", rs(1_80_00_000), rs(1_50_00_000), R)).toBe(rs(11_40_000));
    expect(presumptiveIncome("44AD", rs(1_00_000), rs(5_00_000), R)).toBe(rs(6_000)); // digital capped at turnover
    expect(presumptiveIncome("44AD", rs(1_00_000), -5, R)).toBe(rs(8_000));
    expect(presumptiveIncome("44ADA", rs(60_00_000), 0, R)).toBe(rs(30_00_000));
  });
  it("43B(h): 45-day cap, 15 days without agreement, medium / traders / settled-in-year excluded", () => {
    const m = (o: Partial<MsmeRow>): MsmeRow => ({ vendor: "v", category: "micro", acceptanceDate: "2026-03-01", amountPaise: rs(1_000), agreementDays: 45, paidOn: "2026-04-15", outstandingAtYearEnd: true, ...o });
    const rows = [
      m({ agreementDays: 60, paidOn: "2026-04-16" }), // 46 > 45 cap → disallowed
      m({ agreementDays: 45, paidOn: "2026-04-15" }), // 45 → allowed
      m({ category: "small", agreementDays: null, paidOn: "2026-03-16" }), // 15 → allowed
      m({ category: "small", agreementDays: null, paidOn: "2026-03-17" }), // 16 → disallowed
      m({ category: "medium", paidOn: null }), // outside 43B(h)
      m({ category: "trader", paidOn: null }), // outside 43B(h)
      m({ outstandingAtYearEnd: false, paidOn: "2026-05-30" }), // paid within the year (deduction allowed on payment)
      m({ paidOn: null }), // unpaid → disallowed
    ];
    const r = msmeDisallowance(rows, R);
    expect(r.findings.map((f) => f.disallowed)).toEqual([true, false, false, true, false, false, false, true]);
    expect(r.findings[0]).toMatchObject({ allowedDays: 45, daysToPay: 46 });
    expect(r.totalPaise).toBe(rs(3_000));
  });
});

describe("interest and fee", () => {
  it("months or part of a month", () => {
    expect(monthsOrPart("2026-04-01", "2026-07-31")).toBe(4);
    expect(monthsOrPart("2026-08-01", "2026-08-01")).toBe(1);
    expect(monthsOrPart("2026-08-01", "2026-09-15")).toBe(2);
    expect(monthsOrPart("2026-08-15", "2026-09-14")).toBe(1);
    expect(monthsOrPart("2026-08-15", "2026-08-14")).toBe(0);
  });
  it("month-end pairs follow the documented convention (a month starting on the 31st runs to the end of a shorter month)", () => {
    // Audit case: 31 Jan → 28 Feb is one month (February has no 31st, so no second month starts in it).
    expect(monthsOrPart("2027-01-31", "2027-02-28")).toBe(1);
    expect(monthsOrPart("2027-01-31", "2027-03-01")).toBe(2); // the second month starts on 1 Mar
    expect(monthsOrPart("2027-01-31", "2027-03-30")).toBe(2);
    expect(monthsOrPart("2027-01-31", "2027-03-31")).toBe(3); // the third starts on 31 Mar
    expect(monthsOrPart("2027-03-31", "2027-04-30")).toBe(1);
    expect(monthsOrPart("2027-03-31", "2027-05-01")).toBe(2);
    expect(monthsOrPart("2028-01-31", "2028-02-29")).toBe(1); // leap year
    expect(monthsOrPart("2028-01-30", "2028-02-29")).toBe(1);
    expect(monthsOrPart("2027-01-30", "2027-02-28")).toBe(1);
    expect(monthsOrPart("2027-02-28", "2027-03-27")).toBe(1);
    expect(monthsOrPart("2027-02-28", "2027-03-28")).toBe(2);
    expect(monthsOrPart("2028-02-29", "2028-03-28")).toBe(1);
  });
  it("periods starting on the 1st (every s.234A start after a month-end due date, and s.234B from 1 April) count calendar months", () => {
    expect(monthsOrPart("2026-08-01", "2026-08-31")).toBe(1);
    expect(monthsOrPart("2026-08-01", "2026-09-01")).toBe(2);
    expect(monthsOrPart("2026-11-01", "2027-03-31")).toBe(5);
    expect(monthsOrPart("2026-12-01", "2027-02-28")).toBe(3);
  });
  const dates = ["2025-06-15", "2025-09-15", "2025-12-15", "2026-03-15"];
  const base = { payments: [], instalmentDates: dates, presumptiveOnly: false, exempt: false, aprilFirst: "2026-04-01", filingDate: "2026-07-25" };
  it("234C + 234B with nothing paid (typical-gap fixture working)", () => {
    const r = advanceTaxInterest({ ...base, assessedTaxPaise: rs(1_18_200) }, R);
    expect(r.rows.map((x) => x.interestPaise)).toEqual([rs(531), rs(1_593), rs(2_658), rs(1_182)]);
    expect(r.i234C).toBe(rs(5_964));
    expect(r.i234B).toBe(rs(4_728));
  });
  it("12% / 36% relief; 90% rule for 234B", () => {
    const payments = [
      { date: "2025-06-10", amountPaise: rs(12_000) },
      { date: "2025-09-10", amountPaise: rs(24_000) },
      { date: "2025-12-10", amountPaise: rs(39_000) },
      { date: "2026-03-31", amountPaise: rs(25_000) },
    ];
    const r = advanceTaxInterest({ ...base, assessedTaxPaise: rs(1_00_000), payments }, R);
    // Jun 12% and Sep 36% earn relief; Dec 75% met; the last 25,000 came on 31 Mar, after the 15 Mar
    // instalment → 25,000 x 1% x 1 = 250 u/s 234C; but it counts for 234B (paid by 31 Mar ≥ 90%).
    expect(r.rows.map((x) => x.interestPaise)).toEqual([0, 0, 0, rs(250)]);
    expect(r.i234C).toBe(rs(250));
    expect(r.i234B).toBe(0);
  });
  it("presumptive: one instalment by 15 March; exempt and small liabilities", () => {
    const r = advanceTaxInterest({ ...base, assessedTaxPaise: rs(50_000), payments: [{ date: "2026-03-15", amountPaise: rs(40_000) }], presumptiveOnly: true, filingDate: "2026-07-31" }, R);
    expect(r.rows).toHaveLength(1);
    expect(r.i234C).toBe(rs(100));
    expect(r.i234B).toBe(rs(400)); // 40,000 < 45,000 (90%) → 10,000 x 1% x 4
    expect(advanceTaxInterest({ ...base, assessedTaxPaise: rs(5_00_000), exempt: true }, R)).toMatchObject({ liable: false, i234B: 0, i234C: 0 });
    expect(advanceTaxInterest({ ...base, assessedTaxPaise: rs(9_999) }, R).liable).toBe(false);
  });
  describe("s.234B(2): self-assessment tax paid before filing reduces the shortfall from the next month", () => {
    // Audit counterexample: assessed tax 1,92,400, no advance tax, self-assessment tax 1,92,400 paid
    // 1 May 2026, return 1 Aug 2026. Old code: 1,92,400 x 1% x 5 (Apr-Aug) = 9,620. s.234B(2)(i):
    // interest up to the date of payment — April and (part of) May — on 1,92,400 = 3,848; (ii)
    // thereafter on the shortfall left, nil.
    const sa = (assessed: number, payments: { date: string; amount: number }[], filingDate: string) =>
      advanceTaxInterest({ ...base, assessedTaxPaise: rs(assessed), payments: payments.map((p) => ({ date: p.date, amountPaise: rs(p.amount) })), filingDate }, R);
    it("audit counterexample: 3,848, not 9,620", () => {
      const r = sa(1_92_400, [{ date: "2026-05-01", amount: 1_92_400 }], "2026-08-01");
      expect(r.i234B).toBe(rs(3_848));
      expect(r.stages234B).toEqual([
        { from: "2026-04-01", to: "2026-05-01", paidPaise: 0, shortfallPaise: rs(1_92_400), months: 2, interestPaise: rs(3_848) },
        { from: "2026-06-01", to: "2026-08-01", paidPaise: rs(1_92_400), shortfallPaise: 0, months: 3, interestPaise: 0 },
      ]);
    });
    it("no tax paid after 31 March: one stage, the s.234B(1) amount (unchanged)", () => {
      const r = sa(1_92_400, [], "2026-08-01");
      expect(r.i234B).toBe(rs(9_620));
      expect(r.stages234B).toEqual([{ from: "2026-04-01", to: "2026-08-01", paidPaise: 0, shortfallPaise: rs(1_92_400), months: 5, interestPaise: rs(9_620) }]);
    });
    it("boundary: paid on the 1st of a month vs the last day — the month of payment always carries the old shortfall", () => {
      expect(sa(1_92_400, [{ date: "2026-04-30", amount: 1_92_400 }], "2026-08-01").i234B).toBe(rs(1_924)); // April only
      expect(sa(1_92_400, [{ date: "2026-05-01", amount: 1_92_400 }], "2026-08-01").i234B).toBe(rs(3_848)); // April + May
      expect(sa(1_92_400, [{ date: "2026-05-31", amount: 1_92_400 }], "2026-08-01").i234B).toBe(rs(3_848)); // April + May
      expect(sa(1_92_400, [{ date: "2026-06-01", amount: 1_92_400 }], "2026-08-01").i234B).toBe(rs(5_772)); // April - June
    });
    it("multiple payments: fixture trap-234b-self-assessment-staging (2,40,500 short; 1,92,400 on 25 Apr, 48,100 on 25 Jul; filed 28 Jul)", () => {
      // April on 2,40,500 = 2,405; May-July on 48,100 = 1,443 → 3,848 (old: 2,40,500 x 4 = 9,620).
      const r = sa(2_50_500, [{ date: "2025-06-15", amount: 10_000 }, { date: "2026-07-25", amount: 48_100 }, { date: "2026-04-25", amount: 1_92_400 }], "2026-07-28");
      expect(r.i234B).toBe(rs(3_848));
      expect(r.stages234B.map((s) => [s.from, s.to, s.paidPaise, s.shortfallPaise, s.months])).toEqual([
        ["2026-04-01", "2026-04-25", rs(10_000), rs(2_40_500), 1],
        ["2026-05-01", "2026-07-28", rs(2_02_400), rs(48_100), 3],
      ]);
    });
    it("three stages; two payments in one month take effect together the next month", () => {
      // Apr-May on 1,92,400 = 3,848; Jun-Jul on 92,400 = 1,848; Aug nil → 5,696.
      expect(sa(1_92_400, [{ date: "2026-05-10", amount: 1_00_000 }, { date: "2026-07-10", amount: 92_400 }], "2026-08-01").i234B).toBe(rs(5_696));
      // 1,00,000 on 5 May + 92,400 on 20 May: Apr + May on 1,92,400, June onwards nil → 3,848.
      const r = sa(1_92_400, [{ date: "2026-05-05", amount: 1_00_000 }, { date: "2026-05-20", amount: 92_400 }], "2026-08-01");
      expect(r.i234B).toBe(rs(3_848));
      expect(r.stages234B.map((s) => s.to)).toEqual(["2026-05-20", "2026-08-01"]);
    });
    it("self-assessment tax covering the whole shortfall (or more): nothing after the month of payment", () => {
      expect(sa(1_92_400, [{ date: "2026-05-15", amount: 2_50_000 }], "2026-09-30").i234B).toBe(rs(3_848));
      // with advance tax: 1,00,000 short of 1,50,000 assessed (50,000 < 90%); 1,00,000 paid 10 Jun; filed 25 Jul
      // → Apr-Jun 1,00,000 x 3 = 3,000; July nil (old: 1,00,000 x 4 = 4,000).
      expect(sa(1_50_000, [{ date: "2026-03-15", amount: 50_000 }, { date: "2026-06-10", amount: 1_00_000 }], "2026-07-25").i234B).toBe(rs(3_000));
    });
    it("each stage's amount is rounded down to ₹100 separately", () => {
      // 1,92,450 short; 1,00,000 on 15 May; filed 31 Jul: Apr-May 1,92,400 x 2 = 3,848; Jun-Jul 92,450 → 92,400 x 2 = 1,848.
      expect(sa(1_92_450, [{ date: "2026-05-15", amount: 1_00_000 }], "2026-07-31").i234B).toBe(rs(5_696));
    });
    it("tax paid on or after the filing date, or in the filing month, does not reduce 234B", () => {
      expect(sa(1_92_400, [{ date: "2026-08-02", amount: 1_92_400 }], "2026-08-01").i234B).toBe(rs(9_620));
      expect(sa(1_92_400, [{ date: "2026-08-01", amount: 1_92_400 }], "2026-08-01").i234B).toBe(rs(9_620));
      expect(sa(1_92_400, [{ date: "2026-08-01", amount: 1_92_400 }], "2026-08-01").stages234B).toHaveLength(1);
    });
    it("tax paid after 31 March does not count towards the 90% test, and 234B stays nil when advance tax met it", () => {
      // 85,000 by 31 March < 90,000 (90% of 1,00,000); 15,000 on 1 Apr → April on 15,000 = 150, then nil.
      expect(sa(1_00_000, [{ date: "2026-03-31", amount: 85_000 }, { date: "2026-04-01", amount: 15_000 }], "2026-07-25").i234B).toBe(rs(150));
      expect(sa(1_00_000, [{ date: "2026-03-31", amount: 90_000 }, { date: "2026-04-01", amount: 10_000 }], "2026-07-25")).toMatchObject({ i234B: 0, stages234B: [] });
    });
  });
  it("234A and 234F", () => {
    expect(interest234A(rs(1_00_050), "2026-07-31", "2026-09-15", R, "2026-08-01")).toBe(rs(2_000));
    expect(interest234A(rs(1_00_050), "2026-07-31", "2026-07-31", R, "2026-08-01")).toBe(0);
    expect(interest234A(0, "2026-07-31", "2026-09-15", R, "2026-08-01")).toBe(0);
    expect(lateFee234F(rs(5_00_000), "2026-07-31", "2026-08-01", R)).toBe(rs(1_000));
    expect(lateFee234F(rs(5_00_010), "2026-07-31", "2026-08-01", R)).toBe(rs(5_000));
    expect(lateFee234F(rs(50_00_000), "2026-07-31", "2026-07-31", R)).toBe(0);
  });
});
