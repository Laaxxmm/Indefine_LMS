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
// Characters that fit on one line of the ~6.6" text column at 11pt Times New Roman. A line
// shorter than this cannot wrap, so it is structural rather than prose (see `structural`).
const WRAP_CHARS = 90;

// twips (1 inch = 1440). Top/bottom reserve the pre-printed letterhead + footer bands.
const MARGIN = { top: 2350, bottom: 1750, left: 1200, right: 1200 };

// A "1." / "2." top-level numbered clause, or an "i." / "ii." sub-clause — hanging indent.
const isNumbered = (t: string) => /^\d+\.\s/.test(t);
const isSubNumbered = (t: string) => /^[ivx]+\.\s/i.test(t.trim());

export async function renderDocx(template: CertificateTemplate, rawPayload: Record<string, unknown>): Promise<Buffer> {
  const resolved = resolveValues(template, rawPayload);
  const blocks = compose(template, resolved);
  const children: (Paragraph | Table)[] = [];

  for (const b of blocks) {
    if (b.kind === "para") {
      // ONE Word paragraph PER LINE. Emitting a multi-line block as a single justified
      // paragraph joined by break-runs made Word stretch every line except the last, which
      // splayed the addressee and signature blocks across the full page width. A line that
      // is its own paragraph is its own last line, so it is never stretched: short lines
      // (To / client / address / firm / FRN / M.No / UDIN / Place) sit left naturally,
      // while long prose still justifies as it wraps. Style is read per line too, so a
      // heading no longer centres the body that follows it in the same block.
      // A block whose every line is too short to wrap is structural, not prose — the
      // addressee ("To / client / address"), the PAN·GSTIN line, the signature block,
      // the Place/Date footer. Those are left-aligned outright, so they stay on the left
      // margin even when a long client or firm name does wrap. Prose blocks (which always
      // carry at least one full-width line) keep justification.
      const structural = b.lines.every((l) => l.text.length < WRAP_CHARS);
      b.lines.forEach((line, i) => {
        const centered = line.style === "subheading";
        const heading = line.style === "title" || line.style === "heading" || structural;
        const numbered = isNumbered(line.text);
        const sub = isSubNumbered(line.text);
        // Hanging indent so wrapped lines align under the text, not the number.
        const indent = numbered ? { left: 420, hanging: 420 } : sub ? { left: 820, hanging: 400 } : undefined;
        const bold = !!line.style;
        const size = line.style === "title" ? 26 : SIZE;
        const first = i === 0;
        const last = i === b.lines.length - 1;
        children.push(
          new Paragraph({
            alignment: centered ? AlignmentType.CENTER : heading ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
            // Gap only around the block; lines inside it stay tight, as they were when
            // they were break-separated lines of one paragraph.
            spacing: { before: first ? (centered || heading ? 200 : 40) : 0, after: last ? 140 : 0, line: LINE },
            indent,
            // Bold runs inside the line (entity name, authority, dates …) OR a plain line.
            children: line.runs && line.runs.length
              ? line.runs.map((r) => new TextRun({ text: r.text, font: FONT, size, bold: bold || r.bold }))
              : [new TextRun({ text: line.text, font: FONT, size, bold })],
          }),
        );
      });
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
