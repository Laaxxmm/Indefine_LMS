import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { CertificateTemplate } from "../types";
import { compose, isTotalRow } from "./compose";
import { resolveValues } from "./values";

// Same compose() walk as the HTML preview → Word paragraphs, runs, and tables. The
// composer's structural styles (title / heading / subheading) become bold/centred type;
// bold runs inside a line come through line.runs. Pure-JS (docx npm), Railway-safe.
//
// Page geometry leaves a top band for the firm's pre-printed letterhead and a bottom band
// for its pre-printed footer strip (nothing rendered there — reserved print space).
const FONT = "Times New Roman";
const SIZE = 22; // half-points => 11pt
const LINE = 276; // 1.15 line spacing

// twips (1 inch = 1440). Top/bottom reserve the pre-printed letterhead + footer bands.
const MARGIN = { top: 2350, bottom: 1750, left: 1200, right: 1200 };

// A "1." / "2." top-level numbered clause, or an "i." / "ii." sub-clause — hanging indent.
const isNumbered = (t: string) => /^\d+\.\s/.test(t);
const isSubNumbered = (t: string) => /^[ivx]+\.\s/i.test(t.trim());

export async function renderDocx(template: CertificateTemplate, rawPayload: Record<string, unknown>): Promise<Buffer> {
  const resolved = resolveValues(template, rawPayload);
  const blocks = compose(template, resolved);
  const children: (Paragraph | Table)[] = [];

  // Entity identifiers (PAN / GSTIN) — collected on every cert, rendered outside the ICAI
  // segments (never locked text) as a right-aligned reference line at the top.
  const idBits = [resolved.inline.entityPAN && `PAN: ${resolved.inline.entityPAN}`, resolved.inline.entityGSTIN && `GSTIN: ${resolved.inline.entityGSTIN}`].filter(Boolean);
  if (idBits.length) {
    children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 160 }, children: [new TextRun({ text: idBits.join("    "), font: FONT, size: SIZE })] }));
  }

  for (const b of blocks) {
    if (b.kind === "para") {
      const centered = b.lines.some((l) => l.style === "subheading");
      const heading = b.lines.some((l) => l.style === "title" || l.style === "heading");
      const firstText = b.lines[0]?.text ?? "";
      const numbered = isNumbered(firstText);
      const sub = isSubNumbered(firstText);
      // Hanging indent so wrapped lines align under the text, not the number.
      const indent = numbered ? { left: 420, hanging: 420 } : sub ? { left: 820, hanging: 400 } : undefined;

      children.push(
        new Paragraph({
          alignment: centered ? AlignmentType.CENTER : heading ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
          spacing: { before: centered || heading ? 200 : 40, after: 140, line: LINE },
          indent,
          children: b.lines.flatMap((line, i) => {
            const lineBold = !!line.style;
            const size = line.style === "title" ? 26 : SIZE;
            const brk = i > 0 ? 1 : undefined;
            // Bold runs inside the line (entity name, authority, dates …) OR a plain line.
            if (line.runs && line.runs.length) {
              return line.runs.map((r, j) => new TextRun({ text: r.text, font: FONT, size, bold: lineBold || r.bold, break: j === 0 ? brk : undefined }));
            }
            return [new TextRun({ text: line.text, font: FONT, size, bold: lineBold, break: brk })];
          }),
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

  // No header/footer content — the top/bottom margins reserve space for the firm's
  // pre-printed letterhead so the document prints cleanly onto it.
  const doc = new Document({ sections: [{ properties: { page: { margin: MARGIN } }, children }] });
  return Packer.toBuffer(doc);
}

function cell(text: string, bold = false, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT): TableCell {
  return new TableCell({
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, font: FONT, size: SIZE, bold })] })],
  });
}
