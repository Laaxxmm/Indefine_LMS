// Income-tax rates, thresholds and limits â€” DATA ONLY, versioned by financial year. Amounts are
// integer paise; rates are basis points (1% = 100 bp) so all arithmetic stays in integers.
// Every rule set and every entry carries a `verify` note for the partner.
//
// Implemented: FY 2025-26 = AY 2026-27 under the Income-tax Act, 1961 as amended by the Finance
// Act, 2025 (and Act No. 4 of 2026 for s.87A). The Income-tax Act, 2025 applies from tax year
// 2026-27: its rule set is present but marked "unverified", and the agent refuses to compute
// with an unverified set â€” a partner publishes the verified numbers as a new entry.
// ITR and advance-tax DATES are not here: they come from the shared statutory calendar
// (src/lib/agents/core/calendar-defaults.ts, rules "itr" and "advance-tax").

const L = 1_00_000_00; // â‚¹1 lakh in paise
const CR = 1_00_00_000_00; // â‚¹1 crore in paise

export type Slab = { uptoPaise: number | null; bp: number };
export type SurchargeStep = { abovePaise: number; bp: number };

export type TaxRuleSet = {
  fy: string;
  ay: string;
  act: string;
  status: "verified" | "unverified";
  verify: string;
  slabs: {
    newRegime: Slab[];
    oldBelow60: Slab[];
    oldSenior: Slab[];
    oldSuperSenior: Slab[];
  };
  /** Age reached during the FY (day before the birthday rule): born on or before these dates. */
  seniorBornOnOrBefore: string;
  superSeniorBornOnOrBefore: string;
  rebate87A: { newIncomeLimitPaise: number; newMaxPaise: number; oldIncomeLimitPaise: number; oldMaxPaise: number; verify: string };
  standardDeduction: { newPaise: number; oldPaise: number; verify: string };
  surchargeIndividual: { steps: SurchargeStep[]; newRegimeCapBp: number; specialIncomeCapBp: number; verify: string };
  capitalGains: { stcg111ABp: number; ltcg112ABp: number; ltcg112ABExemptPaise: number; ltcg112Bp: number; equityLongTermMonths: number; otherLongTermMonths: number; verify: string };
  cessBp: number;
  firm: { bp: number; surcharge: SurchargeStep[]; verify: string };
  company: { s115BAABp: number; s115BAASurchargeBp: number; lowRateBp: number; lowRateTurnoverPaise: number; normalBp: number; surcharge: SurchargeStep[]; verify: string };
  deductions: {
    s80CPaise: number;
    s80CCD1BPaise: number;
    s80DSelfPaise: number;
    s80DSelfSeniorPaise: number;
    s80DParentsPaise: number;
    s80DParentsSeniorPaise: number;
    s80TTAPaise: number;
    s80TTBPaise: number;
    selfOccupiedInterestPaise: number;
    employerNpsNewBp: number;
    employerNpsOldBp: number;
    verify: string;
  };
  presumptive: {
    s44ADLimitPaise: number;
    s44ADHigherLimitPaise: number;
    s44ADALimitPaise: number;
    s44ADAHigherLimitPaise: number;
    cashShareMaxBp: number;
    s44ADDigitalBp: number;
    s44ADOtherBp: number;
    s44ADABp: number;
    verify: string;
  };
  audit44AB: { businessLimitPaise: number; businessHigherLimitPaise: number; professionLimitPaise: number; cashShareMaxBp: number; verify: string };
  msme43Bh: { maxAgreementDays: number; noAgreementDays: number; verify: string };
  advanceTax: {
    minLiabilityPaise: number;
    instalmentsBp: number[];
    reliefBp: (number | null)[];
    months234C: number[];
    s234BThresholdBp: number;
    interestBpPerMonth: number;
    roundDownToPaise: number;
    verify: string;
  };
  lateFee234F: { feePaise: number; smallIncomeFeePaise: number; smallIncomeLimitPaise: number; verify: string };
  lossCarryForwardYears: number;
  itr: { itr1IncomeLimitPaise: number; itr1Ltcg112ALimitPaise: number; verify: string };
};

const FY_2025_26: TaxRuleSet = {
  fy: "2025-26",
  ay: "2026-27",
  act: "Income-tax Act, 1961 (as amended by the Finance Act, 2025)",
  status: "verified",
  verify: "Rule set for AY 2026-27 under the 1961 Act. Re-check against the Finance Act, 2025 text and any later amendment before relying on it.",
  slabs: {
    newRegime: [
      { uptoPaise: 4 * L, bp: 0 },
      { uptoPaise: 8 * L, bp: 500 },
      { uptoPaise: 12 * L, bp: 1000 },
      { uptoPaise: 16 * L, bp: 1500 },
      { uptoPaise: 20 * L, bp: 2000 },
      { uptoPaise: 24 * L, bp: 2500 },
      { uptoPaise: null, bp: 3000 },
    ],
    oldBelow60: [
      { uptoPaise: 2.5 * L, bp: 0 },
      { uptoPaise: 5 * L, bp: 500 },
      { uptoPaise: 10 * L, bp: 2000 },
      { uptoPaise: null, bp: 3000 },
    ],
    oldSenior: [
      { uptoPaise: 3 * L, bp: 0 },
      { uptoPaise: 5 * L, bp: 500 },
      { uptoPaise: 10 * L, bp: 2000 },
      { uptoPaise: null, bp: 3000 },
    ],
    oldSuperSenior: [
      { uptoPaise: 5 * L, bp: 0 },
      { uptoPaise: 10 * L, bp: 2000 },
      { uptoPaise: null, bp: 3000 },
    ],
  },
  seniorBornOnOrBefore: "1966-04-01",
  superSeniorBornOnOrBefore: "1946-04-01",
  rebate87A: {
    newIncomeLimitPaise: 12 * L,
    newMaxPaise: 60_000_00,
    oldIncomeLimitPaise: 5 * L,
    oldMaxPaise: 12_500_00,
    verify: "s.87A: old regime TI â‰¤ â‚¹5,00,000 â†’ up to â‚¹12,500 (not against s.112A tax); new regime TI â‰¤ â‚¹12,00,000 â†’ up to â‚¹60,000 with marginal relief above, limited to tax at s.115BAC(1A) slab rates (no rebate on special-rate income) â€” Finance Act 2025, Act 4 of 2026.",
  },
  standardDeduction: { newPaise: 75_000_00, oldPaise: 50_000_00, verify: "s.16(ia): â‚¹75,000 new regime, â‚¹50,000 old regime." },
  surchargeIndividual: {
    steps: [
      { abovePaise: 50 * L, bp: 1000 },
      { abovePaise: 1 * CR, bp: 1500 },
      { abovePaise: 2 * CR, bp: 2500 },
      { abovePaise: 5 * CR, bp: 3700 },
    ],
    newRegimeCapBp: 2500,
    specialIncomeCapBp: 1500,
    verify: "Finance Act 2025, First Schedule Part I/III: 10% > â‚¹50 lakh, 15% > â‚¹1 crore, 25% > â‚¹2 crore, 37% > â‚¹5 crore (new regime capped at 25%); 15% cap on tax under ss.111A/112/112A. The 15% cap on dividend income is NOT modelled â€” verify where total income exceeds â‚¹2 crore and dividends are included. Marginal relief applied.",
  },
  capitalGains: {
    stcg111ABp: 2000,
    ltcg112ABp: 1250,
    ltcg112ABExemptPaise: 1.25 * L,
    ltcg112Bp: 1250,
    equityLongTermMonths: 12,
    otherLongTermMonths: 24,
    verify: "ss.111A (20%), 112A (12.5% above â‚¹1,25,000), 112 (12.5%, no indexation) for transfers on or after 23 Jul 2024; s.2(42A) holding periods 12 months (listed securities) / 24 months (other). Grandfathering, indexation option for land/building acquired before 23 Jul 2024 and s.54-series exemptions are NOT modelled.",
  },
  cessBp: 400,
  firm: { bp: 3000, surcharge: [{ abovePaise: 1 * CR, bp: 1200 }], verify: "Firms / LLPs: 30%, surcharge 12% above â‚¹1 crore with marginal relief, cess 4%. Partner remuneration / interest limits (s.40(b)) are taken as already applied in the books profit." },
  company: {
    s115BAABp: 2200,
    s115BAASurchargeBp: 1000,
    lowRateBp: 2500,
    lowRateTurnoverPaise: 400 * CR,
    normalBp: 3000,
    surcharge: [
      { abovePaise: 1 * CR, bp: 700 },
      { abovePaise: 10 * CR, bp: 1200 },
    ],
    verify: "Domestic company: s.115BAA 22% + 10% surcharge + 4% cess; otherwise 25% where turnover of the second preceding year â‰¤ â‚¹400 crore, else 30%, surcharge 7% > â‚¹1 crore / 12% > â‚¹10 crore. MAT (s.115JB) is NOT computed.",
  },
  deductions: {
    s80CPaise: 1.5 * L,
    s80CCD1BPaise: 50_000_00,
    s80DSelfPaise: 25_000_00,
    s80DSelfSeniorPaise: 50_000_00,
    s80DParentsPaise: 25_000_00,
    s80DParentsSeniorPaise: 50_000_00,
    s80TTAPaise: 10_000_00,
    s80TTBPaise: 50_000_00,
    selfOccupiedInterestPaise: 2 * L,
    employerNpsNewBp: 1400,
    employerNpsOldBp: 1000,
    verify:
      "80C â‚¹1,50,000 (80C + 80CCC + 80CCD(1)); 80CCD(1B) â‚¹50,000; 80D â‚¹25,000 / â‚¹50,000 senior for self-family and parents each; 80TTA â‚¹10,000 (non-senior, savings interest); 80TTB â‚¹50,000 (senior, deposit interest); s.24(b) self-occupied interest â‚¹2,00,000; 80CCD(2) 14% (new) / 10% (old) of basic + DA. 80G is taken as the qualifying amount staff computed. New regime allows only 80CCD(2) and 80CCH (s.115BAC(2)).",
  },
  presumptive: {
    s44ADLimitPaise: 2 * CR,
    s44ADHigherLimitPaise: 3 * CR,
    s44ADALimitPaise: 50 * L,
    s44ADAHigherLimitPaise: 75 * L,
    cashShareMaxBp: 500,
    s44ADDigitalBp: 600,
    s44ADOtherBp: 800,
    s44ADABp: 5000,
    verify:
      "s.44AD: resident individual / HUF / firm (not LLP), turnover â‰¤ â‚¹2 crore or â‚¹3 crore if cash receipts â‰¤ 5% (a cheque or draft that is not account payee counts as cash); 6% on banking-channel receipts received by the s.139(1) due date, 8% on the rest; s.44AD(4) five-year lock. An income declared BELOW the deemed income (s.44AD or s.44ADA) is used as declared; the profit is then not declared under sub-section (1), so ITR-3, the regular advance-tax instalments, and a tax audit u/s 44AB(d) (s.44ADA(4)) or u/s 44AB(e) (s.44AD(4)-(5)) when total income exceeds the basic exemption (new-regime limit) - for s.44AD the agent assumes s.44AD(4) applies (profit declared under s.44AD in one of the five preceding years): PARTNER TO CONFIRM from the prior returns. s.44ADA: resident, specified profession, receipts â‰¤ â‚¹50 lakh or â‚¹75 lakh if cash â‰¤ 5%; 50%.",
  },
  audit44AB: {
    businessLimitPaise: 1 * CR,
    businessHigherLimitPaise: 10 * CR,
    professionLimitPaise: 50 * L,
    cashShareMaxBp: 500,
    verify: "s.44AB: business turnover > â‚¹1 crore (â‚¹10 crore where cash receipts and cash payments are each â‰¤ 5%); profession receipts > â‚¹50 lakh; s.44AB(d)/(e) for presumptive cases declaring less, or within the s.44AD(4) lock, when income exceeds the basic exemption.",
  },
  msme43Bh: { maxAgreementDays: 45, noAgreementDays: 15, verify: "s.43B(h) with MSMED Act s.15: pay a micro / small enterprise within the agreed days (â‰¤ 45) or 15 days without a written agreement; otherwise deduction only in the year of payment. Medium enterprises and traders are outside s.43B(h). The s.43B proviso (payment before the return due date) does not apply to clause (h)." },
  advanceTax: {
    minLiabilityPaise: 10_000_00,
    instalmentsBp: [1500, 4500, 7500, 10000],
    reliefBp: [1200, 3600, null, null],
    months234C: [3, 3, 3, 1],
    s234BThresholdBp: 9000,
    interestBpPerMonth: 100,
    roundDownToPaise: 100_00,
    verify:
      "ss.208-211, 234B, 234C, 234A: no advance tax below â‚¹10,000; resident seniors without business income exempt (s.207(2)); 15/45/75/100% (12%/36% relief) and presumptive 100% by 15 Mar; 1% per month or part, amounts rounded down to â‚¹100 (rule 119A). The 234C proviso for capital gains / dividends arising after an instalment date is NOT modelled. s.234A: the base is assessed tax less tax paid on or before the s.139(1) due date (advance tax and self-assessment tax u/s 140A; later payments do not reduce it) - s.234A(1) lists advance tax, TDS/TCS and reliefs but does not name self-assessment tax: PARTNER TO CONFIRM FIRM PRACTICE. s.234B(2) (s.424(4) of the 2025 Act): tax paid after 31 March (self-assessment u/s 140A or otherwise) is not advance tax for the 90% test, but it reduces the shortfall from the 1st of the month after the month of payment - the month of payment is a part of a month of the period up to the payment, so it carries the old shortfall (paid 1 May or 31 May alike: April and May on the full shortfall, June onwards on the reduced one); several payments in one month take effect together the next month; each payment is applied wholly to tax (the s.140A(1) Explanation order fee - interest - tax for a payment short of the aggregate is NOT applied): PARTNER TO VERIFY both conventions. Month or part of a month (rule 269(b) of the 2026 Rules / rule 119A(b) of the 1962 Rules: a fraction counts as a full month): the n-th month begins on the start's day-of-month n - 1 months later, or on the 1st of the following month when that month has no such day (31 Jan to 28 Feb = 1 month, to 1 Mar = 2). Periods starting on the 1st (234A after a month-end due date, 234B from 1 April) count calendar months under any reading; PARTNER TO CONFIRM the convention for a mid-month start (an extended due date).",
  },
  lateFee234F: { feePaise: 5_000_00, smallIncomeFeePaise: 1_000_00, smallIncomeLimitPaise: 5 * L, verify: "s.234F: â‚¹5,000 for a return after the s.139(1) due date; â‚¹1,000 where total income â‰¤ â‚¹5,00,000." },
  lossCarryForwardYears: 8,
  itr: { itr1IncomeLimitPaise: 50 * L, itr1Ltcg112ALimitPaise: 1.25 * L, verify: "ITR-1 / ITR-4 for AY 2026-27: resident individuals (ITR-4 also HUF / firm other than LLP) with total income â‰¤ â‚¹50 lakh; LTCG u/s 112A up to â‚¹1,25,000 allowed; no brought-forward or carried-forward loss; no director / unlisted shares (ITR-1). Re-check the CBDT notification of the forms." },
};

const TY_2026_27: TaxRuleSet = {
  ...FY_2025_26,
  fy: "2026-27",
  ay: "2027-28",
  act: "Income-tax Act, 2025 (tax year 2026-27)",
  status: "unverified",
  verify: "PARTNER TO VERIFY: tax year 2026-27 falls under the Income-tax Act, 2025 with rates from the Finance Act, 2026. Values here are copied from FY 2025-26 only as a placeholder; the agent will not compute with an unverified rule set.",
};

export const TAX_RULESETS: Readonly<Record<string, TaxRuleSet>> = Object.freeze({ [FY_2025_26.fy]: FY_2025_26, [TY_2026_27.fy]: TY_2026_27 });

/** The verified rule set for an FY, or an explanation why there is none. */
export function ruleSetFor(fy: string): { ok: true; rules: TaxRuleSet } | { ok: false; reason: string } {
  const r = TAX_RULESETS[fy];
  if (!r) return { ok: false, reason: `No income-tax rule set for FY ${fy}; publish one (with partner-verified rates) before running the Tax agent` };
  if (r.status !== "verified") return { ok: false, reason: `The FY ${fy} rule set (${r.act}) is not verified by a partner yet: ${r.verify}` };
  return { ok: true, rules: r };
}

/** Every verify note of a rule set, for the deliverable and the report. */
export function taxVerifyNotes(r: TaxRuleSet): { item: string; verify: string }[] {
  return [
    { item: `Rule set FY ${r.fy} / AY ${r.ay} â€” ${r.act}`, verify: r.verify },
    { item: "Rebate u/s 87A", verify: r.rebate87A.verify },
    { item: "Standard deduction", verify: r.standardDeduction.verify },
    { item: "Surcharge (individual / HUF)", verify: r.surchargeIndividual.verify },
    { item: "Capital gains rates", verify: r.capitalGains.verify },
    { item: "Firms", verify: r.firm.verify },
    { item: "Companies", verify: r.company.verify },
    { item: "Chapter VI-A and s.24(b) caps", verify: r.deductions.verify },
    { item: "Presumptive taxation", verify: r.presumptive.verify },
    { item: "Tax audit u/s 44AB", verify: r.audit44AB.verify },
    { item: "s.43B(h) MSME payments", verify: r.msme43Bh.verify },
    { item: "Advance tax and interest", verify: r.advanceTax.verify },
    { item: "Late fee u/s 234F", verify: r.lateFee234F.verify },
    { item: "ITR form selection", verify: r.itr.verify },
    { item: "Senior citizen age", verify: `Senior if born on or before ${r.seniorBornOnOrBefore}, super senior on or before ${r.superSeniorBornOnOrBefore} (age reached on the day before the birthday).` },
    { item: "TDS credit", verify: "Credit claimed per TAN = lower of books and Form 26AS; TANs only in 26AS are not claimed until the income is traced. Verify against TRACES-downloaded 26AS before filing." },
    { item: "Loss carry-forward", verify: `ss.72 / 80 / 139(3): business loss carried forward ${r.lossCarryForwardYears} AYs only when the loss year's return was filed by the s.139(1) due date. Brought-forward capital and house-property losses are not modelled.` },
  ];
}
