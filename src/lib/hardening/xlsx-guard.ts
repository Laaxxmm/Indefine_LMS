// XLSX decompression / CPU amplification limits (security audit #13).
//
// An .xlsx is a ZIP of XML. The upload limit only caps the compressed size, and ExcelJS
// materialises every row and cell of every sheet: a 168 KB file can unpack to 30,000 rows, and
// one cell at column XFD makes a reader walk 16,384 columns on every row. Before any workbook is
// parsed, inspectXlsx() walks the ZIP itself (central directory + node:zlib, streamed, nothing
// kept) and refuses, with a plain message, a file whose
//   - total unpacked size is over 64 MB, or one part unpacks more than 200× its packed size
//     (once that part passes 1 MB) — the classic ZIP bomb,
//   - has more than 2,000 parts, is encrypted, ZIP64, or damaged,
//   - has a sheet with more than 50,000 rows, a cell beyond column 256 (IV), more than
//     400,000 rows × columns (what a reader walks), or more than 300,000 cells in all.
// Measured on this codebase's ExcelJS: ~340 bytes of heap and ~6 µs per cell, so the caps hold a
// parse to roughly 100 MB / 2 s on the 384 MB heap.
//
// readWorkbookGrid() is the one way the agents read a workbook's cells (books/table.ts parseXlsx,
// core/preview.ts): it inspects first, then loads with ExcelJS exactly as before. A workbook
// above WORKER_THRESHOLD is parsed in a worker_thread with its own heap limit and a time budget
// (20 s), so a slow file cannot block the event loop or grow the main heap; the cell values come
// back by structured clone and the caller formats them exactly as an inline parse would.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createInflateRaw } from "node:zlib";
import ExcelJS from "exceljs";

const KB = 1024;
const MB = 1024 * KB;

export type XlsxLimits = {
  maxUncompressedBytes: number;
  maxEntryRatio: number;
  ratioFloorBytes: number;
  maxEntries: number;
  maxRowsPerSheet: number;
  maxColumns: number;
  maxDenseCellsPerSheet: number;
  maxCells: number;
};

export const XLSX_LIMITS: Readonly<XlsxLimits> = {
  maxUncompressedBytes: 64 * MB,
  maxEntryRatio: 200,
  ratioFloorBytes: 1 * MB,
  maxEntries: 2000,
  maxRowsPerSheet: 50_000,
  maxColumns: 256,
  maxDenseCellsPerSheet: 400_000,
  maxCells: 300_000,
};

/** Above this many cells (or this many unpacked bytes) a workbook is parsed in a worker thread. */
export const WORKER_THRESHOLD = { cells: 25_000, bytes: 8 * MB } as const;
export const XLSX_PARSE_TIMEOUT_MS = 20_000;
export const XLSX_WORKER_HEAP_MB = 192;

export type XlsxProblem = "zip" | "encrypted" | "entries" | "size" | "ratio" | "rows" | "columns" | "cells" | "timeout" | "memory";

export class XlsxLimitError extends Error {
  constructor(
    readonly problem: XlsxProblem,
    message: string,
  ) {
    super(message);
    this.name = "XlsxLimitError";
  }
}

export type SheetStats = { part: string; rows: number; cells: number; maxRow: number; maxColumn: number };
export type XlsxStats = { entries: number; compressedBytes: number; uncompressedBytes: number; cells: number; sheets: SheetStats[] };

const SPLIT = "Split it into smaller files (for example one month or one sheet per file) and try again.";
const fmtMb = (n: number) => `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`;
const fmtInt = (n: number) => n.toLocaleString("en-IN");
const seconds = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s} second${s === 1 ? "" : "s"}`;
};

/** "A" → 1, "XFD" → 16384. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
/** 1 → "A", 256 → "IV". */
export function columnLetters(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const damaged = () => new XlsxLimitError("zip", "This file is not a readable spreadsheet (the .xlsx package is damaged). Save it again from Excel and re-upload.");

type Entry = { name: string; method: number; flags: number; compressedSize: number; localOffset: number };

/** The central directory of a ZIP. Throws XlsxLimitError for anything unusual. */
function centralDirectory(buf: Buffer, limits: XlsxLimits): Entry[] {
  if (buf.length < 22) throw damaged();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw damaged();
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new XlsxLimitError("zip", "This spreadsheet is saved in an extra-large file format that is not accepted. Save it again from Excel and re-upload.");
  if (total > limits.maxEntries) throw new XlsxLimitError("entries", `This spreadsheet has ${fmtInt(total)} parts inside it; the limit is ${fmtInt(limits.maxEntries)}. ${SPLIT}`);
  if (cdOffset + cdSize > buf.length) throw damaged();
  const out: Entry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw damaged();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > buf.length) throw damaged();
    const name = buf.toString("latin1", p + 46, p + 46 + nameLen);
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      // Per-entry ZIP64 sizes (some streaming writers): read them from the 0x0001 extra field.
      const z = zip64Extra(buf, p + 46 + nameLen, extraLen, buf.readUInt32LE(p + 24) === 0xffffffff, compressedSize === 0xffffffff, localOffset === 0xffffffff);
      if (!z) throw damaged();
      if (z.compressed !== undefined) compressedSize = z.compressed;
      if (z.offset !== undefined) localOffset = z.offset;
    }
    out.push({ name, method, flags, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zip64Extra(buf: Buffer, start: number, len: number, hasUncompressed: boolean, hasCompressed: boolean, hasOffset: boolean): { compressed?: number; offset?: number } | null {
  for (let q = start; q + 4 <= start + len; ) {
    const id = buf.readUInt16LE(q);
    const size = buf.readUInt16LE(q + 2);
    if (id === 0x0001) {
      let r = q + 4;
      const read = () => {
        if (r + 8 > q + 4 + size) return null;
        const v = Number(buf.readBigUInt64LE(r));
        r += 8;
        return Number.isSafeInteger(v) ? v : null;
      };
      const out: { compressed?: number; offset?: number } = {};
      if (hasUncompressed && read() === null) return null;
      if (hasCompressed) {
        const v = read();
        if (v === null) return null;
        out.compressed = v;
      }
      if (hasOffset) {
        const v = read();
        if (v === null) return null;
        out.offset = v;
      }
      return out;
    }
    q += 4 + size;
  }
  return null;
}

const SHEET_PART = /^xl\/worksheets\/[^/]+\.xml$/i;
const TAG = /<(?:[A-Za-z_][\w.-]*:)?(row|c)(?=[\s>/])([^>]*)>/g;
const CELL_REF = /\br="([A-Za-z]{1,3})(\d{1,7})"/;
const ROW_REF = /\br="(\d{1,7})"/;

/** Counts rows / cells / the furthest cell in sheet XML arriving in chunks. */
class SheetScanner {
  rows = 0;
  cells = 0;
  maxRow = 0;
  maxColumn = 0;
  private cellsInRow = 0;
  private carry = "";
  constructor(readonly part: string) {}

  push(chunk: Buffer) {
    let text = this.carry + chunk.toString("latin1");
    const lt = text.lastIndexOf("<");
    const gt = text.lastIndexOf(">");
    if (lt > gt) {
      // An open tag continues in the next chunk; keep it (bounded — a real tag is short).
      this.carry = text.length - lt <= 8 * KB ? text.slice(lt) : "";
      text = text.slice(0, lt);
    } else this.carry = "";
    for (const m of text.matchAll(TAG)) {
      if (m[1] === "row") {
        this.rows++;
        this.cellsInRow = 0;
        const r = ROW_REF.exec(m[2]);
        this.maxRow = Math.max(this.maxRow, r ? Number(r[1]) : this.maxRow + 1);
      } else {
        this.cells++;
        this.cellsInRow++;
        const ref = CELL_REF.exec(m[2]);
        this.maxColumn = Math.max(this.maxColumn, ref ? columnIndex(ref[1]) : this.cellsInRow);
        if (ref) this.maxRow = Math.max(this.maxRow, Number(ref[2]));
      }
    }
  }

  stats(): SheetStats {
    return { part: this.part, rows: this.rows, cells: this.cells, maxRow: this.maxRow, maxColumn: this.maxColumn };
  }
}

/** Streams one deflated entry through zlib, counting what comes out; stops as soon as a limit is crossed. */
function inflateCounting(data: Buffer, onChunk: (chunk: Buffer) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const z = createInflateRaw({ chunkSize: 64 * KB });
    let out = 0;
    let failed = false;
    z.on("data", (chunk: Buffer) => {
      if (failed) return;
      out += chunk.length;
      try {
        onChunk(chunk);
      } catch (e) {
        failed = true;
        z.destroy();
        reject(e);
      }
    });
    z.on("error", () => {
      if (!failed) {
        failed = true;
        reject(damaged());
      }
    });
    z.on("end", () => {
      if (!failed) resolve(out);
    });
    z.end(data);
  });
}

/**
 * Inspects a ZIP-based upload (xlsx, docx, …) without materialising it. Resolves with the sizes and
 * per-sheet counts, or throws XlsxLimitError with a message fit to show the person.
 */
export async function inspectXlsx(bytes: Uint8Array, limits: XlsxLimits = XLSX_LIMITS): Promise<XlsxStats> {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = centralDirectory(buf, limits);
  let total = 0;
  let compressed = 0;
  let cells = 0;
  const sheets: SheetStats[] = [];
  for (const e of entries) {
    if (e.flags & 0x1) throw new XlsxLimitError("encrypted", "This spreadsheet is password-protected. Remove the password in Excel and re-upload.");
    const lo = e.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw damaged();
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    if (start + e.compressedSize > buf.length) throw damaged();
    const data = buf.subarray(start, start + e.compressedSize);
    compressed += e.compressedSize;
    const scanner = SHEET_PART.test(e.name) ? new SheetScanner(e.name) : null;
    let entryOut = 0;
    const onChunk = (chunk: Buffer) => {
      entryOut += chunk.length;
      if (total + entryOut > limits.maxUncompressedBytes) {
        throw new XlsxLimitError("size", `This spreadsheet unpacks to more than ${fmtMb(limits.maxUncompressedBytes)}, which is too large to read safely. ${SPLIT}`);
      }
      if (entryOut > limits.ratioFloorBytes && entryOut > limits.maxEntryRatio * Math.max(1, e.compressedSize)) {
        throw new XlsxLimitError("ratio", `This spreadsheet is packed far more tightly than a normal Excel file (a part unpacks over ${limits.maxEntryRatio}× its size), so it was not opened. Save it again from Excel and re-upload.`);
      }
      scanner?.push(chunk);
      if (scanner) checkSheet(scanner.stats(), cells + scanner.cells, limits);
    };
    if (e.method === 0) onChunk(data);
    else if (e.method === 8) await inflateCounting(data, onChunk);
    else throw new XlsxLimitError("zip", "This spreadsheet uses a compression method Excel does not write. Save it again from Excel and re-upload.");
    total += entryOut;
    if (scanner) {
      sheets.push(scanner.stats());
      cells += scanner.cells;
    }
  }
  return { entries: entries.length, compressedBytes: compressed, uncompressedBytes: total, cells, sheets };
}

function checkSheet(s: SheetStats, cellsSoFar: number, limits: XlsxLimits) {
  const name = s.part.replace(/^xl\/worksheets\//i, "").replace(/\.xml$/i, "");
  if (s.maxRow > limits.maxRowsPerSheet) throw new XlsxLimitError("rows", `Sheet ${name} has more than ${fmtInt(limits.maxRowsPerSheet)} rows, the most a single sheet may have here. ${SPLIT}`);
  if (s.maxColumn > limits.maxColumns) {
    throw new XlsxLimitError("columns", `Sheet ${name} has data in column ${columnLetters(s.maxColumn)}; the furthest column read here is ${columnLetters(limits.maxColumns)} (${limits.maxColumns}). Delete the stray cells on the right and re-upload.`);
  }
  if (s.maxRow * s.maxColumn > limits.maxDenseCellsPerSheet) {
    throw new XlsxLimitError("cells", `Sheet ${name} spans ${fmtInt(s.maxRow)} rows × ${fmtInt(s.maxColumn)} columns, more than the ${fmtInt(limits.maxDenseCellsPerSheet)} cells a sheet may span here. ${SPLIT}`);
  }
  if (cellsSoFar > limits.maxCells) throw new XlsxLimitError("cells", `This spreadsheet has more than ${fmtInt(limits.maxCells)} filled cells in all. ${SPLIT}`);
}

/** Does this look like a ZIP (xlsx / docx) by its first bytes? */
export const isZipBytes = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

// ------------------------------------------------------------------ reading cells

export type GridSheet = {
  name: string;
  rowCount: number;
  columnCount: number;
  /** values[r-1][c-1] = row r, column c's ExcelJS value (merged cells repeat their master's value). */
  values: ExcelJS.CellValue[][];
  /** Same shape as values, when asked for. */
  numFmts?: (string | undefined)[][];
};

export type GridOptions = {
  /** Read at most this many rows / columns per sheet (all when omitted). */
  maxRows?: number;
  maxCols?: number;
  numFmt?: boolean;
  /** "auto": a worker above WORKER_THRESHOLD. Tests force one path. */
  mode?: "auto" | "inline" | "worker";
  timeoutMs?: number;
  limits?: XlsxLimits;
};

/** The loop, inline. Keep in step with WORKER_SOURCE below (the equivalence test compares them). */
async function gridInline(bytes: Uint8Array, opts: GridOptions): Promise<GridSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheets: GridSheet[] = [];
  wb.eachSheet((ws) => {
    const lastRow = opts.maxRows === undefined ? ws.rowCount : Math.min(ws.rowCount, opts.maxRows);
    const lastCol = opts.maxCols === undefined ? ws.columnCount : Math.min(ws.columnCount, opts.maxCols);
    const values: ExcelJS.CellValue[][] = [];
    const numFmts: (string | undefined)[][] | undefined = opts.numFmt ? [] : undefined;
    for (let r = 1; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const vs: ExcelJS.CellValue[] = [];
      const fs: (string | undefined)[] = [];
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        vs.push(cell.value);
        if (numFmts) fs.push(cell.numFmt);
      }
      values.push(vs);
      if (numFmts) numFmts.push(fs);
    }
    sheets.push({ name: ws.name, rowCount: ws.rowCount, columnCount: ws.columnCount, values, ...(numFmts ? { numFmts } : {}) });
  });
  return sheets;
}

// Runs in the worker (plain JS, evaluated; exceljs resolved from the app's node_modules).
const WORKER_SOURCE = `
const { parentPort, workerData: d } = require("node:worker_threads");
const ExcelJS = require(d.exceljs);
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(d.bytes));
  const sheets = [];
  wb.eachSheet((ws) => {
    const lastRow = d.maxRows == null ? ws.rowCount : Math.min(ws.rowCount, d.maxRows);
    const lastCol = d.maxCols == null ? ws.columnCount : Math.min(ws.columnCount, d.maxCols);
    const values = [];
    const numFmts = d.numFmt ? [] : undefined;
    for (let r = 1; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const vs = [];
      const fs = [];
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        vs.push(cell.value);
        if (numFmts) fs.push(cell.numFmt);
      }
      values.push(vs);
      if (numFmts) numFmts.push(fs);
    }
    const s = { name: ws.name, rowCount: ws.rowCount, columnCount: ws.columnCount, values };
    if (numFmts) s.numFmts = numFmts;
    sheets.push(s);
  });
  parentPort.postMessage({ ok: true, sheets });
})().catch((e) => parentPort.postMessage({ ok: false, message: String((e && e.message) || e) }));
`;

let exceljsPath: string | null | undefined;
/**
 * The exceljs package folder under the app root (`next start` runs from it; so do the tests). The
 * worker's own Node `require` loads it by folder (package.json "main"), outside the server bundle;
 * a plain path keeps the bundler from trying to resolve it at build time.
 */
function resolveExceljs(): string | null {
  if (exceljsPath === undefined) {
    const dir = join(process.cwd(), "node_modules", "exceljs");
    exceljsPath = existsSync(join(dir, "package.json")) ? dir : null;
  }
  return exceljsPath;
}

class WorkerUnavailable extends Error {}

function gridInWorker(bytes: Uint8Array, opts: GridOptions): Promise<GridSheet[]> {
  const exceljs = resolveExceljs();
  if (!exceljs) return Promise.reject(new WorkerUnavailable("exceljs not resolvable from the app root"));
  const timeoutMs = opts.timeoutMs ?? XLSX_PARSE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { exceljs, bytes: new Uint8Array(bytes), maxRows: opts.maxRows ?? null, maxCols: opts.maxCols ?? null, numFmt: !!opts.numFmt },
        resourceLimits: { maxOldGenerationSizeMb: XLSX_WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32 },
      });
    } catch (e) {
      reject(new WorkerUnavailable((e as Error).message));
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
    const timer = setTimeout(
      () => finish(() => reject(new XlsxLimitError("timeout", `This spreadsheet took longer than ${seconds(timeoutMs)} to read, so reading stopped. ${SPLIT}`))),
      timeoutMs,
    );
    worker.on("message", (m: { ok: true; sheets: GridSheet[] } | { ok: false; message: string }) =>
      finish(() => (m.ok ? resolve(m.sheets) : reject(new Error(m.message)))),
    );
    worker.on("error", (e: Error & { code?: string }) =>
      finish(() =>
        reject(
          e.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? new XlsxLimitError("memory", `This spreadsheet needs more memory to read than is allowed. ${SPLIT}`)
            : e.code === "MODULE_NOT_FOUND"
              ? new WorkerUnavailable(e.message)
              : e,
        ),
      ),
    );
    worker.on("exit", (code) => finish(() => reject(new Error(`spreadsheet reader stopped (exit ${code})`))));
  });
}

let warnedNoWorker = false;

/**
 * Every sheet's cells as ExcelJS values (same walk as `for r ≤ rowCount, c ≤ columnCount:
 * row.getCell(c).value`), after inspectXlsx() has passed the file. Throws XlsxLimitError (plain
 * message) for a file over the limits or too slow to read.
 */
export async function readWorkbookGrid(bytes: Uint8Array, opts: GridOptions = {}): Promise<GridSheet[]> {
  const stats = await inspectXlsx(bytes, opts.limits);
  const mode = opts.mode ?? "auto";
  const big = stats.cells > WORKER_THRESHOLD.cells || stats.uncompressedBytes > WORKER_THRESHOLD.bytes;
  if (mode === "inline" || (mode === "auto" && !big)) return gridInline(bytes, opts);
  try {
    return await gridInWorker(bytes, opts);
  } catch (e) {
    if (!(e instanceof WorkerUnavailable)) throw e;
    // No worker possible here (exceljs not on disk next to the app): the limits above still hold.
    if (!warnedNoWorker) {
      warnedNoWorker = true;
      console.warn(`[xlsx] worker unavailable (${e.message}); parsing on the main thread within the size limits`);
    }
    return gridInline(bytes, opts);
  }
}
