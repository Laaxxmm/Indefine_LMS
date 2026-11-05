import { describe, expect, it } from "vitest";
import { baseExtract, CUR } from "./__fixtures__/base";
import { analyseRoc, columnFromTrialBalance, finTotals, multipleAdditionalFee, normalFeePaise, perDayAdditionalFee } from "./analyse";
import { inForce, rocVerifyNotes, SMALL_COMPANY_LIMITS } from "./data";

const CR = 1_00_00_000_00;
const LAKH = 1_00_000_00;

describe("fees (hand-computed)", () => {
  it("normal fee by authorised capital slab", () => {
    expect(normalFeePaise({ authorisedCapitalPaise: 0 })).toBe(200_00);
    expect(normalFeePaise({ authorisedCapitalPaise: LAKH - 1 })).toBe(200_00);
    expect(normalFeePaise({ authorisedCapitalPaise: LAKH })).toBe(300_00);
    expect(normalFeePaise({ authorisedCapitalPaise: 5 * LAKH })).toBe(400_00);
    expect(normalFeePaise({ authorisedCapitalPaise: 25 * LAKH - 1 })).toBe(400_00);
    expect(normalFeePaise({ authorisedCapitalPaise: 25 * LAKH })).toBe(500_00);
    expect(normalFeePaise({ authorisedCapitalPaise: CR })).toBe(600_00);
  });
  it("₹100 per day for AOC-4 / MGT-7", () => {
    expect(perDayAdditionalFee(0)).toBe(0);
    expect(perDayAdditionalFee(-3)).toBe(0);
    expect(perDayAdditionalFee(17)).toBe(1_700_00);
  });
  it("multiples of the normal fee by delay bracket", () => {
    expect(multipleAdditionalFee(0, 500_00)).toBe(0);
    expect(multipleAdditionalFee(30, 500_00)).toBe(1_000_00);
    expect(multipleAdditionalFee(31, 500_00)).toBe(2_000_00);
    expect(multipleAdditionalFee(60, 500_00)).toBe(2_000_00);
    expect(multipleAdditionalFee(90, 500_00)).toBe(3_000_00);
    expect(multipleAdditionalFee(180, 500_00)).toBe(5_000_00);
    expect(multipleAdditionalFee(181, 500_00)).toBe(6_000_00);
  });
});

describe("data", () => {
  it("picks the entry in force on the FY end", () => {
    expect(inForce(SMALL_COMPANY_LIMITS, "2025-03-31", "x").paidUpMaxPaise).toBe(4 * CR);
    expect(inForce(SMALL_COMPANY_LIMITS, "2026-03-31", "x").paidUpMaxPaise).toBe(10 * CR);
    expect(() => inForce(SMALL_COMPANY_LIMITS, "2020-03-31", "small-company limit")).toThrow(/no small-company limit in force/);
  });
  it("every verify note is filled", () => {
    const notes = rocVerifyNotes();
    expect(notes.length).toBeGreaterThan(10);
    expect(notes.every((n) => n.verify.length > 20)).toBe(true);
  });
});

describe("financials", () => {
  it("totals the clean column", () => {
    const t = finTotals(CUR);
    expect(t).toMatchObject({ equity: 45 * LAKH, liabilities: 20 * LAKH, assets: 65 * LAKH, profitBeforeTax: 12 * LAKH, profitAfterTax: 9 * LAKH, borrowings: 5 * LAKH });
  });
  it("builds a column from a trial balance and carries PAT to reserves", () => {
    const tb = [
      { ledger: "Capital", debitPaise: 0, creditPaise: 100 },
      { ledger: "Sales", debitPaise: 0, creditPaise: 1000 },
      { ledger: "Expenses", debitPaise: 700, creditPaise: 0 },
      { ledger: "Bank", debitPaise: 400, creditPaise: 0 },
      { ledger: "Mystery", debitPaise: 5, creditPaise: 0 },
    ];
    const { column, unmapped } = columnFromTrialBalance(tb, [
      { ledger: " capital ", head: "shareCapital" },
      { ledger: "Sales", head: "revenueFromOperations" },
      { ledger: "Expenses", head: "totalExpenses" },
      { ledger: "Bank", head: "cashAndBank" },
      { ledger: "Bank", head: "otherAssets" }, // a second mapping for the same ledger is ignored
    ]);
    expect(unmapped).toEqual(["Mystery"]);
    expect(column).toMatchObject({ shareCapital: 100, revenueFromOperations: 1000, totalExpenses: 700, cashAndBank: 400, otherAssets: 0, reservesSurplus: 300 });
  });
});

describe("small company / MGT-7A (boundaries)", () => {
  it("at the limit is small; one paisa over is not", () => {
    expect(analyseRoc(baseExtract({ previous: { revenueFromOperations: 100 * CR } })).small.isSmall).toBe(true);
    const over = analyseRoc(baseExtract({ previous: { revenueFromOperations: 100 * CR + 1 } }));
    expect(over.small.isSmall).toBe(false);
    expect(over.small.reason).toMatch(/turnover exceeds/);
    expect(over.annualReturnForm).toBe("MGT-7");
  });
  it("paid-up over the limit", () => {
    const a = analyseRoc(baseExtract({ company: { paidUpCapitalPaise: 10 * CR + 1 } }));
    expect(a.small.isSmall).toBe(false);
    expect(a.small.reason).toMatch(/paid-up capital exceeds/);
  });
  it("uses the 2022 limits for FY 2024-25", () => {
    expect(analyseRoc(baseExtract({ fy: "2024-25", previous: { revenueFromOperations: 40 * CR + 1 } })).small.isSmall).toBe(false);
  });
  it("public, holding/subsidiary, section 8 never small; OPC files MGT-7A", () => {
    expect(analyseRoc(baseExtract({ company: { companyClass: "public" } })).annualReturnForm).toBe("MGT-7");
    expect(analyseRoc(baseExtract({ company: { holdingOrSubsidiary: true } })).small.reason).toMatch(/only a private company/);
    expect(analyseRoc(baseExtract({ company: { section8: true } })).small.isSmall).toBe(false);
    const opc = analyseRoc(baseExtract({ company: { companyClass: "opc", agmDate: null } }));
    expect(opc.small.isSmall).toBe(false);
    expect(opc.annualReturnForm).toBe("MGT-7A");
    expect(opc.small.reason).toMatch(/One Person Company/);
  });
});

describe("CSR (boundaries, hand-computed)", () => {
  const prevPbt = (p: number) => ({ previous: { revenueFromOperations: 60 * CR, otherIncome: 0, totalExpenses: 60 * CR - p } });
  it("net profit exactly ₹5 crore applies; one paisa less does not", () => {
    expect(analyseRoc(baseExtract(prevPbt(5 * CR))).csr.applicable).toBe(true);
    expect(analyseRoc(baseExtract(prevPbt(5 * CR - 1))).csr.applicable).toBe(false);
  });
  it("turnover ₹1,000 crore and net worth ₹500 crore thresholds", () => {
    expect(analyseRoc(baseExtract({ previous: { revenueFromOperations: 1000 * CR, totalExpenses: 1000 * CR } })).csr.reasons).toEqual(["turnover"]);
    expect(analyseRoc(baseExtract({ previous: { reservesSurplus: 500 * CR - 10 * LAKH } })).csr.reasons).toEqual(["net worth"]);
  });
  it("obligation = 2% of the average, nearest rupee", () => {
    // (5,00,00,000 + 4,20,00,000 + 3,10,00,000) / 3 = 4,10,00,000; 2% = 8,20,000.
    const a = analyseRoc(baseExtract({ ...prevPbt(5 * CR), company: { csrNetProfitHistoryPaise: [5 * CR, 4_20_00_000_00, 3_10_00_000_00] } }));
    expect(a.csr.obligationPaise).toBe(8_20_000_00);
    expect(a.csr.avgNetProfitPaise).toBe(4_10_00_000_00);
    // One year only: 2% of ₹5,00,00,001.00 = ₹10,00,000.02 → ₹10,00,000.
    expect(analyseRoc(baseExtract(prevPbt(5 * CR + 100))).csr.obligationPaise).toBe(10_00_000_00);
    // Average of ₹5 cr and ₹1 (2 years): 2% of 2,50,00,000.50 = 5,00,000.01 → 5,00,000.
    expect(analyseRoc(baseExtract({ ...prevPbt(5 * CR), company: { csrNetProfitHistoryPaise: [5 * CR, 100] } })).csr.obligationPaise).toBe(5_00_000_00);
  });
  it("a negative average gives no obligation", () => {
    expect(analyseRoc(baseExtract({ ...prevPbt(5 * CR), company: { csrNetProfitHistoryPaise: [-6 * CR, 1 * CR] } })).csr.obligationPaise).toBe(0);
  });
});

describe("AGM and filing dates", () => {
  it("first AGM within nine months", () => {
    const a = analyseRoc(baseExtract({ company: { firstFinancialYear: true, agmDate: "2026-12-20", agmExtendedTo: "2027-02-28" } }));
    expect(a.agm.dueDate).toBe("2026-12-31");
    expect(a.agm.delayDays).toBe(0);
  });
  it("an extension is capped at three months", () => {
    expect(analyseRoc(baseExtract({ company: { agmExtendedTo: "2027-03-31" } })).agm.dueDate).toBe("2026-12-30");
    expect(analyseRoc(baseExtract({ company: { agmExtendedTo: "2026-11-30" } })).agm.dueDate).toBe("2026-11-30");
  });
  it("no AGM held: filing counted from the AGM due date", () => {
    const a = analyseRoc(baseExtract({ company: { agmDate: null } }));
    expect(a.forms.find((f) => f.id === "aoc-4")?.statutoryDue).toBe("2026-10-29");
    expect(a.forms.find((f) => f.id === "mgt-7")?.statutoryDue).toBe("2026-11-28");
    expect(a.agm.gapExceeded).toBe(false);
  });
  it("MSME-1 and DIR-3 KYC dates come from the shared calendar", () => {
    const a = analyseRoc(baseExtract());
    expect(a.forms.find((f) => f.id === "msme-1-h1")?.statutoryDue).toBe("2025-10-31");
    expect(a.forms.find((f) => f.id === "msme-1-h2")?.statutoryDue).toBe("2026-04-30");
    expect(a.forms.find((f) => f.id === "dir-3-kyc")?.statutoryDue).toBe("2026-09-30");
    expect(a.forms.find((f) => f.id === "dpt-3")?.statutoryDue).toBe("2026-06-30");
  });
  it("no planned filing date: no delay, no fee", () => {
    const a = analyseRoc(baseExtract({ company: { estimateFilingOn: null, agmDate: "2026-09-01" } }));
    expect(a.fees.total).toBe(0);
  });
  it("late AOC-4 and MGT-7 and pending KYC fee", () => {
    const a = analyseRoc(
      baseExtract({
        company: { estimateFilingOn: "2026-12-01" },
        directors: [{ din: "01000001", name: "A", designation: "D", dinStatus: "active", kycCompletedOn: "2025-08-01", residentInIndia: true }],
      }),
    );
    expect(a.fees.aoc4).toBe(38 * 100_00); // 24 Oct → 1 Dec = 38 days
    expect(a.fees.mgt7).toBe(8 * 100_00); // 23 Nov → 1 Dec = 8 days
    expect(a.fees.dirKyc).toBe(5_000_00);
    expect(a.fees.total).toBe(3_800_00 + 800_00 + 5_000_00);
  });
});

describe("directors, auditor, MSME-1, DPT-3", () => {
  it("KYC window boundary: 1 Apr 2026 counts, 31 Mar 2026 does not", () => {
    const d = (kyc: string | null, status: "active" | "disqualified" = "active") => ({ din: "01000009", name: "Z", designation: "D", dinStatus: status, kycCompletedOn: kyc, residentInIndia: true });
    const a = analyseRoc(baseExtract({ directors: [d("2026-04-01"), d("2026-03-31"), d(null), d("2026-05-01", "disqualified")] }));
    expect(a.kycWindowStart).toBe("2026-04-01");
    expect(a.directors.map((x) => x.issue)).toEqual([null, "KYC last completed 2026-03-31, before 2026-04-01", "DIR-3 KYC pending", "DIN disqualified"]);
    expect(a.kycPending).toBe(2);
  });
  it("term year, term end and beyond", () => {
    expect(analyseRoc(baseExtract({ auditor: { termStartFy: "2021-22" } })).auditor).toMatchObject({ termYear: 5, termEndsAtThisAgm: true, beyondTerm: false, adt1Missing: true });
    expect(analyseRoc(baseExtract({ auditor: { termStartFy: "2021-22", newAuditorAtThisAgm: true } })).auditor).toMatchObject({ adt1Missing: false, adt1Required: true });
    expect(analyseRoc(baseExtract({ auditor: { termStartFy: "2020-21" } })).auditor.beyondTerm).toBe(true);
    expect(analyseRoc(baseExtract({ auditor: { termStartFy: "2026-27" } })).auditor.beyondTerm).toBe(true);
  });
  it("rotation: class tests and limits", () => {
    const firm = analyseRoc(baseExtract({ company: { companyClass: "private", paidUpCapitalPaise: 50 * CR }, auditor: { termStartFy: "2021-22", consecutiveYearsBeforeTerm: 5, reappointedAtThisAgm: false } }));
    expect(firm.auditor).toMatchObject({ rotationClass: true, consecutiveYears: 10, rotationBreached: false });
    const firmOver = analyseRoc(baseExtract({ company: { listed: true }, auditor: { termStartFy: "2021-22", consecutiveYearsBeforeTerm: 6 } }));
    expect(firmOver.auditor.rotationBreached).toBe(true);
    const borrowings = analyseRoc(baseExtract({ current: { longTermBorrowings: 50 * CR }, auditor: { type: "individual", termStartFy: "2021-22", reappointedAtThisAgm: true } }));
    expect(borrowings.auditor).toMatchObject({ rotationClass: true, rotationBreached: true });
    const below = analyseRoc(baseExtract({ company: { companyClass: "public", paidUpCapitalPaise: 10 * CR - 1 }, auditor: { type: "individual", termStartFy: "2021-22", reappointedAtThisAgm: true } }));
    expect(below.auditor.rotationClass).toBe(false);
  });
  it("MSME-1: 45 days is fine, 46 is not; zero amounts ignored", () => {
    expect(analyseRoc(baseExtract({ msme: [{ vendor: "V", halfYear: "H1", amountPaise: 100, daysOutstanding: 45 }] })).msme1.applicable).toBe(false);
    expect(analyseRoc(baseExtract({ msme: [{ vendor: "V", halfYear: "H1", amountPaise: 0, daysOutstanding: 90 }] })).msme1.applicable).toBe(false);
    const a = analyseRoc(baseExtract({ msme: [{ vendor: "V", halfYear: "H1", amountPaise: 100, daysOutstanding: 46 }] }));
    expect(a.msme1.h1).toHaveLength(1);
  });
  it("DPT-3: nothing outstanding, government company, deposits", () => {
    expect(analyseRoc(baseExtract({ company: { deposits: { depositsOutstandingPaise: 0, loansNotDepositsPaise: 0, dpt3FiledOn: null } } })).dpt3.applicable).toBe(false);
    expect(analyseRoc(baseExtract({ company: { governmentCompany: true } })).dpt3).toMatchObject({ applicable: false, exempt: true });
    expect(analyseRoc(baseExtract({ company: { deposits: { depositsOutstandingPaise: 1, loansNotDepositsPaise: 0, dpt3FiledOn: null } } })).dpt3.applicable).toBe(true);
  });
  it("caches per extracted object", () => {
    const x = baseExtract();
    expect(analyseRoc(x)).toBe(analyseRoc(x));
  });
});
