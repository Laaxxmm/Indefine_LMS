import type { CertificateTemplate, FieldDef, Segment } from "../types";
import type { ResolvedTable, ResolvedValues } from "./values";

// Single source of truth for BOTH the live HTML preview and the DOCX download.
// compose() walks the segments exactly once and yields block-level items; toHtml
// and toDocx render those items, so preview and download can never diverge (§7).

// Presentation hint for a line, derived structurally (never from the locked text's
// content, which stays verbatim). Both renderers turn these into bold/centred type.
export type LineStyle = "title" | "heading" | "subheading";
export interface Line {
  text: string; // clean text (bold markers stripped) — used for classify + leak scan
  style?: LineStyle;
  runs?: { text: string; bold: boolean }[]; // present when the line has mid-line bold spans
}
export type Block = { kind: "para"; lines: Line[] } | { kind: "table"; table: ResolvedTable };

// Private control-char markers wrap a bold field value inside the text buffer; stripped
// for the clean line text, turned into bold runs by flush(). Never appear in output.
const B_ON = "";
const B_OFF = "";
const stripBold = (s: string) => s.replace(/[]/g, "");
function toRuns(s: string): { text: string; bold: boolean }[] {
  const runs: { text: string; bold: boolean }[] = [];
  let bold = false, cur = "";
  for (const ch of s) {
    if (ch === B_ON || ch === B_OFF) { if (cur) runs.push({ text: cur, bold }); cur = ""; bold = ch === B_ON; }
    else cur += ch;
  }
  if (cur) runs.push({ text: cur, bold });
  return runs;
}

// Known ICAI section headings (exact match) + structural title/statement detection.
const HEADINGS = new Set([
  "Management's Responsibility",
  "Management Responsibility",
  "Auditor's Responsibility",
  "Practitioner's Responsibility",
  "Assessee's Responsibility",
  "Individual's Responsibility for the Statement",
  "Opinion",
  "Conclusion",
  "Restriction on Use",
  "Restrictions on Use",
]);

export function classifyLine(text: string): LineStyle | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (HEADINGS.has(t)) return "heading";
  if (/^Independent (Auditor's|Practitioner's) Certificate\b/.test(t)) return "title";
  if (/^(Statement of\b|Statement I\b|Statement II\b|Statement comprising\b|Enclosure|Annexure\b|STATEMENT)/i.test(t)) return "subheading";
  // ALL-CAPS statement/section titles (e.g. "A. PROPERTY, PLANT AND EQUIPMENTS", "NEGATIVE COVENANTS", "ITR V").
  // A "label: value" line is never a title — it is signature-block data whose value happens
  // to be upper-case ("UDIN: 25255312BMKAAB1234", "PAN: AABCU9603R"), and centring those
  // was pulling the whole signature block off the left margin.
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (!t.includes(":") && letters.length >= 3 && letters.length <= 60 && letters === letters.toUpperCase()) return "subheading";
  return undefined;
}

// A total / net-worth / EBID row — bolded in tables.
export function isTotalRow(label: string): boolean {
  return /\b(total|net ?worth|net-?block|earning before interest)\b/i.test(label.trim());
}

export class PlaceholderLeakError extends Error {
  constructor(public readonly token: string, public readonly context: string) {
    super(`Residual placeholder "${token}" survived into output near: "${context}". Refusing to emit a half-filled certificate.`);
    this.name = "PlaceholderLeakError";
  }
}

// §0.4 — nothing half-filled may survive. Ellipses/brackets/20XX come from an unfilled
// span; the slash-pairs come from a signer toggle that was transcribed as locked text
// instead of a field (a template bug we want to fail loudly on).
const LEAK_PATTERNS: RegExp[] = [
  /…/,
  /\.\.\./,
  /20XX/,
  /[\[\]]/,
  /\bI\/we\b/i,
  /\bmy\/our\b/i,
  /\bme\/us\b/i,
  /\bam\/are\b/i,
  /\/we\b/i,
  /\/our\b/i,
  // applicant/assessee gender pairs (Format ii onward) — an un-toggled his/her(/its),
  // him/her, he/she(/it) or Mr./Mrs./Ms. The source spaces slashes inconsistently.
  /\bhis ?\/ ?her\b/i,
  /\bhim ?\/ ?her\b/i,
  /\bhe ?\/ ?she\b/i,
  /Mr\.? ?\/ ?Mrs?\b/i,
  /Mr\.? ?\/ ?Ms\b/i,
];

function assertNoLeak(text: string): void {
  for (const re of LEAK_PATTERNS) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      const i = Math.max(0, m.index - 25);
      throw new PlaceholderLeakError(m[0], text.slice(i, m.index + 25));
    }
  }
}

function indexFields(fields: FieldDef[]): Map<string, FieldDef> {
  const map = new Map<string, FieldDef>();
  for (const f of fields) {
    map.set(f.key, f);
    for (const sf of f.subFields ?? []) map.set(sf.key, sf);
  }
  return map;
}

// Turn a raw text buffer (with \n line breaks and \n\n paragraph breaks) into paragraph
// blocks. Bold markers survive into `raw`; each line keeps clean text + optional bold runs.
function flush(buf: string, out: Block[]): void {
  if (buf === "") return;
  for (const para of buf.split(/\n\s*\n/)) {
    const raw = para.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
    while (raw.length && stripBold(raw[0]) === "") raw.shift();
    while (raw.length && stripBold(raw[raw.length - 1]) === "") raw.pop();
    if (raw.length) {
      out.push({
        kind: "para",
        lines: raw.map((rawLine) => {
          const text = stripBold(rawLine);
          const runs = toRuns(rawLine);
          return { text, style: classifyLine(text), runs: runs.some((r) => r.bold) ? runs : undefined };
        }),
      });
    }
  }
}

function walk(segments: Segment[], byKey: Map<string, FieldDef>, resolved: ResolvedValues, inlineFor: (key: string) => string | undefined, boldSet: Set<string>, out: Block[]): void {
  let buf = "";
  for (const seg of segments) {
    if (seg.kind === "text") {
      buf += seg.text;
      continue;
    }
    const f = byKey.get(seg.key);
    if (!f) throw new Error(`segment references unknown field "${seg.key}"`);
    if (f.type === "table") {
      flush(buf, out);
      buf = "";
      const table = resolved.tables[seg.key];
      if (!table) throw new Error(`table "${seg.key}" not resolved`);
      out.push({ kind: "table", table });
    } else if (f.type === "optionalBlock") {
      flush(buf, out);
      buf = "";
      const block = resolved.blocks[seg.key];
      // block sub-segments may reference the block's own sub-fields OR a top-level field
      // (e.g. the signer toggle sg_iwe inside the reliance sentence) — fall back to inline.
      if (block?.enabled) walk(f.subSegments ?? [], byKey, resolved, (k) => block.inline[k] ?? resolved.inline[k], boldSet, out);
    } else {
      const v = inlineFor(seg.key);
      if (v === undefined) throw new Error(`field "${seg.key}" not resolved`);
      buf += boldSet.has(seg.key) ? `${B_ON}${v}${B_OFF}` : v;
    }
  }
  flush(buf, out);
}

export function compose(template: CertificateTemplate, resolved: ResolvedValues): Block[] {
  const byKey = indexFields(template.fields);
  const boldSet = new Set(template.boldFields ?? []);
  const out: Block[] = [];
  walk(template.segments, byKey, resolved, (k) => resolved.inline[k], boldSet, out);

  // Entity identifiers (PAN / GSTIN) — collected on every certificate, never part of the
  // locked ICAI text, so they are injected here rather than sitting in segments. They go
  // directly UNDER the addressee, not above the document: block 0 is always the
  // "To / <client> / <address>" block (every template opens with t("To\n")). Built as a
  // styleless line so classifyLine's ALL-CAPS rule can't centre and bold it.
  const idBits = [resolved.inline.entityPAN && `PAN: ${resolved.inline.entityPAN}`, resolved.inline.entityGSTIN && `GSTIN: ${resolved.inline.entityGSTIN}`].filter(Boolean);
  if (idBits.length && out.length) out.splice(1, 0, { kind: "para", lines: [{ text: idBits.join("    ") }] });

  // Guardrail: scan everything we are about to emit for residual placeholders —
  // paragraph lines AND table row/column labels AND cells (a "20XX" can hide in a label).
  for (const b of out) {
    if (b.kind === "para") b.lines.forEach((l) => assertNoLeak(l.text));
    else {
      b.table.rowLabels.forEach(assertNoLeak);
      b.table.columns.forEach((c) => assertNoLeak(c.label));
      b.table.cells.forEach((row) => row.forEach(assertNoLeak));
    }
  }
  return out;
}
