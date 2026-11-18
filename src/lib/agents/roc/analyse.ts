// ROC analysis: deterministic TypeScript over the extracted data. Classification (small company /
// OPC → MGT-7A), CSR applicability and obligation, AGM due date, filing due dates (from the shared
// statutory calendar), additional-fee estimate, DIR-3 KYC status, auditor term / rotation / ADT-1
// trigger, MSME-1 and DPT-3 applicability, shareholding and balance-sheet tie-outs.
// All amounts are integer paise; every threshold comes from ./data.ts. No model, no clock.
import { packDueDates } from "@/lib/agents/core/calendar";
import { DEFAULT_CALENDAR } from "@/lib/agents/core/calendar-defaults";
import { formatDayKey } from "@/lib/agents/core/format";
import {
  ADDITIONAL_FEE,
  AGM_RULES,
  AUDITOR_RULES,
  CSR_THRESHOLDS,
  DIR_KYC,
  DPT3,
  MSME1,
  NORMAL_FEE_SLABS,
  OPC_RULES,
  SMALL_COMPANY_LIMITS,
  inForce,
  inForceVerified,
} from "./data";
import { BS_ASSETS, BS_LIABILITIES, DEBIT_HEADS, FIN_HEADS, type Auditor, type Company, type Director, type FinColumn, type FinHead, type Holding, type MsmeDue, type TbLine } from "./parse";
import { addDays, addMonthsClamped, addYears, daysBetween, divRoundHalfUp, fyEndKey, fyStart } from "@/lib/agents/core/util";

// ------------------------------------------------------------------ extracted shape

export type RocFinancials = { source: "summary" | "tb" | "xlsx"; current: FinColumn; previous: FinColumn; unmappedLedgers: string[]; ledgerQuestions: string[] };

/** What extract() returns and what rules / compute / replay read. */
export type RocExtract = {
  fy: string;
  company: Company;
  directors: Director[];
  shareholding: Holding[];
  auditor: Auditor;
  financials: RocFinancials;
  msme: MsmeDue[];
  notes: string | null;
};

// ------------------------------------------------------------------ financials

export type FinTotals = {
  equity: number;
  liabilities: number;
  assets: number;
  equityAndLiabilities: number;
  turnover: number;
  profitBeforeTax: number;
  profitAfterTax: number;
  netWorth: number;
  borrowings: number;
};

export function finTotals(c: FinColumn): FinTotals {
  const sum = (heads: readonly FinHead[]) => heads.reduce((s, h) => s + c[h], 0);
  const equity = c.shareCapital + c.reservesSurplus;
  const liabilities = sum(BS_LIABILITIES);
  const pbt = c.revenueFromOperations + c.otherIncome - c.totalExpenses;
  return {
    equity,
    liabilities,
    assets: sum(BS_ASSETS),
    equityAndLiabilities: equity + liabilities,
    turnover: c.revenueFromOperations,
    profitBeforeTax: pbt,
    profitAfterTax: pbt - c.taxExpense,
    netWorth: equity,
    borrowings: c.longTermBorrowings + c.shortTermBorrowings,
  };
}

/**
 * Trial balance + ledger → head mapping (from the model) → a column of heads. Code does every
 * sum. The year's profit after tax is carried into reserves (the P&L closes to reserves).
 * Ledgers the mapping does not cover are returned, never guessed.
 */
export function columnFromTrialBalance(tb: TbLine[], mapping: { ledger: string; head: FinHead }[]): { column: FinColumn; unmapped: string[] } {
  const headOf = new Map<string, FinHead>();
  for (const m of mapping) if (!headOf.has(m.ledger.trim().toLowerCase())) headOf.set(m.ledger.trim().toLowerCase(), m.head);
  const column = Object.fromEntries(FIN_HEADS.map((h) => [h, 0])) as FinColumn;
  const unmapped: string[] = [];
  for (const l of tb) {
    const head = headOf.get(l.ledger.trim().toLowerCase());
    if (!head) {
      unmapped.push(l.ledger);
      continue;
    }
    column[head] += DEBIT_HEADS.has(head) ? l.debitPaise - l.creditPaise : l.creditPaise - l.debitPaise;
  }
  column.reservesSurplus += finTotals(column).profitAfterTax;
  return { column, unmapped };
}

// ------------------------------------------------------------------ fees

export function normalFeePaise(company: Pick<Company, "authorisedCapitalPaise">): number {
  if (company.authorisedCapitalPaise <= 0) return NORMAL_FEE_SLABS.noShareCapitalFeePaise;
  const slab = NORMAL_FEE_SLABS.slabs.find((s) => s.belowPaise === null || company.authorisedCapitalPaise < s.belowPaise);
  return (slab ?? NORMAL_FEE_SLABS.slabs[NORMAL_FEE_SLABS.slabs.length - 1]).feePaise;
}

/** Additional fee for forms charged per day of delay (AOC-4, MGT-7/7A). */
export const perDayAdditionalFee = (delayDays: number) => Math.max(0, delayDays) * ADDITIONAL_FEE.perDayFormsPaise;

/** Additional fee for other forms (ADT-1): multiple of the normal fee by delay bracket. */
export function multipleAdditionalFee(delayDays: number, normalFee: number): number {
  if (delayDays <= 0) return 0;
  const b = ADDITIONAL_FEE.multiples.find((m) => m.maxDays === null || delayDays <= m.maxDays)!;
  return b.times * normalFee;
}

// ------------------------------------------------------------------ analysis

export type FormDue = {
  id: "aoc-4" | "mgt-7" | "adt-1" | "dir-3-kyc" | "dpt-3" | "msme-1-h1" | "msme-1-h2";
  form: string;
  applicable: boolean;
  statutoryDue: string | null;
  basis: string;
  expectedFiling: string | null;
  delayDays: number;
  normalFeePaise: number;
  additionalFeePaise: number;
  note: string;
};

export type DirectorStatus = Director & { kycValid: boolean; issue: string | null };

export type PendingSmallLimits = { effectiveFrom: string; paidUpMaxPaise: number; turnoverMaxPaise: number; source: string; wouldBeSmall: boolean };

export type RocAnalysis = {
  fy: string;
  fyEnd: string;
  current: FinTotals;
  previous: FinTotals;
  balanceSheetDiffPaise: number;
  capitalDiffPaise: number;
  shareholding: { totalPaise: number; totalShares: number; diffPaise: number };
  small: {
    eligibleClass: boolean;
    isSmall: boolean;
    /** The verified limits applied (data.ts SMALL_COMPANY_LIMITS). */
    paidUpMaxPaise: number;
    turnoverMaxPaise: number;
    limitsSource: string;
    turnoverTestedPaise: number;
    reason: string;
    /** Unverified later limits in force for this FY under which the classification would differ. Never applied. */
    pendingVerification: PendingSmallLimits[];
  };
  annualReturnForm: "MGT-7" | "MGT-7A";
  csr: { applicable: boolean; reasons: string[]; avgNetProfitPaise: number; obligationPaise: number; yearsAveraged: number };
  agm: { required: boolean; dueDate: string | null; heldOn: string | null; delayDays: number; gapLimit: string | null; gapExceeded: boolean; basis: string };
  forms: FormDue[];
  directors: DirectorStatus[];
  kycPending: number;
  kycWindowStart: string;
  auditor: {
    termYear: number;
    termEndsAtThisAgm: boolean;
    beyondTerm: boolean;
    rotationClass: boolean;
    consecutiveYears: number;
    rotationLimit: number;
    rotationBreached: boolean;
    adt1Required: boolean;
    adt1Missing: boolean;
    reason: string;
  };
  msme1: { applicable: boolean; h1: MsmeDue[]; h2: MsmeDue[] };
  dpt3: { applicable: boolean; filedOn: string | null; exempt: boolean };
  fees: { normalFeePaise: number; aoc4: number; mgt7: number; adt1: number; dirKyc: number; total: number };
};

function calendarDue(ruleId: string, fy: string, period: string, agmDate?: string | null): { due: string; basis: string } {
  const r = packDueDates(DEFAULT_CALENDAR, ruleId, { fy, period, agmDate: agmDate ?? null });
  if (!r.ok) throw new Error(`calendar ${ruleId}: ${r.message}`);
  return { due: r.statutoryDue, basis: r.basis };
}

const late = (due: string | null, filed: string | null) => (due && filed ? Math.max(0, daysBetween(due, filed)) : 0);

const isMonthEnd = (key: string) => addDays(key, 1).endsWith("-01");

/** `n` months after `key`; a month-end stays a month-end (30 Sep + 3 → 31 Dec), any other day is clamped (addMonthsClamped). */
export function addMonthsFromMonthEnd(key: string, n: number): string {
  return isMonthEnd(key) ? addDays(addMonthsClamped(addDays(key, 1), n), -1) : addMonthsClamped(key, n);
}

const cache = new WeakMap<RocExtract, RocAnalysis>();

/** Pure; cached per extracted object (rules, compute and deliverables share one analysis). */
export function analyseRoc(x: RocExtract): RocAnalysis {
  const hit = cache.get(x);
  if (hit) return hit;
  const a = analyse(x);
  cache.set(x, a);
  return a;
}

function analyse(x: RocExtract): RocAnalysis {
  const { company: co, auditor: au } = x;
  const fyEnd = fyEndKey(x.fy);
  const current = finTotals(x.financials.current);
  const previous = finTotals(x.financials.previous);
  const opc = co.companyClass === "opc";

  // Shareholding = paid-up capital.
  const totalPaise = x.shareholding.reduce((s, h) => s + h.shares * h.paidUpPerSharePaise, 0);
  const totalShares = x.shareholding.reduce((s, h) => s + h.shares, 0);

  // Small company (s.2(85)) / OPC → MGT-7A. Only partner-verified limits are applied; later
  // unverified limits are tested too and reported when they would change the classification.
  const { applied: limits, pending } = inForceVerified(SMALL_COMPANY_LIMITS, fyEnd, "small-company limit");
  const eligibleClass = co.companyClass === "private" && !co.section8 && !co.holdingOrSubsidiary && !co.specialAct;
  const smallUnder = (l: { paidUpMaxPaise: number; turnoverMaxPaise: number }) => eligibleClass && co.paidUpCapitalPaise <= l.paidUpMaxPaise && previous.turnover <= l.turnoverMaxPaise;
  const capOk = co.paidUpCapitalPaise <= limits.paidUpMaxPaise;
  const isSmall = smallUnder(limits);
  const pendingVerification: PendingSmallLimits[] = pending
    .filter((l) => smallUnder(l) !== isSmall)
    .map((l) => ({ effectiveFrom: l.effectiveFrom, paidUpMaxPaise: l.paidUpMaxPaise, turnoverMaxPaise: l.turnoverMaxPaise, source: l.source, wouldBeSmall: smallUnder(l) }));
  const baseReason = !eligibleClass
    ? opc
      ? "One Person Company (MGT-7A applies as an OPC)"
      : "not a small company: only a private company that is not a holding/subsidiary, section 8 or special-Act company qualifies"
    : isSmall
      ? "small company: paid-up and preceding-year turnover within the verified limits"
      : `not a small company: ${!capOk ? "paid-up capital" : "preceding-year turnover"} exceeds the verified limit`;
  const p0 = pendingVerification[0];
  const reason = p0
    ? `${baseReason}; PENDING PARTNER VERIFICATION — under the unverified limits from ${formatDayKey(p0.effectiveFrom)} it would ${p0.wouldBeSmall ? "" : "not "}be a small company`
    : baseReason;

  // CSR (s.135): any threshold in the immediately preceding FY.
  const csrT = inForce(CSR_THRESHOLDS, fyEnd, "CSR threshold");
  const reasons: string[] = [];
  if (previous.netWorth >= csrT.netWorthPaise) reasons.push("net worth");
  if (previous.turnover >= csrT.turnoverPaise) reasons.push("turnover");
  if (previous.profitBeforeTax >= csrT.netProfitPaise) reasons.push("net profit");
  const history = co.csrNetProfitHistoryPaise.length ? co.csrNetProfitHistoryPaise : [previous.profitBeforeTax];
  const sum = history.reduce((s, v) => s + v, 0);
  const avg = divRoundHalfUp(sum, history.length);
  const applicable = reasons.length > 0;
  // 2% of the average, rounded to the nearest rupee: sum × pct / (100 × years) paise → rupees.
  const obligationPaise = applicable && sum > 0 ? divRoundHalfUp(sum * csrT.spendPercent, 100 * history.length * 100) * 100 : 0;

  // AGM (s.96).
  const firstAgm = co.firstFinancialYear;
  const regularDue = addMonthsClamped(fyEnd, firstAgm ? AGM_RULES.firstAgmMonths : AGM_RULES.monthsAfterFyEnd);
  // Registrar's extension of up to three months (s.96(1) proviso), counted from the regular due
  // date; when that is a month-end (30 Sep) the period ends on a month-end too (31 Dec, not the
  // clamped 30 Dec). Partner to confirm (AGM_RULES verify note).
  const maxExtended = addMonthsFromMonthEnd(regularDue, AGM_RULES.maxExtensionMonths);
  const agmDue = opc ? null : co.agmExtendedTo && !firstAgm ? (co.agmExtendedTo < maxExtended ? co.agmExtendedTo : maxExtended) : regularDue;
  const agmBasis = opc
    ? "OPC: no AGM (s.96(1))"
    : `${firstAgm ? "first AGM: nine" : "six"} months from the FY end${co.agmExtendedTo && !firstAgm ? ", extended by the Registrar" : ""}`;
  const gapLimit = co.previousAgmDate ? addMonthsClamped(co.previousAgmDate, AGM_RULES.maxGapMonths) : null;
  const agm = {
    required: !opc,
    dueDate: agmDue,
    heldOn: co.agmDate,
    delayDays: late(agmDue, co.agmDate),
    gapLimit,
    gapExceeded: !opc && !!gapLimit && !!co.agmDate && co.agmDate > gapLimit,
    basis: agmBasis,
  };
  // Filing anchor: the AGM held, else the date it should have been held (s.137(1) / s.92(4) provisos).
  const anchor = co.agmDate ?? agmDue ?? addMonthsClamped(fyEnd, AGM_RULES.monthsAfterFyEnd);

  // Auditor term, rotation, ADT-1.
  const termYear = fyStart(x.fy) - fyStart(au.termStartFy) + 1;
  const consecutiveYears = au.consecutiveYearsBeforeTerm + termYear;
  const r = AUDITOR_RULES.rotation;
  // Rule 5 of the Companies (Audit and Auditors) Rules, 2014: the rotation classes exclude One
  // Person Companies and small companies (classified on the verified limits above). A listed
  // company is a public company — never small or an OPC — so it stays in the class whatever the
  // other fields say.
  const rotationClass =
    co.listed ||
    (!opc &&
      !isSmall &&
      ((co.companyClass === "public" && co.paidUpCapitalPaise >= r.unlistedPublicPaidUpPaise) ||
        (co.companyClass !== "public" && co.paidUpCapitalPaise >= r.privatePaidUpPaise) ||
        current.borrowings >= r.borrowingsPaise));
  const rotationLimit = au.type === "individual" ? r.individualMaxYears : r.firmMaxYears;
  const rotationBreached = rotationClass && (consecutiveYears > rotationLimit || (au.reappointedAtThisAgm && consecutiveYears + au.termYears > rotationLimit));
  const termEndsAtThisAgm = termYear === au.termYears;
  const beyondTerm = termYear > au.termYears || termYear < 1;
  const adt1Required = au.reappointedAtThisAgm || au.newAuditorAtThisAgm || au.casualVacancy;
  const adt1Missing = termEndsAtThisAgm && !au.reappointedAtThisAgm && !au.newAuditorAtThisAgm;
  const auditorReason = beyondTerm
    ? `auditing FY ${x.fy} would be year ${termYear} of a ${au.termYears}-year term that began in FY ${au.termStartFy}`
    : termEndsAtThisAgm
      ? `the ${au.termYears}-year term that began in FY ${au.termStartFy} ends at this AGM`
      : `year ${termYear} of ${au.termYears}`;

  // Filing due dates and fee estimate.
  const fee = normalFeePaise(co);
  const filed = co.estimateFilingOn;
  const aoc4 = opc ? { due: addDays(fyEnd, OPC_RULES.aoc4DaysFromFyEnd), basis: `${OPC_RULES.aoc4DaysFromFyEnd} days from the FY end (OPC)` } : calendarDue("aoc-4", x.fy, "Annual", anchor);
  const mgt7 = calendarDue("mgt-7", x.fy, "Annual", anchor);
  const adt1 = adt1Required ? calendarDue("adt-1", x.fy, "Annual", anchor) : null;
  const kyc = calendarDue("dir-3-kyc", x.fy, "Annual");
  const msmeH1 = calendarDue("msme-1", x.fy, "H1");
  const msmeH2 = calendarDue("msme-1", x.fy, "H2");

  // DIR-3 KYC: valid when completed on or after the window start (frequency from data).
  const kycWindowStart = addYears(addDays(fyEnd, 1), -(DIR_KYC.frequencyYears - 1));
  const directors: DirectorStatus[] = x.directors.map((d) => {
    const kycValid = !!d.kycCompletedOn && d.kycCompletedOn >= kycWindowStart;
    const issue =
      d.dinStatus !== "active" ? `DIN ${d.dinStatus}` : kycValid ? null : d.kycCompletedOn ? `KYC last completed ${d.kycCompletedOn}, before ${kycWindowStart}` : "DIR-3 KYC pending";
    return { ...d, kycValid, issue };
  });
  const kycPending = directors.filter((d) => d.dinStatus === "active" && !d.kycValid).length;

  const aoc4Delay = late(aoc4.due, filed);
  const mgt7Delay = late(mgt7.due, filed);
  const adt1Delay = adt1 ? late(adt1.due, filed) : 0;
  const kycLate = !!filed && filed > kyc.due;
  const fees = {
    normalFeePaise: fee,
    aoc4: perDayAdditionalFee(aoc4Delay),
    mgt7: perDayAdditionalFee(mgt7Delay),
    adt1: adt1 ? multipleAdditionalFee(adt1Delay, fee) : 0,
    dirKyc: kycLate ? kycPending * ADDITIONAL_FEE.dirKycLateFeePaise : 0,
    total: 0,
  };
  fees.total = fees.aoc4 + fees.mgt7 + fees.adt1 + fees.dirKyc;

  const msmeOver = x.msme.filter((m) => m.daysOutstanding > MSME1.maxDays && m.amountPaise > 0);
  const msme1 = { applicable: msmeOver.length > 0, h1: msmeOver.filter((m) => m.halfYear === "H1"), h2: msmeOver.filter((m) => m.halfYear === "H2") };
  const dptExempt = co.governmentCompany;
  const dpt3 = { applicable: !dptExempt && (co.deposits.depositsOutstandingPaise > 0 || co.deposits.loansNotDepositsPaise > 0), filedOn: co.deposits.dpt3FiledOn, exempt: dptExempt };
  const dpt3Due = `${fyStart(x.fy) + 1}-${DPT3.dueMonthDay}`;

  const forms: FormDue[] = [
    { id: "aoc-4", form: opc ? "AOC-4 (OPC)" : "AOC-4", applicable: true, statutoryDue: aoc4.due, basis: aoc4.basis, expectedFiling: filed, delayDays: aoc4Delay, normalFeePaise: fee, additionalFeePaise: fees.aoc4, note: "₹100 per day of delay" },
    {
      id: "mgt-7",
      form: isSmall || opc ? "MGT-7A" : "MGT-7",
      applicable: true,
      statutoryDue: mgt7.due,
      basis: mgt7.basis,
      expectedFiling: filed,
      delayDays: mgt7Delay,
      normalFeePaise: fee,
      additionalFeePaise: fees.mgt7,
      note: "₹100 per day of delay",
    },
    {
      id: "adt-1",
      form: "ADT-1",
      applicable: adt1Required,
      statutoryDue: adt1?.due ?? null,
      basis: adt1 ? adt1.basis : adt1Missing ? "term ends at this AGM: appointment resolution needed" : "no appointment at this AGM",
      expectedFiling: adt1 ? filed : null,
      delayDays: adt1Delay,
      normalFeePaise: adt1 ? fee : 0,
      additionalFeePaise: fees.adt1,
      note: "multiple of the normal fee by delay bracket",
    },
    { id: "dir-3-kyc", form: "DIR-3 KYC", applicable: kycPending > 0, statutoryDue: kyc.due, basis: kyc.basis, expectedFiling: kycPending > 0 ? filed : null, delayDays: kycPending > 0 ? late(kyc.due, filed) : 0, normalFeePaise: 0, additionalFeePaise: fees.dirKyc, note: `${kycPending} director(s) pending; ₹5,000 each after the due date` },
    { id: "dpt-3", form: "DPT-3", applicable: dpt3.applicable, statutoryDue: dpt3.applicable ? dpt3Due : null, basis: "30 June after the FY", expectedFiling: dpt3.filedOn, delayDays: 0, normalFeePaise: 0, additionalFeePaise: 0, note: dpt3.filedOn ? `filed ${dpt3.filedOn}` : dpt3.applicable ? "not filed" : "no outstanding deposits or loans" },
    { id: "msme-1-h1", form: "MSME-1 (Apr–Sep)", applicable: msme1.h1.length > 0, statutoryDue: msmeH1.due, basis: msmeH1.basis, expectedFiling: null, delayDays: 0, normalFeePaise: 0, additionalFeePaise: 0, note: `${msme1.h1.length} supplier(s) beyond ${MSME1.maxDays} days` },
    { id: "msme-1-h2", form: "MSME-1 (Oct–Mar)", applicable: msme1.h2.length > 0, statutoryDue: msmeH2.due, basis: msmeH2.basis, expectedFiling: null, delayDays: 0, normalFeePaise: 0, additionalFeePaise: 0, note: `${msme1.h2.length} supplier(s) beyond ${MSME1.maxDays} days` },
  ];

  return {
    fy: x.fy,
    fyEnd,
    current,
    previous,
    balanceSheetDiffPaise: current.assets - current.equityAndLiabilities,
    capitalDiffPaise: x.financials.current.shareCapital - co.paidUpCapitalPaise,
    shareholding: { totalPaise, totalShares, diffPaise: totalPaise - co.paidUpCapitalPaise },
    small: { eligibleClass, isSmall, paidUpMaxPaise: limits.paidUpMaxPaise, turnoverMaxPaise: limits.turnoverMaxPaise, limitsSource: limits.source, turnoverTestedPaise: previous.turnover, reason, pendingVerification },
    annualReturnForm: isSmall || opc ? "MGT-7A" : "MGT-7",
    csr: { applicable, reasons, avgNetProfitPaise: avg, obligationPaise, yearsAveraged: history.length },
    agm,
    forms,
    directors,
    kycPending,
    kycWindowStart,
    auditor: { termYear, termEndsAtThisAgm, beyondTerm, rotationClass, consecutiveYears, rotationLimit, rotationBreached, adt1Required, adt1Missing, reason: auditorReason },
    msme1,
    dpt3,
    fees,
  };
}
