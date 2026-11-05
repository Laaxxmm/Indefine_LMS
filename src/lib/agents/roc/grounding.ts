// Guardrail helpers for model tasks (ADR-008) until the framework enforces them centrally:
// a task registry entry type, the firm preamble, closed-output helpers, and grounding checks
// (a quote must occur in the text actually sent to the model; numbers in an extracted value must
// appear in its quote). Pure; used by the ROC and Tax agents.
import { z, type ZodType } from "zod";
import type { AgentTask } from "@/lib/ai/router";

export const INSUFFICIENT = "insufficient_evidence" as const;

/** Evidence every extracted value / verdict carries: a verbatim quote and where it is. */
export const EvidenceSchema = z.object({
  quote: z.string().trim().min(1).max(300),
  location: z.string().trim().min(1).max(120),
});

export type ModelTaskSpec<T, C> = {
  /** `<agent>.<task>`; recorded on every ModelCall. */
  name: AgentTask;
  version: number;
  schema: ZodType<T>;
  system: string;
  /** Checklist rule ids whose result depends on this task. */
  rules: string[];
  /** Deterministic validator: returns issues (empty = valid). Wired as the router's `contradictions`. */
  validate?: (output: T, ctx: C) => string[];
};

export const FIRM_PREAMBLE =
  "You assist a firm of chartered accountants in Bangalore, India, by preparing drafts that a qualified person reviews. Use only the documents supplied in this message. Never compute totals, tax, interest, fees or any other amount. Give no filing, legal or audit-opinion advice. If the documents do not contain the answer, return insufficient_evidence for that item instead of guessing. Output JSON only.";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Quote occurs in the source text (whitespace- and case-normalised). */
export function quoteIn(source: string, quote: string): boolean {
  const q = norm(quote);
  return q.length > 0 && norm(source).includes(q);
}

/** Digit groups in a text, commas removed ("1,20,000.50" → "120000.50"). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Every number written in `value` must also be written in `quote`. */
export function numbersGrounded(value: string, quote: string): boolean {
  const inQuote = new Set(numbersIn(quote));
  return numbersIn(value).every((n) => inQuote.has(n));
}

// ------------------------------------------------------------------ department sniffing

type NamedFile = { name: string; bytes: Buffer };

/** A GST sales / purchase register or GSTR return: by name, or a CSV header with GSTIN + invoice / HSN columns. */
export function looksLikeGstFile(f: NamedFile): boolean {
  if (/(^|[-_ ])(gstr|sales[-_ ]?register|purchase[-_ ]?register)/i.test(f.name)) return true;
  if (!/\.csv$/i.test(f.name)) return false;
  const header = f.bytes.toString("utf8", 0, Math.min(f.bytes.length, 2000)).split(/\r?\n/)[0].toLowerCase();
  return header.includes("gstin") && (header.includes("invoice") || header.includes("hsn"));
}

export const TAX_INPUT_NAMES = ["organiser.json", "26as.csv", "ais.csv", "capital-gains.csv", "prior-itr.json"];
export const ROC_INPUT_NAMES = ["company.json", "directors.csv", "shareholding.csv", "auditor.json"];

/** Message naming the right agent when the files belong to another department, else null. */
export function wrongDepartment(files: NamedFile[], self: "roc" | "tax"): string | null {
  const names = new Set(files.map((f) => f.name.toLowerCase()));
  if (names.has(self === "roc" ? "company.json" : "organiser.json")) return null;
  const me = self === "roc" ? "ROC Prep" : "Tax Prep";
  const hits = (self === "roc" ? TAX_INPUT_NAMES : ROC_INPUT_NAMES).filter((n) => names.has(n));
  if (hits.length) return `These look like ${self === "roc" ? "income-tax" : "ROC / company-law"} inputs (${hits.join(", ")}): run the ${self === "roc" ? "Tax Prep" : "ROC Prep"} agent, not ${me}.`;
  const gst = files.filter(looksLikeGstFile).map((f) => f.name);
  if (gst.length) return `These look like GST registers / returns (${gst.join(", ")}): run the GST Prep agent, not ${me}.`;
  return null;
}
