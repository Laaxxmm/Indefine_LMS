// CSV limits for agent inputs (re-audit NEW-11). The XLSX guard (xlsx-guard.ts) caps rows, columns
// and cells and parses a large workbook in a worker thread; a CSV under the 25 MB input cap had no
// cap at all ("a,b,c…" × 6 MB = 3 million cells, all held in memory on the main thread). The same
// caps now apply to CSV, checked in one linear pass BEFORE any cell is built, and a large CSV is
// parsed in a worker thread with its own heap limit and time budget, like a large workbook.
//
//   checkCsvShape(text, delim)  throws XlsxLimitError (plain sentence) when a row, column or
//                               filled-cell cap is passed; allocates nothing
//   readCsvCells(text, delim)   RFC 4180-style cells (quoted fields, doubled quotes, CRLF / LF), and
//                               whether a quoted field was left open at the end
//   readCsvGuarded(text, delim) the two above inline for a small text, in a worker (CSV_WORKER_BYTES
//                               and up) for a large one
//
// The agents' three CSV readers differ only in their dialect (CsvDialect): when a `"` opens a quoted
// field and whether cells are trimmed. BOOKS_CSV is books/table.ts (Books Close, Audit Assist),
// GST_CSV is gst/tabular.ts, RECORDS_CSV is core/util.ts (ROC, Tax). The shape check follows the
// same dialect exactly, so the cells it counts are the cells the reader builds: a quote the reader
// does not open can never hide rows or cells from the count. Results are unchanged for any file
// within the caps (csv-guard.test.ts and csv-parity.test.ts parse every fixture CSV both ways).
import { Worker } from "node:worker_threads";
import { XLSX_LIMITS, XLSX_PARSE_TIMEOUT_MS, XLSX_WORKER_HEAP_MB, XlsxLimitError, type XlsxProblem } from "./xlsx-guard";

export type CsvLimits = { maxRows: number; maxColumns: number; maxCells: number };
/** The XLSX caps: rows per sheet, columns, filled cells in all. */
export const CSV_LIMITS: Readonly<CsvLimits> = { maxRows: XLSX_LIMITS.maxRowsPerSheet, maxColumns: XLSX_LIMITS.maxColumns, maxCells: XLSX_LIMITS.maxCells };
/** CSV text this long and longer is parsed in a worker thread. */
export const CSV_WORKER_BYTES = 2 * 1024 * 1024;

/**
 * How a reader reads a field.
 *   quote  when a `"` outside quotes opens a quoted field:
 *          "blank"  the field so far is only whitespace, which is dropped (books/table.ts)
 *          "empty"  nothing has been read into the field yet (gst/tabular.ts)
 *          "any"    anywhere in the field, keeping what came before it (core/util.ts)
 *   trim   cells are trimmed (books) or kept as read (GST, ROC, Tax)
 * A filled cell is one whose value, as the reader returns it, is not empty.
 */
export type CsvDialect = { readonly quote: "blank" | "empty" | "any"; readonly trim: boolean };
export const BOOKS_CSV: CsvDialect = Object.freeze({ quote: "blank", trim: true });
export const GST_CSV: CsvDialect = Object.freeze({ quote: "empty", trim: false });
export const RECORDS_CSV: CsvDialect = Object.freeze({ quote: "any", trim: false });

/** The cells, and whether the text ended inside a quoted field (GST refuses that file). */
export type CsvRead = { rows: string[][]; openQuote: boolean };

const SPLIT = "Split it into smaller files (for example one month per file) and try again.";
const fmtInt = (n: number) => n.toLocaleString("en-IN");

function limitError(problem: XlsxProblem, limits: CsvLimits): XlsxLimitError {
  if (problem === "rows") return new XlsxLimitError("rows", `This CSV file has more than ${fmtInt(limits.maxRows)} rows, the most a file may have here. ${SPLIT}`);
  if (problem === "columns") return new XlsxLimitError("columns", `This CSV file has a row with more than ${fmtInt(limits.maxColumns)} columns. Remove the stray cells on the right and try again.`);
  return new XlsxLimitError("cells", `This CSV file has more than ${fmtInt(limits.maxCells)} filled cells in all. ${SPLIT}`);
}

/** One linear pass over the text, the reader's own quote rule: the first cap passed, or null. Plain JS for the worker. */
const SHAPE_SOURCE = `function csvShapeProblem(text, delim, limits, dialect) {
  const quote = dialect.quote, trim = dialect.trim;
  let rows = 0, cols = 0, cells = 0, quoted = false, empty = true, blank = true;
  const take = (c) => { empty = false; if (blank && c.trim() !== "") blank = false; };
  const endField = () => { cols++; if (trim ? !blank : !empty) cells++; empty = true; blank = true; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { i++; take(c); } else quoted = false; } else take(c); continue; }
    if (c === '"' && (quote === "any" || (quote === "empty" ? empty : blank))) { quoted = true; if (quote === "blank") { empty = true; blank = true; } continue; }
    if (c === delim) { endField(); if (cols > limits.maxColumns) return "columns"; if (cells > limits.maxCells) return "cells"; continue; }
    if (c === "\\n" || c === "\\r") { if (c === "\\r" && text[i + 1] === "\\n") i++; endField(); rows++; if (cols > limits.maxColumns) return "columns"; if (cells > limits.maxCells) return "cells"; if (rows > limits.maxRows) return "rows"; cols = 0; continue; }
    take(c);
  }
  if (!empty || cols > 0) { endField(); rows++; }
  if (cols > limits.maxColumns) return "columns";
  if (cells > limits.maxCells) return "cells";
  if (rows > limits.maxRows) return "rows";
  return null;
}`;

/** RFC 4180-style cells in the given dialect. Plain JS for the worker (the main-thread copy is `cells` below). */
const PARSE_SOURCE = `function csvCells(text, delim, dialect) {
  const quote = dialect.quote, trim = dialect.trim;
  const fin = (s) => (trim ? s.trim() : s);
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; continue; }
    if (c === '"' && (quote === "any" || (quote === "empty" ? field === "" : field.trim() === ""))) { quoted = true; if (quote === "blank") field = ""; }
    else if (c === delim) { row.push(fin(field)); field = ""; }
    else if (c === "\\n" || c === "\\r") { if (c === "\\r" && text[i + 1] === "\\n") i++; row.push(fin(field)); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  const openQuote = quoted;
  if (field !== "" || row.length) { row.push(fin(field)); rows.push(row); }
  return { rows, openQuote };
}`;

// The main-thread versions of the two functions above (the worker evaluates the plain-JS copies;
// csv-guard.test.ts checks that both give the same answers). Code is never built from strings here.
function shapeProblem(text: string, delim: string, limits: CsvLimits, dialect: CsvDialect): XlsxProblem | null {
  const { quote, trim } = dialect;
  let rows = 0;
  let cols = 0;
  let cells = 0;
  let quoted = false;
  // The field read so far: nothing at all (`empty`), or only whitespace (`blank`, String.trim's set).
  let empty = true;
  let blank = true;
  const take = (c: string) => {
    empty = false;
    if (blank && c.trim() !== "") blank = false;
  };
  const endField = () => {
    cols++;
    if (trim ? !blank : !empty) cells++;
    empty = true;
    blank = true;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          i++;
          take(c);
        } else quoted = false;
      } else take(c);
      continue;
    }
    if (c === '"' && (quote === "any" || (quote === "empty" ? empty : blank))) {
      quoted = true;
      if (quote === "blank") {
        empty = true;
        blank = true;
      }
      continue;
    }
    if (c === delim) {
      endField();
      if (cols > limits.maxColumns) return "columns";
      if (cells > limits.maxCells) return "cells";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endField();
      rows++;
      if (cols > limits.maxColumns) return "columns";
      if (cells > limits.maxCells) return "cells";
      if (rows > limits.maxRows) return "rows";
      cols = 0;
      continue;
    }
    take(c);
  }
  if (!empty || cols > 0) {
    endField();
    rows++;
  }
  if (cols > limits.maxColumns) return "columns";
  if (cells > limits.maxCells) return "cells";
  if (rows > limits.maxRows) return "rows";
  return null;
}

function cells(text: string, delim: string, dialect: CsvDialect): CsvRead {
  const { quote, trim } = dialect;
  const fin = (s: string) => (trim ? s.trim() : s);
  const rows: string[][] = [];
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
    if (c === '"' && (quote === "any" || (quote === "empty" ? field === "" : field.trim() === ""))) {
      quoted = true;
      if (quote === "blank") field = "";
    } else if (c === delim) {
      row.push(fin(field));
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(fin(field));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  const openQuote = quoted;
  if (field !== "" || row.length) {
    row.push(fin(field));
    rows.push(row);
  }
  return { rows, openQuote };
}

/** Throws XlsxLimitError when the CSV passes a cap (nothing is built). */
export function checkCsvShape(text: string, delim: string, limits: CsvLimits = CSV_LIMITS, dialect: CsvDialect = BOOKS_CSV): void {
  const p = shapeProblem(text, delim, limits, dialect);
  if (p) throw limitError(p, limits);
}

/** The cells of a CSV already within the caps, and whether it ended inside a quoted field. */
export function readCsvCells(text: string, delim: string, dialect: CsvDialect = BOOKS_CSV): CsvRead {
  return cells(text, delim, dialect);
}

/** The cells of a CSV already within the caps. */
export function parseCsvCells(text: string, delim: string, dialect: CsvDialect = BOOKS_CSV): string[][] {
  return cells(text, delim, dialect).rows;
}

const WORKER_SOURCE = `
const { parentPort, workerData: d } = require("node:worker_threads");
${SHAPE_SOURCE}
${PARSE_SOURCE}
const problem = csvShapeProblem(d.text, d.delim, d.limits, d.dialect);
if (problem) parentPort.postMessage({ ok: false, problem });
else { const r = csvCells(d.text, d.delim, d.dialect); parentPort.postMessage({ ok: true, rows: r.rows, openQuote: r.openQuote }); }
`;

export type CsvWorkerOptions = { dialect?: CsvDialect; limits?: CsvLimits; timeoutMs?: number };

/** Shape check and parse in a worker thread with a heap limit and the XLSX time budget. Falls back to inline when no worker can start. */
export function readCsvInWorker(text: string, delim: string, opts: CsvWorkerOptions = {}): Promise<CsvRead> {
  const dialect = opts.dialect ?? BOOKS_CSV;
  const limits = opts.limits ?? CSV_LIMITS;
  const timeoutMs = opts.timeoutMs ?? XLSX_PARSE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { text, delim, limits, dialect: { quote: dialect.quote, trim: dialect.trim } },
        resourceLimits: { maxOldGenerationSizeMb: XLSX_WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32 },
      });
    } catch {
      try {
        checkCsvShape(text, delim, limits, dialect);
        resolve(readCsvCells(text, delim, dialect));
      } catch (e) {
        reject(e);
      }
      return;
    }
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new XlsxLimitError("timeout", `This CSV file took too long to read, so reading stopped. ${SPLIT}`))), timeoutMs);
    worker.on("message", (m: { ok: true; rows: string[][]; openQuote: boolean } | { ok: false; problem: XlsxProblem }) =>
      finish(() => (m.ok ? resolve({ rows: m.rows, openQuote: m.openQuote }) : reject(limitError(m.problem, limits)))),
    );
    worker.on("error", (e: Error & { code?: string }) =>
      finish(() => reject(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? new XlsxLimitError("memory", `This CSV file needs more memory to read than is allowed. ${SPLIT}`) : e)),
    );
    worker.on("exit", (code) => finish(() => reject(new Error(`CSV reader stopped (exit ${code})`))));
  });
}

/** readCsvInWorker's cells only (the books reader's entry point). */
export async function parseCsvInWorker(
  text: string,
  delim: string,
  limits: CsvLimits = CSV_LIMITS,
  timeoutMs: number = XLSX_PARSE_TIMEOUT_MS,
  dialect: CsvDialect = BOOKS_CSV,
): Promise<string[][]> {
  return (await readCsvInWorker(text, delim, { dialect, limits, timeoutMs })).rows;
}

/** Shape check, then cells: inline below CSV_WORKER_BYTES, in a worker thread from there up. */
export async function readCsvGuarded(text: string, delim: string, dialect: CsvDialect = BOOKS_CSV, limits: CsvLimits = CSV_LIMITS): Promise<CsvRead> {
  if (text.length >= CSV_WORKER_BYTES) return readCsvInWorker(text, delim, { dialect, limits });
  checkCsvShape(text, delim, limits, dialect);
  return readCsvCells(text, delim, dialect);
}
