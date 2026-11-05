// GST Prep deliverables (fixed layouts; every sheet gets the framework header block and the
// "Draft — prepared for human review; not for filing" label). Values come from analyse(); the
// sheets only lay them out. Nothing here is uploaded anywhere but the job's Working folder by
// the runner, and nothing is sent to the client: the document-request list is a draft for staff.
import type { ChecklistResultItem } from "@/lib/agents/core/checklist";
import type { DeliverableContext, DeliverableDraft } from "@/lib/agents/core/runner";
import type { ColumnSpec, RowSpec, SheetSpec } from "@/lib/agents/core/templates";
import { GST_VERIFY_NOTES } from "./config";
import { analyse, byRate, sign, type Analysis, type SalesA } from "./compute";
import { stateName } from "./config";
import { HEADS, rupees, taxTotal, type TaxSplit } from "./money";
import type { GstExtract, GstInput } from "./types";

export const DELIVERABLE_TITLES = {
  gstr1: "GSTR-1 draft",
  gstr3b: "GSTR-3B computation",
  recon: "2B reconciliation",
  exceptions: "Exceptions",
  requests: "Client document requests",
} as const;

const c = (key: string, header: string, type?: ColumnSpec["type"], width?: number): ColumnSpec => ({ key, header, type, width });
const TAX_COLS = [c("igst", "IGST", "inr"), c("cgst", "CGST", "inr"), c("sgst", "SGST", "inr"), c("cess", "Cess", "inr")];
const taxCells = (t: TaxSplit, k = 1): RowSpec => ({ igst: rupees(k * t.igst), cgst: rupees(k * t.cgst), sgst: rupees(k * t.sgst), cess: rupees(k * t.cess) });
const rate = (bps: number) => bps / 10_000;
const yn = (b: boolean) => (b ? "Y" : "N");

// ------------------------------------------------------------------ GSTR-1

export const GSTR1_COLUMNS = {
  B2B: [c("gstin", "GSTIN/UIN of Recipient", "text", 18), c("name", "Receiver Name", "text", 28), c("number", "Invoice Number"), c("date", "Invoice Date", "date"), c("value", "Invoice Value", "inr"), c("pos", "Place Of Supply", "text", 20), c("rc", "Reverse Charge"), c("type", "Invoice Type"), c("rate", "Rate", "percent"), c("taxable", "Taxable Value", "inr"), ...TAX_COLS, c("irn", "IRN", "text", 30)],
  B2CL: [c("number", "Invoice Number"), c("date", "Invoice Date", "date"), c("value", "Invoice Value", "inr"), c("pos", "Place Of Supply", "text", 20), c("rate", "Rate", "percent"), c("taxable", "Taxable Value", "inr"), c("igst", "IGST", "inr"), c("cess", "Cess", "inr")],
  B2CS: [c("type", "Type"), c("pos", "Place Of Supply", "text", 20), c("rate", "Rate", "percent"), c("taxable", "Taxable Value", "inr"), ...TAX_COLS],
  CDNR: [
    c("gstin", "GSTIN/UIN of Recipient", "text", 18),
    c("name", "Receiver Name", "text", 28),
    c("number", "Note Number"),
    c("date", "Note Date", "date"),
    c("type", "Note Type"),
    c("pos", "Place Of Supply", "text", 20),
    c("rc", "Reverse Charge"),
    c("value", "Note Value", "inr"),
    c("rate", "Rate", "percent"),
    c("taxable", "Taxable Value", "inr"),
    ...TAX_COLS,
    c("orig", "Original Invoice Number"),
    c("origDate", "Original Invoice Date", "date"),
  ],
  HSN: [c("supply", "Supply Type"), c("hsn", "HSN"), c("description", "Description", "text", 30), c("uqc", "UQC"), c("qty", "Total Quantity"), c("rate", "Rate", "percent"), c("taxable", "Taxable Value", "inr"), ...TAX_COLS, c("total", "Total Value", "inr")],
  Docs: [c("nature", "Nature of Document", "text", 30), c("from", "Sr. No. From"), c("to", "Sr. No. To"), c("total", "Total Number", "integer"), c("cancelled", "Cancelled", "integer"), c("net", "Net Issued", "integer")],
} as const;

function docRateRows(d: SalesA, extra: (r: { rateBps: number; taxable: number; tax: TaxSplit }) => RowSpec): RowSpec[] {
  return byRate(d.lines).map((r) => ({ rate: rate(r.rateBps), taxable: rupees(r.taxable), ...taxCells(r.tax), ...extra(r) }));
}

function gstr1Sheets(a: Analysis): SheetSpec[] {
  const g = a.gstr1;
  return [
    {
      name: "B2B",
      columns: [...GSTR1_COLUMNS.B2B],
      totals: true,
      rows: g.b2b.flatMap((d) => docRateRows(d, () => ({ gstin: d.gstin, name: d.party, number: d.number.trim(), date: d.date, value: rupees(d.value), pos: stateName(d.posResolved), rc: yn(d.reverseCharge), type: "Regular B2B", irn: d.irn ?? "" }))),
    },
    { name: "B2CL", columns: [...GSTR1_COLUMNS.B2CL], totals: true, rows: g.b2cl.flatMap((d) => docRateRows(d, () => ({ number: d.number.trim(), date: d.date, value: rupees(d.value), pos: stateName(d.posResolved) }))) },
    { name: "B2CS", columns: [...GSTR1_COLUMNS.B2CS], totals: true, rows: g.b2cs.map((r) => ({ type: "OE", pos: stateName(r.pos), rate: rate(r.rateBps), taxable: rupees(r.taxable), ...taxCells(r.tax) })) },
    {
      name: "CDNR",
      columns: [...GSTR1_COLUMNS.CDNR],
      totals: true,
      rows: g.cdnr.flatMap((d) =>
        docRateRows(d, () => ({
          gstin: d.gstin,
          name: d.party,
          number: d.number.trim(),
          date: d.date,
          type: d.docType === "CRN" ? "C" : "D",
          pos: stateName(d.posResolved),
          rc: yn(d.reverseCharge),
          value: rupees(d.value),
          orig: d.origNumber ?? "",
          origDate: d.origDate ?? "",
        })),
      ),
    },
    {
      name: "HSN",
      columns: [...GSTR1_COLUMNS.HSN],
      totals: true,
      rows: g.hsn.map((r) => ({ supply: r.supply, hsn: r.hsn || "(missing)", description: r.description, uqc: r.uqc, qty: r.qty ? String(r.qty) : "", rate: rate(r.rateBps), taxable: rupees(r.taxable), ...taxCells(r.tax), total: rupees(r.taxable + taxTotal(r.tax)) })),
    },
    { name: "Docs", columns: [...GSTR1_COLUMNS.Docs], rows: g.docs.map((r) => ({ nature: r.nature, from: r.from, to: r.to, total: r.total, cancelled: r.cancelled, net: r.net })) },
  ];
}

// ------------------------------------------------------------------ GSTR-3B

export const GSTR3B_COLUMNS = {
  outward: [c("nature", "Nature of supplies", "text", 52), c("taxable", "Taxable Value", "inr"), ...TAX_COLS],
  itc: [c("details", "Details", "text", 60), ...TAX_COLS],
  payment: [
    c("head", "Tax head", "text", 14),
    c("payable", "Tax payable", "inr"),
    c("viaIgst", "Paid through IGST credit", "inr"),
    c("viaCgst", "Paid through CGST credit", "inr"),
    c("viaSgst", "Paid through SGST credit", "inr"),
    c("viaCess", "Paid through cess credit", "inr"),
    c("cash", "Tax paid in cash", "inr"),
    c("interest", "Interest", "inr"),
    c("fee", "Late fee", "inr"),
  ],
  interest: [c("item", "Item", "text", 40), c("detail", "Detail", "text", 30), c("amount", "Amount", "inr")],
  notes: [c("topic", "Topic", "text", 28), c("note", "Note", "text", 110)],
} as const;

const zero = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

function gstr3bSheets(a: Analysis, x: GstExtract): SheetSpec[] {
  const so = a.setoff;
  const feeHalf = a.lateFee / 2;
  const payment = HEADS.map((h) => ({
    head: h.toUpperCase(),
    payable: rupees(so.liability[h] + so.rcm[h]),
    viaIgst: rupees(so.used.igst[h]),
    viaCgst: rupees(so.used.cgst[h]),
    viaSgst: rupees(so.used.sgst[h]),
    viaCess: rupees(so.used.cess[h]),
    cash: rupees(so.cash[h]),
    interest: rupees(a.interest[h]),
    fee: h === "cgst" || h === "sgst" ? rupees(feeHalf) : 0,
  }));
  return [
    {
      name: "3.1 Outward",
      columns: [...GSTR3B_COLUMNS.outward],
      rows: [
        { nature: "(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", taxable: rupees(a.outward.taxable), ...taxCells(a.outward.tax) },
        { nature: "(b) Outward taxable supplies (zero rated)", taxable: 0, ...taxCells(zero) },
        { nature: "(c) Other outward supplies (nil rated, exempted)", taxable: rupees(a.outward.nilExempt), ...taxCells(zero) },
        { nature: "(d) Inward supplies (liable to reverse charge)", taxable: rupees(a.rcm.taxable), ...taxCells(a.rcm.tax) },
        { nature: "(e) Non-GST outward supplies", taxable: 0, ...taxCells(zero) },
      ],
    },
    {
      name: "4 ITC",
      columns: [...GSTR3B_COLUMNS.itc],
      rows: [
        { details: "(A)(1) Import of goods", ...taxCells(zero) },
        { details: "(A)(2) Import of services", ...taxCells(zero) },
        { details: "(A)(3) Inward supplies liable to reverse charge", ...taxCells(a.itc.a3) },
        { details: "(A)(4) Inward supplies from ISD", ...taxCells(zero) },
        { details: "(A)(5) All other ITC (2B matched to books, lower of the two)", ...taxCells(a.itc.a5) },
        { details: "(B)(1) Reversed: rules 38, 42, 43 and s.17(5)", ...taxCells(a.itc.b1) },
        { details: "(B)(2) Reversed: others (rule 37 and net credit notes)", ...taxCells(a.itc.b2) },
        { details: "(C) Net ITC available (A) − (B)", ...taxCells(a.itc.net) },
        { details: "(D)(1) ITC reclaimed", ...taxCells(zero) },
        { details: "(D)(2) Ineligible ITC (GSTR-2B: ITC not available)", ...taxCells(a.itc.unavailable2b) },
        { details: "Memo: opening balance in the electronic credit ledger", ...taxCells(a.openingCredit) },
        { details: "Memo: ITC deferred (in books, not in GSTR-2B)", ...taxCells(a.itc.deferred) },
        { details: "Memo: ITC in GSTR-2B not in books (not claimed)", ...taxCells(a.itc.notBooked) },
      ],
    },
    { name: "6.1 Payment", columns: [...GSTR3B_COLUMNS.payment], totals: true, rows: payment },
    {
      name: "Interest and fees",
      columns: [...GSTR3B_COLUMNS.interest],
      rows: [
        { item: "GSTR-3B due date", detail: a.dueDate },
        { item: "Expected filing date", detail: x.profile.expectedFilingDate ?? "on or before the due date" },
        { item: "Days late", detail: String(a.daysLate) },
        ...HEADS.map((h) => ({ item: `Interest u/s 50 on cash ${h.toUpperCase()} (estimate)`, detail: "18% p.a., cash portion", amount: rupees(a.interest[h]) })),
        { item: "Late fee u/s 47 (estimate, CGST + SGST)", detail: "", amount: rupees(a.lateFee) },
        { item: "Credit carried forward after set-off", detail: "", amount: rupees(taxTotal(so.closingCredit)) },
      ],
    },
    {
      name: "Notes",
      columns: [...GSTR3B_COLUMNS.notes],
      rows: [
        { topic: "Set-off order", note: GST_VERIFY_NOTES.find((n) => n.key === "setoffOrder")!.value + ". Reverse-charge tax is paid in cash. IGST credit left after IGST is applied first to the part of CGST/SGST their own credit cannot cover, then CGST, then SGST." },
        { topic: "ITC basis", note: "Table 4(A)(5) is ITC on documents present in both the purchase register and GSTR-2B (ITC available), at the lower of the two per tax head. Documents not in 2B are deferred, not claimed." },
        { topic: "Interest and late fee", note: "Estimates only, computed from the expected filing date in profile.json. s.50(3) interest on ITC wrongly availed and utilised is not estimated." },
        { topic: "Not covered in v1.0.0", note: "Exports/SEZ (3.1(b)), imports, ISD, amendments (B2BA/CDNRA), CDNUR, GSTR-2B ISD/IMPG sections, e-way bills, 30-day IRN limit." },
        { topic: "Status", note: "Draft prepared for human review. Firm OS never files a return or pays tax; staff file on the government portal after partner approval." },
      ],
    },
  ];
}

// ------------------------------------------------------------------ 2B reconciliation

export const RECON_COLUMNS = {
  summary: [c("status", "Status", "text", 22), c("docs", "Documents", "integer"), c("booksTax", "Tax as per books", "inr"), c("twoBTax", "Tax as per 2B", "inr"), c("claimed", "ITC claimed", "inr")],
  rows: [
    c("status", "Status", "text", 18),
    c("gstin", "Supplier GSTIN", "text", 18),
    c("party", "Supplier", "text", 26),
    c("docType", "Doc Type"),
    c("number", "Document Number"),
    c("date", "Date", "date"),
    c("bTaxable", "Books Taxable", "inr"),
    c("bIgst", "Books IGST", "inr"),
    c("bCgst", "Books CGST", "inr"),
    c("bSgst", "Books SGST", "inr"),
    c("bCess", "Books Cess", "inr"),
    c("tTaxable", "2B Taxable", "inr"),
    c("tIgst", "2B IGST", "inr"),
    c("tCgst", "2B CGST", "inr"),
    c("tSgst", "2B SGST", "inr"),
    c("tCess", "2B Cess", "inr"),
    c("claimed", "ITC Claimed", "inr"),
    c("bLoc", "Books location", "text", 26),
    c("tLoc", "2B location", "text", 26),
  ],
  rule37: [c("supplier", "Supplier", "text", 26), c("gstin", "GSTIN", "text", 18), c("number", "Invoice Number"), c("date", "Invoice Date", "date"), c("days", "Days to period end", "integer"), c("unpaid", "Unpaid", "inr"), ...TAX_COLS, c("loc", "Location", "text", 26)],
} as const;

const STATUSES = ["matched", "value-diff", "missing-in-2b", "missing-in-books", "itc-unavailable"] as const;

function reconSheets(a: Analysis): SheetSpec[] {
  return [
    {
      name: "Summary",
      columns: [...RECON_COLUMNS.summary],
      totals: true,
      rows: STATUSES.map((s) => {
        const rows = a.recon.filter((r) => r.status === s);
        return {
          status: s,
          docs: rows.length,
          booksTax: rupees(rows.reduce((n, r) => n + sign(r.docType) * taxTotal(r.booksTax), 0)),
          twoBTax: rupees(rows.reduce((n, r) => n + sign(r.docType) * taxTotal(r.twoBTax), 0)),
          claimed: rupees(rows.reduce((n, r) => n + taxTotal(r.claimed), 0)),
        };
      }),
    },
    {
      name: "Reconciliation",
      columns: [...RECON_COLUMNS.rows],
      rows: a.recon.map((r) => ({
        status: r.status,
        gstin: r.gstin,
        party: r.party,
        docType: r.docType,
        number: r.number.trim(),
        date: r.date,
        bTaxable: rupees(r.booksTaxable),
        bIgst: rupees(r.booksTax.igst),
        bCgst: rupees(r.booksTax.cgst),
        bSgst: rupees(r.booksTax.sgst),
        bCess: rupees(r.booksTax.cess),
        tTaxable: rupees(r.twoBTaxable),
        tIgst: rupees(r.twoBTax.igst),
        tCgst: rupees(r.twoBTax.cgst),
        tSgst: rupees(r.twoBTax.sgst),
        tCess: rupees(r.twoBTax.cess),
        claimed: rupees(taxTotal(r.claimed)),
        bLoc: r.books?.loc ?? "",
        tLoc: r.twoB?.loc ?? "",
      })),
    },
    {
      name: "Rule 37",
      columns: [...RECON_COLUMNS.rule37],
      totals: true,
      rows: a.itc.rule37Rows.map((r) => ({ supplier: r.doc.supplier, gstin: r.doc.gstin ?? "", number: r.doc.number, date: r.doc.date, days: r.days, unpaid: rupees(r.unpaid), ...taxCells(r.reversal), loc: r.doc.loc })),
    },
  ];
}

// ------------------------------------------------------------------ exceptions

export const EXCEPTION_COLUMNS = [c("severity", "Severity"), c("rule", "Rule", "text", 26), c("title", "Check", "text", 36), c("status", "Status"), c("message", "Finding", "text", 70), c("quote", "Evidence", "text", 36), c("location", "Location", "text", 30)];
const SEV_ORDER = { block: 0, warn: 1, info: 2 } as const;

function exceptionRows(results: ChecklistResultItem[], notes: string[]): RowSpec[] {
  const items = results.filter((r) => r.status === "fail" || r.flags.length).sort((p, q) => SEV_ORDER[p.severity] - SEV_ORDER[q.severity]);
  return [
    ...items.map((r) => ({ severity: r.severity, rule: r.ruleId, title: r.title, status: r.flags.length ? `${r.status} (${r.flags.join(", ")})` : r.status, message: r.message, quote: r.evidence?.quote ?? "", location: r.evidence?.location ?? "" })),
    ...notes.map((n) => ({ severity: "info", rule: "input", title: "Input note", status: "note", message: n, quote: "", location: "" })),
  ];
}

// ------------------------------------------------------------------ client document requests

export type DocRequest = { item: string; reason: string; ref: string };

export function documentRequests(a: Analysis, x: GstExtract): DocRequest[] {
  const out: DocRequest[] = [];
  for (const r of a.recon) {
    if (r.status === "missing-in-books") out.push({ item: `Purchase document ${r.number.trim()} dated ${r.date} from ${r.party || r.gstin}`, reason: "Appears in GSTR-2B but not in the purchase register", ref: r.twoB!.loc });
    if (r.status === "missing-in-2b") out.push({ item: `Ask ${r.party || r.gstin} to report ${r.number.trim()} dated ${r.date} in their GSTR-1/IFF`, reason: "In the books but not in GSTR-2B; ITC deferred", ref: r.books!.loc });
    if (r.status === "value-diff") out.push({ item: `Copy of ${r.number.trim()} from ${r.party || r.gstin}`, reason: "Value or tax differs from GSTR-2B", ref: r.books!.loc });
  }
  for (const p of a.purchases) {
    if (p.rcmUnmarked) out.push({ item: `Engagement/fee details and payment date for "${p.key}" (${p.number})`, reason: "Reverse charge applies; self-invoice needed", ref: p.loc });
    if (p.blocked) out.push({ item: `Purpose/use of "${p.key}" (${p.number})`, reason: "To confirm whether ITC is blocked u/s 17(5)", ref: p.loc });
  }
  for (const r of a.itc.rule37Rows) out.push({ item: `Payment proof for ${r.doc.number} dated ${r.doc.date} (${r.doc.supplier})`, reason: "Unpaid beyond 180 days; ITC reversed until paid", ref: r.doc.loc });
  for (const d of x.sales) if (d.docType !== "INV" && !d.origNumber) out.push({ item: `Original invoice number and date for note ${d.number.trim()} (${d.party})`, reason: "Credit/debit note must reference the original invoice", ref: d.loc });
  // insufficient_evidence answers become questions, never defaults (ADR-008).
  for (const l of x.ledgers) {
    if (l.blockedCategory !== "insufficient_evidence" && l.rcmService !== "insufficient_evidence") continue;
    const doc = a.purchases.find((p) => p.key === l.ledger);
    out.push({ item: `Nature and use of the expense booked as "${l.ledger}"${doc ? ` (${doc.number})` : ""}, with the bill`, reason: "The books do not show whether ITC is blocked or reverse charge applies", ref: doc?.loc ?? x.sources.purchases.file });
  }
  for (const h of x.hsnReads) if (h.status === "insufficient_evidence") out.push({ item: `HSN/SAC code for "${h.description}"`, reason: "No HSN/SAC is written in the sales register", ref: h.location });
  return out;
}

// ------------------------------------------------------------------ all

export function gstDeliverables(ctx: DeliverableContext<GstInput, GstExtract>): DeliverableDraft[] {
  const a = analyse(ctx.extracted);
  const requests = documentRequests(a, ctx.extracted);
  return [
    { type: "xlsx", title: DELIVERABLE_TITLES.gstr1, sheets: gstr1Sheets(a) },
    { type: "xlsx", title: DELIVERABLE_TITLES.gstr3b, sheets: gstr3bSheets(a, ctx.extracted) },
    { type: "xlsx", title: DELIVERABLE_TITLES.recon, sheets: reconSheets(a) },
    { type: "xlsx", title: DELIVERABLE_TITLES.exceptions, sheets: [{ name: "Exceptions", columns: [...EXCEPTION_COLUMNS], rows: exceptionRows(ctx.results, ctx.extracted.notes) }] },
    {
      type: "docx",
      title: DELIVERABLE_TITLES.requests,
      blocks: [
        { type: "heading", text: "Documents and confirmations needed from the client" },
        { type: "paragraph", text: `Draft list for ${ctx.job.clientName}, GST period ${ctx.job.period}. Staff review and send it through the usual channel; Firm OS does not contact the client.` },
        requests.length
          ? { type: "table", columns: [c("item", "Item"), c("reason", "Why"), c("ref", "Reference")], rows: requests.map((r) => ({ ...r })) }
          : { type: "paragraph", text: "No documents are needed for this period based on the registers and GSTR-2B received." },
      ],
    },
  ];
}
