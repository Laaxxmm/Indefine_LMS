import { AlignmentType, Document, Footer, PageNumber, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { CertificateTemplate } from "../types";
import { compose, isTotalRow } from "./compose";
import { resolveValues } from "./values";

// Same compose() walk as the HTML preview → Word paragraphs, runs, and tables, with the
// composer's structural styles (title / heading / subheading) turned into bold/centred
// type. Pure-JS (docx npm), Railway-safe. Throws (via compose's guard) on any residual
// placeholder (§0.4). Leaves top space for the firm's letterhead + a page-number footer.
const FONT = "Times New Roman";
const SIZE = 22; // half-points => 11pt
const FAINT = "9AA0AE";

export async function renderDocx(template: CertificateTemplate, rawPayload: Record<string, unknown>): Promise<Buffer> {
  const blocks = compose(template, resolveValues(template, rawPayload));
  const children: (Paragraph | Table)[] = [
    // letterhead space (§7)
    new Paragraph({ children: [new TextRun({ text: "", font: FONT, size: SIZE })], spacing: { before: 1400 } }),
  ];

  for (const b of blocks) {
    if (b.kind === "para") {
      const centered = b.lines.some((l) => l.style === "subheading");
      const emphasised = b.lines.some((l) => l.style === "title" || l.style === "heading");
      children.push(
        new Paragraph({
          alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: centered || emphasised ? 220 : 0, after: 160 },
          children: b.lines.map(
            (line, i) =>
              new TextRun({
                text: line.text,
                font: FONT,
                size: line.style === "title" ? 26 : SIZE,
                bold: !!line.style,
                break: i > 0 ? 1 : undefined,
              }),
          ),
        }),
      );
    } else {
      const { columns, rowLabels, cells, dynamic } = b.table;
      const headerRow = new TableRow({ tableHeader: true, children: [...(dynamic ? [] : [cell("", true)]), ...columns.map((c) => cell(c.label, true))] });
      const bodyRows = cells.map((row, r) => {
        const total = !dynamic && isTotalRow(rowLabels[r]);
        return new TableRow({ children: [...(dynamic ? [] : [cell(rowLabels[r], true)]), ...row.map((v) => cell(v, total, AlignmentType.RIGHT))] });
      });
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] }));
      children.push(new Paragraph({ children: [new TextRun({ text: "", font: FONT, size: SIZE })] }));
    }
  }

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Page ", font: FONT, size: 16, color: FAINT }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: FAINT }),
          new TextRun({ text: " of ", font: FONT, size: 16, color: FAINT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: FAINT }),
        ],
      }),
    ],
  });

  const doc = new Document({ sections: [{ footers: { default: footer }, children }] });
  return Packer.toBuffer(doc);
}

function cell(text: string, bold = false, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT): TableCell {
  return new TableCell({
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, font: FONT, size: SIZE, bold })] })],
  });
}
