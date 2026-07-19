import {
  AlignmentType, BorderStyle, Document, Footer, Packer, PageNumber, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

// Shared docx building blocks for the legal-document generators. The originals use
// python-docx with Times New Roman 12pt, bold clause headings, bullet lists and
// single-column bordered signature tables — reproduced here with the `docx` npm lib
// (pure-JS, Railway-safe, same lib the certificate engine uses).

export const FONT = "Times New Roman";
const SIZE = 24; // half-points => 12pt

export type Run = { text: string; bold?: boolean; italics?: boolean };
export const t = (text: string): Run => ({ text });
export const b = (text: string): Run => ({ text, bold: true });
export const i = (text: string): Run => ({ text, italics: true });

const runs = (parts: (Run | string)[]) =>
  parts.map((p) => (typeof p === "string" ? new TextRun({ text: p }) : new TextRun(p)));

// A normal justified paragraph from mixed bold/plain runs (or a plain string).
export function para(...parts: (Run | string)[]): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, children: runs(parts) });
}

// Centered bold title/heading.
export function heading(text: string, big = false): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 160 },
    children: [new TextRun({ text, bold: true, size: big ? 28 : SIZE })],
  });
}

// Left-aligned bold clause heading ("1. OBJECTIVE:").
export function clause(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text, bold: true })] });
}

// Empty spacer line.
export const spacer = () => new Paragraph({ children: [new TextRun("")] });

// A real bulleted item.
export function bullet(...parts: (Run | string)[]): Paragraph {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runs(parts) });
}

// Split a multi-line textarea value into bullet paragraphs (blank lines dropped).
export function bulletsFrom(multiline: string): Paragraph[] {
  return multiline.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => bullet(s));
}

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" };

// Single-column bordered table (signature blocks). Each string is one row.
export function boxTable(rows: (string | Paragraph[])[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER,
      insideHorizontal: CELL_BORDER, insideVertical: CELL_BORDER,
    },
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [
            new TableCell({
              children: Array.isArray(r) ? r : [new Paragraph({ children: [new TextRun(r)] })],
            }),
          ],
        }),
    ),
  });
}

export type Cell = { text: string; bold?: boolean };

const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;
type Align = keyof typeof ALIGN;

// Flexible multi-column table. `bordered: false` gives an invisible grid (used for
// signature / witness blocks, matching the source's nil borders). `fontSize` (pt) sets
// the cell run size (e.g. the 9pt related-party tables in the Director's Report).
export function gridTable(rows: Cell[][], opts?: { bordered?: boolean; align?: "left" | "center"; fontSize?: number }): Table {
  const bordered = opts?.bordered ?? true;
  const alignment = opts?.align === "left" ? AlignmentType.LEFT : AlignmentType.CENTER;
  const size = opts?.fontSize ? opts.fontSize * 2 : undefined;
  const bd = bordered ? CELL_BORDER : { style: BorderStyle.NONE, size: 0, color: "auto" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: bd, bottom: bd, left: bd, right: bd, insideHorizontal: bd, insideVertical: bd },
    rows: rows.map(
      (r) =>
        new TableRow({
          children: r.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment,
                    children: cell.text.split("\n").map((ln, i) => new TextRun({ text: ln, bold: cell.bold, size, break: i > 0 ? 1 : undefined })),
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}

// A paragraph from a possibly multi-line string ('\n' -> line breaks), with optional
// bold / alignment / point-size / spacing. Mirrors the source's add_paragraph.
export function paraML(text: string, opts?: { bold?: boolean; align?: Align; sizePt?: number; spaceBeforePt?: number; spaceAfterPt?: number }): Paragraph {
  const size = opts?.sizePt ? opts.sizePt * 2 : undefined;
  const lines = text.split("\n");
  return new Paragraph({
    alignment: ALIGN[opts?.align ?? "justify"],
    spacing: { before: (opts?.spaceBeforePt ?? 0) * 20, after: (opts?.spaceAfterPt ?? 6) * 20, line: 240 },
    children: lines.map((ln, i) => new TextRun({ text: ln, bold: opts?.bold, size, break: i > 0 ? 1 : undefined })),
  });
}

// Narrative block wrapped in a borderless single-cell table (source's add_boxed_text):
// '\n\n' splits paragraphs, single '\n' is a line break. Followed by a spacer paragraph.
export function boxedText(text: string, opts?: { bold?: boolean; sizePt?: number }): (Table | Paragraph)[] {
  const bd = { style: BorderStyle.NONE, size: 0, color: "auto" };
  const size = opts?.sizePt ? opts.sizePt * 2 : undefined;
  const paras = text.split("\n\n").map(
    (block) =>
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 120, line: 240 },
        children: block.trim().split("\n").map((ln, i) => new TextRun({ text: ln, bold: opts?.bold, size, break: i > 0 ? 1 : undefined })),
      }),
  );
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: bd, bottom: bd, left: bd, right: bd, insideHorizontal: bd, insideVertical: bd },
    rows: [new TableRow({ children: [new TableCell({ margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: paras })] })],
  });
  return [table, new Paragraph({ children: [new TextRun("")] })];
}

// Page break (starts the next block on a fresh page).
export const pageBreak = () => new Paragraph({ children: [new TextRun("")], pageBreakBefore: true });

// Wrap the document body with the default font + a page-number footer, return .docx bytes.
export async function buildDoc(children: (Paragraph | Table)[], opts?: { font?: string }): Promise<Buffer> {
  const font = opts?.font ?? FONT;
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Page ", size: 16, color: "9AA0AE" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "9AA0AE" }),
          new TextRun({ text: " of ", size: 16, color: "9AA0AE" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "9AA0AE" }),
        ],
      }),
    ],
  });

  const doc = new Document({
    styles: { default: { document: { run: { font, size: SIZE } } } },
    sections: [{ footers: { default: footer }, children }],
  });
  return Packer.toBuffer(doc);
}
