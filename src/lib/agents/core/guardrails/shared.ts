// Shared helpers for agents' model tasks (ADR-008), moved here from src/lib/agents/roc so that ROC
// and Tax both read them from core: a strict evidence schema, quote / number checks on strings,
// and the ROC ↔ Tax ↔ GST input-name sniff behind their AgentScope.inputSniff. The task spec type
// and the firm preamble these agents used to carry are now the framework's (scope.ts). Pure.
import { z } from "zod";
import { quoteInContext } from "../checklist";
import { INSUFFICIENT_EVIDENCE } from "./schema";

export const INSUFFICIENT = INSUFFICIENT_EVIDENCE;

/** Evidence every extracted value / verdict carries: a verbatim quote and where it is (both required, capped). */
export const EvidenceSchema = z.object({
  quote: z.string().trim().min(1).max(300),
  location: z.string().trim().min(1).max(120),
});

/** Quote occurs in the source text (whitespace- and case-normalised): the checklist engine's quoteInContext, source first. */
export function quoteIn(source: string, quote: string): boolean {
  return quoteInContext(quote, source);
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
