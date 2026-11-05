// Read-only preview of a stored XLSX deliverable: each sheet as rows of display text, capped so a
// large register cannot flood the review screen. Also used by the accuracy harness to check a
// deliverable's shape (sheet names, header block, column headers) against the fixture.
import ExcelJS from "exceljs";
import { DRAFT_LABEL, LAYOUT } from "./templates";
import { formatDate, formatInr } from "./format";

export const PREVIEW_MAX_ROWS = 200;
export const PREVIEW_MAX_COLS = 30;

export type PreviewSheet = { name: string; rows: string[][]; truncated: boolean };
export type WorkbookPreview = { sheets: PreviewSheet[] };

function text(v: ExcelJS.CellValue, numFmt: string | undefined): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return formatDate(v.toISOString().slice(0, 10));
  if (typeof v === "number") return numFmt && numFmt.includes("##,##") ? formatInr(v) : String(v);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return text(v.result as ExcelJS.CellValue, numFmt);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return String(v.error);
    return "";
  }
  return String(v);
}

export async function previewWorkbook(bytes: Uint8Array, opts: { maxRows?: number; maxCols?: number } = {}): Promise<WorkbookPreview> {
  const maxRows = opts.maxRows ?? PREVIEW_MAX_ROWS;
  const maxCols = opts.maxCols ?? PREVIEW_MAX_COLS;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheets: PreviewSheet[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    const last = Math.min(ws.rowCount, maxRows);
    const cols = Math.min(ws.columnCount, maxCols);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= cols; c++) cells.push(text(row.getCell(c).value, row.getCell(c).numFmt));
      rows.push(cells);
    }
    sheets.push({ name: ws.name, rows, truncated: ws.rowCount > maxRows || ws.columnCount > maxCols });
  });
  return { sheets };
}

export type SheetShape = { name: string; columns: string[] };
export type ShapeProblem = string;

/**
 * Checks a built workbook follows the fixed layout: title row, draft label, the header block, and
 * the expected sheets with their column headers on LAYOUT.columnHeaderRow.
 */
export async function checkWorkbookShape(bytes: Uint8Array, expected: (string | SheetShape)[]): Promise<ShapeProblem[]> {
  const problems: ShapeProblem[] = [];
  const preview = await previewWorkbook(bytes, { maxRows: LAYOUT.columnHeaderRow, maxCols: 60 });
  for (const want of expected) {
    const name = typeof want === "string" ? want : want.name;
    const sheet = preview.sheets.find((s) => s.name === name);
    if (!sheet) {
      problems.push(`sheet "${name}" missing`);
      continue;
    }
    const cell = (r: number, c: number) => sheet.rows[r - 1]?.[c - 1] ?? "";
    if (!cell(LAYOUT.titleRow, 1)) problems.push(`sheet "${name}": title row empty`);
    if (cell(LAYOUT.draftRow, 1) !== DRAFT_LABEL) problems.push(`sheet "${name}": draft label missing`);
    const labels = ["Client", "Period", "Financial year", "Prepared by", "Reviewed by", "Version", "Generated at"];
    labels.forEach((l, i) => {
      if (cell(LAYOUT.firstFieldRow + i, 1) !== l) problems.push(`sheet "${name}": header field "${l}" missing`);
    });
    if (typeof want !== "string") {
      const got = (sheet.rows[LAYOUT.columnHeaderRow - 1] ?? []).filter((c) => c !== "");
      if (JSON.stringify(got) !== JSON.stringify(want.columns)) problems.push(`sheet "${name}": columns ${JSON.stringify(got)} ≠ expected ${JSON.stringify(want.columns)}`);
    }
  }
  const unexpected = preview.sheets.map((s) => s.name).filter((n) => !expected.some((w) => (typeof w === "string" ? w : w.name) === n));
  if (unexpected.length) problems.push(`unexpected sheet(s): ${unexpected.join(", ")}`);
  return problems;
}
