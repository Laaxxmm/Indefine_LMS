// Re-audit NEW-11 follow-up: the GST CSV reader (gst/tabular.ts) and the ROC / Tax reader
// (core/util.ts) had no row, column or cell cap — a 6 MB CSV of one-character cells built ~3 million
// cells on the main thread. Both now use csv-guard.ts in their own dialect: the caps are checked
// before any cell is built, a large file is read in a worker thread, and every fixture CSV parses
// exactly as before (the old readers are copied below and every fixture is parsed both ways).
//
// The shape check follows each reader's own quote rule. Counting with one rule for all three let a
// quote the reader does not open hide the rest of the file from the count: the books reader opens a
// quote after a tab (`field.trim() === ""`) while the old check only skipped spaces, so
// `\t"x\n"` followed by any number of cells passed the check and every cell was built.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv as booksParseCsv } from "@/lib/agents/books/table";
import { parseCsv as recordsParseCsv, parseCsvSafe as recordsParseCsvSafe, readCsvAhead, csvRecords } from "@/lib/agents/core/util";
import { parseCsv as gstParseCsv, parseCsvSafe as gstParseCsvSafe } from "@/lib/agents/gst/tabular";
import { GstParseError } from "@/lib/agents/gst/money";
import type { InputFile } from "@/lib/agents/core/runner";
import { ROC_CSV_FILES, parseRocFiles, rocInputSchema } from "@/lib/agents/roc/parse";
import { TAX_CSV_FILES, parseTaxFiles, taxInputSchema } from "@/lib/agents/tax/parse";
import { isPlainMessage } from "@/lib/errors";
import { BOOKS_CSV, CSV_LIMITS, CSV_WORKER_BYTES, GST_CSV, RECORDS_CSV, checkCsvShape, readCsvCells, readCsvInWorker, type CsvDialect } from "./csv-guard";
import { XlsxLimitError } from "./xlsx-guard";

const MB = 1024 * 1024;

// ------------------------------------------------------------------ the readers as they were

/** gst/tabular.ts parseCsv before the caps (verbatim). */
function legacyGstParseCsv(text: string): (string | number | Date | null)[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length }));
  const delim = counts.sort((a, b) => b.n - a.n)[0].d;
  const rows: (string | number | Date | null)[][] = [];
  let row: (string | number | Date | null)[] = [];
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

/** core/util.ts parseCsv before the caps (verbatim). */
function legacyRecordsParseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r, i) => {
    if (r.length > headers.length) throw new Error(`CSV row ${i + 2} has ${r.length} fields but the header has ${headers.length}; quote amounts that contain commas`);
    return Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? "").trim()]));
  });
}

/** books/table.ts parseCsv before the caps (verbatim; csv-guard.test.ts holds the same copy). */
function legacyBooksParseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const first = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts: [string, number][] = [",", ";", "\t", "|"].map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 0 ? counts[0][0] : ",";
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

// ------------------------------------------------------------------ helpers

type Outcome = { value: unknown } | { error: string; name: string };
function outcome(fn: () => unknown): Outcome {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: (e as Error).message, name: (e as Error).name };
  }
}

const ROOT = join(__dirname, "..", "..", "..");
function fixtureCsvs(): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.csv$/i.test(e)) files.push(p);
    }
  };
  walk(join(ROOT, "fixtures"));
  walk(join(ROOT, "tests", "fixtures"));
  return files.sort();
}

const TRICKY = ['a,"b ""q"" c",d\r\nx,,y', ' "lead" , trail ,\n', "only", "", "a;b;c\n1;2;3", "a\tb\n1\t2", 'x"y,z"w\n1,2', '"open,\nnever closed', "﻿h1,h2\n1,2\n\n\n", '\t"tab, quote"\n'];

/** `n` lines of `perLine` one-character cells (a filled-cell attack that stays under the row and column caps). */
const cellFlood = (perLine: number, lines: number, delim = ",") => `${Array(perLine).fill("x").join(delim)}\n`.repeat(lines);

// ------------------------------------------------------------------ tests

describe("CSV caps on the GST and ROC / Tax readers (NEW-11 follow-up)", () => {
  it("PoC: a 6 MB CSV of one-character cells is refused by both readers, quickly and in a plain sentence, before any cell is built", () => {
    const text = "a,b,c,d,e,f,g,h,i,j\n".repeat((6 * MB) / 20);
    for (const parse of [gstParseCsv, recordsParseCsv] as ((t: string) => unknown)[]) {
      const t0 = Date.now();
      let err: unknown = null;
      try {
        parse(text);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(XlsxLimitError);
      expect((err as Error).message).toMatch(/more than 3,00,000 filled cells/);
      expect(isPlainMessage((err as Error).message)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(2000);
    }
  }, 30_000);

  it("rows and columns are capped too, in each reader's dialect", () => {
    expect(() => gstParseCsv("x\n".repeat(CSV_LIMITS.maxRows + 1))).toThrow(/more than 50,000 rows/);
    expect(() => recordsParseCsv("h\n" + "x\n".repeat(CSV_LIMITS.maxRows))).toThrow(/more than 50,000 rows/);
    expect(() => gstParseCsv(`${"x,".repeat(CSV_LIMITS.maxColumns)}x\n`)).toThrow(/more than 256 columns/);
    expect(() => recordsParseCsv(`${"x,".repeat(CSV_LIMITS.maxColumns)}x\n`)).toThrow(/more than 256 columns/);
  });

  it("a quote the reader does not open cannot hide cells from the count (each reader's own quote rule)", () => {
    const flood = cellFlood(100, 3_100); // 3,10,000 cells
    // GST opens a quote only at the very start of a field: after a space it is an ordinary character.
    expect(() => gstParseCsv(` "x\n${flood}`)).toThrow(/filled cells/);
    // ROC / Tax open a quote anywhere: `a"b⏎"` is one field, and everything after it is cells.
    expect(() => recordsParseCsv(`a"b\n"${flood}`)).toThrow(/filled cells/);
    // Books open a quote after any whitespace (tab included): the old check stopped at spaces.
    expect(() => booksParseCsv(`\t"x\n"${flood}`)).toThrow(/filled cells/);
    expect(() => booksParseCsv(`"" \t"x\n"${flood}`)).toThrow(/filled cells/);
    // And a quote each reader does open still hides delimiters and newlines inside it.
    for (const [d, parse] of [
      [GST_CSV, gstParseCsv],
      [RECORDS_CSV, recordsParseCsv],
      [BOOKS_CSV, booksParseCsv],
    ] as [CsvDialect, (t: string) => unknown][]) {
      expect(() => checkCsvShape(`h\n"${",\n".repeat(CSV_LIMITS.maxRows + 5)}"\n`, ",", CSV_LIMITS, d)).not.toThrow();
      expect(() => parse(`h\n"${",\n".repeat(CSV_LIMITS.maxRows + 5)}"\n`)).not.toThrow();
    }
  });

  it("the counted cells are exactly the cells each reader builds", () => {
    const samples = [...TRICKY, ...fixtureCsvs().filter((_, i) => i % 25 === 0).map((f) => readFileSync(f, "utf8"))];
    for (const d of [BOOKS_CSV, GST_CSV, RECORDS_CSV]) {
      for (const t of samples) {
        const built = readCsvCells(t, ",", d).rows;
        const filled = built.flat().filter((c) => c !== "").length;
        const widest = Math.max(0, ...built.map((r) => r.length));
        // One fewer of anything is refused; the exact count is allowed.
        expect(() => checkCsvShape(t, ",", { maxRows: built.length, maxColumns: widest, maxCells: filled }, d), t).not.toThrow();
        if (filled > 0) expect(() => checkCsvShape(t, ",", { maxRows: built.length, maxColumns: widest, maxCells: filled - 1 }, d), t).toThrow(/filled cells/);
        if (built.length > 0) expect(() => checkCsvShape(t, ",", { maxRows: built.length - 1, maxColumns: widest, maxCells: filled }, d), t).toThrow(/rows/);
      }
    }
  });

  it("a large file goes through a worker thread, with the same result as inline", async () => {
    const gstLine = 'INV-1,"Acme, Traders",2026-10-05,"1,500.00",29AAACE1234F1Z2\n';
    const gstText = `Invoice No,Party,Date,Amount,GSTIN\n${gstLine.repeat(Math.ceil((2.2 * MB) / gstLine.length))}`;
    expect(gstText.length).toBeGreaterThanOrEqual(CSV_WORKER_BYTES);
    expect(await gstParseCsvSafe(gstText)).toEqual(gstParseCsv(gstText));
    const recLine = '01234567,"Rao, Asha",Director,active,2026-04-01,yes\n';
    const recText = `din,name,designation,din_status,kyc_completed_on,resident_in_india\n${recLine.repeat(Math.ceil((2.2 * MB) / recLine.length))}`;
    expect(await recordsParseCsvSafe(recText)).toEqual(recordsParseCsv(recText));
    // Over the caps in the worker: the same plain sentence.
    await expect(gstParseCsvSafe(cellFlood(10, 31_000) + " ".repeat(2 * MB))).rejects.toThrow(/filled cells/);
    await expect(recordsParseCsvSafe(cellFlood(10, 31_000) + " ".repeat(2 * MB))).rejects.toThrow(/filled cells/);
    // An open quote in GST is still refused on the worker path.
    await expect(gstParseCsvSafe(`a,b\n"open${" ".repeat(2 * MB)}`)).rejects.toThrow(GstParseError);
    // The worker's plain-JS copies agree with the main-thread functions, in every dialect, refusals included.
    const attack: [CsvDialect, string][] = [
      [GST_CSV, ` "x\n`],
      [RECORDS_CSV, `a"b\n"`],
      [BOOKS_CSV, `\t"x\n"`],
    ];
    for (const [d, lead] of attack) {
      for (const t of TRICKY) expect(await readCsvInWorker(t, ",", { dialect: d }), `${d.quote} ${t}`).toEqual(readCsvCells(t, ",", d));
      await expect(readCsvInWorker(lead + cellFlood(100, 3_100), ",", { dialect: d })).rejects.toThrow(/filled cells/);
      expect(() => checkCsvShape(lead + cellFlood(100, 3_100), ",", CSV_LIMITS, d)).toThrow(/filled cells/);
    }
  }, 120_000);

  it("ROC and Tax read a large CSV in a worker before their synchronous parse, and report a refusal as an input problem", async () => {
    const big = Buffer.from(`din,name\n${`01234567,${"x".repeat(90)}\n`.repeat(22_000)}`); // 2.2 MB, 22,001 rows
    const tooMany = Buffer.from(cellFlood(10, 31_000) + " ".repeat(2 * MB));
    const files = [
      { name: "Directors.csv", source: "fixture", bytes: big },
      { name: "msme.csv", source: "fixture", bytes: tooMany },
      { name: "shareholding.csv", source: "fixture", bytes: Buffer.from("folio,holder\n") }, // small: parsed in place
    ];
    const ahead = await readCsvAhead(files, ["directors.csv", "msme.csv", "shareholding.csv"]);
    expect(ahead.size).toBe(2);
    expect(csvRecords(files[0], ahead)).toEqual(recordsParseCsv(big.toString("utf8")));
    expect(() => csvRecords(files[1], ahead)).toThrow(/filled cells/);
    expect(csvRecords(files[2], ahead)).toEqual([]);
    const rocFiles = [{ name: "msme.csv", source: "fixture", bytes: tooMany }] as InputFile[];
    const rocAhead = await readCsvAhead(rocFiles, ROC_CSV_FILES);
    expect(() => parseRocFiles(rocFiles, rocAhead)).toThrow(/company\.json is missing.*filled cells/);
    expect((await rocInputSchema.safeParseAsync(rocFiles)).success).toBe(false);
    const taxFiles = [{ name: "ais.csv", source: "fixture", bytes: tooMany }] as InputFile[];
    const taxAhead = await readCsvAhead(taxFiles, TAX_CSV_FILES);
    expect(() => parseTaxFiles(taxFiles, taxAhead)).toThrow(/filled cells/);
    expect((await taxInputSchema.safeParseAsync(taxFiles)).success).toBe(false);
  }, 120_000);
});

describe("fixture parity: every fixture CSV parses exactly as before, in all three readers", () => {
  const files = fixtureCsvs();

  it("finds the fixture CSVs", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("old and new readers give the same cells (or the same error) for every fixture CSV", () => {
    let compared = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(outcome(() => gstParseCsv(text)), `gst ${f}`).toEqual(outcome(() => legacyGstParseCsv(text)));
      expect(outcome(() => recordsParseCsv(text)), `records ${f}`).toEqual(outcome(() => legacyRecordsParseCsv(text)));
      expect(outcome(() => booksParseCsv(text)), `books ${f}`).toEqual(outcome(() => legacyBooksParseCsv(text)));
      compared += 3;
    }
    for (const t of TRICKY) {
      expect(outcome(() => gstParseCsv(t)), t).toEqual(outcome(() => legacyGstParseCsv(t)));
      expect(outcome(() => recordsParseCsv(t)), t).toEqual(outcome(() => legacyRecordsParseCsv(t)));
      expect(outcome(() => booksParseCsv(t)), t).toEqual(outcome(() => legacyBooksParseCsv(t)));
    }
    expect(compared).toBe(files.length * 3);
  });

  it("the worker path gives the same cells as inline for every fixture CSV, in all three dialects", async () => {
    const texts = files.map((f) => [f, readFileSync(f, "utf8").replace(/^﻿/, "")] as const);
    for (const d of [BOOKS_CSV, GST_CSV, RECORDS_CSV]) {
      for (let i = 0; i < texts.length; i += 32) {
        const batch = texts.slice(i, i + 32);
        const results = await Promise.all(batch.map(([, t]) => readCsvInWorker(t, ",", { dialect: d })));
        batch.forEach(([f, t], k) => expect(results[k], `${d.quote} ${f}`).toEqual(readCsvCells(t, ",", d)));
      }
    }
  }, 180_000);
});
