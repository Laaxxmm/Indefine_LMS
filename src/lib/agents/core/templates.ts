// Deliverable generators with fixed layouts (Phase 4 task 3). Every file carries the same header
// block (client + code, period, FY, preparing agent run, reviewer — blank until approved —,
// version, generated-at in IST) and the label DRAFT_LABEL: Firm OS prepares packs; humans review
// and file. Values arrive already computed by deterministic code; totals here are summed in paise.
// Pure apart from the libraries: no Prisma, no fetch, no clock (generatedAt is in the spec).
import { createHash } from "node:crypto";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { z } from "zod";
import { istDayKey } from "@/lib/ist";
import { DATE_NUMFMT, INR_NUMFMT, formatDate, formatDateTimeIst, formatInr, toPaise } from "./format";

export { DATE_NUMFMT, INR_NUMFMT, formatDate, formatDateTimeIst, formatInr } from "./format";

export const DRAFT_LABEL = "Draft — prepared for human review; not for filing";
export const PRODUCER = "Indefine Firm OS";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const BRAND_TEAL = "0F5E66";
const WARNING = "B45309";

// ------------------------------------------------------------------ header

const fyOk = (fy: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
};

export const DeliverableHeaderSchema = z.object({
  title: z.string().trim().min(1).max(120),
  clientName: z.string().trim().min(1).max(200),
  clientCode: z.string().regex(/^[A-Z0-9]{3,10}$/, "client code: A-Z 0-9, 3-10 chars"),
  period: z.string().trim().min(1).max(20),
  fy: z.string().refine(fyOk, "fy must look like 2026-27"),
  agentRunId: z.string().trim().min(1).max(64),
  reviewedBy: z.string().trim().max(120).nullable().optional(),
  version: z.number().int().min(1),
  generatedAt: z.date().refine((d) => !Number.isNaN(d.getTime()), "invalid generatedAt"),
});
export type DeliverableHeader = z.infer<typeof DeliverableHeaderSchema>;

/** The fixed header block as [label, value] pairs, in order. Same for XLSX and DOCX. */
export function headerFields(h: DeliverableHeader): [string, string][] {
  return [
    ["Client", `${h.clientName} (${h.clientCode})`],
    ["Period", h.period],
    ["Financial year", `FY ${h.fy}`],
    ["Prepared by", `agent run ${h.agentRunId}`],
    ["Reviewed by", h.reviewedBy?.trim() ?? ""],
    ["Version", `v${h.version}`],
    ["Generated at", `${formatDateTimeIst(h.generatedAt)} IST`],
  ];
}

/** Sheet rows of the fixed layout (1-based). Data starts at DATA_FIRST_ROW. */
export const LAYOUT = {
  titleRow: 1,
  draftRow: 2,
  firstFieldRow: 3, // Client … Generated at occupy rows 3-9
  columnHeaderRow: 11,
  dataFirstRow: 12,
} as const;

/** `ACME_GSTR-3B-computation_2026-10_v1.xlsx` */
export function deliverableFileName(h: Pick<DeliverableHeader, "clientCode" | "period" | "version" | "title">, ext: "xlsx" | "docx", base?: string): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${h.clientCode}_${slug(base ?? h.title)}_${slug(h.period)}_v${h.version}.${ext}`;
}

// ------------------------------------------------------------------ columns and cells

export type ColumnType = "text" | "inr" | "integer" | "date" | "percent";
export type ColumnSpec = { key: string; header: string; type?: ColumnType; width?: number };
export type CellValue = string | number | boolean | Date | null | undefined;
export type RowSpec = Record<string, CellValue>;

export type SheetSpec = {
  name: string;
  columns: ColumnSpec[];
  rows: RowSpec[];
  /** Adds a "Total" row summing inr and integer columns (SUM formula with the TS-computed result). */
  totals?: boolean;
};

export type WorkbookSpec = { header: DeliverableHeader; sheets: SheetSpec[]; fileBase?: string };

export type DocBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; columns: ColumnSpec[]; rows: RowSpec[] };
export type DocxSpec = { header: DeliverableHeader; blocks: DocBlock[]; fileBase?: string };

export type BuiltDeliverable = { buffer: Buffer; sha256: string; fileName: string; mimeType: string; sizeBytes: number };

const NUMFMT: Record<ColumnType, string | undefined> = {
  text: undefined,
  inr: INR_NUMFMT,
  integer: "0",
  date: DATE_NUMFMT,
  percent: "0.00%",
};

const SHEET_NAME_BAD = /[[\]:*?/\\]/;

function assertSheetNames(sheets: SheetSpec[]) {
  if (!sheets.length) throw new Error("workbook needs at least one sheet");
  const seen = new Set<string>();
  for (const s of sheets) {
    const n = s.name.trim();
    if (!n || n.length > 31 || SHEET_NAME_BAD.test(n) || n.startsWith("'") || n.endsWith("'") || n.toLowerCase() === "history")
      throw new Error(`invalid sheet name "${s.name}" (1-31 chars, none of [ ] : * ? / \\, not "History")`);
    if (seen.has(n.toLowerCase())) throw new Error(`duplicate sheet name "${s.name}"`);
    seen.add(n.toLowerCase());
    if (!s.columns.length) throw new Error(`sheet "${s.name}" has no columns`);
    const keys = new Set<string>();
    for (const c of s.columns) {
      if (keys.has(c.key)) throw new Error(`sheet "${s.name}": duplicate column key "${c.key}"`);
      keys.add(c.key);
    }
  }
}

/** Date (its IST day) or "YYYY-MM-DD" → UTC-midnight Date, so Excel shows the IST calendar day. */
function excelDate(v: Date | string): Date {
  const key = typeof v === "string" ? v : istDayKey(v);
  const t = Date.parse(`${key}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || Number.isNaN(t)) throw new Error(`invalid date value: ${String(v)}`);
  return new Date(t);
}

function xlsxValue(col: ColumnSpec, v: CellValue): ExcelJS.CellValue {
  if (v === null || v === undefined || v === "") return null;
  const type = col.type ?? "text";
  if (type === "inr" || type === "integer" || type === "percent") {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`column "${col.key}" expects a number, got ${String(v)}`);
    if (type === "integer" && !Number.isInteger(v)) throw new Error(`column "${col.key}" expects an integer, got ${v}`);
    return v;
  }
  if (type === "date") {
    if (!(v instanceof Date) && typeof v !== "string") throw new Error(`column "${col.key}" expects a date, got ${String(v)}`);
    return excelDate(v);
  }
  return v instanceof Date ? formatDate(v) : String(v);
}

/** Human text for a DOCX table cell. */
export function formatCell(col: ColumnSpec, v: CellValue): string {
  if (v === null || v === undefined || v === "") return "";
  const type = col.type ?? "text";
  if (type === "inr") return formatInr(Number(v));
  if (type === "percent") return `${(Number(v) * 100).toFixed(2)}%`;
  if (type === "integer") return String(v);
  if (type === "date") return formatDate(v instanceof Date ? v : String(v));
  return v instanceof Date ? formatDate(v) : String(v);
}

/** Column total in paise-exact arithmetic (inr) or integer arithmetic. */
export function columnTotal(col: ColumnSpec, rows: RowSpec[]): number {
  const nums = rows.map((r) => r[col.key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (col.type === "inr") return nums.reduce((a, n) => a + toPaise(n), 0) / 100;
  return nums.reduce((a, n) => a + n, 0);
}

const colLetter = (i: number) => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const escHF = (s: string) => s.replace(/&/g, "&&");

// ------------------------------------------------------------------ XLSX

export async function buildWorkbook(spec: WorkbookSpec): Promise<BuiltDeliverable> {
  const h = DeliverableHeaderSchema.parse(spec.header);
  assertSheetNames(spec.sheets);

  const wb = new ExcelJS.Workbook();
  wb.creator = PRODUCER;
  wb.lastModifiedBy = PRODUCER;
  wb.created = h.generatedAt;
  wb.modified = h.generatedAt;
  wb.title = h.title;
  wb.subject = DRAFT_LABEL;
  wb.description = `${h.title} — ${h.clientName} (${h.clientCode}), ${h.period}, FY ${h.fy}. ${DRAFT_LABEL}`;
  wb.keywords = "draft";

  for (const s of spec.sheets) {
    const ws = wb.addWorksheet(s.name.trim(), {
      views: [{ state: "frozen", ySplit: LAYOUT.columnHeaderRow }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      headerFooter: {
        oddHeader: `&L&"-,Bold"${escHF(DRAFT_LABEL)}&R${escHF(`${h.clientCode} · ${h.period}`)}`,
        oddFooter: `&L${escHF(`${h.title} v${h.version}`)}&RPage &P of &N`,
      },
    });

    const title = ws.getCell(LAYOUT.titleRow, 1);
    title.value = h.title;
    title.font = { bold: true, size: 14 };
    const draft = ws.getCell(LAYOUT.draftRow, 1);
    draft.value = DRAFT_LABEL;
    draft.font = { bold: true, color: { argb: `FF${WARNING}` } };
    headerFields(h).forEach(([label, value], i) => {
      const row = LAYOUT.firstFieldRow + i;
      ws.getCell(row, 1).value = label;
      ws.getCell(row, 1).font = { bold: true };
      ws.getCell(row, 2).value = value || null; // "Reviewed by" stays an empty cell until approval
    });

    s.columns.forEach((c, i) => {
      const cell = ws.getCell(LAYOUT.columnHeaderRow, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND_TEAL}` } };
      cell.alignment = { vertical: "middle", horizontal: c.type && c.type !== "text" ? "right" : "left", wrapText: true };
      ws.getColumn(i + 1).width = c.width ?? (i === 0 ? 22 : c.type === "inr" ? 18 : 16);
    });

    s.rows.forEach((r, ri) => {
      const row = LAYOUT.dataFirstRow + ri;
      s.columns.forEach((c, ci) => {
        const cell = ws.getCell(row, ci + 1);
        cell.value = xlsxValue(c, r[c.key]);
        const fmt = NUMFMT[c.type ?? "text"];
        if (fmt) cell.numFmt = fmt;
      });
    });

    if (s.totals) {
      const row = LAYOUT.dataFirstRow + s.rows.length;
      const last = row - 1;
      ws.getCell(row, 1).value = "Total";
      ws.getCell(row, 1).font = { bold: true };
      s.columns.forEach((c, ci) => {
        if (ci === 0 || (c.type !== "inr" && c.type !== "integer")) return;
        const cell = ws.getCell(row, ci + 1);
        const L = colLetter(ci);
        const result = columnTotal(c, s.rows);
        cell.value = s.rows.length ? { formula: `SUM(${L}${LAYOUT.dataFirstRow}:${L}${last})`, result } : 0;
        cell.numFmt = NUMFMT[c.type] as string;
        cell.font = { bold: true };
        cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
      });
    }
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, sha256: sha256(buffer), fileName: deliverableFileName(h, "xlsx", spec.fileBase), mimeType: XLSX_MIME, sizeBytes: buffer.length };
}

// ------------------------------------------------------------------ DOCX

const run = (text: string, opts: { bold?: boolean; color?: string; size?: number } = {}) => new TextRun({ text, ...opts });
const cell = (text: string, opts: { bold?: boolean; right?: boolean; shade?: boolean } = {}) =>
  new TableCell({
    children: [
      new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [run(text, { bold: opts.bold, color: opts.shade ? "FFFFFF" : undefined })],
      }),
    ],
    shading: opts.shade ? { fill: BRAND_TEAL, color: "auto", type: "clear" } : undefined,
  });

function docTable(columns: ColumnSpec[], rows: RowSpec[]): Table {
  const numeric = (c: ColumnSpec) => !!c.type && c.type !== "text";
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((c) => cell(c.header, { bold: true, right: numeric(c), shade: true })) }),
      ...rows.map((r) => new TableRow({ children: columns.map((c) => cell(formatCell(c, r[c.key]), { right: numeric(c) })) })),
    ],
  });
}

export async function buildDocx(spec: DocxSpec): Promise<BuiltDeliverable> {
  const h = DeliverableHeaderSchema.parse(spec.header);
  const body: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [run(h.title, { bold: true })] }),
    new Paragraph({ children: [run(DRAFT_LABEL, { bold: true, color: WARNING })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: headerFields(h).map(([label, value]) => new TableRow({ children: [cell(label, { bold: true }), cell(value)] })),
    }),
    new Paragraph({ children: [] }),
  ];
  for (const b of spec.blocks) {
    if (b.type === "heading") body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(b.text)] }));
    else if (b.type === "paragraph") body.push(new Paragraph({ spacing: { after: 120 }, children: [run(b.text)] }));
    else if (b.type === "bullets") for (const it of b.items) body.push(new Paragraph({ bullet: { level: 0 }, children: [run(it)] }));
    else body.push(docTable(b.columns, b.rows), new Paragraph({ children: [] }));
  }

  const doc = new Document({
    creator: PRODUCER,
    lastModifiedBy: PRODUCER,
    title: h.title,
    subject: DRAFT_LABEL,
    description: `${h.clientName} (${h.clientCode}), ${h.period}, FY ${h.fy}. ${DRAFT_LABEL}`,
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph({ children: [run(DRAFT_LABEL, { bold: true, color: WARNING, size: 16 })] })] }) },
        footers: {
          default: new Footer({
            children: [new Paragraph({ children: [run(`${h.clientCode} · ${h.period} · ${h.title} v${h.version} · ${DRAFT_LABEL}`, { size: 16 })] })],
          }),
        },
        children: body,
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  return { buffer, sha256: sha256(buffer), fileName: deliverableFileName(h, "docx", spec.fileBase), mimeType: DOCX_MIME, sizeBytes: buffer.length };
}
