// Column-mapping layer: canonical register fields ← the header names Tally Prime and Zoho Books
// exports use (plus generic GSTR-1 offline-tool names). Matching is on a normalised header key
// (lower case, punctuation → space, ₹ dropped), exact equality, aliases in priority order, one
// column per field. Adding a software = adding aliases here; the parsers do not change.
import { headerKey } from "./tabular";
import type { RegisterStyle } from "./types";

export const REGISTER_FIELDS = {
  supplierInvNo: ["supplier invoice no", "supplier invoice number", "supplier inv no", "vendor invoice number", "vendor invoice no", "party invoice no", "supplier bill no"],
  supplierInvDate: ["supplier invoice date", "vendor invoice date", "party invoice date", "supplier bill date"],
  origNumber: ["original invoice no", "original invoice number", "reference invoice number", "reference invoice no", "against invoice", "invoice reference", "original invoice"],
  origDate: ["original invoice date", "reference invoice date"],
  number: ["voucher no", "voucher number", "invoice number", "invoice no", "bill number", "bill no", "document number", "document no", "doc no", "note number", "credit note number", "debit note number", "note no"],
  date: ["date", "invoice date", "voucher date", "bill date", "document date", "doc date", "note date", "transaction date", "credit note date"],
  docType: ["voucher type", "transaction type", "document type", "doc type", "note type", "type"],
  party: ["particulars", "party name", "customer name", "vendor name", "supplier name", "receiver name", "buyer name", "party"],
  gstin: ["gstin uin", "gstin", "gst identification number gstin", "customer gstin", "vendor gstin", "supplier gstin", "gstin of supplier", "gstin uin of recipient", "party gstin", "gst no", "gstin number"],
  pos: ["place of supply", "pos", "place of supply state"],
  hsn: ["hsn sac", "hsn", "hsn code", "sac", "hsn sac code", "hsn sac summary"],
  description: ["item description", "item name", "description", "narration", "item", "stock item", "goods description"],
  qty: ["quantity", "qty"],
  uqc: ["uqc", "unit", "usage unit", "units"],
  rate: ["gst rate", "tax rate", "item tax %", "gst %", "rate %", "item tax", "applicable rate", "rate"],
  taxable: ["taxable value", "taxable amount", "item total", "sub total", "subtotal", "assessable value", "taxable"],
  igst: ["igst", "integrated tax", "igst amount", "integrated tax amount", "integrated tax paid"],
  cgst: ["cgst", "central tax", "cgst amount", "central tax amount"],
  sgst: ["sgst utgst", "sgst", "state tax", "sgst amount", "state ut tax", "utgst", "state tax amount"],
  cess: ["cess", "cess amount", "compensation cess"],
  value: ["invoice value", "gross total", "total", "bill amount", "invoice amount", "total amount", "note value", "bill total"],
  reverseCharge: ["reverse charge", "is reverse charge applied", "reverse charge applicable", "rcm", "reverse charge y n"],
  irn: ["irn", "e invoice irn", "einvoice irn", "irn number", "e invoice reference number"],
  ledger: ["purchase ledger", "expense ledger", "ledger", "account", "expense account", "expense head", "ledger name"],
  paidOn: ["payment date", "paid on", "date of payment"],
  paid: ["amount paid", "paid amount", "paid"],
  reversedEarlier: ["itc reversed earlier", "reversed earlier", "already reversed"],
} as const;
export type RegisterField = keyof typeof REGISTER_FIELDS;

/** 2B Excel export (B2B and B2B-CDNR sheets). */
export const GSTR2B_FIELDS = {
  ctin: ["gstin of supplier", "supplier gstin", "ctin"],
  tradeName: ["trade legal name", "trade legal name of the supplier", "trade name", "supplier name"],
  number: ["invoice number", "note number", "invoice no", "note no", "document number"],
  docType: ["note type", "document type"],
  invType: ["invoice type", "note supply type"],
  date: ["invoice date", "note date", "document date"],
  value: ["invoice value", "note value", "document value"],
  pos: ["place of supply"],
  rev: ["supply attract reverse charge", "reverse charge"],
  rate: ["rate %", "rate"],
  taxable: ["taxable value"],
  igst: ["integrated tax", "igst"],
  cgst: ["central tax", "cgst"],
  sgst: ["state ut tax", "state tax", "sgst"],
  cess: ["cess"],
  itcAvailable: ["itc availability", "itc available"],
  reason: ["reason"],
} as const;
export type Gstr2bField = keyof typeof GSTR2B_FIELDS;

export type ColumnMap<F extends string> = Partial<Record<F, number>>;

export function makeHeaderPredicate(fields: Record<string, readonly string[]>): (key: string) => boolean {
  const all = new Set(Object.values(fields).flat());
  return (key) => all.has(key);
}

/** Header cells → field → column index. Fields are resolved in declaration order; a column is used once. */
export function mapColumns<F extends string>(headers: string[], fields: Record<F, readonly string[]>): ColumnMap<F> {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const out: ColumnMap<F> = {};
  for (const field of Object.keys(fields) as F[]) {
    for (const alias of fields[field]) {
      const i = keys.findIndex((k, idx) => k === alias && !used.has(idx));
      if (i >= 0) {
        out[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

const TALLY_MARKS = ["particulars", "voucher no", "voucher type", "gstin uin", "supplier invoice no", "gross total", "voucher number"];
const ZOHO_MARKS = ["customer name", "vendor name", "gst identification number gstin", "item total", "invoice status", "bill number", "item tax %", "transaction type"];

/** Which export the headers look like (reported in the pack; mapping itself is alias-based for all). */
export function detectStyle(headers: string[]): RegisterStyle {
  const keys = new Set(headers.map(headerKey));
  const t = TALLY_MARKS.filter((k) => keys.has(k)).length;
  const z = ZOHO_MARKS.filter((k) => keys.has(k)).length;
  if (t === 0 && z === 0) return "generic";
  return t >= z ? "tally" : "zoho";
}
