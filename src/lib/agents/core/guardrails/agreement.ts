// Agreement on high-stakes judgements (ADR-008 §6). LLM rules with block severity, and tasks
// marked highStakes, are read twice: the second read is pinned to a different tier
// (AGREEMENT_TIER) and logged as `<task>@<v>#2`. Same verdict status → the first verdict stands;
// different → `na` + model-disagreement, and a human decides. Pure.
import type { LlmGuardrailOutcome, RuleDefinition } from "../checklist";
import type { AnyTaskSpec } from "./scope";

/** Tier of the second read. Judgement calls start on SMART, so the re-ask goes to HARD. */
export const AGREEMENT_TIER = "HARD" as const;

/** Does this rule / task need two reads? */
export const needsAgreement = (rule: Pick<RuleDefinition, "severity">, task: Pick<AnyTaskSpec, "highStakes">) => rule.severity === "block" || task.highStakes === true;

const statusOf = (v: unknown): string => {
  const s = (v as { status?: unknown } | null)?.status;
  return typeof s === "string" ? s : "(no status)";
};

/** First verdict when both reads give the same status; otherwise the disagreement outcome. */
export function settleAgreement(rule: Pick<RuleDefinition, "title">, first: unknown, second: unknown): { agreed: true; verdict: unknown } | { agreed: false; verdict: LlmGuardrailOutcome } {
  const a = statusOf(first);
  const b = statusOf(second);
  if (a === b) return { agreed: true, verdict: first };
  return {
    agreed: false,
    verdict: { guardrail: "model-disagreement", message: `${rule.title}: two independent model reads disagree (${a} vs ${b}); decide from the documents` },
  };
}
