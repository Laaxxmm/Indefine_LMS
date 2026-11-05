// GSTR-2B parsers: the JSON staff download (documented shape: data.docdata.b2b[].inv[] and
// data.docdata.cdnr[].nt[], values in rupees) and the Excel export (B2B and B2B-CDNR sheets, one
// row per rate). Both GSTR-2B key names (dt, igst/cgst/sgst/cess, items[]) and the older 2A-style
// names (idt, iamt/camt/samt/csamt, itms[].itm_det) are accepted. Amendment sections (b2ba,
// cdnra) and ISD/IMPG are not used in v1.0.0; their presence is reported as a note.
import { stateCodeOf } from "./config";
import { GSTR2B_FIELDS, makeHeaderPredicate, mapColumns, type Gstr2bField } from "./columns";
import { GstParseError, addTax, parseDay, parseAmount, rupeesToPaise, zeroTax, type TaxSplit } from "./money";
import { normGstin } from "./registers";
import { headerKey, type Cell, type XlsxSheet } from "./tabular";
import type { B2bDoc, DocType } from "./types";

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

function itemTax(it: J): { taxable: number; tax: TaxSplit } {
  const d = Object.keys(obj(it.itm_det)).length ? obj(it.itm_det) : it;
  return {
    taxable: rupeesToPaise(d.txval),
    tax: {
      igst: rupeesToPaise(d.igst ?? d.iamt),
      cgst: rupeesToPaise(d.cgst ?? d.camt),
      sgst: rupeesToPaise(d.sgst ?? d.samt),
      cess: rupeesToPaise(d.cess ?? d.csamt),
    },
  };
}

function docTotals(doc: J): { taxable: number; tax: TaxSplit } {
  const items = [...arr(doc.items), ...arr(doc.itms)].map(obj);
  if (!items.length) return itemTax(doc);
  return items.map(itemTax).reduce((a, b) => ({ taxable: a.taxable + b.taxable, tax: addTax(a.tax, b.tax) }), { taxable: 0, tax: zeroTax() });
}

function dateOf(raw: unknown, loc: string): string {
  try {
    const d = parseDay(raw);
    if (d) return d;
  } catch {
    /* fall through */
  }
  throw new GstParseError(`${loc}: document date ${JSON.stringify(raw)} is not a date`);
}

const noteType = (raw: string): DocType => (/^d/i.test(raw) ? "DBN" : "CRN");

/** Credit notes are stored with positive amounts (the doc type carries the sign), whatever the export shows. */
const positive = (d: B2bDoc): B2bDoc =>
  d.docType !== "CRN" ? d : { ...d, value: Math.abs(d.value), taxable: Math.abs(d.taxable), tax: { igst: Math.abs(d.tax.igst), cgst: Math.abs(d.tax.cgst), sgst: Math.abs(d.tax.sgst), cess: Math.abs(d.tax.cess) } };

/** 2B JSON → documents (+ notes about sections not used). */
export function parse2bJson(json: unknown, file: string): { docs: B2bDoc[]; notes: string[] } {
  const root = obj(json);
  const docdata = obj(obj(root.data).docdata ?? root.docdata ?? root.data ?? root);
  const b2b = arr(docdata.b2b);
  const cdnr = arr(docdata.cdnr);
  if (!b2b.length && !cdnr.length && !Object.keys(docdata).some((k) => ["b2b", "cdnr"].includes(k))) {
    throw new GstParseError(`${file}: not a GSTR-2B JSON (no docdata.b2b or docdata.cdnr)`);
  }
  const docs: B2bDoc[] = [];
  b2b.map(obj).forEach((sup, i) => {
    const ctin = normGstin(s(sup.ctin)) ?? "";
    arr(sup.inv).map(obj).forEach((inv, j) => {
      const loc = `${file} b2b[${i}].inv[${j}]`;
      const { taxable, tax } = docTotals(inv);
      docs.push({
        loc,
        ctin,
        tradeName: s(sup.trdnm),
        docType: "INV",
        number: s(inv.inum),
        date: dateOf(inv.dt ?? inv.idt, loc),
        value: rupeesToPaise(inv.val),
        pos: stateCodeOf(s(inv.pos)),
        reverseCharge: /^y/i.test(s(inv.rev ?? inv.rchrg)),
        itcAvailable: !/^n/i.test(s(inv.itcavl) || "Y"),
        reason: s(inv.rsn),
        taxable,
        tax,
      });
    });
  });
  cdnr.map(obj).forEach((sup, i) => {
    const ctin = normGstin(s(sup.ctin)) ?? "";
    [...arr(sup.nt)].map(obj).forEach((nt, j) => {
      const loc = `${file} cdnr[${i}].nt[${j}]`;
      const { taxable, tax } = docTotals(nt);
      docs.push({
        loc,
        ctin,
        tradeName: s(sup.trdnm),
        docType: noteType(s(nt.typ ?? nt.ntty)),
        number: s(nt.ntnum ?? nt.nt_num),
        date: dateOf(nt.dt ?? nt.nt_dt, loc),
        value: rupeesToPaise(nt.val),
        pos: stateCodeOf(s(nt.pos)),
        reverseCharge: /^y/i.test(s(nt.rev ?? nt.rchrg)),
        itcAvailable: !/^n/i.test(s(nt.itcavl) || "Y"),
        reason: s(nt.rsn),
        taxable,
        tax,
      });
    });
  });
  const unused = Object.keys(docdata).filter((k) => !["b2b", "cdnr"].includes(k) && arr(docdata[k]).length);
  const notes = unused.length ? [`${file}: GSTR-2B sections ${unused.sort().join(", ")} are not used by GST Prep v1.0.0; review them by hand`] : [];
  return { docs: docs.map(positive), notes };
}

const is2bHeader = makeHeaderPredicate(GSTR2B_FIELDS);

/** Locate the header (one or two rows: group heading above column names) in a 2B Excel sheet. */
function headerOf(grid: Cell[][]): { headers: string[]; dataStart: number } | null {
  const hits = (row: Cell[]) => row.filter((c) => is2bHeader(headerKey(c))).length;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    if (hits(grid[i]) < 2) continue;
    const next = grid[i + 1] ?? [];
    if (hits(next) >= 2) {
      const width = Math.max(grid[i].length, next.length);
      const headers = Array.from({ length: width }, (_, c) => {
        const lower = s(next[c]);
        return lower && is2bHeader(headerKey(lower)) ? lower : s(grid[i][c]);
      });
      return { headers, dataStart: i + 2 };
    }
    return { headers: grid[i].map((c) => s(c)), dataStart: i + 1 };
  }
  return null;
}

/** 2B Excel export → documents. Sheets named like B2B and B2B-CDNR; other sheets are ignored. */
export function parse2bSheets(sheets: XlsxSheet[], file: string): { docs: B2bDoc[]; notes: string[] } {
  const docs: B2bDoc[] = [];
  const used: string[] = [];
  for (const sh of sheets) {
    const name = headerKey(sh.name).replace(/\s+/g, "");
    const kind = name === "b2b" ? "b2b" : name === "b2bcdnr" || name === "cdnr" ? "cdnr" : null;
    if (!kind) continue;
    const h = headerOf(sh.grid);
    if (!h) continue;
    used.push(sh.name);
    const cols = mapColumns(h.headers, GSTR2B_FIELDS);
    const get = (row: Cell[], f: Gstr2bField) => (cols[f] === undefined ? null : (row[cols[f] as number] ?? null));
    const groups = new Map<string, B2bDoc>();
    for (let r = h.dataStart; r < sh.grid.length; r++) {
      const row = sh.grid[r];
      const ctin = normGstin(get(row, "ctin"));
      const number = s(get(row, "number"));
      if (!ctin || !number) continue;
      const loc = `${file}!${sh.name} row ${r + 1}`;
      const docType: DocType = kind === "b2b" ? "INV" : noteType(s(get(row, "docType")) || "C");
      const date = dateOf(get(row, "date"), loc);
      const key = [ctin, docType, number, date].join("\u0000");
      const money = (f: Gstr2bField) => {
        try {
          return parseAmount(get(row, f)) ?? 0;
        } catch (e) {
          throw new GstParseError(`${loc}: ${f} ${(e as Error).message}`);
        }
      };
      const tax = { igst: money("igst"), cgst: money("cgst"), sgst: money("sgst"), cess: money("cess") };
      const g = groups.get(key);
      if (g) {
        g.taxable += money("taxable");
        g.tax = addTax(g.tax, tax);
        continue;
      }
      const doc: B2bDoc = {
        loc,
        ctin,
        tradeName: s(get(row, "tradeName")),
        docType,
        number,
        date,
        value: Math.abs(money("value")),
        pos: stateCodeOf(s(get(row, "pos"))),
        reverseCharge: /^y/i.test(s(get(row, "rev"))),
        itcAvailable: !/^n/i.test(s(get(row, "itcAvailable")) || "Y"),
        reason: s(get(row, "reason")),
        taxable: money("taxable"),
        tax,
      };
      groups.set(key, doc);
      docs.push(doc);
    }
  }
  if (!used.length) throw new GstParseError(`${file}: no B2B or B2B-CDNR sheet with GSTR-2B headings found`);
  return { docs: docs.map(positive), notes: [] };
}
