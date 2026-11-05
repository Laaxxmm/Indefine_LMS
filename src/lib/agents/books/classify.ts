// Expense-classification suggestions for bank debits the books do not have yet. The ONLY model
// call of the Books agent: router fast tier (difficulty "sop"), anonymised before any cloud call.
// The model picks a head and a confidence; code validates every answer (known line, confidence
// in [0, 1], head in the chart or marked "not in chart"). Suggestions are labelled as such in the
// pack and are never posted to the books.
import { z } from "zod";
import type { ModelCaller } from "@/lib/agents/core/runner";
import type { BankLine } from "./bank";
import { DEFAULT_EXPENSE_HEADS } from "./config";
import type { Suggestion } from "./analysis";
import { expenseRows } from "./analysis";
import type { TbData } from "./tb";

export const BOOKS_CLASSIFY_TASK = "books.classify-expenses" as const;

export const ClassifyOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        lineId: z.string().min(1).max(20),
        ledger: z.string().trim().min(1).max(120),
        confidence: z.number().min(0).max(1),
        reason: z.string().max(300).optional(),
      }),
    )
    .max(500),
});
export type ClassifyOutput = z.infer<typeof ClassifyOutputSchema>;

/** Heads offered: the TB's expense ledgers (name order), else the default list. */
export function chartHeads(tb: TbData | null): string[] {
  const fromTb = tb ? [...new Set(expenseRows(tb).map((r) => r.ledger))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  return fromTb.length ? fromTb : [...DEFAULT_EXPENSE_HEADS];
}

export const CLASSIFY_SYSTEM = [
  "You suggest an expense ledger head for bank debits that are not yet recorded in a client's books, for a chartered accountant to review.",
  "Choose the head only from the list given. Give confidence between 0 and 1 and a short reason based on the narration.",
  "Return one suggestion per line id. Do not add up, total or change any amount. These are suggestions only; nothing is posted.",
].join(" ");

export function classifyPrompt(lines: BankLine[], heads: string[], notes: string | null): string {
  return [
    notes ? `Reviewer notes: ${notes}\n` : "",
    `Heads: ${heads.join("; ")}`,
    "",
    "Bank debits not in the books (id | date | narration | reference | amount):",
    ...lines.map((l) => `${l.id} | ${l.date} | ${l.narration} | ${l.ref} | ${(Math.abs(l.amountPaise) / 100).toFixed(2)}`),
  ].join("\n");
}

/** Keep answers for known lines only (first per line), flag heads outside the chart. */
export function validateSuggestions(out: ClassifyOutput, lines: BankLine[], heads: string[]): Suggestion[] {
  const known = new Set(lines.map((l) => l.id));
  const chart = new Set(heads.map((h) => h.toLowerCase()));
  const seen = new Set<string>();
  const res: Suggestion[] = [];
  for (const s of out.suggestions) {
    if (!known.has(s.lineId) || seen.has(s.lineId)) continue;
    seen.add(s.lineId);
    res.push({ lineId: s.lineId, ledger: s.ledger, confidence: s.confidence, reason: s.reason ?? "", inChart: chart.has(s.ledger.toLowerCase()) });
  }
  const order = new Map(lines.map((l, i) => [l.id, i]));
  return res.sort((a, b) => order.get(a.lineId)! - order.get(b.lineId)!);
}

export async function suggestClassifications(model: ModelCaller, lines: BankLine[], tb: TbData | null, notes: string | null): Promise<{ suggestions: Suggestion[]; heads: string[] }> {
  const heads = chartHeads(tb);
  if (!lines.length) return { suggestions: [], heads };
  const out = await model({
    task: BOOKS_CLASSIFY_TASK,
    privacy: "anonymize-then-cloud",
    difficulty: "sop",
    schema: ClassifyOutputSchema,
    messages: [
      { role: "system", content: CLASSIFY_SYSTEM },
      { role: "user", content: classifyPrompt(lines, heads, notes) },
    ],
  });
  return { suggestions: validateSuggestions(out, lines, heads), heads };
}
