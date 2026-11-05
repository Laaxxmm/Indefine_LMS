// ROC model-task registry (ADR-008). The ROC agent may run exactly these tasks:
//
//   roc.map-ledgers@1                    trial-balance ledger names → Schedule III heads (closed enum
//                                        + insufficient_evidence), each with a verbatim quote/location
//   roc.check:roc.aoc2-related-party@1   the LLM checklist rule (prompt built by the framework runner)
//
// Every output is validated deterministically (ledger exists, quote occurs in the text sent,
// location is the line given, one head per ledger). Invalid items are dropped and the ledger is
// reported as unmapped; insufficient_evidence becomes a reviewer question — never a default head.
//
// These specs ARE the agent's ADR-008 scope (index.ts): the framework prefixes every system prompt
// with the firm and ROC department preambles, wires `validate` as the router's contradictions
// (input = RocInput for the mapping task, the documents text for the checklist task), grounds the
// output and locks each `name@version` in prompts.lock.json.
import { z } from "zod";
import { CHECK_TASK_INSTRUCTIONS, type ModelTaskSpec } from "@/lib/agents/core/guardrails/scope";
import { INSUFFICIENT_EVIDENCE, ScopedVerdictSchema, type ScopedVerdict } from "@/lib/agents/core/guardrails/schema";
import { EvidenceSchema, INSUFFICIENT, quoteIn } from "@/lib/agents/core/guardrails/shared";
import { FIN_HEADS, HEAD_LABELS, type FinHead, type RocInput, type TbLine } from "./parse";

/** ROC department specifics, at the start of every ROC task prompt (after the framework's firm + department preambles). */
export const ROC_PREAMBLE =
  "Department: ROC — Indian company-law compliance under the Companies Act, 2013 and its Rules (MCA filings). Do not answer questions about income tax, GST or anything outside company law.";

export const MAP_HEADS = [...FIN_HEADS, INSUFFICIENT] as const;

export const LedgerMappingSchema = z.object({
  mappings: z
    .array(
      z.object({
        ledger: z.string().trim().min(1).max(200),
        head: z.enum(MAP_HEADS),
        evidence: EvidenceSchema,
      }),
    )
    .max(5000),
});
export type LedgerMapping = z.infer<typeof LedgerMappingSchema>;

/** What the model is shown: one labelled line per ledger, no amounts (amounts are code's job). */
export function ledgerPrompt(tb: TbLine[]): { labels: string[]; text: string } {
  const labels = tb.map((_, i) => `financials.json trialBalance[${i}]`);
  return { labels, text: tb.map((l, i) => `${labels[i]}: ${l.ledger}`).join("\n") };
}

export function validateLedgerMapping(out: LedgerMapping, tb: TbLine[]): string[] {
  const { labels, text } = ledgerPrompt(tb);
  const lines = new Map(labels.map((label, i) => [label, `${label}: ${tb[i].ledger}`]));
  const known = new Set(tb.map((l) => l.ledger.trim().toLowerCase()));
  const seen = new Map<string, string>();
  const issues: string[] = [];
  for (const m of out.mappings) {
    const key = m.ledger.trim().toLowerCase();
    if (!known.has(key)) issues.push(`ledger "${m.ledger}" is not in the trial balance`);
    else if (!lines.has(m.evidence.location)) issues.push(`ledger "${m.ledger}": location "${m.evidence.location}" is not a line given`);
    else if (!quoteIn(lines.get(m.evidence.location)!, m.evidence.quote) || !quoteIn(m.evidence.quote, m.ledger)) issues.push(`ledger "${m.ledger}": quote is not copied from its line`);
    else if (!quoteIn(text, m.evidence.quote)) issues.push(`ledger "${m.ledger}": quote not found in the input`);
    if (seen.has(key) && seen.get(key) !== m.head) issues.push(`ledger "${m.ledger}" mapped to two heads`);
    seen.set(key, m.head);
  }
  return issues;
}

/** Keeps only valid, decided mappings; reports abstentions and dropped items. */
export function acceptedMappings(out: LedgerMapping, tb: TbLine[]): { mappings: { ledger: string; head: FinHead }[]; questions: string[]; dropped: string[] } {
  const mappings: { ledger: string; head: FinHead }[] = [];
  const questions: string[] = [];
  const dropped: string[] = [];
  const headsOf = new Map<string, Set<string>>();
  for (const m of out.mappings) {
    const key = m.ledger.trim().toLowerCase();
    headsOf.set(key, (headsOf.get(key) ?? new Set()).add(m.head));
  }
  for (const m of out.mappings) {
    if (validateLedgerMapping({ mappings: [m] }, tb).length || headsOf.get(m.ledger.trim().toLowerCase())!.size > 1) {
      dropped.push(m.ledger);
      continue;
    }
    if (m.head === INSUFFICIENT) questions.push(m.ledger);
    else mappings.push({ ledger: m.ledger, head: m.head });
  }
  return { mappings, questions, dropped };
}

const MAP_SYSTEM = [
  ROC_PREAMBLE,
  "Task: map each trial-balance ledger of an Indian company to exactly one Schedule III head from the list, or insufficient_evidence when the name does not show which head it belongs to (for example a suspense or unexplained ledger).",
  "Copy each ledger name exactly as written; evidence.quote is the ledger name copied from its line and evidence.location is the line label (for example financials.json trialBalance[3]).",
  "Closing stock → inventories; GST / TDS receivable → otherAssets; provisions and statutory dues → otherLiabilities; opening profit and loss balance → reservesSurplus.",
].join(" ");

export function mapLedgersUserMessage(tb: TbLine[], notes: string | null): string {
  const heads = FIN_HEADS.map((h) => `${h}: ${HEAD_LABELS[h]}`).join("\n");
  return `${notes ? `Reviewer notes: ${notes}\n\n` : ""}Heads:\n${heads}\n\nLedgers:\n${ledgerPrompt(tb).text}`;
}

/** The trial balance the mapping task reads (only a TB input has ledgers to map). */
export const trialBalanceOf = (input: RocInput): TbLine[] => (input.financials.kind === "tb" ? input.financials.trialBalance : []);

export const ROC_MAP_TASK_SPEC: ModelTaskSpec<LedgerMapping, RocInput, "roc"> = {
  name: "roc.map-ledgers",
  version: 1,
  schema: LedgerMappingSchema,
  systemPrompt: MAP_SYSTEM,
  difficulty: "sop",
  ruleIds: ["roc.financials-tie"],
  validate: (out, input) => validateLedgerMapping(out, trialBalanceOf(input)),
};

/** The AOC-2 verdict must quote the notes to accounts it was shown (abstaining needs no quote). */
export const validateAoc2Verdict = (out: ScopedVerdict, context: string): string[] =>
  out.status === INSUFFICIENT_EVIDENCE || !out.evidence ? [] : quoteIn(context, out.evidence.quote) ? [] : ["verdict quote not found in the notes to accounts"];

export const ROC_AOC2_CHECK_SPEC: ModelTaskSpec<ScopedVerdict, string, "roc"> = {
  name: "roc.check:roc.aoc2-related-party",
  version: 1,
  schema: ScopedVerdictSchema,
  systemPrompt: [ROC_PREAMBLE, CHECK_TASK_INSTRUCTIONS].join("\n"),
  difficulty: "judgement",
  ruleIds: ["roc.aoc2-related-party"],
  validate: validateAoc2Verdict,
};

/** Every model task the ROC agent may run. */
export const ROC_MODEL_TASKS = [ROC_MAP_TASK_SPEC, ROC_AOC2_CHECK_SPEC] as const;
