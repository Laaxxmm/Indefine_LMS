// GST Prep computation: GSTR-1 tables, GSTR-3B (3.1 outward, 4 ITC, 6.1 set-off), 2B vs books
// reconciliation, rule 37 reversal, s.50 interest and late-fee estimates. Deterministic integer
// paise over the parsed inputs (GstExtract); the model's classifications only decide WHICH
// documents are blocked / reverse-charge / which HSN a line has, never an amount.
//
// Conventions (documented for the reviewer in the 3B workbook):
// - Credit notes are stored positive; `sign` makes them negative in every total.
// - 3.1(a) = forward-charge outward supplies at a rate > 0 (invoices + debit notes − credit notes);
//   rate-0 lines go to 3.1(c). Outward supplies on which the recipient pays tax (RC = Y) are
//   reported in GSTR-1 but carry no liability here.
// - 3.1(d) / 4(A)(3): inward supplies under reverse charge — marked RCM in the books, or a ledger the
//   model classifies as a notified RCM service (unless a registered supplier lawfully charged tax
//   forward at an allowed rate). Tax = the tax in the books when recorded, else taxable × rate.
// - 4(A)(5) = ITC on purchase documents matched to GSTR-2B with ITC available, at the LOWER of
//   books and 2B per tax head (credit notes: the larger reduction). Books documents missing in 2B
//   are deferred (not claimed); a supplier credit note missing in 2B still reduces ITC.
// - 4(B)(1) = ITC of matched documents in a s.17(5) category; 4(B)(2) = rule 37 reversal (+ any
//   net-negative head of 4(A)(5)). 4(C) = 4(A) − 4(B). 4(D)(2) memo = 2B documents with ITC not available.
// - B2CL: unregistered recipient, inter-state, invoice value > GST_CONFIG.b2clThresholdPaise.
//   Notes to unregistered persons are netted into B2CS (CDNUR is not produced in v1.0.0).
// - Time-barred credit notes (owner-approved 2026-11-05): a credit note dated after the s.34(2)
//   time limit (GST_CONFIG.creditNoteDeadlineMonthDay after the FY of its original invoice) does
//   NOT reduce outward liability: it is left out of 3.1(a)/(c), the GSTR-1 CDNR / B2CS rows and the
//   HSN summary. Rule gst.credit-note-time-limit still blocks and lists each excluded note; the
//   GSTR-3B Notes sheet repeats them. GSTR-1 Table 13 still counts the note (it was issued).
// - ITC held back on abstained bills (owner-approved 2026-11-05): when the model answered
//   insufficient_evidence for a bill's ledger (whether ITC is blocked u/s 17(5), or whether reverse
//   charge applies — an ungrounded answer is recorded the same way, classify.ts), the ITC that bill
//   would add to 4(A)(5) (or 4(A)(3) for a reverse-charge bill) is NOT claimed: it is held back
//   (itc.heldBack, figure itcHeldBackPaise, a memo row in Table 4) and raised by rule
//   gst.model-questions and the client document requests with the amount. A supplier credit note
//   on such a ledger still reduces ITC; RCM liability (3.1(d)) is unchanged.
import { BLOCKED_CATEGORIES, GST_CONFIG, RCM_SERVICES, type BlockedCategory, type RcmService } from "./config";
import { hsnFromText, ledgerKeyOf } from "./classify";
import {
  HEADS,
  addTax,
  dayAfterFyEnd,
  dayOfNextMonth,
  daysBetween,
  fyOfDay,
  minTax,
  mulDivRound,
  periodInfo,
  scaleTax,
  subTax,
  sumTax,
  taxAt,
  taxTotal,
  zeroTax,
  type PeriodInfo,
  type TaxSplit,
} from "./money";
import { matchKey } from "./registers";
import { setOff, type SetoffResult } from "./setoff";
import type { B2bDoc, DocType, GstExtract, LedgerClass, Line, PayableDoc, PurchaseDoc, SalesDoc } from "./types";

export const sign = (t: DocType) => (t === "CRN" ? -1 : 1);

export type HsnSource = "register" | "text" | "model" | null;
export type LineA = Line & { hsnSource: HsnSource };
export type Gstr1Table = "B2B" | "B2CL" | "B2CS" | "CDNR";
export type SalesA = Omit<SalesDoc, "lines"> & {
  posResolved: string;
  interState: boolean;
  registered: boolean;
  table: Gstr1Table;
  lines: LineA[];
  /** Credit note past the s.34(2) time limit: kept out of 3.1 and the GSTR-1 value tables. */
  timeBarred: boolean;
};

export type ReconStatus = "matched" | "value-diff" | "missing-in-2b" | "missing-in-books" | "itc-unavailable";
export type ReconRow = {
  status: ReconStatus;
  gstin: string;
  party: string;
  docType: DocType;
  number: string;
  date: string;
  books: PurchaseA | null;
  twoB: B2bDoc | null;
  booksTaxable: number;
  booksTax: TaxSplit;
  twoBTaxable: number;
  twoBTax: TaxSplit;
  /** Signed ITC taken into 4(A)(5) from this row. */
  claimed: TaxSplit;
  /** ITC this row would have claimed but holds back: the model abstained on the bill's ledger. */
  heldBack: TaxSplit;
};

export type PurchaseA = PurchaseDoc & {
  key: string;
  cls: LedgerClass | null;
  blocked: BlockedCategory | null;
  rcmService: RcmService | null;
  /** Treated as reverse charge in the draft. */
  rcm: boolean;
  /** Classified as a notified RCM service but not marked RCM in the books. */
  rcmUnmarked: boolean;
  /** The model answered insufficient_evidence for this ledger (blocked credit or reverse charge): ITC held back. */
  abstained: boolean;
  /** ITC on this document held back from Table 4(A) (positive; zero unless `abstained`). */
  heldBack: TaxSplit;
  /** Signed RCM tax (3.1(d)) for rcm documents. */
  rcmTax: TaxSplit;
  rcmTaxable: number;
  booksTax: TaxSplit;
  booksTaxable: number;
};

export type Rule37Row = { doc: PayableDoc; days: number; unpaid: number; reversal: TaxSplit };
export type B2csRow = { pos: string; rateBps: number; taxable: number; tax: TaxSplit };
export type HsnRow = { supply: "B2B" | "B2C"; hsn: string; description: string; uqc: string; qty: number; rateBps: number; taxable: number; tax: TaxSplit };
/**
 * GSTR-1 Table 13 row. `cancelled` comes only from an input that lists cancelled documents (none is
 * read in v1.0.0, so it is 0) — a gap in the series is NOT presumed cancelled: it is counted in
 * `gaps` (numbers in `missing`) for staff to explain (cancelled, or an invoice missing from the
 * register). `net` = documents actually in the register; total = net + cancelled + gaps.
 */
export type DocsRow = { nature: string; prefix: string; from: string; to: string; total: number; cancelled: number; gaps: number; net: number; missing: string[] };

export type Analysis = {
  clientState: string;
  periodInfo: PeriodInfo;
  /** Every sales document in the register (time-barred credit notes included). */
  sales: SalesA[];
  /** Credit notes past the s.34(2) time limit, excluded from 3.1 and the GSTR-1 value tables. */
  timeBarredNotes: SalesA[];
  purchases: PurchaseA[];
  gstr1: { b2b: SalesA[]; b2cl: SalesA[]; b2cs: B2csRow[]; cdnr: SalesA[]; hsn: HsnRow[]; docs: DocsRow[] };
  outward: { taxable: number; tax: TaxSplit; nilExempt: number };
  rcm: { taxable: number; tax: TaxSplit };
  recon: ReconRow[];
  itc: {
    a3: TaxSplit;
    a5: TaxSplit;
    available: TaxSplit;
    b1: TaxSplit;
    b2: TaxSplit;
    rule37: TaxSplit;
    net: TaxSplit;
    /** ITC not claimed because the model abstained on the bill (a reviewer question / client request). */
    heldBack: TaxSplit;
    deferred: TaxSplit;
    unavailable2b: TaxSplit;
    notBooked: TaxSplit;
    rule37Rows: Rule37Row[];
  };
  liability: TaxSplit;
  openingCredit: TaxSplit;
  setoff: SetoffResult;
  dueDate: string;
  daysLate: number;
  interest: TaxSplit;
  lateFee: number;
  prevGap: TaxSplit;
};

const pos0 = (t: TaxSplit): TaxSplit => ({ igst: Math.max(0, t.igst), cgst: Math.max(0, t.cgst), sgst: Math.max(0, t.sgst), cess: Math.max(0, t.cess) });
const neg0 = (t: TaxSplit): TaxSplit => ({ igst: Math.max(0, -t.igst), cgst: Math.max(0, -t.cgst), sgst: Math.max(0, -t.sgst), cess: Math.max(0, -t.cess) });
const lineTax = (lines: Line[]) => sumTax(lines.map((l) => l.tax));
const lineTaxable = (lines: Line[]) => lines.reduce((n, l) => n + l.taxable, 0);

export function clientStateOf(x: GstExtract): string {
  return x.profile.gstin.slice(0, 2);
}

// ------------------------------------------------------------------ sales / GSTR-1

function resolveLines(d: SalesDoc, reads: Map<string, string | null>): LineA[] {
  return d.lines.map((l) => {
    if (l.hsn) return { ...l, hsnSource: "register" as const };
    const t = l.description ? hsnFromText(l.description) : null;
    if (t) return { ...l, hsn: t, hsnSource: "text" as const };
    const m = reads.get(l.description) ?? null;
    return m ? { ...l, hsn: m, hsnSource: "model" as const } : { ...l, hsnSource: null };
  });
}

/**
 * s.34(2) time limit of a credit note: `monthDay` (default GST_CONFIG) after the end of the FY of
 * its original invoice. Null for invoices, debit notes and notes without an original invoice date.
 */
export function creditNoteDeadline(d: Pick<SalesDoc, "docType" | "origDate">, monthDay: string = GST_CONFIG.creditNoteDeadlineMonthDay): string | null {
  return d.docType === "CRN" && d.origDate ? dayAfterFyEnd(fyOfDay(d.origDate), monthDay) : null;
}

/** True when the credit note is dated after its s.34(2) time limit (the limit day itself is in time). */
export function isTimeBarredNote(d: Pick<SalesDoc, "docType" | "origDate" | "date">, monthDay: string = GST_CONFIG.creditNoteDeadlineMonthDay): boolean {
  const deadline = creditNoteDeadline(d, monthDay);
  return deadline !== null && d.date > deadline;
}

function analyseSales(x: GstExtract, clientState: string): SalesA[] {
  const reads = new Map(x.hsnReads.map((r) => [r.description, r.hsn]));
  return x.sales.map((d) => {
    const registered = !!d.gstin;
    const posResolved = d.pos ?? (registered ? (d.gstin as string).slice(0, 2) : clientState);
    const interState = posResolved !== clientState;
    let table: Gstr1Table;
    if (d.docType !== "INV") table = registered ? "CDNR" : "B2CS";
    else if (registered) table = "B2B";
    else table = interState && d.value > GST_CONFIG.b2clThresholdPaise ? "B2CL" : "B2CS";
    return { ...d, posResolved, interState, registered, table, lines: resolveLines(d, reads), timeBarred: isTimeBarredNote(d) };
  });
}

/** Lines of one document aggregated by rate (GSTR-1 rows are per document per rate). */
export function byRate(lines: Line[]): { rateBps: number; taxable: number; tax: TaxSplit }[] {
  const m = new Map<number, { rateBps: number; taxable: number; tax: TaxSplit }>();
  for (const l of lines) {
    const r = m.get(l.rateBps) ?? { rateBps: l.rateBps, taxable: 0, tax: zeroTax() };
    r.taxable += l.taxable;
    r.tax = addTax(r.tax, l.tax);
    m.set(l.rateBps, r);
  }
  return [...m.values()].sort((a, b) => a.rateBps - b.rateBps);
}

function b2csRows(sales: SalesA[]): B2csRow[] {
  const m = new Map<string, B2csRow>();
  for (const d of sales.filter((s) => s.table === "B2CS")) {
    const k = sign(d.docType);
    for (const r of byRate(d.lines)) {
      const key = `${d.posResolved}|${r.rateBps}`;
      const row = m.get(key) ?? { pos: d.posResolved, rateBps: r.rateBps, taxable: 0, tax: zeroTax() };
      row.taxable += k * r.taxable;
      row.tax = addTax(row.tax, scaleTax(r.tax, k));
      m.set(key, row);
    }
  }
  return [...m.values()].sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.rateBps - b.rateBps));
}

function hsnRows(sales: SalesA[]): HsnRow[] {
  const m = new Map<string, HsnRow>();
  for (const d of sales) {
    const k = sign(d.docType);
    const supply = d.registered ? "B2B" : "B2C";
    for (const l of d.lines) {
      const hsn = l.hsn ?? "";
      const key = `${supply}|${hsn}|${l.rateBps}`;
      const row = m.get(key) ?? { supply, hsn, description: l.description, uqc: l.uqc ?? "", qty: 0, rateBps: l.rateBps, taxable: 0, tax: zeroTax() };
      row.qty += k * (l.qty ?? 0);
      row.taxable += k * l.taxable;
      row.tax = addTax(row.tax, scaleTax(l.tax, k));
      m.set(key, row);
    }
  }
  return [...m.values()].sort((a, b) => (a.supply + a.hsn + String(a.rateBps).padStart(5, "0") < b.supply + b.hsn + String(b.rateBps).padStart(5, "0") ? -1 : 1));
}

const NATURE: Record<DocType, string> = { INV: "Invoices for outward supply", DBN: "Debit Note", CRN: "Credit Note" };

/** Split "INV/26/0101" into prefix "INV/26/" and number 101 (width kept for display). */
export function seriesOf(n: string): { prefix: string; num: number | null; width: number } {
  const t = n.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^(.*?)(\d+)$/.exec(t);
  return m ? { prefix: m[1], num: Number(m[2]), width: m[2].length } : { prefix: t, num: null, width: 0 };
}

export function docsRows(sales: SalesDoc[]): DocsRow[] {
  const out: DocsRow[] = [];
  for (const t of ["INV", "DBN", "CRN"] as DocType[]) {
    const groups = new Map<string, { nums: Set<number>; width: number; raw: string[] }>();
    for (const d of sales.filter((s) => s.docType === t)) {
      const s = seriesOf(d.number);
      if (s.num === null) {
        out.push({ nature: NATURE[t], prefix: s.prefix, from: d.number.trim(), to: d.number.trim(), total: 1, cancelled: 0, gaps: 0, net: 1, missing: [] });
        continue;
      }
      const g = groups.get(s.prefix) ?? { nums: new Set<number>(), width: s.width, raw: [] };
      g.nums.add(s.num);
      g.width = Math.max(g.width, s.width);
      groups.set(s.prefix, g);
    }
    for (const prefix of [...groups.keys()].sort()) {
      const g = groups.get(prefix)!;
      const nums = [...g.nums].sort((a, b) => a - b);
      const min = nums[0];
      const max = nums[nums.length - 1];
      const fmt = (n: number) => `${prefix}${String(n).padStart(g.width, "0")}`;
      const missing: string[] = [];
      for (let n = min; n <= max && missing.length < 500; n++) if (!g.nums.has(n)) missing.push(fmt(n));
      const total = max - min + 1;
      out.push({ nature: NATURE[t], prefix, from: fmt(min), to: fmt(max), total, cancelled: 0, gaps: total - nums.length, net: nums.length, missing });
    }
  }
  return out;
}

// ------------------------------------------------------------------ purchases / ITC

// insufficient_evidence is neither blocked nor RCM in the figures, and the bill's ITC is held back
// (not claimed); it surfaces as a reviewer question (gst.model-questions) and a client document request.
const isBlocked = (v: string): v is BlockedCategory => Object.prototype.hasOwnProperty.call(BLOCKED_CATEGORIES, v);
const isRcm = (v: string): v is RcmService => Object.prototype.hasOwnProperty.call(RCM_SERVICES, v);
/** The model could not say whether ITC is blocked or whether reverse charge applies (or its answer was ungrounded). */
export const isAbstained = (c: LedgerClass | null): boolean => !!c && (c.blockedCategory === "insufficient_evidence" || c.rcmService === "insufficient_evidence");

function analysePurchases(x: GstExtract, clientState: string): PurchaseA[] {
  const cls = new Map(x.ledgers.map((l) => [l.ledger, l]));
  return x.purchases.map((d) => {
    const key = ledgerKeyOf(d);
    const c = cls.get(key) ?? null;
    const abstained = isAbstained(c);
    const blocked = c && isBlocked(c.blockedCategory) ? c.blockedCategory : null;
    const rcmService = c && isRcm(c.rcmService) ? c.rcmService : null;
    const booksTax = lineTax(d.lines);
    const booksTaxable = lineTaxable(d.lines);
    const forwardOk =
      !!rcmService &&
      !!d.gstin &&
      taxTotal(booksTax) > 0 &&
      d.lines.every((l) => l.taxable === 0 || (RCM_SERVICES[rcmService].forwardChargeRatesBps as readonly number[]).includes(l.rateBps));
    const rcm = d.reverseCharge || (!!rcmService && !forwardOk);
    let rcmTax = zeroTax();
    let rcmTaxable = 0;
    if (rcm) {
      const supplierState = d.gstin ? d.gstin.slice(0, 2) : clientState;
      const inter = supplierState !== (d.pos ?? clientState);
      const k = sign(d.docType);
      for (const l of d.lines) {
        const recorded = taxTotal(l.tax) > 0;
        const rate = l.rateBps > 0 ? l.rateBps : rcmService ? GST_CONFIG.rcmRatesBps[rcmService] : 0;
        rcmTax = addTax(rcmTax, scaleTax(recorded ? l.tax : taxAt(l.taxable, rate, inter), k));
        rcmTaxable += k * l.taxable;
      }
    }
    // A reverse-charge bill's 4(A)(3) ITC is held back here; a forward-charge bill's in reconcile().
    const heldBack = rcm && abstained && d.docType !== "CRN" ? pos0(rcmTax) : zeroTax();
    return { ...d, key, cls: c, blocked, rcmService, rcm, rcmUnmarked: rcm && !d.reverseCharge, abstained, heldBack, rcmTax, rcmTaxable, booksTax, booksTaxable };
  });
}

const reconKey = (gstin: string, t: DocType, n: string) => `${gstin}|${t}|${matchKey(n)}`;

/** True when any of taxable value / IGST / CGST / SGST / cess differs by more than the tolerance. */
export function differs(aTaxable: number, aTax: TaxSplit, bTaxable: number, bTax: TaxSplit, tolerancePaise: number): boolean {
  if (Math.abs(aTaxable - bTaxable) > tolerancePaise) return true;
  return HEADS.some((h) => Math.abs(aTax[h] - bTax[h]) > tolerancePaise);
}

function reconcile(purchases: PurchaseA[], gstr2b: B2bDoc[]): ReconRow[] {
  const twoB = gstr2b.filter((d) => !d.reverseCharge);
  const index = new Map<string, B2bDoc[]>();
  for (const d of twoB) {
    const k = reconKey(d.ctin, d.docType, d.number);
    index.set(k, [...(index.get(k) ?? []), d]);
  }
  const used = new Set<B2bDoc>();
  const rows: ReconRow[] = [];
  for (const p of purchases) {
    if (p.rcm || !p.gstin) continue;
    const k = sign(p.docType);
    const cand = (index.get(reconKey(p.gstin, p.docType, p.number)) ?? []).find((d) => !used.has(d)) ?? null;
    const base = { gstin: p.gstin, party: p.supplier, docType: p.docType, number: p.number, date: p.date, books: p, booksTaxable: p.booksTaxable, booksTax: p.booksTax, heldBack: zeroTax() };
    if (!cand) {
      rows.push({ ...base, status: "missing-in-2b", twoB: null, twoBTaxable: 0, twoBTax: zeroTax(), claimed: k < 0 ? scaleTax(p.booksTax, -1) : zeroTax() });
      continue;
    }
    used.add(cand);
    const both = { ...base, twoB: cand, twoBTaxable: cand.taxable, twoBTax: cand.tax };
    if (!cand.itcAvailable) rows.push({ ...both, status: "itc-unavailable", claimed: zeroTax() });
    else {
      const status: ReconStatus = differs(p.booksTaxable, p.booksTax, cand.taxable, cand.tax, GST_CONFIG.reconTolerancePaise) ? "value-diff" : "matched";
      const claim = minTax(scaleTax(p.booksTax, k), scaleTax(cand.tax, k));
      // Abstained ledger: the ITC is held back, not claimed (a supplier credit note still reduces ITC).
      const heldBack = p.abstained && k > 0 ? pos0(claim) : zeroTax();
      p.heldBack = heldBack; // p was created by analysePurchases for this analysis only
      rows.push({ ...both, status, claimed: subTax(claim, heldBack), heldBack });
    }
  }
  for (const d of twoB.filter((x) => !used.has(x))) {
    rows.push({ status: "missing-in-books", gstin: d.ctin, party: d.tradeName, docType: d.docType, number: d.number, date: d.date, books: null, twoB: d, booksTaxable: 0, booksTax: zeroTax(), twoBTaxable: d.taxable, twoBTax: d.tax, claimed: zeroTax(), heldBack: zeroTax() });
  }
  return rows;
}

export function rule37Rows(payables: PayableDoc[], periodEnd: string, days: number = GST_CONFIG.rule37Days): Rule37Row[] {
  const out: Rule37Row[] = [];
  for (const p of payables) {
    const age = daysBetween(p.date, periodEnd);
    const unpaid = p.value - p.paid;
    if (p.reversedEarlier || unpaid <= 0 || age <= days || p.value <= 0) continue;
    const reversal = { igst: mulDivRound(p.itc.igst, unpaid, p.value), cgst: mulDivRound(p.itc.cgst, unpaid, p.value), sgst: mulDivRound(p.itc.sgst, unpaid, p.value), cess: mulDivRound(p.itc.cess, unpaid, p.value) };
    out.push({ doc: p, days: age, unpaid, reversal });
  }
  return out;
}

// ------------------------------------------------------------------ due date, interest, late fee

export function dueDateOf(x: GstExtract, pi: PeriodInfo, clientState: string): string {
  if (x.profile.dueDate) return x.profile.dueDate;
  if (pi.kind === "monthly") return dayOfNextMonth(pi.end, GST_CONFIG.due.gstr3bMonthlyDay);
  const day = (GST_CONFIG.due.qrmpDay22States as readonly string[]).includes(clientState) ? GST_CONFIG.due.qrmpDay22 : GST_CONFIG.due.qrmpDay24;
  return dayOfNextMonth(pi.end, day);
}

/** s.50(1) interest on cash tax per head for `days` days: round(cash × rate × days / (10000 × daysInYear)). */
export function interestOn(cash: TaxSplit, days: number): TaxSplit {
  if (days <= 0) return zeroTax();
  const k = GST_CONFIG.interestRateBps * days;
  const d = 10_000 * GST_CONFIG.daysInYear;
  return { igst: mulDivRound(cash.igst, k, d), cgst: mulDivRound(cash.cgst, k, d), sgst: mulDivRound(cash.sgst, k, d), cess: mulDivRound(cash.cess, k, d) };
}

export function lateFeeFor(days: number, aatoPaise: number, nil: boolean): number {
  if (days <= 0) return 0;
  const lf = GST_CONFIG.lateFee;
  if (nil) return Math.min(days * lf.nilPerDayPaise, lf.nilCapPaise);
  const cap = lf.caps.find((c) => c.uptoAatoPaise === null || aatoPaise <= c.uptoAatoPaise)!.capPaise;
  return Math.min(days * lf.perDayPaise, cap);
}

// ------------------------------------------------------------------ analysis

const cache = new WeakMap<GstExtract, Analysis>();

/** Full computation; memoised per extract object (rules and deliverables call it again). */
export function analyse(x: GstExtract): Analysis {
  const hit = cache.get(x);
  if (hit) return hit;
  const clientState = clientStateOf(x);
  const pi = periodInfo(x.period, x.fy);
  const sales = analyseSales(x, clientState);
  // Documents the return reports: everything except credit notes past the s.34(2) time limit.
  const reported = sales.filter((s) => !s.timeBarred);

  // 3.1(a) / (c)
  let taxable = 0;
  let nilExempt = 0;
  let outTax = zeroTax();
  for (const d of reported) {
    if (d.reverseCharge) continue;
    const k = sign(d.docType);
    for (const l of d.lines) {
      if (l.rateBps > 0) {
        taxable += k * l.taxable;
        outTax = addTax(outTax, scaleTax(l.tax, k));
      } else nilExempt += k * l.taxable;
    }
  }

  const purchases = analysePurchases(x, clientState);
  const recon = reconcile(purchases, x.gstr2b);
  const rcmDocs = purchases.filter((p) => p.rcm);
  const rcmTax = sumTax(rcmDocs.map((p) => p.rcmTax));
  const rcmTaxable = rcmDocs.reduce((n, p) => n + p.rcmTaxable, 0);

  // 4(A)(3): RCM tax paid is credit, except on a bill whose ledger the model abstained on (held back).
  const a3 = pos0(subTax(rcmTax, sumTax(rcmDocs.map((p) => p.heldBack))));
  const heldBack = sumTax(purchases.map((p) => p.heldBack));
  const claimedAll = sumTax(recon.map((r) => r.claimed));
  const a5 = pos0(claimedAll);
  const blockedClaimed = sumTax(recon.filter((r) => r.books?.blocked).map((r) => r.claimed));
  const blockedRcm = sumTax(rcmDocs.filter((p) => p.blocked).map((p) => p.rcmTax));
  const b1 = pos0(addTax(blockedClaimed, blockedRcm));
  const r37 = rule37Rows(x.payables, pi.end);
  const rule37 = sumTax(r37.map((r) => r.reversal));
  const b2 = addTax(rule37, neg0(claimedAll));
  const available = addTax(a3, a5);
  const netRaw = subTax(subTax(available, b1), b2);
  const net = pos0(netRaw);
  const excessReversal = neg0(netRaw);

  const deferred = pos0(sumTax(recon.filter((r) => r.status === "missing-in-2b" && r.docType !== "CRN").map((r) => r.booksTax)));
  const unavailable2b = sumTax(recon.filter((r) => r.status === "itc-unavailable").map((r) => scaleTax(r.twoBTax, sign(r.docType))));
  const notBooked = sumTax(recon.filter((r) => r.status === "missing-in-books").map((r) => scaleTax(r.twoBTax, sign(r.docType))));

  const liability = addTax(pos0(outTax), excessReversal);
  const openingCredit = x.prev ? pos0(x.prev.closingCredit) : zeroTax();
  const so = setOff(liability, addTax(openingCredit, net), pos0(rcmTax));

  const dueDate = dueDateOf(x, pi, clientState);
  const daysLate = x.profile.expectedFilingDate ? Math.max(0, daysBetween(dueDate, x.profile.expectedFilingDate)) : 0;
  const interest = interestOn(so.cash, daysLate);
  const nil = taxable === 0 && nilExempt === 0 && taxTotal(rcmTax) === 0 && taxTotal(available) === 0;
  const lateFee = lateFeeFor(daysLate, x.profile.aatoPaise, nil);
  const prevGap = x.prev ? subTax(x.prev.gstr1, x.prev.gstr3b) : zeroTax();

  const a: Analysis = {
    clientState,
    periodInfo: pi,
    sales,
    timeBarredNotes: sales.filter((s) => s.timeBarred),
    purchases,
    gstr1: {
      b2b: reported.filter((s) => s.table === "B2B"),
      b2cl: reported.filter((s) => s.table === "B2CL"),
      b2cs: b2csRows(reported),
      cdnr: reported.filter((s) => s.table === "CDNR"),
      hsn: hsnRows(reported),
      docs: docsRows(x.sales),
    },
    outward: { taxable, tax: outTax, nilExempt },
    rcm: { taxable: rcmTaxable, tax: rcmTax },
    recon,
    itc: { a3, a5, available, b1, b2, rule37, net, heldBack, deferred, unavailable2b, notBooked, rule37Rows: r37 },
    liability,
    openingCredit,
    setoff: so,
    dueDate,
    daysLate,
    interest,
    lateFee,
    prevGap,
  };
  cache.set(x, a);
  return a;
}

/** ITC held back on the bills booked to one ledger key, and their numbers (abstained ledgers). */
export function heldBackFor(a: Analysis, ledger: string): { paise: number; numbers: string[] } {
  const docs = a.purchases.filter((p) => p.key === ledger && taxTotal(p.heldBack) > 0);
  return { paise: docs.reduce((n, p) => n + taxTotal(p.heldBack), 0), numbers: docs.map((p) => p.number.trim()) };
}

const count = (rows: ReconRow[], s: ReconStatus) => rows.filter((r) => r.status === s).length;
const docTaxable = (d: SalesA) => d.lines.reduce((n, l) => n + l.taxable, 0);

/** Integer figures for the run (amounts in paise). Compared exactly by the accuracy harness. */
export function computeFigures(x: GstExtract): Record<string, number> {
  const a = analyse(x);
  const so = a.setoff;
  return {
    salesDocCount: a.sales.length,
    purchaseDocCount: a.purchases.length,
    outwardTaxablePaise: a.outward.taxable,
    outwardIgstPaise: a.outward.tax.igst,
    outwardCgstPaise: a.outward.tax.cgst,
    outwardSgstPaise: a.outward.tax.sgst,
    outwardCessPaise: a.outward.tax.cess,
    outwardTaxPaise: taxTotal(a.outward.tax),
    nilExemptPaise: a.outward.nilExempt,
    rcmTaxablePaise: a.rcm.taxable,
    rcmTaxPaise: taxTotal(a.rcm.tax),
    itcAvailablePaise: taxTotal(a.itc.available),
    itcBlockedPaise: taxTotal(a.itc.b1),
    itcOtherReversalPaise: taxTotal(a.itc.b2),
    itcRule37Paise: taxTotal(a.itc.rule37),
    itcNetPaise: taxTotal(a.itc.net),
    itcHeldBackPaise: taxTotal(a.itc.heldBack),
    itcDeferredPaise: taxTotal(a.itc.deferred),
    itcUnavailable2bPaise: taxTotal(a.itc.unavailable2b),
    itcNotBookedPaise: taxTotal(a.itc.notBooked),
    cashIgstPaise: so.cash.igst,
    cashCgstPaise: so.cash.cgst,
    cashSgstPaise: so.cash.sgst,
    cashCessPaise: so.cash.cess,
    cashTaxPaise: taxTotal(so.cash),
    creditUtilisedPaise: so.creditUtilised,
    closingCreditPaise: taxTotal(so.closingCredit),
    daysLate: a.daysLate,
    interestPaise: taxTotal(a.interest),
    lateFeePaise: a.lateFee,
    b2bInvoiceCount: a.gstr1.b2b.length,
    b2bTaxablePaise: a.gstr1.b2b.reduce((n, d) => n + docTaxable(d), 0),
    b2clInvoiceCount: a.gstr1.b2cl.length,
    b2clTaxablePaise: a.gstr1.b2cl.reduce((n, d) => n + docTaxable(d), 0),
    b2csTaxablePaise: a.gstr1.b2cs.reduce((n, r) => n + r.taxable, 0),
    cdnrNoteCount: a.gstr1.cdnr.length,
    cdnrNetTaxablePaise: a.gstr1.cdnr.reduce((n, d) => n + sign(d.docType) * docTaxable(d), 0),
    hsnRowCount: a.gstr1.hsn.length,
    docsIssuedCount: a.gstr1.docs.reduce((n, r) => n + r.total, 0),
    docsCancelledCount: a.gstr1.docs.reduce((n, r) => n + r.cancelled, 0),
    docsGapCount: a.gstr1.docs.reduce((n, r) => n + r.gaps, 0),
    reconMatchedCount: count(a.recon, "matched"),
    reconValueDiffCount: count(a.recon, "value-diff"),
    reconMissingIn2bCount: count(a.recon, "missing-in-2b"),
    reconMissingInBooksCount: count(a.recon, "missing-in-books"),
    reconItcUnavailableCount: count(a.recon, "itc-unavailable"),
    prevLiabilityGapPaise: taxTotal(pos0(a.prevGap)),
  };
}
