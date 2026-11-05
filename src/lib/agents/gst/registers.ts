// Sales / purchase register, payables ageing and e-invoice parsers. Input: a located Table
// (CSV or XLSX, Tally or Zoho style); output: documents with item lines in paise. One register
// row is one item line; rows sharing doc type + number (exactly as written) + date + party are
// one document; a row with neither number nor date continues the previous document (Tally item
// rows). Number cells are kept exactly as written so near-duplicates ("INV-1" vs "inv-1 ") stay
// two documents for the duplicate check.
import { GST_RATE_SLABS_BPS, stateCodeOf } from "./config";
import { REGISTER_FIELDS, detectStyle, makeHeaderPredicate, mapColumns, type ColumnMap, type RegisterField } from "./columns";
import { GstParseError, parseAmount, parseDay, parseRateBps, type TaxSplit } from "./money";
import { headerKey, toTable, type Cell, type Grid, type Table } from "./tabular";
import type { DocType, Line, PayableDoc, PurchaseDoc, RegisterStyle, SalesDoc } from "./types";

export const isRegisterHeader = makeHeaderPredicate(REGISTER_FIELDS);

type Row = { cells: Cell[]; loc: string };
type Get = (f: RegisterField) => Cell;

const str = (c: Cell): string => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));
const blank = (c: Cell) => str(c).trim() === "";
const TOTAL_ROW = /^(grand\s+)?total\b|^sub\s*total\b/i;

export function locOf(t: Table, i: number): string {
  return `${t.file}${t.sheet ? `!${t.sheet}` : ""} row ${t.rowNumbers[i]}`;
}

function rowsOf(t: Table): Row[] {
  return t.rows.map((cells, i) => ({ cells, loc: locOf(t, i) }));
}

function getter(cols: ColumnMap<RegisterField>, cells: Cell[]): Get {
  return (f) => {
    const i = cols[f];
    return i === undefined ? null : (cells[i] ?? null);
  };
}

export function docTypeOf(raw: string): DocType {
  const k = headerKey(raw);
  if (/credit|\bcrn\b|\bcn\b|sales return|purchase return/.test(k)) return "CRN";
  if (/debit|\bdbn\b|\bdn\b/.test(k)) return "DBN";
  return "INV";
}

export function yes(raw: Cell): boolean {
  return /^(y|yes|true|1|applicable|rcm)$/i.test(str(raw).trim());
}

export function normGstin(raw: Cell): string | null {
  const s = str(raw).replace(/\s+/g, "").toUpperCase();
  return s && s !== "-" && s !== "NA" && s !== "URP" ? s : null;
}

/** Snap a derived rate to the nearest slab. */
export function snapRate(bps: number): number {
  let best: number = GST_RATE_SLABS_BPS[0];
  for (const s of GST_RATE_SLABS_BPS) if (Math.abs(s - bps) < Math.abs(best - bps)) best = s;
  return best;
}

function amount(c: Cell, field: string, loc: string): number {
  try {
    return parseAmount(c) ?? 0;
  } catch (e) {
    throw new GstParseError(`${loc}: ${field} ${(e as Error).message}`);
  }
}

function day(c: Cell, field: string, loc: string): string | null {
  try {
    return parseDay(c);
  } catch (e) {
    throw new GstParseError(`${loc}: ${field} ${(e as Error).message}`);
  }
}

function lineOf(get: Get, loc: string, credit: boolean): Line | null {
  const taxableCell = get("taxable");
  const heads = ["igst", "cgst", "sgst", "cess"] as const;
  if (blank(taxableCell) && heads.every((h) => blank(get(h)))) return null;
  const sign = (n: number) => (credit ? Math.abs(n) : n);
  const tax: TaxSplit = { igst: sign(amount(get("igst"), "IGST", loc)), cgst: sign(amount(get("cgst"), "CGST", loc)), sgst: sign(amount(get("sgst"), "SGST", loc)), cess: sign(amount(get("cess"), "cess", loc)) };
  const taxable = sign(amount(taxableCell, "taxable value", loc));
  let rateBps: number | null = null;
  try {
    rateBps = parseRateBps(get("rate"));
  } catch {
    rateBps = null;
  }
  const derived = taxable ? snapRate(Math.round(((tax.igst + tax.cgst + tax.sgst) * 10_000) / taxable)) : 0;
  if (rateBps === null || !(GST_RATE_SLABS_BPS as readonly number[]).includes(rateBps)) rateBps = derived;
  const hsnRaw = str(get("hsn")).replace(/\s+/g, "");
  const qtyRaw = str(get("qty")).replace(/[^\d.-]/g, "");
  return {
    rateBps,
    taxable,
    tax,
    hsn: hsnRaw ? hsnRaw.replace(/\.0+$/, "") : null,
    description: str(get("description")).trim(),
    qty: qtyRaw && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : null,
    uqc: str(get("uqc")).trim() || null,
  };
}

type RawDoc = { loc: string; docType: DocType; number: string; date: string; party: string; gstin: string | null; posRaw: string; rc: boolean; value: number | null; lines: Line[]; get: Get };

function groupDocs(t: Table, kind: "sales" | "purchases"): { docs: RawDoc[]; style: RegisterStyle } {
  const cols = mapColumns(t.headers, REGISTER_FIELDS);
  const numberField: RegisterField = kind === "purchases" && cols.supplierInvNo !== undefined ? "supplierInvNo" : "number";
  const dateField: RegisterField = kind === "purchases" && cols.supplierInvDate !== undefined ? "supplierInvDate" : "date";
  const missing = (["date", "number", "taxable"] as RegisterField[]).filter((f) => cols[f] === undefined && !(f === "number" && cols.supplierInvNo !== undefined));
  if (missing.length) throw new GstParseError(`${t.file}: cannot find column(s) ${missing.join(", ")} in the ${kind} register (headers: ${t.headers.filter(Boolean).join(", ")})`);
  const docs: RawDoc[] = [];
  const byKey = new Map<string, RawDoc>();
  let prev: RawDoc | null = null;
  for (const { cells, loc } of rowsOf(t)) {
    const get = getter(cols, cells);
    const first = str(cells.find((c) => !blank(c)) ?? "");
    if (TOTAL_ROW.test(first.trim())) continue;
    const rawNumber = str(get(numberField));
    const rawDate = get(dateField);
    if (blank(rawNumber) && blank(rawDate)) {
      if (!prev) continue;
      const line = lineOf(get, loc, prev.docType === "CRN");
      if (line) prev.lines.push(line);
      continue;
    }
    if (blank(rawNumber)) throw new GstParseError(`${loc}: document number is blank`);
    const date = day(rawDate, "date", loc);
    if (!date) throw new GstParseError(`${loc}: date is blank`);
    const docType = docTypeOf(str(get("docType")));
    const gstin = normGstin(get("gstin"));
    const party = str(get("party")).trim();
    const number = rawNumber; // exactly as written (stray whitespace is evidence for the duplicate check)
    const key = [docType, rawNumber, date, gstin ?? "", party.toLowerCase()].join("\u0000");
    let doc = byKey.get(key);
    if (!doc) {
      const v = get("value");
      doc = { loc, docType, number, date, party, gstin, posRaw: str(get("pos")), rc: yes(get("reverseCharge")), value: blank(v) ? null : Math.abs(amount(v, "value", loc)), lines: [], get };
      byKey.set(key, doc);
      docs.push(doc);
    }
    const line = lineOf(get, loc, docType === "CRN");
    if (line) doc.lines.push(line);
    prev = doc;
  }
  return { docs, style: detectStyle(t.headers) };
}

const docValue = (d: RawDoc) => d.value ?? d.lines.reduce((n, l) => n + l.taxable + l.tax.igst + l.tax.cgst + l.tax.sgst + l.tax.cess, 0);

export function parseSalesTable(t: Table): { docs: SalesDoc[]; style: RegisterStyle } {
  const { docs, style } = groupDocs(t, "sales");
  return {
    style,
    docs: docs.map((d) => ({
      loc: d.loc,
      docType: d.docType,
      number: d.number,
      date: d.date,
      party: d.party,
      gstin: d.gstin,
      pos: stateCodeOf(d.posRaw),
      reverseCharge: d.rc,
      value: docValue(d),
      lines: d.lines,
      origNumber: str(d.get("origNumber")).trim() || null,
      origDate: day(d.get("origDate"), "original invoice date", d.loc),
      irn: str(d.get("irn")).trim() || null,
    })),
  };
}

export function parsePurchaseTable(t: Table): { docs: PurchaseDoc[]; style: RegisterStyle } {
  const { docs, style } = groupDocs(t, "purchases");
  return {
    style,
    docs: docs.map((d) => ({
      loc: d.loc,
      docType: d.docType,
      number: d.number,
      date: d.date,
      supplier: d.party,
      gstin: d.gstin,
      pos: stateCodeOf(d.posRaw),
      reverseCharge: d.rc,
      value: docValue(d),
      lines: d.lines,
      ledger: (str(d.get("ledger")).trim() || d.lines.find((l) => l.description)?.description || "").trim(),
      paidOn: day(d.get("paidOn"), "payment date", d.loc),
    })),
  };
}

export function parsePayablesTable(t: Table): PayableDoc[] {
  const cols = mapColumns(t.headers, REGISTER_FIELDS);
  for (const f of ["number", "date", "value"] as RegisterField[]) {
    if (cols[f] === undefined) throw new GstParseError(`${t.file}: payables ageing needs a ${f} column`);
  }
  return rowsOf(t).flatMap(({ cells, loc }) => {
    const get = getter(cols, cells);
    if (blank(get("number")) || TOTAL_ROW.test(str(cells[0]).trim())) return [];
    const date = day(get("date"), "invoice date", loc);
    if (!date) throw new GstParseError(`${loc}: invoice date is blank`);
    return [
      {
        loc,
        supplier: str(get("party")).trim(),
        gstin: normGstin(get("gstin")),
        number: str(get("number")).trim(),
        date,
        value: amount(get("value"), "invoice value", loc),
        paid: amount(get("paid"), "amount paid", loc),
        itc: { igst: amount(get("igst"), "IGST", loc), cgst: amount(get("cgst"), "CGST", loc), sgst: amount(get("sgst"), "SGST", loc), cess: amount(get("cess"), "cess", loc) },
        reversedEarlier: yes(get("reversedEarlier")),
      },
    ];
  });
}

/** e-invoice register (CSV/XLSX table or JSON list) → document number (normalised) → IRN. */
export function parseEinvoiceTable(t: Table): Map<string, string> {
  const cols = mapColumns(t.headers, { ...REGISTER_FIELDS, number: [...REGISTER_FIELDS.number, "doc no", "inum", "docno"] });
  const out = new Map<string, string>();
  for (const { cells } of rowsOf(t)) {
    const get = getter(cols as ColumnMap<RegisterField>, cells);
    const n = str(get("number")).trim();
    const irn = str(get("irn")).trim();
    if (n && irn) out.set(matchKey(n), irn);
  }
  return out;
}

export function parseEinvoiceJson(json: unknown): Map<string, string> {
  const list = Array.isArray(json) ? json : Array.isArray((json as { data?: unknown })?.data) ? (json as { data: unknown[] }).data : [];
  const out = new Map<string, string>();
  for (const it of list as Record<string, unknown>[]) {
    const n = String(it.docNo ?? it.DocNo ?? it.inum ?? it.invoiceNumber ?? it.number ?? "").trim();
    const irn = String(it.irn ?? it.Irn ?? it.IRN ?? "").trim();
    if (n && irn) out.set(matchKey(n), irn);
  }
  return out;
}

/** Document-number key for matching across sources: upper case, letters and digits only. */
export function matchKey(n: string): string {
  return n.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Duplicate-check key: upper case, whitespace removed (punctuation kept: INV/1 ≠ INV-1). */
export function dupKey(n: string): string {
  return n.toUpperCase().replace(/\s+/g, "");
}

export function registerTable(grid: Grid, file: string, sheet?: string): Table {
  const t = toTable(grid, file, isRegisterHeader, 3, sheet);
  if (!t) throw new GstParseError(`${file}${sheet ? `!${sheet}` : ""}: no header row found (expected columns such as Date, Invoice Number, Taxable Value)`);
  return t;
}
