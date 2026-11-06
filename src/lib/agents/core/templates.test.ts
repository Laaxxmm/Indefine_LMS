import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DATE_NUMFMT,
  DRAFT_LABEL,
  INR_NUMFMT,
  LAYOUT,
  buildDocx,
  buildWorkbook,
  columnTotal,
  deliverableFileName,
  formatCell,
  headerFields,
  type DeliverableHeader,
  type SheetSpec,
  type WorkbookSpec,
} from "./templates";

const GEN = new Date("2026-11-05T09:00:00.000Z"); // 14:30 IST

const header: DeliverableHeader = {
  title: "GSTR-3B computation",
  clientName: "Acme Industries Pvt Ltd",
  clientCode: "ACME",
  period: "2026-10",
  fy: "2026-27",
  agentRunId: "run_abc123",
  reviewedBy: null,
  version: 2,
  generatedAt: GEN,
};

const outward: SheetSpec = {
  name: "Outward supplies",
  columns: [
    { key: "nature", header: "Nature of supply" },
    { key: "taxable", header: "Taxable value (₹)", type: "inr" },
    { key: "igst", header: "IGST (₹)", type: "inr" },
    { key: "count", header: "Invoices", type: "integer" },
    { key: "date", header: "Last invoice", type: "date" },
    { key: "rate", header: "Rate", type: "percent" },
  ],
  rows: [
    { nature: "B2B taxable", taxable: 1234567.8, igst: 222222.2, count: 41, date: "2026-10-31", rate: 0.18 },
    { nature: "B2C small", taxable: 98765.43, igst: 0.1, count: 3, date: new Date("2026-10-15T20:00:00Z"), rate: 0.05 },
    { nature: "Exempt", taxable: 0.2, igst: null, count: 1, date: undefined, rate: undefined },
  ],
  totals: true,
};
const notes: SheetSpec = { name: "Exceptions", columns: [{ key: "msg", header: "Exception" }, { key: "seen", header: "Seen on" }], rows: [{ msg: "2B missing", seen: new Date("2026-11-01T00:00:00Z") }] };

const spec: WorkbookSpec = { header, sheets: [outward, notes] };

// exceljs un-escapes format codes when reading; the file itself keeps the escaped literal commas.
const INR_READBACK = INR_NUMFMT.replace(/\\/g, "");

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

afterEach(() => vi.useRealTimers());

describe("headerFields", () => {
  it("is the fixed block, reviewer blank until approved", () => {
    expect(headerFields(header)).toEqual([
      ["Client", "Acme Industries Pvt Ltd (ACME)"],
      ["Period", "2026-10"],
      ["Financial year", "FY 2026-27"],
      ["Prepared by", "agent run run_abc123"],
      ["Reviewed by", ""],
      ["Version", "v2"],
      ["Generated at", "05 Nov 2026 14:30 IST"],
    ]);
    expect(headerFields({ ...header, reviewedBy: " Ravi K " })[4]).toEqual(["Reviewed by", "Ravi K"]);
  });
});

describe("buildWorkbook", () => {
  it("writes the header block on every sheet and the sheets in order", async () => {
    const out = await buildWorkbook(spec);
    expect(out.fileName).toBe("ACME_GSTR-3B-computation_2026-10_v2.xlsx");
    expect(out.mimeType).toMatch(/spreadsheetml/);
    expect(out.sizeBytes).toBe(out.buffer.length);
    expect(out.sha256).toBe(createHash("sha256").update(out.buffer).digest("hex"));

    const wb = await load(out.buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Outward supplies", "Exceptions"]);
    expect(wb.creator).toBe("Indefine Firm OS");
    expect(wb.subject).toBe(DRAFT_LABEL);
    for (const ws of wb.worksheets) {
      expect(ws.getCell(LAYOUT.titleRow, 1).value).toBe("GSTR-3B computation");
      expect(ws.getCell(LAYOUT.draftRow, 1).value).toBe(DRAFT_LABEL);
      expect(ws.getCell("A3").value).toBe("Client");
      expect(ws.getCell("B3").value).toBe("Acme Industries Pvt Ltd (ACME)");
      expect(ws.getCell("B4").value).toBe("2026-10");
      expect(ws.getCell("B5").value).toBe("FY 2026-27");
      expect(ws.getCell("B6").value).toBe("agent run run_abc123");
      expect(ws.getCell("A7").value).toBe("Reviewed by");
      expect(ws.getCell("B7").value).toBeNull();
      expect(ws.getCell("B8").value).toBe("v2");
      expect(ws.getCell("B9").value).toBe("05 Nov 2026 14:30 IST");
      expect(ws.headerFooter.oddHeader).toContain(DRAFT_LABEL);
      expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: LAYOUT.columnHeaderRow });
    }
  });

  it("writes column headers, values and number formats", async () => {
    const ws = (await load((await buildWorkbook(spec)).buffer)).getWorksheet("Outward supplies")!;
    const hdr = ws.getRow(LAYOUT.columnHeaderRow);
    expect([1, 2, 3, 4, 5, 6].map((c) => hdr.getCell(c).value)).toEqual(["Nature of supply", "Taxable value (₹)", "IGST (₹)", "Invoices", "Last invoice", "Rate"]);
    expect(hdr.getCell(1).font?.bold).toBe(true);

    const r1 = ws.getRow(LAYOUT.dataFirstRow);
    expect(r1.getCell(1).value).toBe("B2B taxable");
    expect(r1.getCell(2).value).toBe(1234567.8);
    expect(r1.getCell(2).numFmt).toBe(INR_READBACK);
    expect(r1.getCell(4).value).toBe(41);
    expect(r1.getCell(4).numFmt).toBe("0");
    expect(r1.getCell(5).value).toEqual(new Date("2026-10-31T00:00:00.000Z"));
    expect(r1.getCell(5).numFmt).toBe(DATE_NUMFMT);
    expect(r1.getCell(6).value).toBe(0.18);
    expect(r1.getCell(6).numFmt).toBe("0.00%");

    // A Date value lands on its IST calendar day (15 Oct 20:00 UTC = 16 Oct IST)
    expect(ws.getRow(LAYOUT.dataFirstRow + 1).getCell(5).value).toEqual(new Date("2026-10-16T00:00:00.000Z"));
    const r3 = ws.getRow(LAYOUT.dataFirstRow + 2);
    expect(r3.getCell(3).value).toBeNull();
    expect(r3.getCell(5).value).toBeNull();
  });

  it("adds a totals row with a SUM formula and the paise-exact result", async () => {
    const ws = (await load((await buildWorkbook(spec)).buffer)).getWorksheet("Outward supplies")!;
    const t = ws.getRow(LAYOUT.dataFirstRow + 3);
    expect(t.getCell(1).value).toBe("Total");
    expect(t.getCell(2).value).toEqual({ formula: "SUM(B12:B14)", result: 1333333.43 });
    expect(t.getCell(3).value).toEqual({ formula: "SUM(C12:C14)", result: 222222.3 });
    expect(t.getCell(4).value).toEqual({ formula: "SUM(D12:D14)", result: 45 });
    expect(t.getCell(2).numFmt).toBe(INR_READBACK);
    expect(t.getCell(5).value).toBeNull();
  });

  it("stores the Indian-grouping format code with escaped literal commas in styles.xml", async () => {
    const zip = await JSZip.loadAsync((await buildWorkbook(spec)).buffer);
    const styles = await zip.file("xl/styles.xml")!.async("string");
    expect(styles).toContain('formatCode="[&gt;=10000000]##\\,##\\,##\\,##0.00;[&gt;=100000]##\\,##\\,##0.00;##,##0.00"');
    expect(styles).toContain('formatCode="dd mmm yyyy"');
  });

  it("totals an empty sheet as zero", async () => {
    const ws = (await load((await buildWorkbook({ header, sheets: [{ ...outward, rows: [] }] })).buffer)).worksheets[0];
    expect(ws.getRow(LAYOUT.dataFirstRow).getCell(2).value).toBe(0);
  });

  it("renders non-date values in a text column and dates as DD MMM YYYY text", async () => {
    const ws = (await load((await buildWorkbook(spec)).buffer)).getWorksheet("Exceptions")!;
    expect(ws.getRow(LAYOUT.dataFirstRow).getCell(2).value).toBe("01 Nov 2026");
  });

  it("is byte-identical for the same spec at the same instant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(GEN);
    const a = await buildWorkbook(spec);
    const b = await buildWorkbook(spec);
    expect(a.sha256).toBe(b.sha256);
    const c = await buildWorkbook({ ...spec, header: { ...header, version: 3 } });
    expect(c.sha256).not.toBe(a.sha256);
  });

  it.each([
    ["no sheets", { header, sheets: [] }, /at least one sheet/],
    ["long sheet name", { header, sheets: [{ ...notes, name: "x".repeat(32) }] }, /invalid sheet name/],
    ["bad chars", { header, sheets: [{ ...notes, name: "GST/3B" }] }, /invalid sheet name/],
    ["reserved name", { header, sheets: [{ ...notes, name: "History" }] }, /invalid sheet name/],
    ["duplicate names", { header, sheets: [notes, { ...notes, name: "EXCEPTIONS" }] }, /duplicate sheet name/],
    ["no columns", { header, sheets: [{ ...notes, columns: [] }] }, /no columns/],
    ["duplicate column", { header, sheets: [{ ...notes, columns: [notes.columns[0], notes.columns[0]] }] }, /duplicate column key/],
    ["text in inr column", { header, sheets: [{ ...outward, rows: [{ taxable: "1,000" }] }] }, /expects a number/],
    ["fraction in integer column", { header, sheets: [{ ...outward, rows: [{ count: 1.5 }] }] }, /expects an integer/],
    ["number in date column", { header, sheets: [{ ...outward, rows: [{ date: 45000 }] }] }, /expects a date/],
    ["malformed date", { header, sheets: [{ ...outward, rows: [{ date: "31/10/2026" }] }] }, /invalid date value/],
    ["bad client code", { header: { ...header, clientCode: "acme" }, sheets: [notes] }, /client code/],
    ["bad fy", { header: { ...header, fy: "2026-28" }, sheets: [notes] }, /fy must look like/],
    ["version 0", { header: { ...header, version: 0 }, sheets: [notes] }, /version|>=1|greater/i],
  ] as [string, WorkbookSpec, RegExp][])("rejects %s", async (_n, s, re) => {
    await expect(buildWorkbook(s)).rejects.toThrow(re);
  });
});

describe("buildDocx", () => {
  const docSpec = {
    header: { ...header, title: "ROC data sheet", reviewedBy: "Ravi Kumar" },
    blocks: [
      { type: "heading" as const, text: "Summary & scope" },
      { type: "paragraph" as const, text: "AGM held on 30 Sep 2026." },
      { type: "bullets" as const, items: ["AOC-4 due 29 Oct 2026", "MGT-7 due 28 Nov 2026"] },
      {
        type: "table" as const,
        columns: [
          { key: "item", header: "Item" },
          { key: "amt", header: "Amount (₹)", type: "inr" as const },
          { key: "on", header: "Due", type: "date" as const },
        ],
        rows: [{ item: "Additional fee estimate", amt: 123456, on: "2026-10-29" }],
      },
    ],
  };

  it("returns a docx zip whose document.xml carries the header block, label and content", async () => {
    const out = await buildDocx(docSpec);
    expect(out.buffer.length).toBeGreaterThan(1000);
    expect(out.fileName).toBe("ACME_ROC-data-sheet_2026-10_v2.docx");
    expect(out.sha256).toBe(createHash("sha256").update(out.buffer).digest("hex"));
    const zip = await JSZip.loadAsync(out.buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const text of [
      "ROC data sheet",
      DRAFT_LABEL,
      "Acme Industries Pvt Ltd (ACME)",
      "FY 2026-27",
      "agent run run_abc123",
      "Reviewed by",
      "Ravi Kumar",
      "v2",
      "05 Nov 2026 14:30 IST",
      "Summary &amp; scope",
      "AOC-4 due 29 Oct 2026",
      "1,23,456.00",
      "29 Oct 2026",
    ])
      expect(xml).toContain(text);
    const headers = Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f));
    expect(headers.length).toBeGreaterThan(0);
    expect(await zip.file(headers[0])!.async("string")).toContain(DRAFT_LABEL);
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("Indefine Firm OS");
  });

  it("is byte-identical for the same spec at the same instant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(GEN);
    expect((await buildDocx(docSpec)).sha256).toBe((await buildDocx(docSpec)).sha256);
  });

  it("validates the header", async () => {
    await expect(buildDocx({ ...docSpec, header: { ...header, agentRunId: "" } })).rejects.toThrow();
  });
});

describe("helpers", () => {
  it("formatCell renders each column type for documents", () => {
    expect(formatCell({ key: "a", header: "A", type: "inr" }, 1234567.891)).toBe("12,34,567.89");
    expect(formatCell({ key: "a", header: "A", type: "percent" }, 0.185)).toBe("18.50%");
    expect(formatCell({ key: "a", header: "A", type: "integer" }, 7)).toBe("7");
    expect(formatCell({ key: "a", header: "A", type: "date" }, new Date("2027-03-31T19:00:00Z"))).toBe("01 Apr 2027");
    expect(formatCell({ key: "a", header: "A" }, new Date("2026-11-05T00:00:00Z"))).toBe("05 Nov 2026");
    expect(formatCell({ key: "a", header: "A" }, true)).toBe("true");
    expect(formatCell({ key: "a", header: "A", type: "inr" }, null)).toBe("");
  });

  it("columnTotal sums in paise", () => {
    expect(columnTotal({ key: "v", header: "V", type: "inr" }, [{ v: 0.1 }, { v: 0.2 }, { v: "x" }, {}])).toBe(0.3);
    expect(columnTotal({ key: "v", header: "V", type: "integer" }, [{ v: 2 }, { v: 3 }])).toBe(5);
  });

  it("deliverableFileName slugs the title and period", () => {
    expect(deliverableFileName({ clientCode: "ACME", title: "GSTR-1 / B2B & HSN", period: "Q2", version: 1 }, "xlsx")).toBe("ACME_GSTR-1-B2B-HSN_Q2_v1.xlsx");
    expect(deliverableFileName({ clientCode: "ACME", title: "x", period: "Annual", version: 4 }, "docx", "Board resolution")).toBe("ACME_Board-resolution_Annual_v4.docx");
  });

  it("wide sheets get column letters beyond Z in total formulas", async () => {
    const columns = Array.from({ length: 28 }, (_, i) => ({ key: `c${i}`, header: `C${i}`, type: i === 0 ? ("text" as const) : ("integer" as const) }));
    const row = Object.fromEntries(columns.map((c, i) => [c.key, i === 0 ? "r" : i]));
    const ws = (await load((await buildWorkbook({ header, sheets: [{ name: "Wide", columns, rows: [row], totals: true }] })).buffer)).worksheets[0];
    expect(ws.getRow(LAYOUT.dataFirstRow + 1).getCell(28).value).toEqual({ formula: "SUM(AB12:AB12)", result: 27 });
  });
});
