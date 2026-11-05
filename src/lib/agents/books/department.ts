// Wrong-department input fails closed (ADR-008 §7): a deterministic look at the header rows of
// the supplied files, BEFORE any model call. When the documents belong to another department the
// run stops with a message naming the agent to use. Shared by Books Close and Audit Assist.
import { HEADER_SCAN_ROWS, parseCsv, type Cells } from "./table";

export type Department = { agent: "gst" | "tax" | "roc" | "books" | "audit"; label: string };

type Signal = Department & { patterns: RegExp[]; minHits: number };

/** Header signals per department (data). A file matches when at least `minHits` patterns occur. */
export const DEPARTMENT_SIGNALS: Signal[] = [
  { agent: "gst", label: "GST Prep", patterns: [/\bgstin\b|gstin\/uin/, /invoice\s*(no|number|date)/, /taxable\s*value/, /\bhsn\b|\bsac\b/, /place\s*of\s*supply/, /\bigst\b.*\bamount|\bcgst\b.*\bamount/], minHits: 2 },
  { agent: "tax", label: "Tax Prep", patterns: [/26as/, /\bais\b|\btis\b/, /tan\s*of\s*deductor|name\s*of\s*deductor/, /assessment\s*year/, /\bitr\b/], minHits: 2 },
  { agent: "roc", label: "ROC Prep", patterns: [/\bdin\b/, /no\.?\s*of\s*shares|shareholding/, /\bagm\b/, /\bfolio\b/, /\bcin\b/], minHits: 2 },
];

export function sniffRows(rows: Cells, signals: Signal[] = DEPARTMENT_SIGNALS): Department | null {
  const text = rows
    .slice(0, HEADER_SCAN_ROWS)
    .map((r) => r.join(" | "))
    .join("\n")
    .toLowerCase();
  for (const s of signals) {
    const hits = s.patterns.filter((p) => p.test(text)).length;
    if (hits >= s.minHits) return { agent: s.agent, label: s.label };
  }
  return null;
}

/** CSV/TXT files only (synchronous; XLSX is sniffed after it is read). */
export function sniffCsv(name: string, bytes: Buffer): Department | null {
  if (!/\.(csv|txt)$/i.test(name)) return null;
  return sniffRows(parseCsv(bytes.toString("utf8")));
}

export class WrongDepartmentError extends Error {
  constructor(
    readonly file: string,
    readonly dept: Department,
    readonly self: string,
  ) {
    super(`Wrong department: ${file} looks like a ${dept.label} document, not ${self} input. Run the ${dept.label} agent (/agents/${dept.agent}) instead.`);
    this.name = "WrongDepartmentError";
  }
}

export const wrongDepartmentMessage = (file: string, dept: Department, self: string) => new WrongDepartmentError(file, dept, self).message;
