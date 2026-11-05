// Income-tax arithmetic: pure functions over integer paise and basis points (BigInt where a
// product could pass 2^53). Slab tax, special-rate capital gains, basic-exemption shortfall,
// s.87A rebate, surcharge with marginal relief, cess; capital-gains classification and set-off;
// presumptive income; s.43B(h); interest u/s 234A/B/C and fee u/s 234F. No model, no clock.
import { addMonthsClamped, daysBetween, divRoundHalfUp, roundToRupee } from "@/lib/agents/roc/util";
import type { Slab, SurchargeStep, TaxRuleSet } from "./data";
import type { CgRow, MsmeRow } from "./parse";

/** amount × bp / 10,000, rounded half up to the paisa (exact, BigInt). */
export function pct(amountPaise: number, bp: number): number {
  if (amountPaise <= 0 || bp === 0) return 0;
  const n = BigInt(amountPaise) * BigInt(bp);
  const q = n / 10000n;
  const r = n % 10000n;
  return Number(r * 2n >= 10000n ? q + 1n : q);
}

/** s.288A: total income rounded to the nearest ₹10 (₹5 and above rounds up). */
export const roundIncomeTo10 = (paise: number) => divRoundHalfUp(paise, 1000) * 1000;
/** s.288B: amount payable / refundable rounded to the nearest ₹10. */
export const roundPayableTo10 = (paise: number) => divRoundHalfUp(paise, 1000) * 1000;

export function slabTax(incomePaise: number, slabs: Slab[]): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    if (incomePaise <= lower) break;
    const upper = s.uptoPaise === null ? incomePaise : Math.min(incomePaise, s.uptoPaise);
    tax += pct(upper - lower, s.bp);
    if (s.uptoPaise === null) break;
    lower = s.uptoPaise;
  }
  return tax;
}

export const basicExemption = (slabs: Slab[]) => (slabs[0].bp === 0 ? (slabs[0].uptoPaise ?? 0) : 0);

const stepRate = (ti: number, steps: SurchargeStep[]) => steps.filter((s) => ti > s.abovePaise).reduce((r, s) => Math.max(r, s.bp), 0);
const stepAt = (ti: number, steps: SurchargeStep[]) => [...steps].reverse().find((s) => ti > s.abovePaise) ?? null;

// ------------------------------------------------------------------ tax on total income

/** Total income split by rate: normal (slab / flat) and special-rate capital gains. */
export type IncomeSplit = { normal: number; s111A: number; s112: number; s112A: number };
export type Entity = "individual" | "huf" | "firm" | "company";
export type AgeBand = "below60" | "senior" | "superSenior";

export type TaxContext = {
  entity: Entity;
  regime: "old" | "new";
  ageBand: AgeBand;
  resident: boolean;
  companyRegime: "115BAA" | "normal";
  companyTurnoverPy2Paise: number;
};

export type TaxBreakdown = {
  normalTax: number;
  specialTax: number;
  t111A: number;
  t112: number;
  t112A: number;
  exemptionAdjusted: number;
  rebate: number;
  surcharge: number;
  marginalRelief: number;
  cess: number;
  /** Tax + surcharge − relief + cess, rounded to the rupee. */
  total: number;
};

export function slabsFor(rules: TaxRuleSet, ctx: Pick<TaxContext, "regime" | "ageBand" | "resident">): Slab[] {
  if (ctx.regime === "new") return rules.slabs.newRegime;
  if (!ctx.resident || ctx.ageBand === "below60") return rules.slabs.oldBelow60;
  return ctx.ageBand === "senior" ? rules.slabs.oldSenior : rules.slabs.oldSuperSenior;
}

type Core = Omit<TaxBreakdown, "cess" | "total" | "marginalRelief">;

function coreTax(split: IncomeSplit, ti: number, rules: TaxRuleSet, ctx: TaxContext): Core {
  const cg = rules.capitalGains;
  const personal = ctx.entity === "individual" || ctx.entity === "huf";
  let normalTax: number;
  let shortfall = 0;
  if (personal) {
    const slabs = slabsFor(rules, ctx);
    normalTax = slabTax(split.normal, slabs);
    if (ctx.resident) shortfall = Math.max(0, basicExemption(slabs) - split.normal);
  } else if (ctx.entity === "firm") {
    normalTax = pct(split.normal, rules.firm.bp);
  } else {
    const c = rules.company;
    const bp = ctx.companyRegime === "115BAA" ? c.s115BAABp : ctx.companyTurnoverPy2Paise <= c.lowRateTurnoverPaise ? c.lowRateBp : c.normalBp;
    normalTax = pct(split.normal, bp);
  }
  const totalShortfall = shortfall;
  const take = (v: number) => {
    const t = Math.min(shortfall, v);
    shortfall -= t;
    return v - t;
  };
  const r111A = take(split.s111A);
  const r112 = take(split.s112);
  const r112A = take(split.s112A);
  const t111A = pct(r111A, cg.stcg111ABp);
  const t112 = pct(r112, cg.ltcg112Bp);
  const t112A = pct(Math.max(0, r112A - cg.ltcg112ABExemptPaise), cg.ltcg112ABp);
  const specialTax = t111A + t112 + t112A;
  const before = normalTax + specialTax;

  let rebate = 0;
  if (ctx.entity === "individual" && ctx.resident) {
    const r = rules.rebate87A;
    if (ctx.regime === "new") {
      if (ti <= r.newIncomeLimitPaise) rebate = Math.min(before, r.newMaxPaise, normalTax);
      else if (before > ti - r.newIncomeLimitPaise) rebate = Math.min(before - (ti - r.newIncomeLimitPaise), normalTax);
    } else if (ti <= r.oldIncomeLimitPaise) {
      rebate = Math.min(r.oldMaxPaise, Math.max(0, before - t112A));
    }
  }
  const after = before - rebate;

  let surcharge = 0;
  if (personal) {
    const s = rules.surchargeIndividual;
    let rate = stepRate(ti, s.steps);
    if (ctx.regime === "new") rate = Math.min(rate, s.newRegimeCapBp);
    const normalPart = Math.max(0, normalTax - rebate);
    surcharge = pct(normalPart, rate) + pct(after - normalPart, Math.min(rate, s.specialIncomeCapBp));
  } else if (ctx.entity === "firm") {
    surcharge = pct(after, stepRate(ti, rules.firm.surcharge));
  } else if (ctx.companyRegime === "115BAA") {
    surcharge = pct(after, rules.company.s115BAASurchargeBp);
  } else {
    surcharge = pct(after, stepRate(ti, rules.company.surcharge));
  }
  return { normalTax, specialTax, t111A, t112, t112A, exemptionAdjusted: totalShortfall - shortfall, rebate, surcharge };
}

function steps(rules: TaxRuleSet, ctx: TaxContext): SurchargeStep[] {
  if (ctx.entity === "individual" || ctx.entity === "huf") return rules.surchargeIndividual.steps;
  if (ctx.entity === "firm") return rules.firm.surcharge;
  return ctx.companyRegime === "115BAA" ? [] : rules.company.surcharge;
}

/** Tax on total income with marginal relief on surcharge and cess. `ti` is the s.288A-rounded total income. */
export function taxOnIncome(split: IncomeSplit, ti: number, rules: TaxRuleSet, ctx: TaxContext): TaxBreakdown {
  const core = coreTax(split, ti, rules, ctx);
  let marginalRelief = 0;
  const step = stepAt(ti, steps(rules, ctx));
  if (step && core.surcharge > 0) {
    const excess = ti - step.abovePaise;
    // Tax at the threshold: the excess comes off normal income first, then the special incomes.
    let left = excess;
    const cut = (v: number) => {
      const t = Math.min(left, v);
      left -= t;
      return v - t;
    };
    const atSplit = { normal: cut(split.normal), s111A: cut(split.s111A), s112: cut(split.s112), s112A: cut(split.s112A) };
    const at = coreTax(atSplit, step.abovePaise, rules, ctx);
    const payable = core.normalTax + core.specialTax - core.rebate + core.surcharge;
    const cap = at.normalTax + at.specialTax - at.rebate + at.surcharge + excess;
    marginalRelief = Math.max(0, Math.min(core.surcharge, payable - cap));
  }
  const base = core.normalTax + core.specialTax - core.rebate + core.surcharge - marginalRelief;
  const cess = pct(base, rules.cessBp);
  return { ...core, marginalRelief, cess, total: roundToRupee(base + cess) };
}

// ------------------------------------------------------------------ capital gains

export type CgBucket = "stcgOther" | "stcg111A" | "ltcg112" | "ltcg112A";
export type CgResult = {
  rows: (CgRow & { gainPaise: number; bucket: CgBucket })[];
  /** Net of intra-head set-off; never negative. */
  buckets: Record<CgBucket, number>;
  /** Short- and long-term capital loss left after set-off (carried forward only with a timely return). */
  lossCarriedForwardPaise: number;
};

export function classifyGain(row: CgRow, rules: TaxRuleSet): CgBucket {
  const months = row.assetType === "listed-equity" ? rules.capitalGains.equityLongTermMonths : rules.capitalGains.otherLongTermMonths;
  const longTerm = row.soldOn > addMonthsClamped(row.acquiredOn, months);
  if (row.assetType === "listed-equity") return longTerm ? "ltcg112A" : "stcg111A";
  return longTerm ? "ltcg112" : "stcgOther";
}

/** s.70: short-term loss against any gain (slab-rate gains first), long-term loss only against long-term gains. */
export function capitalGains(rows: CgRow[], rules: TaxRuleSet): CgResult {
  const out = rows.map((r) => ({ ...r, gainPaise: r.saleValuePaise - r.costPaise - r.expensesPaise, bucket: classifyGain(r, rules) }));
  const b: Record<CgBucket, number> = { stcgOther: 0, stcg111A: 0, ltcg112: 0, ltcg112A: 0 };
  for (const r of out) b[r.bucket] += r.gainPaise;
  let stLoss = 0;
  let ltLoss = 0;
  for (const k of ["stcgOther", "stcg111A"] as const) {
    if (b[k] < 0) {
      stLoss -= b[k];
      b[k] = 0;
    }
  }
  for (const k of ["ltcg112", "ltcg112A"] as const) {
    if (b[k] < 0) {
      ltLoss -= b[k];
      b[k] = 0;
    }
  }
  const absorb = (loss: number, order: CgBucket[]) => {
    for (const k of order) {
      const t = Math.min(loss, b[k]);
      b[k] -= t;
      loss -= t;
    }
    return loss;
  };
  ltLoss = absorb(ltLoss, ["ltcg112", "ltcg112A"]);
  stLoss = absorb(stLoss, ["stcgOther", "stcg111A", "ltcg112", "ltcg112A"]);
  return { rows: out, buckets: b, lossCarriedForwardPaise: stLoss + ltLoss };
}

// ------------------------------------------------------------------ presumptive and s.43B(h)

/** s.44AD: 6% of banking-channel receipts + 8% of the rest; s.44ADA: 50% of receipts. */
export function presumptiveIncome(kind: "44AD" | "44ADA", turnoverPaise: number, digitalPaise: number, rules: TaxRuleSet): number {
  const p = rules.presumptive;
  if (kind === "44ADA") return pct(turnoverPaise, p.s44ADABp);
  const digital = Math.min(Math.max(0, digitalPaise), turnoverPaise);
  return pct(digital, p.s44ADDigitalBp) + pct(turnoverPaise - digital, p.s44ADOtherBp);
}

export type MsmeFinding = MsmeRow & { allowedDays: number; daysToPay: number | null; disallowed: boolean };

/** s.43B(h): amounts owed to micro / small enterprises at the year end, not paid within the allowed days. */
export function msmeDisallowance(rows: MsmeRow[], rules: TaxRuleSet): { findings: MsmeFinding[]; totalPaise: number } {
  const m = rules.msme43Bh;
  const findings = rows.map((r) => {
    const allowedDays = r.agreementDays === null ? m.noAgreementDays : Math.min(r.agreementDays, m.maxAgreementDays);
    const daysToPay = r.paidOn ? daysBetween(r.acceptanceDate, r.paidOn) : null;
    const inScope = r.category === "micro" || r.category === "small";
    const disallowed = inScope && r.outstandingAtYearEnd && (daysToPay === null || daysToPay > allowedDays);
    return { ...r, allowedDays, daysToPay, disallowed };
  });
  return { findings, totalPaise: findings.filter((f) => f.disallowed).reduce((s, f) => s + f.amountPaise, 0) };
}

// ------------------------------------------------------------------ interest and fee

/** Months "or part of a month" from `start` (inclusive) to `end` (inclusive); 0 when end < start. */
export function monthsOrPart(start: string, end: string): number {
  if (end < start) return 0;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const diff = ey * 12 + em - (sy * 12 + sm);
  return ed >= sd ? diff + 1 : diff;
}

const roundDown = (paise: number, unit: number) => Math.max(0, Math.floor(paise / unit) * unit);

export type AdvanceTaxInput = {
  assessedTaxPaise: number;
  payments: { date: string; amountPaise: number }[];
  instalmentDates: string[]; // 4 dates, 15 Jun … 15 Mar
  presumptiveOnly: boolean;
  exempt: boolean;
  aprilFirst: string; // 1 Apr of the AY
  filingDate: string;
};

export type InstalmentRow = { date: string; requiredBp: number; requiredPaise: number; paidPaise: number; shortfallPaise: number; months: number; interestPaise: number };

/** Interest u/s 234C (instalments) and 234B (advance tax < 90% of assessed tax). */
export function advanceTaxInterest(a: AdvanceTaxInput, rules: TaxRuleSet): { liable: boolean; rows: InstalmentRow[]; i234C: number; i234B: number; paidByMarch: number } {
  const t = rules.advanceTax;
  const paidBy = (d: string) => a.payments.filter((p) => p.date <= d).reduce((s, p) => s + p.amountPaise, 0);
  const marchEnd = a.instalmentDates[3].slice(0, 8) + "31";
  const paidByMarch = paidBy(marchEnd);
  const liable = !a.exempt && a.assessedTaxPaise >= t.minLiabilityPaise;
  const rows: InstalmentRow[] = [];
  let i234C = 0;
  if (liable) {
    a.instalmentDates.forEach((date, i) => {
      if (a.presumptiveOnly && i < 3) return;
      const requiredBp = a.presumptiveOnly ? 10000 : t.instalmentsBp[i];
      const requiredPaise = pct(a.assessedTaxPaise, requiredBp);
      const paid = paidBy(date);
      const relief = !a.presumptiveOnly && t.reliefBp[i] !== null && paid >= pct(a.assessedTaxPaise, t.reliefBp[i] as number);
      const shortfall = relief ? 0 : roundDown(requiredPaise - paid, t.roundDownToPaise);
      const months = t.months234C[i];
      const interest = pct(shortfall * months, t.interestBpPerMonth);
      i234C += interest;
      rows.push({ date, requiredBp, requiredPaise, paidPaise: paid, shortfallPaise: shortfall, months, interestPaise: interest });
    });
  }
  let i234B = 0;
  if (liable && paidByMarch < pct(a.assessedTaxPaise, t.s234BThresholdBp)) {
    const base = roundDown(a.assessedTaxPaise - paidByMarch, t.roundDownToPaise);
    i234B = pct(base * monthsOrPart(a.aprilFirst, a.filingDate), t.interestBpPerMonth);
  }
  return { liable, rows, i234C: roundToRupee(i234C), i234B: roundToRupee(i234B), paidByMarch };
}

/** Interest u/s 234A on tax unpaid at the due date, from the day after the due date to filing. */
export function interest234A(unpaidPaise: number, dueDate: string, filingDate: string, rules: TaxRuleSet, dayAfterDue: string): number {
  if (filingDate <= dueDate || unpaidPaise <= 0) return 0;
  const base = roundDown(unpaidPaise, rules.advanceTax.roundDownToPaise);
  return roundToRupee(pct(base * monthsOrPart(dayAfterDue, filingDate), rules.advanceTax.interestBpPerMonth));
}

export function lateFee234F(totalIncomePaise: number, dueDate: string, filingDate: string, rules: TaxRuleSet): number {
  if (filingDate <= dueDate) return 0;
  const f = rules.lateFee234F;
  return totalIncomePaise <= f.smallIncomeLimitPaise ? f.smallIncomeFeePaise : f.feePaise;
}
