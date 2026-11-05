// Tabular readers for GST inputs: a tolerant CSV parser (quotes, "" escapes, CRLF, BOM, comma /
// semicolon / tab) and an XLSX reader (exceljs) that flattens cells to string | number | Date.
// Header rows are found by content, not position: Tally and Zoho exports put company name,
// report title and period above the column headings.
import ExcelJS from "exceljs";
import { GstParseError } from "./money";

export type Cell = string | number | Date | null;
export type Grid = Cell[][];
/** A sheet with its header row located. `rowNumbers[i]` is the 1-based source row of rows[i]. */
export type Table = { file: string; sheet?: string; headers: string[]; headerRow: number; rows: Cell[][]; rowNumbers: number[] };

export function parseCsv(text: string): Grid {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length }));
  const delim = counts.sort((a, b) => b.n - a.n)[0].d;
  const rows: Grid = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new GstParseError("CSV has an unterminated quoted field");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v ?? "").trim() !== ""));
}

function flatten(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return flatten((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
  }
  return String(v);
}

export type XlsxSheet = { name: string; grid: Grid };

/** Every sheet of an XLSX file as a grid (row i = source row i + 1, trailing empty rows dropped). */
export async function readXlsx(bytes: Buffer): Promise<XlsxSheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new GstParseError("not a readable XLSX file. Open it in Excel, save it again as .xlsx and upload it.");
  }
  const out: XlsxSheet[] = [];
  wb.eachSheet((ws) => {
    const grid: Grid = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(flatten(row.getCell(c).value));
      grid.push(cells);
    }
    while (grid.length && grid[grid.length - 1].every((c) => c === null || String(c).trim() === "")) grid.pop();
    out.push({ name: ws.name, grid });
  });
  return out;
}

export const headerKey = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/₹/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();

/**
 * Locate the header row: the first of the first 20 rows with at least `minHits` cells the
 * predicate recognises. Rows after it (non-blank) become data rows.
 */
export function toTable(grid: Grid, file: string, isHeader: (key: string) => boolean, minHits = 3, sheet?: string): Table | null {
  const limit = Math.min(grid.length, 20);
  for (let i = 0; i < limit; i++) {
    const hits = grid[i].filter((c) => isHeader(headerKey(c))).length;
    if (hits >= minHits) {
      const headers = grid[i].map((c) => String(c ?? "").trim());
      const rows: Cell[][] = [];
      const rowNumbers: number[] = [];
      for (let r = i + 1; r < grid.length; r++) {
        if (grid[r].every((c) => c === null || String(c).trim() === "")) continue;
        rows.push(grid[r]);
        rowNumbers.push(r + 1);
      }
      return { file, sheet, headers, headerRow: i + 1, rows, rowNumbers };
    }
  }
  return null;
}
