import ExcelJS from "exceljs";

export type Row = Record<string, string | number>;

// Union of column keys across rows, in first-seen order (mirrors pandas DataFrame).
export function unionColumns(rows: Row[]): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!set.has(k)) { set.add(k); seen.push(k); }
  return seen;
}

const YELLOW = "FFFFFF00";

// Add a worksheet from row objects. `columns` fixes the header order; any row whose
// index is in `highlight` is bolded + yellow-filled (subtotals / totals).
export function addSheet(wb: ExcelJS.Workbook, name: string, columns: string[], rows: Row[], highlight?: (r: Row) => boolean): void {
  const ws = wb.addWorksheet(name);
  ws.addRow(columns);
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => {
    const rowRef = ws.addRow(columns.map((c) => (c in r ? r[c] : "")));
    if (highlight?.(r)) {
      rowRef.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
      });
    }
  });
  columns.forEach((c, i) => {
    const w = Math.min(40, Math.max(12, c.length + 2));
    ws.getColumn(i + 1).width = w;
  });
}

export async function workbookBytes(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}
