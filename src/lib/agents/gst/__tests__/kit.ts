// Builders for GST Prep unit tests: synthetic documents (checksum-valid synthetic GSTINs, no real
// entities). Amounts are paise.
import { taxAt, zeroTax, type TaxSplit } from "../money";
import type { B2bDoc, GstExtract, Line, PayableDoc, PurchaseDoc, SalesDoc } from "../types";

export const GSTIN = {
  client: "29AAFCZ1001K1ZC",
  ka1: "29AABCT5101P1Z3",
  ka2: "29AACCR5202Q1Z0",
  mh: "27AADCM5303R1Z4",
  tn: "33AAECN5404S1Z5",
  sup1: "29AAGCS6101U1ZN",
  sup2: "29AAHCP6202V1ZL",
  supMh: "27AAJCW6303W1ZC",
  supTn: "33AAKCX6404X1ZD",
  bad: "29AABCT5101P1Z4", // ka1 with the wrong check character
};

export const R = (rupees: number) => Math.round(rupees * 100);

export function line(taxable: number, rateBps = 1800, inter = false, over: Partial<Line> = {}): Line {
  return { rateBps, taxable, tax: taxAt(taxable, rateBps, inter), hsn: "7318", description: "Steel bolts", qty: 10, uqc: "NOS", ...over };
}
export const lineTax = (taxable: number, tax: Partial<TaxSplit>, over: Partial<Line> = {}): Line => ({ rateBps: 1800, taxable, tax: { ...zeroTax(), ...tax }, hsn: "7318", description: "Steel bolts", qty: 10, uqc: "NOS", ...over });

let n = 0;
export function sale(over: Partial<SalesDoc> = {}): SalesDoc {
  n += 1;
  const lines = over.lines ?? [line(R(100000))];
  const value = lines.reduce((a, l) => a + l.taxable + l.tax.igst + l.tax.cgst + l.tax.sgst + l.tax.cess, 0);
  return { loc: `sales.csv row ${n + 1}`, docType: "INV", number: `INV/${n}`, date: "2026-10-05", party: "Tanvir Traders", gstin: GSTIN.ka1, pos: "29", reverseCharge: false, value, lines, origNumber: null, origDate: null, irn: null, ...over };
}

export function purchase(over: Partial<PurchaseDoc> = {}): PurchaseDoc {
  n += 1;
  const lines = over.lines ?? [line(R(60000))];
  const value = lines.reduce((a, l) => a + l.taxable + l.tax.igst + l.tax.cgst + l.tax.sgst + l.tax.cess, 0);
  return { loc: `purchases.csv row ${n + 1}`, docType: "INV", number: `SS/${n}`, date: "2026-10-06", supplier: "Sunrise Steel", gstin: GSTIN.sup1, pos: "29", reverseCharge: false, value, lines, ledger: "Raw Material Purchases", paidOn: null, ...over };
}

/** The 2B twin of a purchase (same number, amounts). */
export function twin(p: PurchaseDoc, over: Partial<B2bDoc> = {}): B2bDoc {
  const taxable = p.lines.reduce((a, l) => a + l.taxable, 0);
  const tax = p.lines.reduce((a, l) => ({ igst: a.igst + l.tax.igst, cgst: a.cgst + l.tax.cgst, sgst: a.sgst + l.tax.sgst, cess: a.cess + l.tax.cess }), zeroTax());
  return { loc: `gstr2b.json b2b[0].inv[${p.number}]`, ctin: p.gstin ?? "", tradeName: p.supplier, docType: p.docType, number: p.number, date: p.date, value: p.value, pos: "29", reverseCharge: false, itcAvailable: true, reason: "", taxable, tax, ...over };
}

export function payable(over: Partial<PayableDoc> = {}): PayableDoc {
  return { loc: "payables.csv row 2", supplier: "Coastal Chemicals", gstin: GSTIN.supTn, number: "CC/1", date: "2026-05-03", value: R(118000), paid: 0, itc: { ...zeroTax(), igst: R(18000) }, reversedEarlier: false, ...over };
}

export function extract(over: Partial<GstExtract> = {}): GstExtract {
  return {
    period: "2026-10",
    fy: "2026-27",
    profile: { gstin: GSTIN.client, legalName: "Synthetic Client", aatoPaise: R(2_00_00_000), filingFrequency: "monthly", expectedFilingDate: null, dueDate: null },
    sales: [],
    purchases: [],
    payables: [],
    gstr2b: [],
    prev: null,
    ledgers: [],
    hsnReads: [],
    sources: { sales: { file: "sales.csv", style: "tally", format: "csv" }, purchases: { file: "purchases.csv", style: "tally", format: "csv" }, gstr2b: { file: "gstr2b.json", format: "json" } },
    notes: [],
    ...over,
  };
}

/** A purchase with its 2B twin, both in the extract. */
export function matched(...ps: PurchaseDoc[]): Pick<GstExtract, "purchases" | "gstr2b"> {
  return { purchases: ps, gstr2b: ps.map((p) => twin(p)) };
}
