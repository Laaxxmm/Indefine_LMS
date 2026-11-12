import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, PageNumber, PageOrientation, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { SopContent, SopDetailStep, SopSubProcess } from "./types";
import { fitBox } from "./screens";
import { departmentLabel } from "./labels";

/* ------------------------------ DOCX (OneDrive / download) ------------------------------ */

const FONT = "Calibri";
const BODY = 22; // 11pt
const FAINT = "9AA0AE";
const BOX = { style: BorderStyle.SINGLE, size: 6, color: "333333" };

const run = (text: string, opts: { bold?: boolean; size?: number; break?: number } = {}) =>
  new TextRun({ text, font: FONT, size: opts.size ?? BODY, bold: opts.bold, break: opts.break });

function metaCell(text: string, header = false) {
  return new TableCell({
    shading: header ? { fill: "F1F0F7" } : undefined,
    children: [new Paragraph({ children: [run(text, { bold: header })] })],
  });
}

const headerRow = (headers: string[]) => new TableRow({ tableHeader: true, children: headers.map((h) => new TableCell({ shading: { fill: "F1F0F7" }, children: [new Paragraph({ children: [run(h, { bold: true })] })] })) });
const textRow = (r: string[]) => new TableRow({ children: r.map((v) => new TableCell({ children: [new Paragraph({ children: [run(v)] })] })) });
const table = (rows: TableRow[], widths?: number[]) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: widths, rows });

function dataTable(headers: string[], rows: string[][], widths?: number[]): Table {
  return table([headerRow(headers), ...rows.map(textRow)], widths);
}

// A screenshot's bytes and pixel size (SopImage), keyed by id in the map renderSopDocx takes.
export type SopImageData = { mime: string; bytes: Uint8Array; width: number; height: number };

// One sub-process's steps; a step with screens is followed by a full-width row holding them.
const STEP_HEADERS = ["Step", "Who", "Action", "System / screen", "Input → Output", "Control"];
function stepTable(p: SopSubProcess, images: ReadonlyMap<string, SopImageData>): Table {
  const rows = [headerRow(STEP_HEADERS)];
  for (const s of p.steps) {
    rows.push(textRow([s.no, s.role, s.action, s.system, [s.input, s.output].filter(Boolean).join(" → "), s.control]));
    const shots = screenParagraphs(s, images);
    if (shots.length) rows.push(new TableRow({ children: [new TableCell({ columnSpan: STEP_HEADERS.length, children: shots })] }));
  }
  return table(rows, [900, 1700, 5200, 2600, 2700, 900]);
}
function screenParagraphs(s: SopDetailStep, images: ReadonlyMap<string, SopImageData>): Paragraph[] {
  return (s.screens ?? []).flatMap((sc) => {
    const img = images.get(sc.imageId);
    if (!img) return [];
    const caption = `Screen ${s.no}${sc.caption ? ` — ${sc.caption}` : ""}`;
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120 },
        children: [new ImageRun({ type: img.mime === "image/png" ? "png" : "jpg", data: img.bytes, transformation: fitBox(img.width, img.height), altText: { name: `Screen ${s.no}`, title: caption, description: caption } })],
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: caption, font: FONT, size: 18, italics: true, color: "555555" })] }),
    ];
  });
}

const heading = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 }, children: [run(text, { bold: true, size: 26 })] });
const subHeading = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 }, children: [run(text, { bold: true, size: 24 })] });
const para = (text: string) => new Paragraph({ spacing: { after: 140 }, children: [run(text)] });
const label = (text: string) => new Paragraph({ spacing: { before: 120, after: 60 }, children: [run(text, { bold: true })] });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, children: [run(text)] });
const flowBox = (text: string) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 }, border: { top: BOX, bottom: BOX, left: BOX, right: BOX }, children: [run(text, { bold: true })] });
const flowArrow = () => new Paragraph({ alignment: AlignmentType.CENTER, children: [run("↓", { size: 24 })] });

export async function renderSopDocx(c: SopContent, images: ReadonlyMap<string, SopImageData> = new Map()): Promise<Buffer> {
  // Detailed SOPs (schemaVersion 2) carry sub-processes; older versions carry a flat procedure.
  const subProcesses = c.subProcesses ?? [];
  const detailed = subProcesses.length > 0;
  const children: (Paragraph | Table)[] = [];
  // top space for letterhead + title
  children.push(new Paragraph({ spacing: { before: 800 }, children: [run("")] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run(c.title, { bold: true, size: 30 })] }));

  // document control: meta table, plus sign-off slots on a detailed SOP
  const metaRows = [
    new TableRow({ children: [metaCell("Department", true), metaCell(departmentLabel(c.department)), metaCell("Revision", true), metaCell(c.revision)] }),
    new TableRow({ children: [metaCell("Work category", true), metaCell(c.workCategory), metaCell("Effective date", true), metaCell(c.effectiveDate)] }),
  ];
  if (detailed) {
    metaRows.push(new TableRow({ children: [metaCell("Prepared by", true), metaCell(c.preparedBy ?? ""), metaCell("Reviewed by", true), metaCell("")] }));
    metaRows.push(new TableRow({ children: [metaCell("Approved by", true), metaCell(""), metaCell("Next review due", true), metaCell("")] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: metaRows }));
  children.push(new Paragraph({ children: [run("")] }));

  if (c.flowchart.length) {
    children.push(heading(detailed ? "Process Map" : "Process Flow"));
    c.flowchart.forEach((s, i) => {
      children.push(flowBox(s));
      if (i < c.flowchart.length - 1) children.push(flowArrow());
    });
    children.push(new Paragraph({ children: [run("")] }));
  }

  let n = 1;
  children.push(heading(`${n++}. Purpose`));
  children.push(para(c.purpose));
  children.push(heading(`${n++}. Scope`));
  children.push(para(c.scope));
  if (c.definitions.length) {
    children.push(heading(`${n++}. Definitions`));
    children.push(dataTable(["Term", "Meaning"], c.definitions.map((d) => [d.term, d.meaning])));
  }
  if (c.responsibilities.length) {
    children.push(heading(`${n++}. Responsibilities`));
    children.push(dataTable(["Role", "Responsibility"], c.responsibilities.map((r) => [r.role, r.duty])));
  }
  children.push(heading(`${n++}. Procedure`));
  if (detailed) {
    for (const p of subProcesses) {
      children.push(subHeading(`${p.code} — ${p.name}`));
      if (p.objective) children.push(para(`Objective: ${p.objective}`));
      if (p.owner) children.push(para(`Process owner: ${p.owner}`));
      children.push(stepTable(p, images));
      const differences = p.steps.flatMap((s) => s.ifThen.map((t) => `${s.no}: ${t}`));
      if (differences.length) {
        children.push(label("If something is different"));
        differences.forEach((d) => children.push(bullet(d)));
      }
    }
    if (c.controls?.length) {
      children.push(heading(`${n++}. Controls`));
      children.push(dataTable(["Control", "Type", "What is checked"], c.controls.map((k) => [k.id, k.type === "APPLICATION" ? "Application" : "Manual", k.description]), [1200, 1800, 11000]));
    }
    if (c.kpis?.length) {
      children.push(heading(`${n++}. Key Performance Indicators`));
      c.kpis.forEach((k) => children.push(bullet(k)));
    }
    if (c.risks?.length) {
      children.push(heading(`${n++}. Risk and Control Matrix`));
      children.push(dataTable(["Risk", "Control", "Owner", "Frequency"], c.risks.map((r) => [r.risk, r.control, r.owner, r.frequency]), [4800, 5200, 2200, 1800]));
    }
    if (c.openPoints?.length) {
      children.push(heading(`${n++}. Points to Confirm`));
      children.push(para("The author's description did not cover these. Confirm each one, then issue a new version."));
      c.openPoints.forEach((q) => children.push(bullet(q)));
    }
  } else {
    children.push(dataTable(["Step", "Action", "Responsibility"], c.procedure.map((p) => [String(p.step), p.action, p.responsibility]), [900, 6300, 2400]));
  }
  if (c.references.length) {
    children.push(heading(`${n++}. References`));
    c.references.forEach((r) => children.push(bullet(r)));
  }

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          run(`${c.title} · ${departmentLabel(c.department)} · Rev ${c.revision} — `, { size: 16 }),
          new TextRun({ text: "Page ", font: FONT, size: 16, color: FAINT }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: FAINT }),
        ],
      }),
    ],
  });

  // Six-column step tables need the width: a detailed SOP prints landscape.
  const properties = detailed ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } } : {};
  const doc = new Document({ sections: [{ properties, footers: { default: footer }, children }] });
  return Packer.toBuffer(doc);
}
