// Re-audit NEW-11 (LOW): a CSV under the 25 MB input cap had no row / cell cap — 6 MB of one-character
// cells built ~3 million cells on the main thread. Ported from the re-audit PoC platform-csv.test.ts.
// The XLSX caps now apply to CSV before any cell is built; a large CSV is parsed in a worker thread;
// results within the caps are unchanged (every fixture CSV parses to the same cells as before).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvSafe, readTable } from "@/lib/agents/books/table";
import { isPlainMessage } from "@/lib/errors";
import { CSV_LIMITS, checkCsvShape, parseCsvCells, parseCsvInWorker } from "./csv-guard";
import { XlsxLimitError } from "./xlsx-guard";

const MB = 1024 * 1024;

/** The parser as it was before the caps (books/table.ts), to prove results are unchanged. */
function legacyParseCsv(input: string): string[][] {
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

describe("NEW-11: CSV caps", () => {
  it("PoC: a 6 MB CSV of one-character cells is refused quickly with a plain sentence, nothing built", async () => {
    const line = "a,b,c,d,e,f,g,h,i,j\n";
    const text = line.repeat((6 * MB) / line.length);
    const t0 = Date.now();
    expect(() => parseCsv(text)).toThrow(XlsxLimitError);
    expect(Date.now() - t0).toBeLessThan(2000);
    const r = await readTable({ name: "big.csv", bytes: Buffer.from(text) });
    expect(r.table.rows).toEqual([]);
    expect(r.issues[0].message).toMatch(/more than 3,00,000 filled cells/);
    expect(isPlainMessage(r.issues[0].message)).toBe(true);
  }, 30_000);

  it("rows and columns are capped like a workbook's", () => {
    expect(() => checkCsvShape("x\n".repeat(CSV_LIMITS.maxRows + 1), ",")).toThrow(/more than 50,000 rows/);
    expect(() => checkCsvShape(`${"x,".repeat(CSV_LIMITS.maxColumns)}x\n`, ",")).toThrow(/more than 256 columns/);
    expect(() => checkCsvShape("a,b\n1,2\n", ",")).not.toThrow();
    // Quoted delimiters and newlines are not counted as cells or rows.
    expect(() => checkCsvShape(`"${",\n".repeat(CSV_LIMITS.maxRows + 5)}"\n`, ",")).not.toThrow();
  });

  it("a large CSV is parsed in a worker, with the same cells as inline", async () => {
    const line = 'INV-1,"Acme, Traders",2026-10-05,"1,500.00"\n';
    const text = line.repeat(Math.ceil((2.5 * MB) / line.length)).slice(0, line.length * 40_000);
    const inWorker = await parseCsvInWorker(text, ",");
    expect(inWorker).toEqual(parseCsvCells(text, ","));
    expect((await parseCsvSafe(text)).length).toBe(40_000);
    await expect(parseCsvInWorker("a,b\n".repeat(60_000), ",")).rejects.toThrow(/more than 50,000 rows/);
    // The worker's plain-JS copies and the main-thread functions agree, refusals included.
    await expect(parseCsvInWorker(`${"x,".repeat(CSV_LIMITS.maxColumns)}x\n`, ",")).rejects.toThrow(/more than 256 columns/);
    await expect(parseCsvInWorker("a,b,c,d,e,f,g,h,i,j\n".repeat(31_000), ",")).rejects.toThrow(/filled cells/);
    for (const t of ['a,"b ""q"" c",d\r\nx,,y', ' "lead" , trail ,\n', "only", "a\n\n\nb"]) expect(await parseCsvInWorker(t, ","), t).toEqual(parseCsvCells(t, ","));
  }, 60_000);

  it("results are unchanged: every fixture CSV parses exactly as before", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.csv$/i.test(e)) files.push(p);
      }
    };
    walk(join(__dirname, "..", "..", "..", "fixtures"));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(parseCsv(text), f).toEqual(legacyParseCsv(text));
    }
    for (const t of ['a,"b ""q"" c",d\r\nx,,y', ' "lead" , trail ,\n', "only", "", "a;b;c\n1;2;3", "a\tb\n1\t2"]) expect(parseCsv(t), t).toEqual(legacyParseCsv(t));
  });
});
