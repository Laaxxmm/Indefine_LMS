// Security audit #13: XLSX decompression / CPU amplification. Ported from the audit PoC
// (.audit-sec/web/uploads.test.ts "XLSX decompression amplification"): a tiny .xlsx that passed
// the 25 MB + ZIP-magic checks was fully materialised by ExcelJS on the main thread. Now the ZIP is
// walked first (size, ratio, rows, columns, cells), big workbooks parse in a worker with a time
// budget, and the cells the agents read are unchanged.
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { cellText, parseXlsx, readTable } from "@/lib/agents/books/table";
import { previewWorkbook } from "@/lib/agents/core/preview";
import { InputRejectedError, screenedInputSource, staticInputSource } from "@/lib/agents/core/inputs";
import { screenUpload } from "./uploads";
import { WORKER_THRESHOLD, XLSX_LIMITS, XlsxLimitError, columnIndex, columnLetters, inspectXlsx, isZipBytes, readWorkbookGrid } from "./xlsx-guard";

const CT = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

/** A one-sheet .xlsx whose sheet1.xml has the given <sheetData> body (the audit PoC's construction). */
async function xlsx(sheetData: string, level = 9): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CT);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level } });
}

const pocRows = (n: number) => {
  const parts: string[] = [];
  for (let i = 1; i <= n; i++) parts.push(`<row r="${i}"><c r="A${i}" t="inlineStr"><is><t>${"A".repeat(80)}</t></is></c></row>`);
  return parts.join("");
};

async function refused(p: Promise<unknown>): Promise<XlsxLimitError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(XlsxLimitError);
  return e as XlsxLimitError;
}

/** The pre-fix parseXlsx, verbatim, as the reference the new reader must match. */
async function oldParseXlsx(bytes: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  let out: string[][] = [];
  wb.eachSheet((ws) => {
    if (out.length) return;
    const rows: string[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    }
    if (rows.some((r) => r.some((c) => c !== ""))) out = rows;
  });
  return out;
}

/** A realistic books export: an empty first sheet, merged title, dates, formulas, rich text, links, number formats. */
async function richWorkbook(rows = 40): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Cover");
  const ws = wb.addWorksheet("Ledger");
  ws.mergeCells("A1:E1");
  ws.getCell("A1").value = "Acme Pvt Ltd — Day Book 1-Oct-2026 to 31-Oct-2026";
  ws.addRow([]);
  ws.addRow(["Date", "Particulars", "Vch No", "Debit (₹)", "Credit (₹)"]);
  for (let i = 0; i < rows; i++) {
    const r = ws.addRow([new Date(Date.UTC(2026, 9, 1 + (i % 28))), i % 3 === 0 ? { richText: [{ text: "Party " }, { text: String(i), font: { bold: true } }] } : `Party ${i}`, `V-${i}`, i % 2 ? 1234.5 + i : null, i % 2 ? null : 99.99 * i]);
    r.getCell(4).numFmt = "##,##,##0.00";
  }
  ws.addRow(["Total", null, null, { formula: `SUM(D4:D${rows + 3})`, result: 12345 }, { formula: `SUM(E4:E${rows + 3})`, result: 6789 }]);
  ws.addRow([{ text: "portal", hyperlink: "https://example.in/x" }, { error: "#N/A" }, true]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("PoC: the audit's 30,000-row file", () => {
  it("still passes the upload screen, but is inspected first and parsed in a worker within a time budget", async () => {
    const bytes = await xlsx(pocRows(30_000));
    expect(bytes.length).toBeLessThan(200 * 1024);
    expect((await screenUpload({ name: "ledger.xlsx", bytes: new Uint8Array(bytes), type: "" }, { log: () => {} })).ok).toBe(true);
    const stats = await inspectXlsx(bytes);
    expect(stats.sheets).toEqual([{ part: "xl/worksheets/sheet1.xml", rows: 30_000, cells: 30_000, maxRow: 30_000, maxColumn: 1 }]);
    expect(stats.cells).toBeGreaterThan(WORKER_THRESHOLD.cells); // auto mode → worker
    const viaWorker = await parseXlsx(bytes, { mode: "worker" });
    expect(viaWorker.length).toBe(30_000);
    expect(viaWorker).toEqual(await parseXlsx(bytes, { mode: "inline" }));
    // The time budget: a worker that cannot finish in time is stopped with a plain message.
    const slow = await refused(parseXlsx(bytes, { mode: "worker", timeoutMs: 5 }));
    expect(slow.problem).toBe("timeout");
    expect(slow.message).toMatch(/took longer than 1 second to read, so reading stopped\. Split it into smaller files/);
  }, 60_000);

  it("the larger variants the audit could not finish (150k / 400k rows) are refused before ExcelJS runs", async () => {
    const e = await refused(inspectXlsx(await xlsx(`${pocRows(10)}<row r="150000"><c r="A150000"><v>1</v></c></row>`)));
    expect(e.problem).toBe("rows");
    expect(e.message).toBe("Sheet sheet1 has more than 50,000 rows, the most a single sheet may have here. Split it into smaller files (for example one month or one sheet per file) and try again.");
    // readTable (the agents' reader) turns it into a parse issue, not a crash.
    const t = await readTable({ name: "daybook.xlsx", bytes: await xlsx(`<row r="400000"><c r="A400000"><v>1</v></c></row>`) });
    expect(t.table.rows).toEqual([]);
    expect(t.issues[0].message).toMatch(/^could not read the file: Sheet sheet1 has more than 50,000 rows/);
  });
});

describe("ZIP bomb and amplification limits", () => {
  it("a part that unpacks far beyond its packed size (ratio) is refused while inflating", async () => {
    const bytes = await xlsx(`<row r="1"><c r="A1" t="inlineStr"><is><t>${" ".repeat(6 * 1024 * 1024)}</t></is></c></row>`);
    expect(bytes.length).toBeLessThan(64 * 1024);
    const e = await refused(inspectXlsx(bytes));
    expect(e.problem).toBe("ratio");
    expect(e.message).toMatch(/packed far more tightly than a normal Excel file/);
  });

  it("total unpacked size over the cap is refused", async () => {
    const e = await refused(inspectXlsx(await xlsx(pocRows(2000)), { ...XLSX_LIMITS, maxUncompressedBytes: 64 * 1024 }));
    expect(e.problem).toBe("size");
    expect(e.message).toMatch(/^This spreadsheet unpacks to more than 0\.1 MB/);
  });

  it("one stray cell at column XFD (the CPU amplification) is refused; so is a sheet spanning too many rows × columns", async () => {
    const far = await refused(inspectXlsx(await xlsx(`<row r="1"><c r="A1"><v>1</v></c><c r="XFD1"><v>2</v></c></row>`)));
    expect(far.problem).toBe("columns");
    expect(far.message).toBe("Sheet sheet1 has data in column XFD; the furthest column read here is IV (256). Delete the stray cells on the right and re-upload.");
    const wide = await refused(inspectXlsx(await xlsx(`<row r="1"><c r="A1"><v>1</v></c></row><row r="2000"><c r="IP2000"><v>1</v></c></row>`)));
    expect(wide.problem).toBe("cells");
    expect(wide.message).toMatch(/spans 2,000 rows × 250 columns/);
    // Cells without r= are counted by position.
    const positional = await refused(inspectXlsx(await xlsx(`<row>${"<c><v>1</v></c>".repeat(300)}</row>`)));
    expect(positional.problem).toBe("columns");
  });

  it("too many filled cells in all, too many parts, damaged, encrypted, or an unknown method are refused", async () => {
    expect((await refused(inspectXlsx(await xlsx(pocRows(500)), { ...XLSX_LIMITS, maxCells: 100 }))).problem).toBe("cells");
    expect((await refused(inspectXlsx(await xlsx(pocRows(5)), { ...XLSX_LIMITS, maxEntries: 3 }))).problem).toBe("entries");
    expect((await refused(inspectXlsx(Buffer.from("PK\x03\x04 not really a zip")))).problem).toBe("zip");
    const good = await xlsx(pocRows(3));
    const enc = Buffer.from(good);
    for (let i = 0; i + 4 <= enc.length; i++) if (enc.readUInt32LE(i) === 0x02014b50) enc.writeUInt16LE(enc.readUInt16LE(i + 8) | 1, i + 8);
    expect((await refused(inspectXlsx(enc))).problem).toBe("encrypted");
    const odd = Buffer.from(good);
    for (let i = 0; i + 4 <= odd.length; i++) if (odd.readUInt32LE(i) === 0x02014b50) odd.writeUInt16LE(12, i + 10); // bzip2
    expect((await refused(inspectXlsx(odd))).message).toMatch(/compression method Excel does not write/);
  });

  it("namespaced sheet XML (x:row / x:c) is counted too", async () => {
    const stats = await inspectXlsx(await xlsx(`<x:row r="1"><x:c r="C1"><x:v>1</x:v></x:c></x:row><x:row r="7"><x:c r="B7"/></x:row>`, 0));
    expect(stats.sheets[0]).toMatchObject({ rows: 2, cells: 2, maxRow: 7, maxColumn: 3 });
  });

  it("column helpers", () => {
    expect([columnIndex("A"), columnIndex("Z"), columnIndex("AA"), columnIndex("IV"), columnIndex("XFD")]).toEqual([1, 26, 27, 256, 16384]);
    expect([columnLetters(1), columnLetters(256), columnLetters(16384)]).toEqual(["A", "IV", "XFD"]);
    expect(isZipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isZipBytes(new TextEncoder().encode("a,b"))).toBe(false);
  });
});

describe("agent inputs: a bomb stops the run with a plain reason", () => {
  it("screenedInputSource refuses an over-limit workbook before any agent parses it", async () => {
    const bomb = await xlsx(`<row r="1"><c r="A1"><v>1</v></c><c r="XFD1"><v>2</v></c></row>`);
    const src = screenedInputSource(staticInputSource([{ name: "tb.xlsx", source: "client-docs", bytes: bomb, contentType: "" } as never]), { typeMode: "warn", log: () => {} });
    const e = await src.gather({ clientCode: "ACME01" } as never).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(InputRejectedError);
    expect((e as Error).message).toBe("tb.xlsx was refused: Sheet sheet1 has data in column XFD; the furthest column read here is IV (256). Delete the stray cells on the right and re-upload.");
  });
});

describe("results unchanged", () => {
  it("parseXlsx (inline and worker) equals the pre-fix reader on a realistic books export", async () => {
    const bytes = await richWorkbook();
    const reference = await oldParseXlsx(bytes);
    expect(reference.length).toBeGreaterThan(40);
    expect(reference[0].slice(0, 2)).toEqual(["Acme Pvt Ltd — Day Book 1-Oct-2026 to 31-Oct-2026", "Acme Pvt Ltd — Day Book 1-Oct-2026 to 31-Oct-2026"]); // merged cells repeat
    expect(await parseXlsx(bytes)).toEqual(reference);
    expect(await parseXlsx(bytes, { mode: "worker" })).toEqual(reference);
  }, 30_000);

  it("previewWorkbook (inline and worker) is identical, numFmt included", async () => {
    const bytes = await richWorkbook(260);
    const inline = await previewWorkbook(bytes, { mode: "inline" });
    expect(await previewWorkbook(bytes, { mode: "worker" })).toEqual(inline);
    expect(inline.sheets.map((s) => [s.name, s.rows.length, s.truncated])).toEqual([["Cover", 0, false], ["Ledger", 200, true]]);
    const grid = await readWorkbookGrid(bytes, { maxRows: 5, maxCols: 5, numFmt: true, mode: "worker" });
    expect(grid[1].numFmts?.[3]?.[3]).toBe("##,##,##0.00");
  }, 30_000);
});
