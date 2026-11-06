// Audit Assist model-task registry (ADR-008 §1, §8). The agent's ONLY model task is the
// related-party LLM checklist rule, run by the framework (task `audit.check:<rule id>`, difficulty
// "judgement", anonymised). Lead schedules, materiality, sampling and CARO applicability are
// deterministic code — no model.
//
// The registry IS the agent's AgentScope task list (index.ts). The department preamble that used
// to sit inside the rule question (statutory audit working papers only, never an opinion,
// documents only, no arithmetic) is now the system prompt: the framework's firm + Audit department
// preambles followed by AUDIT_CHECK_SYSTEM. The validator below runs as the router's
// contradictions against the exact documents text the verdict must quote.
import type { ModelTaskSpec } from "@/lib/agents/core/guardrails/scope";
import { INSUFFICIENT_EVIDENCE, ScopedVerdictSchema, type ScopedVerdict } from "@/lib/agents/core/guardrails/schema";
import { RELATED_PARTY_QUESTION } from "./rules";

export const AUDIT_RELATED_PARTY_TASK = "audit.check:audit.related-party-disclosure" as const;
export const INSUFFICIENT = "insufficient_evidence" as const;

/** Audit department specifics (moved here from the rule question). */
export const AUDIT_PREAMBLE = "Statutory audit working papers only; never give an audit opinion; use only the documents below and do not compute anything.";

/** System prompt of the related-party check (after the framework's firm + Audit preambles). */
export const AUDIT_CHECK_SYSTEM = [
  AUDIT_PREAMBLE,
  "You check one point in a draft audit working paper prepared for the engagement team's review.",
  "Always give evidence.quote copied verbatim from the documents and evidence.location naming the file and row or line. Do not add up, total or recompute any amount.",
].join("\n");

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const numbers = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));

type Verdict = Pick<ScopedVerdict, "status" | "message"> & { evidence?: { quote: string; location: string } };

/**
 * Deterministic validator for a verdict against the exact llmContext text: the quote occurs in it,
 * the location names a file and row/line that occurs in it, numbers in the quote are numbers of the
 * context, a message is ≤ 300 characters, and "na" is used only for insufficient_evidence. A
 * framework abstain (status insufficient_evidence) carries no evidence and is accepted.
 */
export function validateRelatedPartyVerdict(v: Verdict, context: string): string[] {
  if (v.status === INSUFFICIENT_EVIDENCE) return (v.message ?? "").length > 300 ? ["message longer than 300 characters"] : [];
  if (!v.evidence) return ["evidence is missing"];
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

export type AuditModelTask = ModelTaskSpec<ScopedVerdict, string, "audit"> & {
  question: string;
  /** Back-compat alias of schema. */
  outputSchema: typeof ScopedVerdictSchema;
  rules: string[];
};

export const AUDIT_MODEL_TASKS: readonly AuditModelTask[] = Object.freeze([
  {
    name: AUDIT_RELATED_PARTY_TASK,
    version: 2,
    systemPrompt: AUDIT_CHECK_SYSTEM,
    schema: ScopedVerdictSchema,
    outputSchema: ScopedVerdictSchema,
    difficulty: "judgement",
    question: RELATED_PARTY_QUESTION,
    rules: ["audit.related-party-disclosure"],
    ruleIds: ["audit.related-party-disclosure"],
    validate: validateRelatedPartyVerdict,
    privacy: "anonymize-then-cloud",
    profile: { documents: "LLM context: trial-balance ledger names and groups (labelled rows) and the disclosure-note lines (labelled lines). No amounts." },
  },
]);

export const auditTaskIds = () => AUDIT_MODEL_TASKS.map((t) => `${t.name}@${t.version}`);
