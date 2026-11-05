// Expense-classification suggestions for bank debits the books do not have yet — the ONLY model
// task of the Books agent (ADR-008): `books.classify-expenses@1`, router fast tier (difficulty
// "sop"), anonymised before any cloud call.
//
// Guardrails (ADR-008):
//   - closed outputs: `lineId` is an enum of the candidate lines; `ledger` is an enum of the
//     client's OWN ledgers from the trial balance plus "insufficient_evidence" — the model cannot
//     invent a head;
//   - grounding: every answer carries { quote, location } copied from the line text it was given;
//     `validateClassification` checks the quote occurs in that line and every number in the quote
//     is a number of that line (wired as the router's `contradictions`, and re-applied here after
//     the call: an ungrounded answer is never used — it becomes a reviewer question);
//   - abstain: "insufficient_evidence" becomes a reviewer question in the pack, never a default.
// Suggestions are labelled as such and never posted to the books.
import { z } from "zod";
import type { ModelCaller } from "@/lib/agents/core/runner";
import type { BankLine } from "./bank";
import type { Suggestion } from "./analysis";
import { matchRows, type TbData } from "./tb";

export const BOOKS_CLASSIFY_TASK = "books.classify-expenses" as const;
export const BOOKS_CLASSIFY_VERSION = 1;
export const INSUFFICIENT = "insufficient_evidence" as const;
export const MAX_TEXT = 300;

/** Firm + department preamble (ADR-008 §1). */
export const BOOKS_SYSTEM_PREAMBLE = [
  "You assist an Indian chartered accountancy firm. You work ONLY on month-end bookkeeping close (trial balance, bank reconciliation, expense classification) for the client whose documents are supplied.",
  "Use only the documents supplied. Never compute, add up or change any amount. Never give filing, legal, tax-planning or audit-opinion advice.",
  `If the documents do not contain the answer, return "${INSUFFICIENT}". Output JSON only.`,
].join(" ");

export const CLASSIFY_SYSTEM = [
  BOOKS_SYSTEM_PREAMBLE,
  "Task: for each bank debit that is not yet in the books, choose the client's ledger it most likely belongs to, from the allowed ledger list only.",
  `If the narration does not show what the payment was for, answer "${INSUFFICIENT}" for that line.`,
  "For every line give evidence.quote copied verbatim from that line's text and evidence.location = the line id (e.g. S8). Confidence is between 0 and 1. Notes are optional and short.",
  "These are suggestions for a reviewer; nothing is posted.",
].join(" ");

/** Patterns for the ledgers offered as heads: expense and purchase groups of the client's TB. */
export const HEAD_GROUPS = ["indirect expenses", "direct expenses", "^expenses?$", "operating expenses", "administrative expenses", "other expenses", "cost of goods sold", "purchase accounts", "^purchases?$"];

/** The client's own ledgers offered as heads: expense/purchase ledgers of the TB; else every TB ledger; name order. */
export function chartHeads(tb: TbData | null): string[] {
  if (!tb) return [];
  const sorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const heads = sorted(matchRows(tb, { group: HEAD_GROUPS }).map((r) => r.ledger));
  return heads.length ? heads : sorted(tb.rows.map((r) => r.ledger));
}

/** The exact text of one line as the model sees it (and as quotes are checked against). */
export const lineText = (l: BankLine) => `${l.id} | ${l.date} | ${l.narration} | ${l.ref} | ${(Math.abs(l.amountPaise) / 100).toFixed(2)}`;

/** Output schema for one call: enums built from this call's input (ADR-008 §2). */
export function classifySchema(lines: BankLine[], heads: string[]) {
  const ids = lines.map((l) => l.id) as [string, ...string[]];
  return z.object({
    suggestions: z
      .array(
        z.object({
          lineId: z.enum(ids),
          ledger: z.enum([INSUFFICIENT, ...heads] as [string, ...string[]]),
          confidence: z.number().min(0).max(1),
          evidence: z.object({ quote: z.string().trim().min(1).max(MAX_TEXT), location: z.string().trim().min(1).max(120) }),
          note: z.string().max(MAX_TEXT).optional(),
        }),
      )
      .max(500),
  });
}
export type ClassifyOutput = z.infer<ReturnType<typeof classifySchema>>;
export type ClassifyAnswer = ClassifyOutput["suggestions"][number];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const numbers = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));

/** Why one answer is not grounded in its line, or null when it is. */
export function groundingIssue(a: Pick<ClassifyAnswer, "lineId" | "evidence">, line: BankLine | undefined): string | null {
  if (!line) return `${a.lineId}: unknown line`;
  const text = lineText(line);
  if (!norm(text).includes(norm(a.evidence.quote))) return `${a.lineId}: quote "${a.evidence.quote}" is not in the line text`;
  if (!a.evidence.location.toUpperCase().includes(line.id.toUpperCase())) return `${a.lineId}: location "${a.evidence.location}" does not name the line`;
  const have = new Set(numbers(text));
  const bad = numbers(a.evidence.quote).find((n) => !have.has(n));
  if (bad) return `${a.lineId}: number ${bad} in the quote is not a number of the line`;
  return null;
}

/** Deterministic validator (ADR-008 §5): issues → the router escalates; empty = valid. */
export function validateClassification(out: ClassifyOutput, lines: BankLine[]): string[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const a of out.suggestions) {
    if (seen.has(a.lineId)) issues.push(`${a.lineId}: answered twice`);
    seen.add(a.lineId);
    const g = groundingIssue(a, byId.get(a.lineId));
    if (g) issues.push(g);
  }
  return issues;
}

/** Keep the first grounded answer per line; ungrounded or missing answers become reviewer questions. */
export function toSuggestions(out: ClassifyOutput, lines: BankLine[]): Suggestion[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const first = new Map<string, ClassifyAnswer>();
  for (const a of out.suggestions) if (!first.has(a.lineId)) first.set(a.lineId, a);
  return lines.map((l): Suggestion => {
    const a = first.get(l.id);
    if (!a) return { lineId: l.id, ledger: INSUFFICIENT, confidence: 0, reason: "No answer for this line", status: "insufficient_evidence", evidence: null };
    const issue = groundingIssue(a, byId.get(l.id));
    if (issue) return { lineId: l.id, ledger: INSUFFICIENT, confidence: 0, reason: `Answer not grounded in the bank line (${issue})`, status: "ungrounded", evidence: null };
    if (a.ledger === INSUFFICIENT) return { lineId: l.id, ledger: INSUFFICIENT, confidence: a.confidence, reason: a.note ?? "", status: "insufficient_evidence", evidence: a.evidence };
    return { lineId: l.id, ledger: a.ledger, confidence: a.confidence, reason: a.note ?? "", status: "suggested", evidence: a.evidence };
  });
}

export function classifyPrompt(lines: BankLine[], heads: string[], notes: string | null): string {
  return [
    notes ? `Reviewer notes: ${notes}\n` : "",
    `Allowed ledgers: ${heads.join("; ")}`,
    "",
    "Bank debits not in the books (id | date | narration | reference | amount):",
    ...lines.map(lineText),
  ].join("\n");
}

export async function suggestClassifications(model: ModelCaller, lines: BankLine[], tb: TbData | null, notes: string | null): Promise<{ suggestions: Suggestion[]; heads: string[] }> {
  const heads = chartHeads(tb);
  if (!lines.length) return { suggestions: [], heads };
  // No ledger list to choose from: nothing for the model to pick — every line is a reviewer question.
  if (!heads.length) return { suggestions: toSuggestions({ suggestions: [] }, lines), heads };
  const schema = classifySchema(lines, heads);
  const out = await model({
    task: BOOKS_CLASSIFY_TASK,
    privacy: "anonymize-then-cloud",
    difficulty: "sop",
    schema,
    contradictions: (o) => validateClassification(o, lines),
    messages: [
      { role: "system", content: CLASSIFY_SYSTEM },
      { role: "user", content: classifyPrompt(lines, heads, notes) },
    ],
  });
  return { suggestions: toSuggestions(out, lines), heads };
}
