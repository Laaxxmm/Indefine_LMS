// Tax analysis: deterministic TypeScript over the extracted data — heads of income and set-off,
// presumptive eligibility, s.43B(h), Chapter VI-A caps, old vs new regime, tax, TDS (26AS vs
// books), AIS vs books (using the model's validated matches), tax-audit applicability, ITR form,
// advance tax with 234B/234C, 234A and 234F, loss carry-forward and missing documents.
// Integer paise throughout; rates from ./data.ts; dates from the shared statutory calendar.
import { packDueDates } from "@/lib/agents/core/calendar";
import { DEFAULT_CALENDAR } from "@/lib/agents/core/calendar-defaults";
import { addDays, fyStart } from "@/lib/agents/roc/util";
import {
  advanceTaxInterest,
  basicExemption,
  capitalGains,
  interest234A,
  lateFee234F,
  msmeDisallowance,
  pct,
  presumptiveIncome,
  roundIncomeTo10,
  roundPayableTo10,
  slabsFor,
  taxOnIncome,
  type AgeBand,
  type CgResult,
  type InstalmentRow,
  type MsmeFinding,
  type TaxBreakdown,
  type TaxContext,
} from "./compute";
import { ruleSetFor, type TaxRuleSet } from "./data";
import type { AisLine, CgRow, MsmeRow, Organiser, PriorItr, Tds26As } from "./parse";

// ------------------------------------------------------------------ extracted shape

export type AisOutcome = "matched" | "not_in_books" | "insufficient_evidence" | "dropped" | "unanswered";
export type AisMatch = { aisId: string; outcome: AisOutcome; bookId: string | null };

export type TaxExtract = {
  fy: string;
  organiser: Organiser;
  form26as: Tds26As[] | null;
  ais: AisLine[] | null;
  capitalGains: CgRow[] | null;
  msme: MsmeRow[] | null;
  priorItr: PriorItr | null;
  /** Validated model matches of AIS income lines to books ledgers (one per AIS income line). */
  aisMatches: AisMatch[];
};

/** AIS income categories and the books ledger natures each may match. Other categories are informational. */
export const AIS_INCOME_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  "interest-savings": ["savings-interest"],
  "interest-deposit": ["deposit-interest"],
  dividend: ["dividend"],
  rent: ["rent"],
  "other-income": ["other", "savings-interest", "deposit-interest", "dividend", "rent"],
};
export const isAisIncome = (category: string) => Object.prototype.hasOwnProperty.call(AIS_INCOME_CATEGORIES, category);

// ------------------------------------------------------------------ result shape

export type RegimeResult = {
  regime: "old" | "new";
  salary: number;
  houseProperty: number;
  business: number;
  otherSources: number;
  cg: { stcgOther: number; stcg111A: number; ltcg112: number; ltcg112A: number };
  grossTotalIncome: number;
  deductions: { section: string; claimed: number; allowed: number }[];
  deductionsAllowed: number;
  totalIncome: number;
  tax: TaxBreakdown;
};

export type TaxAnalysis = {
  rules: TaxRuleSet;
  personal: boolean;
  ageBand: AgeBand;
  resident: boolean;
  due139: string;
  dueCategory: "audit" | "non-audit";
  belated: boolean;
  presumptive: { claimed: "44AD" | "44ADA" | null; eligible: boolean; reasons: string[]; incomePaise: number; cashSharePaise: number };
  businessIncome: number;
  msme: { findings: MsmeFinding[]; disallowedPaise: number; applied: boolean };
  cgResult: CgResult;
  losses: { bfValidPaise: number; bfInvalid: { ay: string; amountPaise: number; reason: string }[]; bfSetOffPaise: number; currentLossPaise: number; carriedForwardPaise: number; lostPaise: number; cgLossCarriedForwardPaise: number };
  regime: { claimed: "old" | "new" | null; used: "old" | "new" | null; oldEligible: boolean; reason: string };
  old: RegimeResult | null;
  new: RegimeResult;
  chosen: RegimeResult;
  capsExceeded: { section: string; claimed: number; cap: number }[];
  newRegimeClaims: string[];
  tds: { rows: { tan: string; deductor: string; books: number; form26as: number; diff: number; credit: number }[]; credit: number; total26as: number; totalBooks: number; have26as: boolean };
  ais: { rows: { line: AisLine; outcome: AisOutcome; bookId: string | null; unexplainedPaise: number; note: string }[]; unexplainedPaise: number; questions: number; haveAis: boolean };
  audit: { required: boolean; reason: string };
  itrForm: "ITR-1" | "ITR-2" | "ITR-3" | "ITR-4" | "ITR-5" | "ITR-6";
  advance: { liable: boolean; exempt: boolean; presumptiveOnly: boolean; assessedTaxPaise: number; paidPaise: number; rows: InstalmentRow[]; i234B: number; i234C: number };
  i234A: number;
  fee234F: number;
  netPayablePaise: number;
  missingDocs: string[];
};

// ------------------------------------------------------------------ helpers

export function ageBandOf(dob: string | null, rules: TaxRuleSet): AgeBand {
  if (!dob) return "below60";
  if (dob <= rules.superSeniorBornOnOrBefore) return "superSenior";
  if (dob <= rules.seniorBornOnOrBefore) return "senior";
  return "below60";
}

/** amount ≤ bp% of base, in integers. */
const withinShare = (amount: number, base: number, bp: number) => BigInt(amount) * 10000n <= BigInt(base) * BigInt(bp);

function dueDate139(fy: string, category: "audit" | "non-audit"): string {
  const r = packDueDates(DEFAULT_CALENDAR, "itr", { fy, period: "Annual", category });
  if (!r.ok) throw new Error(`calendar itr: ${r.message}`);
  return r.statutoryDue;
}

function instalmentDates(fy: string): string[] {
  return ["Q1", "Q2", "Q3", "Q4"].map((q) => {
    const r = packDueDates(DEFAULT_CALENDAR, "advance-tax", { fy, period: q, category: "regular" });
    if (!r.ok) throw new Error(`calendar advance-tax: ${r.message}`);
    return r.statutoryDue;
  });
}

export function presumptiveCheck(o: Organiser, rules: TaxRuleSet): TaxAnalysis["presumptive"] {
  const p = o.profile;
  const b = o.business;
  const claimed = p.presumptive;
  const cash = b ? b.cashReceiptsPaise + b.nonAccountPayeeChequePaise : 0;
  if (!claimed || !b) return { claimed, eligible: false, reasons: [], incomePaise: 0, cashSharePaise: cash };
  const r = rules.presumptive;
  const reasons: string[] = [];
  const cashOk = withinShare(cash, b.turnoverPaise, r.cashShareMaxBp);
  if (!["individual", "huf", "firm"].includes(p.status) || p.isLlp) reasons.push(`a ${p.isLlp ? "LLP" : p.status} cannot use s.${claimed}`);
  if (p.residentialStatus === "nonresident") reasons.push(`s.${claimed} is for residents only`);
  if (claimed === "44AD") {
    if (p.businessKind !== "business") reasons.push("s.44AD is for a business, not a profession");
    if (p.commissionOrAgency) reasons.push("commission, brokerage or agency income is excluded from s.44AD");
    if (p.presumptiveLock) reasons.push("within the s.44AD(4) five-year lock after opting out");
    const limit = cashOk ? r.s44ADHigherLimitPaise : r.s44ADLimitPaise;
    if (b.turnoverPaise > limit)
      reasons.push(`turnover ₹${b.turnoverPaise / 100} exceeds the ₹${limit / 100} limit${cashOk ? "" : ` (cash receipts incl. non-account-payee cheques ₹${cash / 100} are more than 5%, so the ₹3 crore limit is not available)`}`);
  } else {
    if (p.businessKind !== "profession" || !p.specifiedProfession) reasons.push("s.44ADA is for a specified profession (s.44AA(1))");
    const limit = cashOk ? r.s44ADAHigherLimitPaise : r.s44ADALimitPaise;
    if (b.turnoverPaise > limit) reasons.push(`gross receipts ₹${b.turnoverPaise / 100} exceed the ₹${limit / 100} limit`);
  }
  const eligible = reasons.length === 0;
  return { claimed, eligible, reasons, incomePaise: eligible ? presumptiveIncome(claimed, b.turnoverPaise, b.digitalReceiptsPaise, rules) : 0, cashSharePaise: cash };
}

function auditCheck(o: Organiser, pres: TaxAnalysis["presumptive"], rules: TaxRuleSet, incomeAboveExemption: boolean): TaxAnalysis["audit"] {
  const p = o.profile;
  const b = o.business;
  if (p.businessKind === "none" || !b) return { required: false, reason: "no business or profession income" };
  if (pres.claimed && pres.eligible) return { required: false, reason: `income offered under s.${pres.claimed} at or above the presumptive rate` };
  const a = rules.audit44AB;
  if (p.presumptiveLock && pres.claimed === "44AD" && incomeAboveExemption) return { required: true, reason: "s.44AB(e) read with s.44AD(4)-(5): opted out within the five-year lock and income exceeds the basic exemption" };
  if (p.businessKind === "profession") {
    return b.turnoverPaise > a.professionLimitPaise
      ? { required: true, reason: `professional receipts above ₹${a.professionLimitPaise / 100} (s.44AB(b))` }
      : { required: false, reason: `professional receipts within ₹${a.professionLimitPaise / 100}` };
  }
  const cash = b.cashReceiptsPaise + b.nonAccountPayeeChequePaise;
  const lowCash = withinShare(cash, b.turnoverPaise, a.cashShareMaxBp) && withinShare(b.cashPaymentsPaise, b.totalPaymentsPaise, a.cashShareMaxBp);
  const limit = lowCash ? a.businessHigherLimitPaise : a.businessLimitPaise;
  return b.turnoverPaise > limit
    ? { required: true, reason: `turnover above ₹${limit / 100}${lowCash ? "" : " (cash receipts or payments above 5%, so the ₹10 crore limit is not available)"} (s.44AB(a))` }
    : { required: false, reason: `turnover within the ₹${limit / 100} limit${lowCash ? " (cash ≤ 5%)" : ""}` };
}

// ------------------------------------------------------------------ income and tax for one regime

type Common = {
  x: TaxExtract;
  rules: TaxRuleSet;
  personal: boolean;
  ageBand: AgeBand;
  resident: boolean;
  businessIncome: number;
  cg: CgResult;
  bfValid: number;
};

function absorb(loss: number, pools: { [k: string]: number }, order: string[]): number {
  for (const k of order) {
    const t = Math.min(loss, Math.max(0, pools[k]));
    pools[k] -= t;
    loss -= t;
  }
  return loss;
}

function regimeResult(c: Common, regime: "old" | "new"): RegimeResult & { bfSetOff: number; currentLoss: number; remainingLoss: number } {
  const { x, rules } = c;
  const o = x.organiser;
  const old = regime === "old" && c.personal;
  const d = rules.deductions;
  const sal = o.salary;
  let salary = 0;
  if (sal && c.personal) {
    const exempt = old ? sal.exemptAllowancesPaise : 0;
    const afterExempt = Math.max(0, sal.grossPaise - exempt);
    const std = Math.min(afterExempt, old ? rules.standardDeduction.oldPaise : rules.standardDeduction.newPaise);
    salary = Math.max(0, afterExempt - std - (old ? sal.professionalTaxPaise : 0));
  }
  const hpLossCap = old ? Math.min(o.houseProperty?.selfOccupiedInterestPaise ?? 0, d.selfOccupiedInterestPaise) : 0;

  const pools: Record<string, number> = {
    salary,
    business: c.businessIncome,
    otherSources: o.otherSources.reduce((s, v) => s + v.amountPaise, 0),
    stcgOther: c.cg.buckets.stcgOther,
    stcg111A: c.cg.buckets.stcg111A,
    ltcg112: c.cg.buckets.ltcg112,
    ltcg112A: c.cg.buckets.ltcg112A,
  };
  // Brought-forward business loss: business income only (s.72).
  let bfSetOff = 0;
  if (pools.business > 0) {
    bfSetOff = Math.min(pools.business, c.bfValid);
    pools.business -= bfSetOff;
  }
  // Current-year business loss: any head except salary (s.71(2A)).
  let currentLoss = 0;
  let remainingLoss = 0;
  if (pools.business < 0) {
    currentLoss = -pools.business;
    pools.business = 0;
    remainingLoss = absorb(currentLoss, pools, ["otherSources", "stcgOther", "stcg111A", "ltcg112", "ltcg112A"]);
  }
  // Self-occupied house-property loss (old regime, capped).
  absorb(hpLossCap, pools, ["salary", "otherSources", "business", "stcgOther", "stcg111A", "ltcg112", "ltcg112A"]);

  const normal = pools.salary + pools.business + pools.otherSources + pools.stcgOther;
  const special = pools.stcg111A + pools.ltcg112 + pools.ltcg112A;
  const grossTotalIncome = normal + special;

  // Chapter VI-A.
  const ded = o.deductions;
  const senior = c.ageBand !== "below60" && o.profile.status === "individual";
  const savings = o.otherSources.filter((s) => s.nature === "savings-interest").reduce((s, v) => s + v.amountPaise, 0);
  const deposits = savings + o.otherSources.filter((s) => s.nature === "deposit-interest").reduce((s, v) => s + v.amountPaise, 0);
  const nps = sal?.employerNpsPaise ?? 0;
  const npsCap = pct(sal?.basicDaPaise ?? 0, old ? d.employerNpsOldBp : d.employerNpsNewBp);
  const lines: { section: string; claimed: number; allowed: number }[] = [];
  if (c.personal) {
    if (old) {
      lines.push(
        { section: "80C", claimed: ded.s80C, allowed: Math.min(ded.s80C, d.s80CPaise) },
        { section: "80CCD(1B)", claimed: ded.s80CCD1B, allowed: Math.min(ded.s80CCD1B, d.s80CCD1BPaise) },
        { section: "80D (self / family)", claimed: ded.s80DSelf, allowed: Math.min(ded.s80DSelf, senior ? d.s80DSelfSeniorPaise : d.s80DSelfPaise) },
        { section: "80D (parents)", claimed: ded.s80DParents, allowed: Math.min(ded.s80DParents, o.profile.parentsSenior ? d.s80DParentsSeniorPaise : d.s80DParentsPaise) },
        { section: "80TTA", claimed: ded.s80TTA, allowed: senior ? 0 : Math.min(ded.s80TTA, d.s80TTAPaise, savings) },
        { section: "80TTB", claimed: ded.s80TTB, allowed: senior && c.resident ? Math.min(ded.s80TTB, d.s80TTBPaise, deposits) : 0 },
        { section: "80E", claimed: ded.s80E, allowed: ded.s80E },
        { section: "80G", claimed: ded.s80G, allowed: ded.s80G },
      );
    }
    lines.push({ section: "80CCD(2)", claimed: nps, allowed: Math.min(nps, npsCap) });
  }
  const capped = lines.reduce((s, l) => s + l.allowed, 0);
  const deductionsAllowed = Math.min(capped, Math.max(0, normal)); // never against special-rate gains
  const totalIncome = roundIncomeTo10(Math.max(0, grossTotalIncome - deductionsAllowed));
  const split = { normal: Math.max(0, totalIncome - special), s111A: pools.stcg111A, s112: pools.ltcg112, s112A: pools.ltcg112A };
  const ctx: TaxContext = {
    entity: o.profile.status,
    regime,
    ageBand: c.ageBand,
    resident: c.resident,
    companyRegime: o.profile.companyRegime,
    companyTurnoverPy2Paise: o.profile.companyTurnoverPy2Paise,
  };
  return {
    regime,
    salary: pools.salary,
    houseProperty: -hpLossCap,
    business: pools.business,
    otherSources: pools.otherSources,
    cg: { stcgOther: pools.stcgOther, stcg111A: pools.stcg111A, ltcg112: pools.ltcg112, ltcg112A: pools.ltcg112A },
    grossTotalIncome,
    deductions: lines,
    deductionsAllowed,
    totalIncome,
    tax: taxOnIncome(split, totalIncome, rules, ctx),
    bfSetOff,
    currentLoss,
    remainingLoss,
  };
}

// ------------------------------------------------------------------ analysis

const cache = new WeakMap<TaxExtract, TaxAnalysis>();

export function analyseTax(x: TaxExtract): TaxAnalysis {
  const hit = cache.get(x);
  if (hit) return hit;
  const a = analyse(x);
  cache.set(x, a);
  return a;
}

function analyse(x: TaxExtract): TaxAnalysis {
  const rs = ruleSetFor(x.fy);
  if (!rs.ok) throw new Error(rs.reason);
  const rules = rs.rules;
  const o = x.organiser;
  const p = o.profile;
  const personal = p.status === "individual" || p.status === "huf";
  const ageBand = p.status === "individual" ? ageBandOf(p.dateOfBirth, rules) : "below60";
  const resident = p.residentialStatus !== "nonresident";
  const fy0 = fyStart(x.fy);

  // Business income.
  const pres = presumptiveCheck(o, rules);
  const msmeRes = msmeDisallowance(x.msme ?? [], rules);
  const b = o.business;
  let businessIncome = 0;
  let msmeApplied = false;
  if (b && p.businessKind !== "none") {
    // Presumptive: the deemed income, or a higher sum the taxpayer declares — never the books profit by default.
    if (pres.claimed && pres.eligible) businessIncome = Math.max(pres.incomePaise, b.declaredIncomePaise);
    else {
      msmeApplied = true;
      businessIncome = b.booksProfitPaise + msmeRes.totalPaise + b.otherDisallowancesPaise;
    }
  }

  // Capital gains and brought-forward losses.
  const cg = capitalGains(x.capitalGains ?? [], rules);
  const ayStart = fy0 + 1;
  const bfInvalid: TaxAnalysis["losses"]["bfInvalid"] = [];
  let bfValid = 0;
  for (const l of x.priorItr?.lossesCarriedForward ?? []) {
    const lossAy = Number(l.ay.slice(0, 4));
    if (!l.returnFiledInTime) bfInvalid.push({ ay: l.ay, amountPaise: l.amountPaise, reason: "the loss year's return was not filed by the s.139(1) due date (s.80)" });
    else if (ayStart - lossAy > rules.lossCarryForwardYears) bfInvalid.push({ ay: l.ay, amountPaise: l.amountPaise, reason: `more than ${rules.lossCarryForwardYears} assessment years old (s.72(3))` });
    else bfValid += l.amountPaise;
  }

  const common: Common = { x, rules, personal, ageBand, resident, businessIncome, cg, bfValid };
  const resNew = regimeResult(common, "new");
  const resOld = personal ? regimeResult(common, "old") : null;

  // Audit applicability needs income vs basic exemption: use the new-regime figure (s.115BAC default).
  const exemptLimit = personal ? basicExemption(slabsFor(rules, { regime: "new", ageBand, resident })) : 0;
  const audit = auditCheck(o, pres, rules, resNew.totalIncome > exemptLimit);
  const dueCategory: "audit" | "non-audit" = p.status === "company" || audit.required || p.partnerInAuditedFirm ? "audit" : "non-audit";
  const due139 = dueDate139(x.fy, dueCategory);
  const belated = p.plannedFilingDate > due139;

  // Regime.
  let regime: TaxAnalysis["regime"];
  if (!personal) regime = { claimed: null, used: null, oldEligible: false, reason: `${p.status}: no regime choice` };
  else {
    const hasBiz = p.businessKind !== "none";
    let reason = "";
    if (hasBiz) {
      if (p.optedBackToNewEarlier) reason = "already withdrew the s.115BAC(6) option once and came back to the new regime; the old regime is no longer available";
      else if (!p.form10IEAFiledOn) reason = "business income: Form 10-IEA not filed";
      else if (p.form10IEAFiledOn > due139) reason = `business income: Form 10-IEA filed ${p.form10IEAFiledOn}, after the due date ${due139}`;
    } else if (belated) reason = `no business income: the old regime is available only in a return filed by the due date ${due139} (s.115BAC(6)(ii))`;
    const oldEligible = reason === "";
    const used = p.regimeClaimed === "old" && oldEligible ? "old" : "new";
    regime = { claimed: p.regimeClaimed, used, oldEligible, reason: oldEligible ? "old regime available" : reason };
  }
  const chosenFull = regime.used === "old" && resOld ? resOld : resNew;

  // Losses carried forward.
  const remainingLoss = chosenFull.remainingLoss;
  const losses = {
    bfValidPaise: bfValid,
    bfInvalid,
    bfSetOffPaise: chosenFull.bfSetOff,
    currentLossPaise: chosenFull.currentLoss,
    // s.80 bars only this year's loss in a belated return; earlier valid losses keep running.
    carriedForwardPaise: (belated ? 0 : remainingLoss) + (bfValid - chosenFull.bfSetOff),
    lostPaise: belated ? remainingLoss : 0,
    cgLossCarriedForwardPaise: belated ? 0 : cg.lossCarriedForwardPaise,
  };

  // Deduction caps and new-regime claims (as claimed by staff).
  const capsExceeded = personal && p.regimeClaimed === "old" && resOld ? resOld.deductions.filter((l) => l.claimed > l.allowed).map((l) => ({ section: l.section, claimed: l.claimed, cap: l.allowed })) : [];
  const ded = o.deductions;
  const newRegimeClaims =
    personal && p.regimeClaimed === "new"
      ? [
          ["80C", ded.s80C],
          ["80CCD(1B)", ded.s80CCD1B],
          ["80D", ded.s80DSelf + ded.s80DParents],
          ["80TTA", ded.s80TTA],
          ["80TTB", ded.s80TTB],
          ["80E", ded.s80E],
          ["80G", ded.s80G],
          ["HRA / exempt allowances", o.salary?.exemptAllowancesPaise ?? 0],
          ["s.24(b) self-occupied interest", o.houseProperty?.selfOccupiedInterestPaise ?? 0],
        ]
          .filter(([, v]) => (v as number) > 0)
          .map(([k]) => k as string)
      : [];

  // TDS: 26AS vs books, per TAN. Credit = lower of the two where both show the TAN.
  const tans = new Map<string, { deductor: string; books: number; form26as: number }>();
  for (const t of o.tdsInBooks) {
    const e = tans.get(t.tan) ?? { deductor: t.deductor, books: 0, form26as: 0 };
    e.books += t.amountPaise;
    tans.set(t.tan, e);
  }
  for (const t of x.form26as ?? []) {
    const e = tans.get(t.tan) ?? { deductor: t.deductor, books: 0, form26as: 0 };
    e.form26as += t.tdsPaise;
    if (!e.deductor) e.deductor = t.deductor;
    tans.set(t.tan, e);
  }
  const have26as = x.form26as !== null;
  const tdsRows = [...tans.entries()]
    .sort(([a], [b2]) => (a < b2 ? -1 : 1))
    .map(([tan, e]) => ({ tan, deductor: e.deductor, books: e.books, form26as: e.form26as, diff: e.form26as - e.books, credit: have26as ? Math.min(e.books, e.form26as) : e.books }));
  const tds = {
    rows: tdsRows,
    credit: tdsRows.reduce((s, r) => s + r.credit, 0),
    total26as: tdsRows.reduce((s, r) => s + r.form26as, 0),
    totalBooks: tdsRows.reduce((s, r) => s + r.books, 0),
    have26as,
  };

  // AIS vs books.
  const haveAis = x.ais !== null;
  const matchOf = new Map(x.aisMatches.map((m) => [m.aisId, m]));
  const incomeLines = (x.ais ?? []).filter((l) => isAisIncome(l.category));
  const perBook = new Map<string, number>();
  for (const l of incomeLines) {
    const m = matchOf.get(l.id);
    if (m?.outcome === "matched" && m.bookId) perBook.set(m.bookId, (perBook.get(m.bookId) ?? 0) + l.amountPaise);
  }
  const bookAmount = new Map(o.otherSources.map((s) => [s.id, s.amountPaise]));
  const excessCounted = new Set<string>();
  const aisRows = incomeLines.map((line) => {
    const m = matchOf.get(line.id) ?? { aisId: line.id, outcome: "unanswered" as const, bookId: null };
    if (m.outcome === "matched" && m.bookId) {
      const excess = Math.max(0, (perBook.get(m.bookId) ?? 0) - (bookAmount.get(m.bookId) ?? 0));
      const first = !excessCounted.has(m.bookId);
      excessCounted.add(m.bookId);
      const unexplained = first ? excess : 0;
      return { line, outcome: m.outcome, bookId: m.bookId, unexplainedPaise: unexplained, note: excess > 0 ? `AIS exceeds books ledger ${m.bookId} by ₹${excess / 100}` : `in books as ${m.bookId}` };
    }
    const note =
      m.outcome === "not_in_books"
        ? "not in the books"
        : m.outcome === "insufficient_evidence"
          ? "reviewer question: the model could not tell which books ledger (if any) holds this income"
          : "reviewer question: no valid match returned";
    return { line, outcome: m.outcome, bookId: null, unexplainedPaise: line.amountPaise, note };
  });
  const ais = {
    rows: aisRows,
    unexplainedPaise: aisRows.reduce((s, r) => s + r.unexplainedPaise, 0),
    questions: aisRows.filter((r) => r.outcome !== "matched" && r.outcome !== "not_in_books").length,
    haveAis,
  };

  // ITR form.
  const rows = cg.rows;
  const onlySmall112A = rows.every((r) => r.bucket === "ltcg112A" && r.gainPaise >= 0) && cg.buckets.ltcg112A <= rules.itr.itr1Ltcg112ALimitPaise;
  const anyLoss = (x.priorItr?.lossesCarriedForward.length ?? 0) > 0 || chosenFull.currentLoss > 0 || cg.lossCarriedForwardPaise > 0;
  const simple = p.residentialStatus === "resident" && chosenFull.totalIncome <= rules.itr.itr1IncomeLimitPaise && !anyLoss && (rows.length === 0 || onlySmall112A);
  const hasBiz = p.businessKind !== "none";
  const presOk = !!pres.claimed && pres.eligible;
  let itrForm: TaxAnalysis["itrForm"];
  if (p.status === "company") itrForm = "ITR-6";
  else if (p.status === "firm") itrForm = !p.isLlp && simple && presOk ? "ITR-4" : "ITR-5";
  else if (!hasBiz) itrForm = p.status === "individual" && simple && !p.isDirector && !p.hasUnlistedShares ? "ITR-1" : "ITR-2";
  else itrForm = simple && presOk && !p.isDirector && !p.hasUnlistedShares ? "ITR-4" : "ITR-3";

  // Advance tax, 234B / 234C, 234A, 234F.
  const taxLiability = chosenFull.tax.total;
  const assessed = Math.max(0, taxLiability - tds.credit);
  const exempt = p.status === "individual" && resident && ageBand !== "below60" && !hasBiz;
  const paid = o.advanceTax.reduce((s, a2) => s + a2.amountPaise, 0);
  const adv = advanceTaxInterest(
    { assessedTaxPaise: assessed, payments: o.advanceTax, instalmentDates: instalmentDates(x.fy), presumptiveOnly: presOk, exempt, aprilFirst: `${fy0 + 1}-04-01`, filingDate: p.plannedFilingDate },
    rules,
  );
  const i234A = interest234A(assessed - adv.paidByMarch, due139, p.plannedFilingDate, rules, addDays(due139, 1));
  const fee234F = lateFee234F(chosenFull.totalIncome, due139, p.plannedFilingDate, rules);
  const netPayablePaise = roundPayableTo10(taxLiability + i234A + adv.i234B + adv.i234C + fee234F - tds.credit - paid);

  // Missing documents.
  const missingDocs: string[] = [];
  if (!have26as) missingDocs.push("Form 26AS (downloaded from TRACES by staff)");
  if (!haveAis) missingDocs.push("Annual Information Statement (AIS / TIS)");
  if (!x.capitalGains && (x.ais ?? []).some((l) => l.category.startsWith("sale-"))) missingDocs.push("Capital gains statement (AIS shows a sale of securities or property)");
  if (!x.msme && hasBiz && !presOk) missingDocs.push("MSME supplier ageing with acceptance and payment dates (s.43B(h))");
  if (!x.priorItr) missingDocs.push("Prior-year ITR acknowledgement and computation");
  if (personal && p.regimeClaimed === "old" && hasBiz && !p.form10IEAFiledOn) missingDocs.push("Form 10-IEA acknowledgement (old regime with business income)");

  const strip = (r: typeof resNew): RegimeResult => {
    const { bfSetOff: _b, currentLoss: _c, remainingLoss: _r, ...rest } = r;
    void _b;
    void _c;
    void _r;
    return rest;
  };
  return {
    rules,
    personal,
    ageBand,
    resident,
    due139,
    dueCategory,
    belated,
    presumptive: pres,
    businessIncome,
    msme: { findings: msmeRes.findings, disallowedPaise: msmeApplied ? msmeRes.totalPaise : 0, applied: msmeApplied },
    cgResult: cg,
    losses,
    regime,
    old: resOld ? strip(resOld) : null,
    new: strip(resNew),
    chosen: strip(chosenFull),
    capsExceeded,
    newRegimeClaims,
    tds,
    ais,
    audit,
    itrForm,
    advance: { liable: adv.liable, exempt, presumptiveOnly: presOk, assessedTaxPaise: assessed, paidPaise: paid, rows: adv.rows, i234B: adv.i234B, i234C: adv.i234C },
    i234A,
    fee234F,
    netPayablePaise,
    missingDocs,
  };
}
