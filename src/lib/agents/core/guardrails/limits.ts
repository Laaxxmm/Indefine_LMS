// Consumption limits and hallucination budgets per model task (ADR-009: OWASP LLM10 unbounded
// consumption, LLM09 misinformation). One table, keyed by task name (not version):
//
//   maxInputTokens        the documents of one call (screened, before the fence) are cut at a
//                         line boundary beyond this; the cut is flagged (guardrail.input-truncated,
//                         warn) with the task and the first line not sent — never silent
//   maxOutputTokens       the router's per-call output cap for this task
//   hallucinationBudget   the share of ground-checked model items per task per day that may be
//                         ungrounded before the drift row breaches (/admin/firm-os/models)
//
// Plus a per-run cost budget (RUN_BUDGET_INR) the session passes to the router as maxCostInr on
// every scoped call; the daily budget stays the router's (AI_DAILY_BUDGET_INR). Every declared
// task must have an entry (tests); a task without one gets DEFAULT_TASK_LIMITS. Pure.
import type { ChecklistResultItem } from "../checklist";
import { estimateTokens } from "@/lib/ai/pricing";

export type TaskLimits = { maxInputTokens: number; maxOutputTokens: number; hallucinationBudget: number };

const LIST = { maxInputTokens: 24_000, maxOutputTokens: 32_000, hallucinationBudget: 0.02 } as const;
const CHECK = { maxInputTokens: 24_000, maxOutputTokens: 1_024, hallucinationBudget: 0.02 } as const;

/** Per-task limits. List tasks answer one item per input line (output ≈ 2× input); checks answer one verdict. */
export const TASK_LIMITS: Readonly<Record<string, TaskLimits>> = Object.freeze({
  "echo.check:echo.related-party": { ...CHECK, maxInputTokens: 8_000 },
  "gst.classify-ledgers": LIST,
  "gst.read-hsn": { ...LIST, maxInputTokens: 12_000, maxOutputTokens: 16_000 },
  "gst.check:gst.free-supplies": { ...CHECK, maxInputTokens: 40_000 },
  "roc.map-ledgers": LIST,
  "roc.check:roc.aoc2-related-party": CHECK,
  "tax.match-ais": { ...LIST, maxInputTokens: 12_000, maxOutputTokens: 16_000 },
  "tax.check:tax.foreign-asset": CHECK,
  "books.classify-expenses": LIST,
  "audit.check:audit.related-party-disclosure": { ...CHECK, maxInputTokens: 40_000 },
  "onboarding.extract-spec": { maxInputTokens: 1_000, maxOutputTokens: 1_024, hallucinationBudget: 0.05 },
});

/** A task without an entry (tests require one for every declared task). */
export const DEFAULT_TASK_LIMITS: Readonly<TaskLimits> = Object.freeze({ maxInputTokens: 8_000, maxOutputTokens: 2_048, hallucinationBudget: 0.02 });

/** Limits of a task by name (`<agent>.<task>`, no version). */
export const limitsFor = (task: string): TaskLimits => TASK_LIMITS[task] ?? DEFAULT_TASK_LIMITS;
export const hasTaskLimits = (task: string) => Object.prototype.hasOwnProperty.call(TASK_LIMITS, task);
export const hallucinationBudgetFor = (task: string) => limitsFor(task.replace(/@\d+(?:#2)?$/, "")).hallucinationBudget;

/** Per-run cost budget in ₹ (all scoped calls of one run, second reads and escalations included). */
export const RUN_BUDGET_INR: Readonly<Record<string, number>> = Object.freeze({ gst: 150, roc: 100, tax: 100, books: 100, audit: 100, echo: 25 });
export const DEFAULT_RUN_BUDGET_INR = 100;
export const runBudgetFor = (agent: string) => RUN_BUDGET_INR[agent] ?? DEFAULT_RUN_BUDGET_INR;

// ------------------------------------------------------------------ truncation

export type Truncation = { task: string; linesNotSent: number; firstLocation: string };

/**
 * Keep whole lines while the text stays within `maxInputTokens` (the router's ~4 characters per
 * token estimate); the rest is not sent. `locate` names a line for the flag.
 */
export function truncateToLimit(text: string, maxInputTokens: number, locate: (line: string, index: number) => string): { kept: string; cut: { lines: number; firstLocation: string } | null } {
  if (estimateTokens(text) <= maxInputTokens) return { kept: text, cut: null };
  const maxChars = maxInputTokens * 4; // estimateTokens(t) <= max  ⇔  t.length <= 4 × max
  const lines = text.split("\n");
  const kept: string[] = [];
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    const next = size + lines[i].length + (kept.length ? 1 : 0);
    if (next > maxChars) {
      const rest = lines.slice(i).filter((l) => l.trim()).length;
      return { kept: kept.join("\n"), cut: rest ? { lines: rest, firstLocation: locate(lines[i], i) } : null };
    }
    kept.push(lines[i]);
    size = next;
  }
  return { kept: kept.join("\n"), cut: null };
}

export const TRUNCATION_RULE_ID = "guardrail.input-truncated";
export const TRUNCATION_FLAG = "input-truncated" as const;

/** Warn row the runner adds when any call's documents were cut at the task's input limit; null when none were. */
export function truncationResult(cuts: readonly Truncation[]): ChecklistResultItem | null {
  if (!cuts.length) return null;
  // Plain words for the reviewer: where the cut starts, not the task identifier (that stays in the run record).
  const parts = cuts.slice(0, 5).map((c) => `${c.linesNotSent} line${c.linesNotSent === 1 ? "" : "s"} from ${c.firstLocation} onwards`);
  return {
    ruleId: TRUNCATION_RULE_ID,
    title: "Documents longer than the per-call limit for the AI",
    severity: "warn",
    status: "fail",
    message: `Some documents were longer than the AI may read in one call, so part of them was not sent (${parts.join("; ")}${cuts.length > 5 ? `; and ${cuts.length - 5} more` : ""}). Those items have no AI answer: check them by hand, or split the job into smaller periods and run it again.`,
    evidence: { location: cuts[0].firstLocation },
    source: "deterministic",
    flags: [TRUNCATION_FLAG],
  };
}
