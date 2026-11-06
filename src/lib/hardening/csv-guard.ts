// CSV limits for agent inputs (re-audit NEW-11). The XLSX guard (xlsx-guard.ts) caps rows, columns
// and cells and parses a large workbook in a worker thread; a CSV under the 25 MB input cap had no
// cap at all ("a,b,c…" × 6 MB = 3 million cells, all held in memory on the main thread). The same
// caps now apply to CSV, checked in one linear pass BEFORE any cell is built, and a large CSV is
// parsed in a worker thread with its own heap limit and time budget, like a large workbook.
//
//   checkCsvShape(text, delim)  throws XlsxLimitError (plain sentence) when a row, column or
//                               filled-cell cap is passed; allocates nothing
//   parseCsvCells(text, delim)  RFC 4180-style cells (quoted fields, doubled quotes, CRLF / LF)
//   parseCsvInWorker(text)      the same parse in a worker (CSV_WORKER_BYTES and up)
//
// Results are unchanged for any file within the caps: books/table.ts parseCsv is this parser.
import { Worker } from "node:worker_threads";
import { XLSX_LIMITS, XLSX_PARSE_TIMEOUT_MS, XLSX_WORKER_HEAP_MB, XlsxLimitError, type XlsxProblem } from "./xlsx-guard";

export type CsvLimits = { maxRows: number; maxColumns: number; maxCells: number };
/** The XLSX caps: rows per sheet, columns, filled cells in all. */
export const CSV_LIMITS: Readonly<CsvLimits> = { maxRows: XLSX_LIMITS.maxRowsPerSheet, maxColumns: XLSX_LIMITS.maxColumns, maxCells: XLSX_LIMITS.maxCells };
/** CSV text this long and longer is parsed in a worker thread. */
export const CSV_WORKER_BYTES = 2 * 1024 * 1024;

const SPLIT = "Split it into smaller files (for example one month per file) and try again.";
const fmtInt = (n: number) => n.toLocaleString("en-IN");

function limitError(problem: XlsxProblem, limits: CsvLimits): XlsxLimitError {
  if (problem === "rows") return new XlsxLimitError("rows", `This CSV file has more than ${fmtInt(limits.maxRows)} rows, the most a file may have here. ${SPLIT}`);
  if (problem === "columns") return new XlsxLimitError("columns", `This CSV file has a row with more than ${fmtInt(limits.maxColumns)} columns. Remove the stray cells on the right and try again.`);
  return new XlsxLimitError("cells", `This CSV file has more than ${fmtInt(limits.maxCells)} filled cells in all. ${SPLIT}`);
}

/**
 * One linear pass over the text (quotes respected): the first cap passed, or null. Shared by the
 * main thread and the worker source below (kept as plain JS so both run the same code).
 */
const SHAPE_SOURCE = `function csvShapeProblem(text, delim, limits) {
  let rows = 0, cols = 0, cells = 0, filled = false, quoted = false, fieldStart = true;
  const endField = () => { cols++; if (filled) cells++; filled = false; fieldStart = true; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { i++; filled = true; } else quoted = false; } else filled = true; continue; }
    if (c === '"' && fieldStart) { quoted = true; fieldStart = false; continue; }
    if (c === delim) { endField(); if (cols > limits.maxColumns) return "columns"; if (cells > limits.maxCells) return "cells"; continue; }
    if (c === "\\n" || c === "\\r") { if (c === "\\r" && text[i + 1] === "\\n") i++; endField(); rows++; if (cols > limits.maxColumns) return "columns"; if (cells > limits.maxCells) return "cells"; if (rows > limits.maxRows) return "rows"; cols = 0; continue; }
    if (c !== " " && c !== "\\t") filled = true;
    if (c !== " ") fieldStart = false;
  }
  if (!fieldStart || cols > 0 || filled) { endField(); rows++; }
  if (cols > limits.maxColumns) return "columns";
  if (cells > limits.maxCells) return "cells";
  if (rows > limits.maxRows) return "rows";
  return null;
}`;

/** RFC 4180-style cells; the same code runs inline and in the worker. */
const PARSE_SOURCE = `function csvCells(text, delim) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; continue; }
    if (c === '"' && field.trim() === "") { quoted = true; field = ""; }
    else if (c === delim) { row.push(field.trim()); field = ""; }
    else if (c === "\\n" || c === "\\r") { if (c === "\\r" && text[i + 1] === "\\n") i++; row.push(field.trim()); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}`;

// One definition, two runtimes: the inline functions are built from the same constant source the
// worker evaluates (no input ever reaches new Function).
const shapeProblem = new Function(`${SHAPE_SOURCE}; return csvShapeProblem;`)() as (text: string, delim: string, limits: CsvLimits) => XlsxProblem | null;
const cells =new Function(`${PARSE_SOURCE}; return csvCells;`)() as (text: string, delim: string) => string[][];

/** Throws XlsxLimitError when the CSV passes a cap (nothing is built). */
export function checkCsvShape(text: string, delim: string, limits: CsvLimits = CSV_LIMITS): void {
  const p = shapeProblem(text, delim, limits);
  if (p) throw limitError(p, limits);
}

/** The cells of a CSV already within the caps. */
export function parseCsvCells(text: string, delim: string): string[][] {
  return cells(text, delim);
}

const WORKER_SOURCE = `
const { parentPort, workerData: d } = require("node:worker_threads");
${SHAPE_SOURCE}
${PARSE_SOURCE}
const problem = csvShapeProblem(d.text, d.delim, d.limits);
parentPort.postMessage(problem ? { ok: false, problem } : { ok: true, rows: csvCells(d.text, d.delim) });
`;

/** Shape check and parse in a worker thread with a heap limit and the XLSX time budget. Falls back to inline when no worker can start. */
export function parseCsvInWorker(text: string, delim: string, limits: CsvLimits = CSV_LIMITS, timeoutMs: number = XLSX_PARSE_TIMEOUT_MS): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { text, delim, limits }, resourceLimits: { maxOldGenerationSizeMb: XLSX_WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32 } });
    } catch {
      checkCsvShape(text, delim, limits);
      resolve(parseCsvCells(text, delim));
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
    worker.on("message", (m: { ok: true; rows: string[][] } | { ok: false; problem: XlsxProblem }) => finish(() => (m.ok ? resolve(m.rows) : reject(limitError(m.problem, limits)))));
    worker.on("error", (e: Error & { code?: string }) =>
      finish(() => reject(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? new XlsxLimitError("memory", `This CSV file needs more memory to read than is allowed. ${SPLIT}`) : e)),
    );
    worker.on("exit", (code) => finish(() => reject(new Error(`CSV reader stopped (exit ${code})`))));
  });
}
