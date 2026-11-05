// Checklist engine (Phase 4 task 2). Rules are data: a SopPack's `checklist` JSON holds rule
// definitions; deterministic rule bodies live in code and are looked up by id in a registry
// (functions cannot be JSON). The engine runs every deterministic rule first, then LLM rules one
// at a time through an injected `llmCheck`. Each LLM rule is given a documents text (`llmContext`;
// default: the check input as JSON) and the verdict is re-validated against it: it must carry a
// non-empty location AND a quote that occurs verbatim in that text (whitespace and letter case
// normalised, nothing else). Otherwise the verdict is not trusted: it becomes status "na" with the
// "llm-evidence-missing" flag for the reviewer — a fabricated quote cannot raise or clear a flag.
// Approved MistakeLog proposals become rules with source "mistake" (nothing auto-promotes).
// Pure apart from the injected llmCheck: no Prisma, no fetch, no clock.
import { z } from "zod";

// ------------------------------------------------------------------ types

export const SEVERITIES = ["block", "warn", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type RuleKind = "deterministic" | "llm";
export type CheckStatus = "pass" | "fail" | "na";
export type ResultSource = "deterministic" | "llm" | "mistake";

export type Evidence = { quote?: string; location?: string; link?: string };

/** Why a result needs a human look beyond its status. */
export type ResultFlag =
  | "check-error" // deterministic body threw: recorded as fail (fail-safe)
  | "missing-implementation" // no registry entry for a deterministic rule: recorded as fail
  | "llm-unavailable" // no llmCheck supplied
  | "llm-error" // llmCheck threw
  | "llm-evidence-missing"; // verdict lacked a location or a quote found in the documents given: recorded as na

const SEMVER = /^\d+\.\d+\.\d+$/;
const RULE_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;

export const RuleDefinitionSchema = z
  .object({
    id: z.string().regex(RULE_ID, "rule id: lowercase letters, digits, . _ - (2-80 chars)"),
    title: z.string().min(1).max(200),
    severity: z.enum(SEVERITIES),
    kind: z.enum(["deterministic", "llm"]),
    /** deterministic: registry key of the implementation; llm: the yes/no question asked of the documents. */
    check: z.string().min(1).max(4000),
    /** What a result must cite, e.g. "invoice number and row of the sales register". */
    evidence: z.string().min(1).max(500),
    /** Message shown when the rule fails and the check gives none. */
    failMessage: z.string().max(500).optional(),
    params: z.record(z.unknown()).optional(),
    origin: z
      .object({
        type: z.literal("mistake"),
        mistakeLogId: z.string().min(1),
        promotedInVersion: z.string().regex(SEMVER),
      })
      .optional(),
  })
  .strict();

export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

/** Serialised form stored in SopPack.checklist. */
export const ChecklistPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z.string().min(1),
    version: z.string().regex(SEMVER),
    rules: z.array(RuleDefinitionSchema),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const seen = new Set<string>();
    pack.rules.forEach((r, i) => {
      if (seen.has(r.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rules", i, "id"], message: `duplicate rule id ${r.id}` });
      seen.add(r.id);
    });
  });
export type ChecklistPack = z.infer<typeof ChecklistPackSchema>;

/** MistakeLog.ruleProposal: a rule definition without origin (the promotion adds it). */
export const MistakeRuleProposalSchema = RuleDefinitionSchema.omit({ origin: true });

export type CheckOutcome = { status: CheckStatus; message?: string; evidence?: Evidence };
export type DeterministicCheck<I> = (input: I, rule: RuleDefinition) => CheckOutcome;
export type RuleRegistry<I> = ReadonlyMap<string, DeterministicCheck<I>>;

export type LlmVerdict = { status: CheckStatus; message?: string; evidence: { quote: string; location: string } };
/**
 * Injected; the agent wires it to the ModelRouter. `context` is the documents text for this rule
 * (show exactly this to the model): the verdict's quote is checked against it. Its output is
 * validated, never trusted.
 */
export type LlmCheck<I> = (rule: RuleDefinition, input: I, context: string) => Promise<unknown>;
/** Documents text an LLM rule is given. Default: the check input as JSON. */
export type LlmContextFn<I> = (rule: RuleDefinition, input: I) => string;

export type ChecklistResultItem = {
  ruleId: string;
  title: string;
  severity: Severity;
  status: CheckStatus;
  message: string;
  evidence: Evidence | null;
  source: ResultSource;
  flags: ResultFlag[];
};

export type RuleSet = { key: string; version: string; rules: RuleDefinition[] };

// ------------------------------------------------------------------ loading

export function createRuleRegistry<I>(entries: Record<string, DeterministicCheck<I>>): RuleRegistry<I> {
  return new Map(Object.entries(entries));
}

export type LoadResult = { ok: true; ruleSet: RuleSet } | { ok: false; errors: string[] };

/**
 * Parse a SopPack checklist JSON (plus any approved mistake rules not yet folded into the pack)
 * and check every deterministic rule has an implementation. Fails closed: any problem → errors.
 */
export function loadRuleSet<I>(json: unknown, registry: RuleRegistry<I>, extraRules: RuleDefinition[] = []): LoadResult {
  const parsed = ChecklistPackSchema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  const ids = new Set(parsed.data.rules.map((r) => r.id));
  const errors: string[] = [];
  const rules = [...parsed.data.rules];
  for (const r of extraRules) {
    if (ids.has(r.id)) errors.push(`extra rule ${r.id} duplicates a pack rule`);
    ids.add(r.id);
    rules.push(r);
  }
  for (const r of rules) {
    if (r.kind === "deterministic" && !registry.has(r.check)) errors.push(`rule ${r.id}: no deterministic implementation registered as "${r.check}"`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, ruleSet: { key: parsed.data.key, version: parsed.data.version, rules } };
}

export type MistakeLogLike = { id: string; status: string; ruleProposal: unknown; promotedToVersion: string | null };

/** Approved MistakeLog rows → rules tagged as mistake-promoted. Unapproved or malformed rows are skipped and reported. */
export function rulesFromMistakeLogs(logs: MistakeLogLike[]): { rules: RuleDefinition[]; skipped: { id: string; reason: string }[] } {
  const rules: RuleDefinition[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const log of logs) {
    if (log.status !== "APPROVED") {
      skipped.push({ id: log.id, reason: `status ${log.status}` });
      continue;
    }
    if (!log.promotedToVersion || !SEMVER.test(log.promotedToVersion)) {
      skipped.push({ id: log.id, reason: "approved but not promoted to a pack version" });
      continue;
    }
    const p = MistakeRuleProposalSchema.safeParse(log.ruleProposal);
    if (!p.success) {
      skipped.push({ id: log.id, reason: `invalid rule proposal: ${p.error.issues[0]?.message ?? "unknown"}` });
      continue;
    }
    rules.push({ ...p.data, origin: { type: "mistake", mistakeLogId: log.id, promotedInVersion: log.promotedToVersion } });
  }
  return { rules, skipped };
}

/** Next minor version of a semver string ("1.3.2" → "1.4.0"). */
export function bumpMinor(version: string): string {
  if (!SEMVER.test(version)) throw new Error(`not a semver version: ${version}`);
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

/** A new pack (minor bump) with an approved mistake rule appended. The input pack is not modified. */
export function withPromotedRule(pack: ChecklistPack, proposal: unknown, mistakeLogId: string): ChecklistPack {
  const rule = MistakeRuleProposalSchema.parse(proposal);
  if (pack.rules.some((r) => r.id === rule.id)) throw new Error(`rule ${rule.id} already exists in ${pack.key} ${pack.version}`);
  const version = bumpMinor(pack.version);
  return ChecklistPackSchema.parse({
    ...pack,
    version,
    rules: [...pack.rules, { ...rule, origin: { type: "mistake", mistakeLogId, promotedInVersion: version } }],
  });
}

// ------------------------------------------------------------------ running

const LlmVerdictSchema = z.object({
  status: z.enum(["pass", "fail", "na"]),
  message: z.string().max(1000).optional(),
  evidence: z.object({ quote: z.string().trim().min(1), location: z.string().trim().min(1), link: z.string().optional() }),
});

/** Whitespace runs → one space, trimmed, lower case. The only normalisation applied to quotes. */
export const normalizeEvidenceText = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Does the quote occur in the documents text (after normalizeEvidenceText on both)? */
export function quoteInContext(quote: string, context: string): boolean {
  const q = normalizeEvidenceText(quote);
  return q.length > 0 && normalizeEvidenceText(context).includes(q);
}

export const defaultLlmContext = (input: unknown): string => (typeof input === "string" ? input : (JSON.stringify(input, null, 2) ?? ""));

const sourceOf = (rule: RuleDefinition): ResultSource => (rule.origin?.type === "mistake" ? "mistake" : rule.kind);

function defaultMessage(rule: RuleDefinition, status: CheckStatus): string {
  if (status === "pass") return `${rule.title}: OK`;
  if (status === "na") return `${rule.title}: not applicable`;
  return rule.failMessage ?? `${rule.title}: failed`;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function item(rule: RuleDefinition, status: CheckStatus, message: string | undefined, evidence: Evidence | undefined | null, flags: ResultFlag[] = []): ChecklistResultItem {
  return {
    ruleId: rule.id,
    title: rule.title,
    severity: rule.severity,
    status,
    message: message?.trim() || defaultMessage(rule, status),
    evidence: evidence && (evidence.quote || evidence.location || evidence.link) ? { ...evidence } : null,
    source: sourceOf(rule),
    flags,
  };
}

function runDeterministic<I>(rule: RuleDefinition, input: I, registry: RuleRegistry<I>): ChecklistResultItem {
  const impl = registry.get(rule.check);
  if (!impl) return item(rule, "fail", `${rule.title}: no implementation registered ("${rule.check}"); treat as unchecked`, null, ["missing-implementation"]);
  try {
    const out = impl(input, rule);
    return item(rule, out.status, out.message, out.evidence);
  } catch (e) {
    return item(rule, "fail", `${rule.title}: check could not run (${errText(e)}); treat as unchecked`, null, ["check-error"]);
  }
}

async function runLlm<I>(rule: RuleDefinition, input: I, llmCheck: LlmCheck<I> | undefined, llmContext: LlmContextFn<I> | undefined): Promise<ChecklistResultItem> {
  if (!llmCheck) return item(rule, "na", `${rule.title}: needs a model check; none available, review manually`, null, ["llm-unavailable"]);
  let raw: unknown;
  let context: string;
  try {
    context = llmContext ? llmContext(rule, input) : defaultLlmContext(input);
    raw = await llmCheck(rule, input, context);
  } catch (e) {
    return item(rule, "na", `${rule.title}: model check failed (${errText(e)}); review manually`, null, ["llm-error"]);
  }
  const v = LlmVerdictSchema.safeParse(raw);
  if (!v.success) {
    return item(rule, "na", `${rule.title}: model answer rejected (no verbatim quote and location); review manually`, null, ["llm-evidence-missing"]);
  }
  if (!quoteInContext(v.data.evidence.quote, context)) {
    return item(rule, "na", `${rule.title}: model answer rejected (its quote does not occur in the documents it was given); review manually`, null, ["llm-evidence-missing"]);
  }
  return item(rule, v.data.status, v.data.message, v.data.evidence);
}

/**
 * Runs deterministic rules (pack order), then LLM rules (pack order, one at a time). Each LLM rule
 * gets `llmContext(rule, input)` (default: the input as JSON) and its verdict's quote must occur
 * in that text.
 */
export async function runChecklist<I>(
  ruleSet: RuleSet,
  input: I,
  deps: { registry: RuleRegistry<I>; llmCheck?: LlmCheck<I>; llmContext?: LlmContextFn<I> },
): Promise<ChecklistResultItem[]> {
  const out: ChecklistResultItem[] = [];
  for (const rule of ruleSet.rules.filter((r) => r.kind === "deterministic")) out.push(runDeterministic(rule, input, deps.registry));
  for (const rule of ruleSet.rules.filter((r) => r.kind === "llm")) out.push(await runLlm(rule, input, deps.llmCheck, deps.llmContext));
  return out;
}

// ------------------------------------------------------------------ summary + persistence

type Counts = Record<CheckStatus, number>;
const zero = (): Counts => ({ pass: 0, fail: 0, na: 0 });

export type ChecklistSummary = {
  total: number;
  byStatus: Counts;
  bySeverity: Record<Severity, Counts>;
  bySource: Record<ResultSource, number>;
  blockingFailures: number;
  flagged: number;
  hasBlockingFailures: boolean;
};

export function hasBlockingFailures(results: readonly ChecklistResultItem[]): boolean {
  return results.some((r) => r.severity === "block" && r.status === "fail");
}

export function summarizeChecklist(results: readonly ChecklistResultItem[]): ChecklistSummary {
  const s: ChecklistSummary = {
    total: results.length,
    byStatus: zero(),
    bySeverity: { block: zero(), warn: zero(), info: zero() },
    bySource: { deterministic: 0, llm: 0, mistake: 0 },
    blockingFailures: 0,
    flagged: 0,
    hasBlockingFailures: false,
  };
  for (const r of results) {
    s.byStatus[r.status] += 1;
    s.bySeverity[r.severity][r.status] += 1;
    s.bySource[r.source] += 1;
    if (r.flags.length) s.flagged += 1;
    if (r.severity === "block" && r.status === "fail") s.blockingFailures += 1;
  }
  s.hasBlockingFailures = s.blockingFailures > 0;
  return s;
}

/** Rows for prisma.checklistResult.createMany (flags travel inside the evidence JSON). */
export function toChecklistResultRows(agentRunId: string, results: readonly ChecklistResultItem[]) {
  return results.map((r) => ({
    agentRunId,
    ruleId: r.ruleId,
    severity: r.severity,
    status: r.status,
    message: r.message,
    evidence: r.evidence || r.flags.length ? { ...(r.evidence ?? {}), ...(r.flags.length ? { flags: r.flags } : {}) } : undefined,
    source: r.source,
  }));
}
