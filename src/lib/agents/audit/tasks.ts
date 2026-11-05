// Audit Assist model-task registry (ADR-008 §1, §8). The agent's ONLY model task is the
// related-party LLM checklist rule, run by the framework runner (task `audit.check:<rule id>`,
// difficulty "judgement", anonymised, the framework's LlmVerdictOutputSchema). Lead schedules,
// materiality, sampling and CARO applicability are deterministic code — no model. The rule's
// question carries the department preamble (statutory audit working papers only, never an
// opinion, documents only, no arithmetic, "insufficient_evidence" when the documents do not tell).
import { LLM_CHECK_SYSTEM, LlmVerdictOutputSchema } from "@/lib/agents/core/runner";
import { RELATED_PARTY_QUESTION } from "./rules";

export const AUDIT_RELATED_PARTY_TASK = "audit.check:audit.related-party-disclosure" as const;
export const INSUFFICIENT = "insufficient_evidence" as const;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const numbers = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));

type Verdict = { status: "pass" | "fail" | "na"; message?: string; evidence: { quote: string; location: string } };

/**
 * Deterministic validator for a verdict against the exact llmContext text: the quote occurs in it,
 * the location names a file and row/line that occurs in it, numbers in the quote are numbers of the
 * context, a message is ≤ 300 characters, and "na" is used only for insufficient_evidence.
 */
export function validateRelatedPartyVerdict(v: Verdict, context: string): string[] {
  const issues: string[] = [];
  const ctx = norm(context);
  if (!ctx.includes(norm(v.evidence.quote))) issues.push(`quote "${v.evidence.quote}" is not in the documents`);
  const loc = norm(v.evidence.location);
  const rowRef = /\b(row|line) \d+$/.test(loc);
  const located = rowRef ? context.split(/\r?\n/).some((l) => norm(l).startsWith(`${loc}:`)) : !!loc && ctx.includes(loc);
  if (!located) issues.push(`location "${v.evidence.location}" does not name a document row or line`);
  const have = new Set(numbers(context));
  const bad = numbers(v.evidence.quote).find((n) => !have.has(n));
  if (bad) issues.push(`number ${bad} in the quote is not in the documents`);
  if ((v.message ?? "").length > 300) issues.push("message longer than 300 characters");
  if (v.status === "na" && !(v.message ?? "").startsWith(INSUFFICIENT)) issues.push(`na must carry the message "${INSUFFICIENT}"`);
  return issues;
}

export const isInsufficient = (r: { status: string; message: string; source?: string }) => r.status === "na" && r.message.startsWith(INSUFFICIENT);

export const AUDIT_MODEL_TASKS = Object.freeze([
  {
    name: AUDIT_RELATED_PARTY_TASK,
    version: 1,
    /** System prompt = the framework's LLM_CHECK_SYSTEM; the department preamble is in the question. */
    systemPrompt: LLM_CHECK_SYSTEM,
    question: RELATED_PARTY_QUESTION,
    outputSchema: LlmVerdictOutputSchema,
    rules: ["audit.related-party-disclosure"],
    validate: validateRelatedPartyVerdict,
  },
] as const);

export const auditTaskIds = () => AUDIT_MODEL_TASKS.map((t) => `${t.name}@${t.version}`);
