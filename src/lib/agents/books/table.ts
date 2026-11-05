// Tolerant table reading for books exports (Tally / Zoho / bank CSV and XLSX). Shared by the
// Books Close and Audit Assist agents. Everything here is deterministic: no model, no clock.
//
//   readTable(file)          CSV (delimiter sniffed: , ; tab |) or XLSX (first sheet with data) → string cells
//   locateColumns(rows, ...) finds the header row (within the first HEADER_SCAN_ROWS rows) by header aliases,
//                            optionally overridden by an explicit column map (column-map.json)
//   parseAmountPaise(text)   "1,23,456.78", "(1,234.00)", "-50", "12,000.00 Cr", "₹ 5" → integer paise
//   parseDay(text)           "2026-10-05", "05/10/2026" (DD/MM/YYYY), "05-Oct-2026", "5 Oct 2026",
//                            Excel serial numbers → "YYYY-MM-DD"
//
// Amounts never pass through floating-point multiplication: the text is split at the decimal
// point and assembled as integer paise. More than two decimals round half away from zero.
import type ExcelJS from "exceljs";
import type { InputFile } from "@/lib/agents/core/runner";
import { readWorkbookGrid, type GridOptions } from "@/lib/hardening/xlsx-guard";
import { causeSentence } from "@/lib/errors";

export type Cells = string[][];
export type RawTable = { file: string; rows: Cells };
export type ParseIssue = { file: string; row: number; message: string };

/** Rows scanned for a header line (Tally exports start with company name / period rows). */
export const HEADER_SCAN_ROWS = 15;

// ------------------------------------------------------------------ CSV

function sniffDelimiter(text: string): string {
  const first = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts: [string, number][] = [",", ";", "\t", "|"].map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF/LF, BOM stripped. */
export function parseCsv(input: string): Cells {
  const text = input.replace(/^﻿/, "");
  const delim = sniffDelimiter(text);
  const rows: Cells = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (c === delim) {
      row.push(field.trim());
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

// ------------------------------------------------------------------ XLSX

/** One spreadsheet cell as text: dates as YYYY-MM-DD, numbers in shortest exact form. */
export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") {
    if ("result" in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("").trim();
    if ("text" in v) return String((v as { text: unknown }).text).trim();
    return "";
  }
  return String(v).trim();
}

/**
 * The first sheet with data, as text cells. The workbook is inspected first (ZIP bomb, row /
 * column / cell caps: src/lib/hardening/xlsx-guard.ts) and a large one is parsed in a worker with a
 * time budget; a file over the limits throws XlsxLimitError with a plain message (readTable turns
 * it into a parse issue). The cell walk and cellText are unchanged.
 */
export async function parseXlsx(bytes: Buffer, opts: Pick<GridOptions, "mode" | "timeoutMs" | "limits"> = {}): Promise<Cells> {
  for (const sheet of await readWorkbookGrid(bytes, opts)) {
    const rows: Cells = sheet.values.map((r) => r.map(cellText));
    if (rows.some((r) => r.some((c) => c !== ""))) return rows;
  }
  return [];
}

export const isXlsx = (f: Pick<InputFile, "name" | "bytes">) => /\.xlsx$/i.test(f.name) || f.bytes.subarray(0, 2).toString("latin1") === "PK";

/** CSV or XLSX → string cells. A file that cannot be read gives no rows and an issue. */
export async function readTable(file: Pick<InputFile, "name" | "bytes">): Promise<{ table: RawTable; issues: ParseIssue[] }> {
  try {
    const rows = isXlsx(file) ? await parseXlsx(file.bytes) : parseCsv(file.bytes.toString("utf8"));
    return { table: { file: file.name, rows }, issues: [] };
  } catch (e) {
    return { table: { file: file.name, rows: [] }, issues: [{ file: file.name, row: 0, message: `could not read the file: ${causeSentence(e) ?? "it is not a readable spreadsheet or CSV file."}` }] };
  }
}

// ------------------------------------------------------------------ headers

/** Header text → comparison key: lower case, letters and digits only ("Debit (₹)" → "debit"). */
export const headerKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");

export type ColumnAliases<F extends string> = Record<F, string[]>;
export type ColumnMap<F extends string> = Partial<Record<F, number>>;
export type Located<F extends string> = { headerRow: number; columns: ColumnMap<F> };

/**
 * Find the header row: the first row (of the first HEADER_SCAN_ROWS) where every `required` field
 * group has a matching column. `required` entries are alternatives joined by "|" ("debit|balance").
 * `override` maps a field to the exact header text (column-map.json) and wins over aliases.
 */
export function locateColumns<F extends string>(
  rows: Cells,
  aliases: ColumnAliases<F>,
  required: string[],
  override: Partial<Record<F, string>> = {},
): Located<F> | null {
  const fields = Object.keys(aliases) as F[];
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const keys = rows[r].map(headerKey);
    const columns: ColumnMap<F> = {};
    const used = new Set<number>();
    // Overrides first, then aliases in the order given (earlier alias = stronger match).
    for (const f of fields) {
      const o = override[f];
      if (o === undefined) continue;
      const i = keys.indexOf(headerKey(o));
      if (i >= 0) {
        columns[f] = i;
        used.add(i);
      }
    }
    for (const f of fields) {
      if (columns[f] !== undefined) continue;
      for (const a of aliases[f]) {
        const i = keys.findIndex((k, idx) => k === headerKey(a) && !used.has(idx));
        if (i >= 0) {
          columns[f] = i;
          used.add(i);
          break;
        }
      }
    }
    const ok = required.every((group) => group.split("|").some((f) => columns[f as F] !== undefined));
    if (ok) return { headerRow: r, columns };
  }
  return null;
}

export const cell = (row: string[], i: number | undefined) => (i === undefined ? "" : (row[i] ?? "").trim());

// ------------------------------------------------------------------ amounts

export type AmountParse = { ok: true; paise: number } | { ok: false; reason: string };

/**
 * Text → signed integer paise. Accepts Indian or western grouping, ₹/Rs/INR, a leading minus,
 * parentheses for negatives, and a trailing (or leading) Dr / Cr marker: Cr negates. Blank → 0.
 */
export function parseAmountPaise(input: string | number | null | undefined): AmountParse {
  if (input === null || input === undefined) return { ok: true, paise: 0 };
  let s = String(input).trim();
  if (s === "" || s === "-" || s === "--") return { ok: true, paise: 0 };
  let negative = false;
  const crdr = /\s*(dr|cr)\.?$/i.exec(s) ?? /^(dr|cr)\.?\s*/i.exec(s);
  if (crdr) {
    if (crdr[1].toLowerCase() === "cr") negative = !negative;
    s = s.replace(crdr[0], "").trim();
  }
  if (/^\(.*\)$/.test(s)) {
    negative = !negative;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").trim();
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) s = s.slice(1).trim();
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/[,\s]/g, "");
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false, reason: `not an amount: "${String(input)}"` };
    s = n.toFixed(2);
  }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return { ok: false, reason: `not an amount: "${String(input)}"` };
  const whole = m[1] === "" ? 0 : Number(m[1]);
  const frac = m[2] ?? "";
  let paise = whole * 100 + Number((frac + "00").slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) paise += 1; // half away from zero (sign applied below)
  if (!Number.isSafeInteger(paise)) return { ok: false, reason: `amount too large: "${String(input)}"` };
  return { ok: true, paise: negative && paise !== 0 ? -paise : paise };
}

// ------------------------------------------------------------------ dates

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

function validDay(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > dim ? null : `${y}-${pad(m)}-${pad(d)}`;
}

/** Text (or Excel serial) → "YYYY-MM-DD", or null. Numeric day/month order is Indian (DD/MM/YYYY). */
export function parseDay(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validDay(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[\s/.-]*([A-Za-z]{3,9})[\s/.,-]*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (!mon) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validDay(y, mon, Number(m[1]));
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial day (1900 system): 1 = 1900-01-01, with the 1900 leap-year bug → epoch 1899-12-30.
    const serial = Math.floor(Number(s));
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return validDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/** "2026-10", "Oct-2026", "October 2026", "10/2026", "2026-10-15" → "YYYY-MM", or null. */
export function parseMonth(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${pad(Number(m[2]))}`;
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${pad(Number(m[1]))}`;
  m = /^([A-Za-z]{3,9})[\s/.,-]*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (!mon) return null;
    return `${m[2].length === 2 ? 2000 + Number(m[2]) : m[2]}-${pad(mon)}`;
  }
  const day = parseDay(s);
  return day ? day.slice(0, 7) : null;
}

/** Whole days from a to b (YYYY-MM-DD), b − a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Last day of a "YYYY-MM" month. */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** "YYYY-MM" plus n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

/** Text compare key: lower case, single spaces, no punctuation at the ends. */
export const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");

/** Paise → rupees for spreadsheet cells (exact: paise are integers). */
export const rupees = (paise: number) => paise / 100;
