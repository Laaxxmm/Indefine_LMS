// Helpers for per-input sensitivity probes (second accuracy audit, M2): each agent declares one
// probe per input file kind that changes ONE material value in THAT file. These helpers do the
// file surgery — a CSV cell, a JSON field, an XLSX cell — on copies; the originals are never
// modified, and a file or column that is not there leaves the files unchanged (the harness then
// reports the probe as not applied). Pure apart from the XLSX reader/writer.
import ExcelJS from "exceljs";
import type { InputFile } from "./runner";

const lower = (s: string) => s.trim().toLowerCase();
/** Header text for matching: lower case, punctuation as spaces ("GSTIN/UIN" → "gstin uin"). */
export const headerName = (s: string) => s.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** First file whose name matches (case-insensitive exact name, or a pattern). */
export function findInput(files: InputFile[], name: string | RegExp): InputFile | undefined {
  return files.find((f) => (typeof name === "string" ? lower(f.name) === lower(name) : name.test(f.name)));
}

/** A copy of `files` with `target` replaced by new bytes. */
export function replaceInput(files: InputFile[], target: InputFile, bytes: Buffer): InputFile[] {
  return files.map((f) => (f === target ? { ...f, bytes } : { ...f, bytes: Buffer.from(f.bytes) }));
}

/**
 * A written amount plus `delta` (default 1), keeping its decimals: "10,00,000" → "1000001",
 * "15000.00" → "15001.00", "-2,000.50" → "-1999.50". Null when the text is not a plain amount.
 */
export function bumpAmountText(text: string, delta = 1): string | null {
  const t = text.trim().replace(/^₹\s*/, "");
  const m = /^(-)?([\d,]+)(?:\.(\d+))?$/.exec(t);
  if (!m || !/\d/.test(m[2])) return null;
  const decimals = m[3]?.length ?? 0;
  const scale = 10 ** decimals;
  const units = Number(m[2].replace(/,/g, "")) * scale + Number(m[3] ?? 0);
  const value = (m[1] ? -units : units) + delta * scale;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / scale);
  const frac = decimals ? `.${String(abs % scale).padStart(decimals, "0")}` : "";
  return `${value < 0 ? "-" : ""}${whole}${frac}`;
}

/** One CSV line → cells (double quotes may wrap commas; "" is a quote). */
export function splitCsvCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Change one cell of a CSV input: the first data row (after the header row found within the
 * first 20 lines) whose `column` cell `mutate` returns a new value for.
 */
export function mutateCsvCell(files: InputFile[], name: string | RegExp, column: string | string[], mutate: (cell: string, row: Record<string, string>) => string | null): InputFile[] {
  const f = findInput(files, name);
  if (!f) return files;
  const text = f.bytes.toString("utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const wanted = (Array.isArray(column) ? column : [column]).map(headerName);
  for (let h = 0; h < Math.min(lines.length, 20); h++) {
    const header = splitCsvCells(lines[h]).map(headerName);
    const cols = wanted.map((w) => header.indexOf(w)).filter((i, k, all) => i >= 0 && all.indexOf(i) === k);
    if (!cols.length) continue;
    // Candidate columns in the order given; within a column, the first row that changes.
    for (const col of cols) {
      for (let i = h + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cells = splitCsvCells(lines[i]);
        if (col >= cells.length) continue;
        const row = Object.fromEntries(header.map((k, j) => [k, cells[j] ?? ""]));
        const next = mutate(cells[col], row);
        if (next === null || next === cells[col]) continue;
        cells[col] = next;
        const out = [...lines];
        out[i] = cells.map(csvCell).join(",");
        return replaceInput(files, f, Buffer.from(out.join(eol), "utf8"));
      }
    }
    return files;
  }
  return files;
}

/** Change a JSON input in place on a parsed copy; `mutate` returns false to leave it unchanged. */
export function mutateJsonInput(files: InputFile[], name: string | RegExp, mutate: (doc: Record<string, unknown>) => boolean): InputFile[] {
  const f = findInput(files, name);
  if (!f) return files;
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(f.bytes.toString("utf8").replace(/^﻿/, "")) as Record<string, unknown>;
  } catch {
    return files;
  }
  if (!mutate(doc)) return files;
  return replaceInput(files, f, Buffer.from(JSON.stringify(doc, null, 2), "utf8"));
}

/** A JSON amount (number or written string) plus `delta` rupees; null when it is not an amount. */
export function bumpJsonAmount(v: unknown, delta = 1): number | string | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round((v + delta) * 100) / 100;
  if (typeof v === "string") return bumpAmountText(v, delta);
  return null;
}

/**
 * Change one XLSX cell by column header: in workbook order, the first sheet with a header row
 * (within its first 20 rows) naming one of `columns`; the first data row below it whose cell
 * `mutate` returns a new value for.
 */
export async function mutateXlsxColumn(files: InputFile[], name: string | RegExp, columns: readonly string[], mutate: (value: unknown) => unknown | undefined): Promise<InputFile[]> {
  const wanted = columns.map(headerName);
  let header: { sheet: string; row: number; col: number } | null = null;
  return mutateXlsxCell(files, name, (value, ctx) => {
    if (header?.sheet !== ctx.sheet) {
      if (ctx.row > 20) return undefined;
      const names = ctx.rowValues.map((v) => headerName(String(v ?? "")));
      const col = wanted.map((w) => names.indexOf(w)).find((i) => i >= 0);
      if (col !== undefined) header = { sheet: ctx.sheet, row: ctx.row, col: col + 1 };
      return undefined;
    }
    if (ctx.row <= header.row || ctx.col !== header.col) return undefined;
    return mutate(value);
  });
}

/** An XLSX cell amount plus `delta` (numbers and written amounts); undefined when it is not one. */
export function bumpCellAmount(value: unknown, delta = 1): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value !== 0) return Math.round((value + delta) * 100) / 100;
  if (typeof value === "string" && value.trim() && !/^0+(\.0+)?$/.test(value.trim())) return bumpAmountText(value, delta) ?? undefined;
  return undefined;
}

/** Change the first XLSX cell (any sheet, workbook order) for which `mutate` returns a new value. */
export async function mutateXlsxCell(files: InputFile[], name: string | RegExp, mutate: (value: unknown, ctx: { sheet: string; row: number; col: number; rowValues: unknown[] }) => unknown | undefined): Promise<InputFile[]> {
  const f = findInput(files, name);
  if (!f) return files;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(f.bytes) as unknown as ArrayBuffer);
  } catch {
    return files;
  }
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const values = (row.values as unknown[]).slice(1);
      for (let c = 1; c <= values.length; c++) {
        const next = mutate(row.getCell(c).value, { sheet: ws.name, row: r, col: c, rowValues: values });
        if (next === undefined) continue;
        row.getCell(c).value = next as ExcelJS.CellValue;
        const out = Buffer.from(await wb.xlsx.writeBuffer());
        return replaceInput(files, f, out);
      }
    }
  }
  return files;
}
