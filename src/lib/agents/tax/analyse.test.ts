// Analysis tests on synthetic fixture inputs; tax expectations hand-computed in the comments.
import { describe, expect, it } from "vitest";
import { CLEAN_MATCHES, extractOf } from "./__fixtures__/base";
import { ageBandOf, analyseTax, presumptiveCheck } from "./analyse";
import { TAX_RULESETS } from "./data";

const R = TAX_RULESETS["2025-26"];
const rs = (n: number) => Math.round(n * 100);
const a = (...args: Parameters<typeof extractOf>) => analyseTax(extractOf(...args));

describe("age band (day-before-birthday rule)", () => {
  it("born 1 Apr 1966 is a senior for FY 2025-26; 2 Apr 1966 is not", () => {
    expect(ageBandOf("1966-04-01", R)).toBe("senior");
    expect(ageBandOf("1966-04-02", R)).toBe("below60");
    expect(ageBandOf("1946-04-01", R)).toBe("superSenior");
    expect(ageBandOf(null, R)).toBe("below60");
  });
});

describe("computation of income (hand-computed)", () => {
  it("old regime with s.24(b) interest capped at 2,00,000 and 80TTA limited to savings interest", () => {
    // salary 15,00,000 - 50,000 - 2,400 = 14,47,600 - HP 2,00,000 = 12,47,600; + OS 50,000 = 12,97,600
    // deductions 80C 1,50,000 + 80TTA 8,000 (claimed 10,000) = 1,58,000; TI 11,39,600
    // tax 12,500 + 1,00,000 + 1,39,600 x 30% 41,880 = 1,54,380; cess 6,175.20; 1,60,555
    const x = a("clean-salaried-new", (o) => {
      o.profile.regimeClaimed = "old";
      o.houseProperty = { selfOccupiedInterest: "2,50,000" };
      o.deductions = { "80C": "1,50,000", "80TTA": "10,000" };
    });
    expect(x.regime.used).toBe("old");
    expect(x.chosen).toMatchObject({ grossTotalIncome: rs(12_97_600), deductionsAllowed: rs(1_58_000), totalIncome: rs(11_39_600), houseProperty: rs(-2_00_000) });
    expect(x.chosen.tax.total).toBe(rs(1_60_555));
    expect(x.capsExceeded).toEqual([{ section: "80TTA", claimed: rs(10_000), cap: rs(8_000) }]);
  });
  it("80CCD(2) employer NPS: 14% of basic + DA in the new regime, 10% in the old", () => {
    // new: 14,75,000 - 1,05,000 = 13,70,000; 60,000 + 1,70,000 x 15% = 85,500; cess 3,420; 88,920
    // old: 14,97,600 - 75,000 = 14,22,600; 12,500 + 1,00,000 + 4,22,600 x 30% 1,26,780 = 2,39,280; cess 9,571.20; 2,48,851
    const x = a("clean-salaried-new", (o) => (o.salary.employerNps = "1,20,000"));
    expect(x.new.deductionsAllowed).toBe(rs(1_05_000));
    expect(x.new.tax.total).toBe(rs(88_920));
    expect(x.old?.deductionsAllowed).toBe(rs(75_000));
    expect(x.old?.tax.total).toBe(rs(2_48_851));
  });
  it("deductions never reduce special-rate capital gains", () => {
    const x = a("trap-capital-gains-itr1", (o) => {
      o.profile.regimeClaimed = "old";
      o.salary.gross = "60,000";
      o.deductions = { "80C": "1,50,000" };
    });
    // normal income 60,000 - 50,000 = 10,000 caps the deductions
    expect(x.chosen.deductionsAllowed).toBe(rs(10_000));
  });
});

describe("presumptive conditions (boundaries)", () => {
  const trader = (patch: (o: Record<string, any>) => void) => presumptiveCheck(extractOf("clean-44ad-presumptive", patch).organiser, R); // eslint-disable-line @typescript-eslint/no-explicit-any
  it("cash exactly 5% keeps the ₹3 crore limit; one rupee more loses it", () => {
    const at = trader((o) => Object.assign(o.business, { turnover: "2,50,00,000", cashReceipts: "12,50,000", digitalReceipts: "2,37,50,000" }));
    expect(at.eligible).toBe(true);
    const over = trader((o) => Object.assign(o.business, { turnover: "2,50,00,000", cashReceipts: "12,50,001", digitalReceipts: "2,37,49,999" }));
    expect(over.eligible).toBe(false);
    expect(over.reasons[0]).toMatch(/₹3 crore limit is not available/);
  });
  it("status, residence, nature and lock exclusions", () => {
    expect(trader((o) => Object.assign(o.profile, { status: "firm", isLlp: true, dateOfBirth: null })).reasons[0]).toMatch(/LLP cannot use s.44AD/);
    expect(trader((o) => (o.profile.status = "company")).reasons[0]).toMatch(/company cannot/);
    expect(trader((o) => (o.profile.residentialStatus = "nonresident")).reasons).toContain("s.44AD is for residents only");
    expect(trader((o) => (o.profile.commissionOrAgency = true)).eligible).toBe(false);
    expect(trader((o) => (o.profile.presumptiveLock = true)).reasons[0]).toMatch(/five-year lock/);
    expect(trader((o) => (o.profile.businessKind = "profession")).reasons[0]).toMatch(/not a profession/);
  });
  it("44ADA: specified profession and ₹75 lakh limit with low cash", () => {
    const doc = (patch: (o: Record<string, any>) => void) => presumptiveCheck(extractOf("clean-44ada-doctor", patch).organiser, R); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(doc((o) => Object.assign(o.business, { turnover: "75,00,000" })).eligible).toBe(true);
    expect(doc((o) => Object.assign(o.business, { turnover: "75,00,001" })).eligible).toBe(false);
    expect(doc((o) => Object.assign(o.business, { turnover: "60,00,000", cashReceipts: "3,00,001" })).eligible).toBe(false); // > 5% cash → ₹50 lakh limit
    expect(doc((o) => (o.profile.specifiedProfession = false)).reasons[0]).toMatch(/specified profession/);
  });
  it("a higher declared income replaces the deemed income; books profit does not", () => {
    expect(a("clean-44ada-doctor").businessIncome).toBe(rs(30_00_000));
    expect(a("clean-44ada-doctor", (o) => (o.business.declaredIncome = "32,00,000")).businessIncome).toBe(rs(32_00_000));
  });
  it("no scheme claimed", () => {
    expect(presumptiveCheck(extractOf("clean-salaried-new").organiser, R)).toMatchObject({ claimed: null, eligible: false });
  });
});

describe("tax audit u/s 44AB (boundaries)", () => {
  it("profession: ₹50 lakh is not audited, a rupee more is", () => {
    const prof = (t: string) => a("clean-44ada-doctor", (o) => Object.assign(o.profile, { presumptive: null }) && Object.assign(o.business, { turnover: t })).audit;
    expect(prof("50,00,000").required).toBe(false);
    expect(prof("50,00,001").required).toBe(true);
  });
  it("business: ₹1 crore with high cash; ₹10 crore when cash receipts and payments are ≤ 5%", () => {
    const biz = (patch: Record<string, string>) => a("trap-msme-46-days", (o) => Object.assign(o.business, patch)).audit;
    expect(biz({ turnover: "1,00,00,000", cashReceipts: "6,00,000" }).required).toBe(false);
    expect(biz({ turnover: "1,00,00,001", cashReceipts: "6,00,000" }).required).toBe(true);
    expect(biz({ turnover: "10,00,00,000", totalPayments: "9,00,00,000" }).required).toBe(false);
    expect(biz({ turnover: "10,00,00,001", totalPayments: "9,00,00,000" }).required).toBe(true);
  });
  it("44AD lock with income above the exemption needs an audit (s.44AB(e))", () => {
    const x = a("clean-44ad-presumptive", (o) => (o.profile.presumptiveLock = true));
    expect(x.audit).toMatchObject({ required: true });
    expect(x.dueCategory).toBe("audit");
    expect(x.due139).toBe("2026-10-31");
  });
  it("partner of an audited firm takes the audit due date", () => {
    expect(a("clean-salaried-new", (o) => (o.profile.partnerInAuditedFirm = true)).due139).toBe("2026-10-31");
  });
});

describe("regime eligibility", () => {
  const biz = (patch: (o: Record<string, any>) => void) => a("trap-msme-46-days", patch).regime; // eslint-disable-line @typescript-eslint/no-explicit-any
  it("business: Form 10-IEA by the due date; after it, missing, or after a previous switch-back → new regime", () => {
    expect(biz(() => undefined)).toMatchObject({ used: "old", oldEligible: true });
    expect(biz((o) => (o.profile.form10IEAFiledOn = "2026-08-01")).reason).toMatch(/after the due date/);
    expect(biz((o) => (o.profile.form10IEAFiledOn = null)).reason).toMatch(/Form 10-IEA not filed/);
    expect(biz((o) => (o.profile.optedBackToNewEarlier = true))).toMatchObject({ used: "new", oldEligible: false });
  });
  it("firms and companies have no regime choice", () => {
    expect(a("clean-firm-audit").regime).toMatchObject({ claimed: null, used: null });
  });
});

describe("losses", () => {
  it("brought-forward business loss: set off against business income only, if the loss year was filed in time and within 8 AYs", () => {
    const x = a("trap-msme-46-days", undefined, {
      files: {
        "prior-itr.json": JSON.stringify({
          ay: "2025-26",
          filedOn: "2025-07-20",
          dueDate: "2025-07-31",
          lossesCarriedForward: [
            { ay: "2018-19", type: "business", amount: "3,00,000", returnFiledInTime: true },
            { ay: "2017-18", type: "business", amount: "1,00,000", returnFiledInTime: true },
            { ay: "2023-24", type: "business", amount: "50,000", returnFiledInTime: false },
          ],
        }),
      },
    });
    expect(x.losses.bfValidPaise).toBe(rs(3_00_000));
    expect(x.losses.bfSetOffPaise).toBe(rs(3_00_000));
    expect(x.losses.bfInvalid.map((b) => b.ay)).toEqual(["2017-18", "2023-24"]);
    expect(x.chosen.business).toBe(rs(20_00_000)); // 23,00,000 - 3,00,000
    expect(x.itrForm).toBe("ITR-3");
  });
  it("a timely return carries this year's loss forward", () => {
    const x = a("trap-belated-business-loss", (o) => (o.profile.plannedFilingDate = "2026-07-31"));
    expect(x.losses).toMatchObject({ carriedForwardPaise: rs(5_00_000), lostPaise: 0 });
  });
});

describe("TDS and AIS reconciliation", () => {
  it("TANs on one side only: no credit for a books-only TAN; a 26AS-only TAN is not claimed", () => {
    const x = a("clean-salaried-new", undefined, { files: { "26as.csv": "tan,deductor,section,amount_paid,tds_deposited\nBLRF00001A,Fixture Tech Pvt Ltd,192,1500000,101100\nBLRX00009K,Other Payer,194J,10000,1000\n" } });
    expect(x.tds.rows.map((r) => [r.tan, r.diff, r.credit])).toEqual([
      ["BLRF00001A", 0, rs(1_01_100)],
      ["BLRX00009K", rs(1_000), 0],
      ["MUMH00001B", rs(-4_200), 0],
    ]);
  });
  it("AIS above the matched ledger: only the excess is unexplained, counted once per ledger", () => {
    const files = { "ais.csv": "id,category,source,description,amount\nA1,interest-savings,SBI,Interest,8000\nA2,interest-deposit,HDFC Bank Ltd,Interest,30000\nA3,interest-deposit,HDFC Bank Ltd,Interest,15000\n" };
    const x = a("clean-salaried-new", undefined, { files, matches: [...CLEAN_MATCHES, { aisId: "A3", outcome: "matched", bookId: "B2" }] });
    expect(x.ais.unexplainedPaise).toBe(rs(3_000)); // 30,000 + 15,000 - 42,000
    expect(x.ais.rows[1].note).toMatch(/exceeds books ledger B2/);
  });
  it("an AIS line with no answer is a reviewer question", () => {
    const x = a("clean-salaried-new", undefined, { matches: [CLEAN_MATCHES[0]] });
    expect(x.ais).toMatchObject({ unexplainedPaise: rs(42_000), questions: 1 });
    expect(x.ais.rows[1].outcome).toBe("unanswered");
  });
});

describe("ITR form selection", () => {
  it.each([
    ["director → ITR-2", (o: Record<string, any>) => (o.profile.isDirector = true), "ITR-2"], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["HUF → ITR-2", (o: Record<string, any>) => Object.assign(o.profile, { status: "huf", dateOfBirth: null }), "ITR-2"], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["RNOR → ITR-2", (o: Record<string, any>) => (o.profile.residentialStatus = "rnor"), "ITR-2"], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["clean salaried → ITR-1", () => undefined, "ITR-1"],
  ])("%s", (_l, patch, form) => {
    expect(a("clean-salaried-new", patch).itrForm).toBe(form);
  });
  it("small s.112A gain alone keeps ITR-1; LLP files ITR-5; presumptive firm ITR-4", () => {
    const cg = "asset,asset_type,acquired_on,sold_on,sale_value,cost,expenses\nX,listed-equity,2023-01-01,2025-06-01,200000,100000,0\n";
    expect(a("clean-salaried-new", undefined, { files: { "capital-gains.csv": cg } }).itrForm).toBe("ITR-1");
    expect(a("clean-firm-audit", (o) => (o.profile.isLlp = true)).itrForm).toBe("ITR-5");
    const firm44AD = a("clean-44ad-presumptive", (o) => Object.assign(o.profile, { status: "firm", dateOfBirth: null }));
    expect(firm44AD.itrForm).toBe("ITR-4");
  });
});

describe("missing documents, rule-set guard, 234A", () => {
  it("lists the capital-gains statement, MSME ageing and Form 10-IEA when needed", () => {
    const x = a("trap-msme-46-days", (o) => (o.profile.form10IEAFiledOn = null), { files: { "msme.csv": null, "ais.csv": "id,category,source,description,amount\nA1,sale-securities,Broker,Sale of shares,100000\n" } });
    expect(x.missingDocs).toEqual(["Capital gains statement (AIS shows a sale of securities or property)", "MSME supplier ageing with acceptance and payment dates (s.43B(h))", "Form 10-IEA acknowledgement (old regime with business income)"]);
  });
  it("an unverified rule set stops the analysis", () => {
    expect(() => analyseTax(extractOf("clean-salaried-new", undefined, { fy: "2026-27" }))).toThrow(/not verified/);
  });
  it("belated return with tax unpaid at the due date: 234A from the day after the due date", () => {
    // clean salaried with no TDS: assessed 1,05,300 → 234A on 1,05,300 x 1% x 2 (Aug + part Sep) = 2,106
    const x = a("clean-salaried-new", (o) => Object.assign(o, { tdsInBooks: [] }) && (o.profile.plannedFilingDate = "2026-09-10"), { files: { "26as.csv": "tan,deductor,section,amount_paid,tds_deposited\n" } });
    expect(x.i234A).toBe(rs(2_106));
    expect(x.fee234F).toBe(rs(5_000));
  });
  it("caches per extracted object", () => {
    const x = extractOf("clean-salaried-new");
    expect(analyseTax(x)).toBe(analyseTax(x));
  });
});
