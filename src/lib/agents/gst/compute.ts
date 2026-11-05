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
import { BLOCKED_CATEGORIES, GST_CONFIG, RCM_SERVICES, type BlockedCategory, type RcmService } from "./config";
import { hsnFromText, ledgerKeyOf } from "./classify";
import {
  HEADS,
  addTax,
  dayOfNextMonth,
  daysBetween,
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
export type SalesA = Omit<SalesDoc, "lines"> & { posResolved: string; interState: boolean; registered: boolean; table: Gstr1Table; lines: LineA[] };

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
  /** Signed RCM tax (3.1(d)) for rcm documents. */
  rcmTax: TaxSplit;
  rcmTaxable: number;
  booksTax: TaxSplit;
  booksTaxable: number;
};

export type Rule37Row = { doc: PayableDoc; days: number; unpaid: number; reversal: TaxSplit };
export type B2csRow = { pos: string; rateBps: number; taxable: number; tax: TaxSplit };
export type HsnRow = { supply: "B2B" | "B2C"; hsn: string; description: string; uqc: string; qty: number; rateBps: number; taxable: number; tax: TaxSplit };
export type DocsRow = { nature: string; prefix: string; from: string; to: string; total: number; cancelled: number; net: number; missing: string[] };

export type Analysis = {
  clientState: string;
  periodInfo: PeriodInfo;
  sales: SalesA[];
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
    return { ...d, posResolved, interState, registered, table, lines: resolveLines(d, reads) };
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
        out.push({ nature: NATURE[t], prefix: s.prefix, from: d.number.trim(), to: d.number.trim(), total: 1, cancelled: 0, net: 1, missing: [] });
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
      out.push({ nature: NATURE[t], prefix, from: fmt(min), to: fmt(max), total, cancelled: total - nums.length, net: nums.length, missing });
    }
  }
  return out;
}

// ------------------------------------------------------------------ purchases / ITC

// insufficient_evidence is neither blocked nor RCM in the figures; it surfaces as a reviewer question (gst.model-questions).
const isBlocked = (v: string): v is BlockedCategory => Object.prototype.hasOwnProperty.call(BLOCKED_CATEGORIES, v);
const isRcm = (v: string): v is RcmService => Object.prototype.hasOwnProperty.call(RCM_SERVICES, v);

function analysePurchases(x: GstExtract, clientState: string): PurchaseA[] {
  const cls = new Map(x.ledgers.map((l) => [l.ledger, l]));
  return x.purchases.map((d) => {
    const key = ledgerKeyOf(d);
    const c = cls.get(key) ?? null;
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
    return { ...d, key, cls: c, blocked, rcmService, rcm, rcmUnmarked: rcm && !d.reverseCharge, rcmTax, rcmTaxable, booksTax, booksTaxable };
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
    const base = { gstin: p.gstin, party: p.supplier, docType: p.docType, number: p.number, date: p.date, books: p, booksTaxable: p.booksTaxable, booksTax: p.booksTax };
    if (!cand) {
      rows.push({ ...base, status: "missing-in-2b", twoB: null, twoBTaxable: 0, twoBTax: zeroTax(), claimed: k < 0 ? scaleTax(p.booksTax, -1) : zeroTax() });
      continue;
    }
    used.add(cand);
    const both = { ...base, twoB: cand, twoBTaxable: cand.taxable, twoBTax: cand.tax };
    if (!cand.itcAvailable) rows.push({ ...both, status: "itc-unavailable", claimed: zeroTax() });
    else {
      const status: ReconStatus = differs(p.booksTaxable, p.booksTax, cand.taxable, cand.tax, GST_CONFIG.reconTolerancePaise) ? "value-diff" : "matched";
      rows.push({ ...both, status, claimed: minTax(scaleTax(p.booksTax, k), scaleTax(cand.tax, k)) });
    }
  }
  for (const d of twoB.filter((x) => !used.has(x))) {
    rows.push({ status: "missing-in-books", gstin: d.ctin, party: d.tradeName, docType: d.docType, number: d.number, date: d.date, books: null, twoB: d, booksTaxable: 0, booksTax: zeroTax(), twoBTaxable: d.taxable, twoBTax: d.tax, claimed: zeroTax() });
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

  // 3.1(a) / (c)
  let taxable = 0;
  let nilExempt = 0;
  let outTax = zeroTax();
  for (const d of sales) {
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

  const a3 = pos0(rcmTax);
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
    purchases,
    gstr1: {
      b2b: sales.filter((s) => s.table === "B2B"),
      b2cl: sales.filter((s) => s.table === "B2CL"),
      b2cs: b2csRows(sales),
      cdnr: sales.filter((s) => s.table === "CDNR"),
      hsn: hsnRows(sales),
      docs: docsRows(x.sales),
    },
    outward: { taxable, tax: outTax, nilExempt },
    rcm: { taxable: rcmTaxable, tax: rcmTax },
    recon,
    itc: { a3, a5, available, b1, b2, rule37, net, deferred, unavailable2b, notBooked, rule37Rows: r37 },
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
    reconMatchedCount: count(a.recon, "matched"),
    reconValueDiffCount: count(a.recon, "value-diff"),
    reconMissingIn2bCount: count(a.recon, "missing-in-2b"),
    reconMissingInBooksCount: count(a.recon, "missing-in-books"),
    reconItcUnavailableCount: count(a.recon, "itc-unavailable"),
    prevLiabilityGapPaise: taxTotal(pos0(a.prevGap)),
  };
}
