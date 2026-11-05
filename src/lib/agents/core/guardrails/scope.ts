// Department scope contract (ADR-008 §1, §7). An agent declares an AgentScope: its department,
// the exact model tasks it may run (name, version, schema, system prompt, validators) and the
// checklist rule ids it owns, plus a deterministic sniff of its inputs. The runner enforces it:
// an undeclared task is a ScopeViolationError (run FAILED), every system prompt is
// FIRM_PREAMBLE + the department preamble + the task's own prompt, and a wrong-department input
// stops the run before any model call. Pure apart from the types it shares with the runner.
import type { FirmService } from "@prisma/client";
import type { ZodType, ZodTypeDef } from "zod";
import type { Difficulty, Privacy } from "@/lib/ai/router";
import type { ChecklistPack } from "../checklist";
import { UNTRUSTED_DATA_INSTRUCTION } from "./untrusted";

/** Files as the runner gathered them (structurally the runner's InputFile). */
export type SniffFile = { name: string; bytes: Buffer; contentType?: string };

export type InputSniffResult = { ok: true } | { ok: false; reason: string; suggestAgent?: string };

/** One registered model task: `<agentKey>.<task>@<version>`. */
export interface ModelTaskSpec<T = unknown, I = unknown, K extends string = string> {
  name: `${K}.${string}`;
  /** Positive integer; bump it whenever the prompt, the schema or the tier hint changes (prompts.lock.json). */
  version: number;
  /**
   * Closed output contract: enums (abstainable), evidence quote/location, capped notes. With
   * `schemaPerCall` this is the template every per-call schema must match in shape.
   */
  schema: ZodType<T, ZodTypeDef, T>;
  /** The task's own instructions; the runner prefixes FIRM_PREAMBLE and the department preamble. */
  systemPrompt: string;
  /**
   * Deterministic cross-checks on the output (GSTIN checksum, HSN digits, quote in the cited line,
   * …), run as the router's `contradictions`: any issue escalates like a schema failure. `input`
   * is the agent's parsed input for extraction tasks and the documents text the verdict must
   * quote for LLM checklist tasks (`<key>.check:<ruleId>`). A call may add its own per-call
   * `contradictions` (validators that need call-specific data); both run.
   */
  validate?(output: T, input: I): string[];
  /** Run twice (second read on a different tier); disagreement → `na` + model-disagreement. */
  highStakes?: boolean;
  /** Tier hint: the difficulty every call of this task uses (part of the prompt lock). */
  difficulty?: Difficulty;
  /**
   * The call supplies its own schema (closed enums built from the input, e.g. the client's own
   * ledgers). It must have the same shape as `schema` (enum values aside) and no free-form strings.
   */
  schemaPerCall?: boolean;
  /** Checklist rules whose outcome depends on this task (documentation; the scope's ruleIds is the ownership list). */
  ruleIds?: readonly string[];
  /**
   * Data class of what this task carries (ADR-006 / ADR-009, OWASP LLM02). When declared, a call
   * asking for any other privacy is a scope violation; production tasks declare
   * "anonymize-then-cloud" (or the stricter "local-only"). Not part of the prompt lock.
   */
  privacy?: Privacy;
  /** For docs/ai/guardrail-profiles.md (not part of the prompt lock). */
  profile?: {
    /** The untrusted document text the task carries (what is fenced and screened). */
    documents: string;
    /** Call-level validators passed as `contradictions` (the task's own `validate` is listed automatically). */
    validators?: string;
    /** How the task's documents are screened, when it differs from the default description. */
    screen?: string;
    /** How the output is grounded, when it carries no { quote, location } (e.g. fact-copy validators). */
    grounding?: string;
  };
}

/** Any task spec (registries, the runner). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTaskSpec = ModelTaskSpec<any, any>;

export interface AgentScope {
  /** The one department this agent works on. Must equal the agent's service. */
  department: FirmService;
  /** Every model task the agent may run. LLM rule R is answered by `<key>.check:<R>` (or the generic `<key>.check`). */
  tasks: AnyTaskSpec[];
  /** Checklist rule ids the agent owns. An LLM rule it does not own gets no model call (`na` + out-of-scope). */
  ruleIds: string[];
  /** Deterministic look at the gathered files before any model call (e.g. a GST run given a trial balance). May be async (XLSX). */
  inputSniff(files: SniffFile[]): InputSniffResult | Promise<InputSniffResult>;
}

/** The fields of an agent definition the scope checks read. */
export type ScopedAgentLike = { key: string; title: string; service: FirmService; internal?: boolean; scope?: AgentScope; defaultChecklist: ChecklistPack };

export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(`Scope violation: ${message}`);
    this.name = "ScopeViolationError";
  }
}

/** Input that belongs to another department (or is not this agent's document at all). */
export class WrongInputError extends Error {
  readonly suggestAgent?: string;
  constructor(message: string, suggestAgent?: string) {
    super(message);
    this.name = "WrongInputError";
    this.suggestAgent = suggestAgent;
  }
}

// ------------------------------------------------------------------ preambles

export const DEPARTMENT_LABELS: Readonly<Record<FirmService, string>> = Object.freeze({
  GST: "GST (Goods and Services Tax)",
  ROC: "ROC and company-law compliance (MCA filings)",
  IncomeTax: "Income tax",
  TDS: "TDS and TCS",
  Books: "Bookkeeping and accounts",
  Audit: "Audit working papers",
  Engagement: "Engagement letters",
});

/**
 * First block of every scoped system prompt (ADR-008 §1; ADR-009 adds the untrusted-documents
 * line). Changing it changes every task's prompt-lock hash.
 */
export const FIRM_PREAMBLE = [
  "You are a drafting assistant for a firm of chartered accountants in India. Your output is a draft that a qualified reviewer checks; it is never final.",
  "Use only the documents supplied in this conversation. Do not rely on memory, outside knowledge or assumptions about the client.",
  UNTRUSTED_DATA_INSTRUCTION,
  "Never add up, total, net off or recompute any amount, tax, interest or fee. Copy numbers exactly as they are written in the documents.",
  "Never give filing, legal or audit-opinion advice.",
  'If the documents do not contain the answer, return "insufficient_evidence" in the field that allows it. Do not guess.',
  "Reply with JSON only, in exactly the requested shape.",
].join("\n");

/** Second block: the department this agent works on. */
export function departmentPreamble(department: FirmService): string {
  const label = DEPARTMENT_LABELS[department];
  return [
    `Department: ${label}.`,
    `Work only on ${label} for Indian compliance. If the request or the documents concern another department, do not answer from them: return "insufficient_evidence".`,
  ].join("\n");
}

/** FIRM_PREAMBLE + department preamble + the task's own prompt (what the model is given as system). */
export function composeSystemPrompt(department: FirmService, task: Pick<AnyTaskSpec, "systemPrompt">): string {
  return [FIRM_PREAMBLE, departmentPreamble(department), task.systemPrompt.trim()].join("\n\n");
}

/**
 * Shared instructions for LLM checklist rules (`<key>.check:<ruleId>` tasks). Agents start their
 * check task's systemPrompt with it and add department specifics.
 */
export const CHECK_TASK_INSTRUCTIONS = [
  "You check one point in a draft compliance pack prepared for a chartered accountant's review.",
  'Answer only from the documents given. status = "fail" when the documents show the problem, "pass" when they show it is absent, "na" when the question does not apply, "insufficient_evidence" when the documents do not let you tell.',
  "Unless you return insufficient_evidence, give evidence.quote copied verbatim from the documents and evidence.location naming the file and row or line.",
  "For insufficient_evidence, put in message (at most 300 characters) the document or fact that would answer the question.",
].join("\n");

// ------------------------------------------------------------------ resolution + static checks

export const checkTaskName = (agentKey: string, ruleId: string) => `${agentKey}.check:${ruleId}`;
export const genericCheckTaskName = (agentKey: string) => `${agentKey}.check`;

export const taskLabel = (t: Pick<AnyTaskSpec, "name" | "version">) => `${t.name}@${t.version}`;

/** The declared task an LLM rule is answered by: `<key>.check:<ruleId>`, else the generic `<key>.check`. */
export function checkTaskFor(agentKey: string, scope: AgentScope, ruleId: string): AnyTaskSpec | undefined {
  return scope.tasks.find((t) => t.name === checkTaskName(agentKey, ruleId)) ?? scope.tasks.find((t) => t.name === genericCheckTaskName(agentKey));
}

/** The declared task for a model call, or a ScopeViolationError naming what is wrong. */
export function resolveTask(agentKey: string, scope: AgentScope, task: string): AnyTaskSpec {
  if (!task.startsWith(`${agentKey}.`)) throw new ScopeViolationError(`task "${task}" is not prefixed with this agent's key "${agentKey}."`);
  const spec = scope.tasks.find((t) => t.name === task);
  if (!spec) throw new ScopeViolationError(`task "${task}" is not declared in the ${agentKey} agent's scope (declared: ${scope.tasks.map(taskLabel).join(", ") || "none"})`);
  return spec;
}

/** Problems with a declared scope (empty = valid). Does not look at schemas (see closedOutputProblems). */
export function validateScope(def: ScopedAgentLike): string[] {
  const scope = def.scope;
  if (!scope) return ["scope: not declared"];
  const p: string[] = [];
  if (scope.department !== def.service) p.push(`scope: department ${scope.department} differs from the agent's service ${def.service}`);
  if (typeof scope.inputSniff !== "function") p.push("scope: inputSniff is missing");
  const names = new Set<string>();
  for (const t of scope.tasks) {
    if (!t.name.startsWith(`${def.key}.`) || t.name.length <= def.key.length + 1) p.push(`scope: task "${t.name}" is not prefixed with "${def.key}."`);
    if (names.has(t.name)) p.push(`scope: task "${t.name}" is declared twice`);
    names.add(t.name);
    if (!Number.isSafeInteger(t.version) || t.version < 1) p.push(`scope: task "${t.name}" has version ${String(t.version)}; use a positive integer`);
    if (!t.systemPrompt?.trim()) p.push(`scope: task "${t.name}" has no systemPrompt`);
    if (!t.schema || typeof (t.schema as { safeParse?: unknown }).safeParse !== "function") p.push(`scope: task "${t.name}" has no Zod schema`);
  }
  const owned = new Set(scope.ruleIds);
  if (owned.size !== scope.ruleIds.length) p.push("scope: ruleIds has duplicates");
  for (const r of def.defaultChecklist.rules.filter((x) => x.kind === "llm")) {
    if (!owned.has(r.id)) p.push(`scope: LLM rule ${r.id} of the default checklist is not in ruleIds`);
    else if (!checkTaskFor(def.key, scope, r.id)) p.push(`scope: LLM rule ${r.id} has no model task (declare "${checkTaskName(def.key, r.id)}" or "${genericCheckTaskName(def.key)}")`);
  }
  return p;
}

/** Run the sniff; a sniff that throws (or rejects) fails closed. */
export async function sniffInputs(scope: AgentScope, files: SniffFile[]): Promise<InputSniffResult> {
  try {
    const r = await scope.inputSniff(files);
    if (r && r.ok === true) return { ok: true };
    if (r && r.ok === false) return { ok: false, reason: String(r.reason || "inputs are not this department's documents"), suggestAgent: r.suggestAgent };
    return { ok: false, reason: "inputSniff returned no verdict" };
  } catch (e) {
    return { ok: false, reason: `inputSniff could not read the files (${e instanceof Error ? e.message : String(e)})` };
  }
}

export function wrongInputMessage(def: Pick<ScopedAgentLike, "title" | "service">, r: Extract<InputSniffResult, { ok: false }>): string {
  return `Wrong input for ${def.title} (${DEPARTMENT_LABELS[def.service]}): ${r.reason}${r.suggestAgent ? `. Run the ${r.suggestAgent} agent on these documents instead.` : ""}`;
}
