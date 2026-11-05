// The runner's guardrail layer for one run of a scoped agent (ADR-008). Built once per run; the
// runner hands it the bound router call and its own unwrap, and uses:
//
//   sniff(files)   wrong-department input → WrongInputError, before any model call
//   model(req)     ctx.model: declared tasks only (ScopeViolationError otherwise), system prompt =
//                  FIRM_PREAMBLE + department + task prompt, the task's validators plus the call's
//                  own `contradictions` as router contradictions (an issue escalates; after the
//                  last escalation the router returns the output as needs-review and the run is
//                  marked needsPartnerReview — agents keep only the items their validators accept),
//                  output grounded (groundCheck: ungrounded array items dropped)
//   llmCheck       LLM rules: owned rules only, `<key>.check:<ruleId>` task, abstainable verdict,
//                  two reads on block / highStakes (disagreement → na + model-disagreement)
//   stats          counts for the run's `guardrail-run` AuditEvent (drift monitoring, harness)
//
// ADR-009 (OWASP LLM01): every user / assistant message of a scoped call and the documents of
// every LLM rule are screened line by line (screenDocumentText) — a line that reads like an
// instruction to the AI is withheld and recorded with its location — and what is left is fenced
// as untrusted data (fenceUntrusted). Grounding checks quotes against the screened text, so an
// answer that cites a withheld line cannot be used. Agents also screen their own items first
// (`screen`, hung on ctx.model) so a withheld item becomes a reviewer question in their output.
// The runner turns everything withheld into the `possible-prompt-injection` reviewer flag
// (injectionResult). Nothing withheld is ever dropped silently.
//
// ADR-006 (DPDP): names reach the anonymizer only through a dictionary. The runner hands the session
// the run's dictionary (setDictionary: client master, staff, names the agent harvests from its
// inputs) and every model and LLM-rule call carries it to the router. An anonymize-then-cloud call
// with an empty dictionary, or after the dictionary could not be built, is refused before anything
// is sent (DictionaryUnavailableError, plain message) and fails the run.
//
// No I/O of its own: every model call goes through `route` (the ModelRouter, or a recording).
import type { ZodTypeAny } from "zod";
import type { AgentTask, Difficulty, DictionaryEntry, ModelRequest, Msg, Privacy, RouterResult } from "@/lib/ai/router";
import type { ChecklistResultItem, LlmCheck, RuleDefinition } from "../checklist";
import { ABSTAIN_STATUS, isGuardrailOutcome, quoteInContext } from "../checklist";
import { AGREEMENT_TIER, needsAgreement, settleAgreement } from "./agreement";
import { GroundingError, groundCheck } from "./grounding";
import { shapeFingerprint, unboundedStrings } from "./schema";
import { BudgetExceededError } from "@/lib/ai/errors";
import { estimateTokens } from "@/lib/ai/pricing";
import { limitsFor, runBudgetFor, truncateToLimit, truncationResult, type Truncation } from "./limits";
import { supplyChainMeta } from "./supply-chain";
import { fenceUntrusted, injectionResult, lineLocation, screenDocumentText, screenItems, type ItemScreen, type ScreenOptions, type WithheldItem } from "./untrusted";
import {
  ScopeViolationError,
  WrongInputError,
  checkTaskFor,
  checkTaskName,
  composeSystemPrompt,
  genericCheckTaskName,
  resolveTask,
  sniffInputs,
  taskLabel,
  wrongInputMessage,
  type AgentScope,
  type AnyTaskSpec,
  type ScopedAgentLike,
  type SniffFile,
} from "./scope";

export type GuardrailStats = {
  /** Scoped model calls made (second reads included). */
  modelCalls: number;
  /** LLM rule verdicts asked of the model. */
  judgements: number;
  /** LLM rules answered insufficient_evidence (→ reviewer questions). */
  abstained: number;
  /** Evidence quotes / grounded numbers checked. */
  groundChecked: number;
  /** Ungrounded items dropped + LLM verdicts whose quote is not in the documents. */
  ungrounded: number;
  agreementChecks: number;
  disagreements: number;
  scopeViolations: number;
  /** LLM rules the scope does not own (no model call; na + out-of-scope). */
  outOfScopeRules: number;
  /** 1 when inputSniff stopped the run. */
  wrongInput: number;
  /** Document items / lines the injection screen looked at (ADR-009). */
  screened: number;
  /** Distinct locations the injection screen withheld from the model (ADR-009). */
  injections: number;
  /** Calls whose documents were cut at the task's input limit (ADR-009, flagged input-truncated). */
  truncatedCalls: number;
};

export const emptyGuardrailStats = (): GuardrailStats => ({
  modelCalls: 0,
  judgements: 0,
  abstained: 0,
  groundChecked: 0,
  ungrounded: 0,
  agreementChecks: 0,
  disagreements: 0,
  scopeViolations: 0,
  outOfScopeRules: 0,
  wrongInput: 0,
  screened: 0,
  injections: 0,
  truncatedCalls: 0,
});

const rupees = (n: number) => `₹${n.toFixed(2)}`;

/** What a person reads when the router refuses a call over budget (the ModelCall row keeps the code). */
export function budgetMessage(e: BudgetExceededError): string {
  return e.scope === "run"
    ? `This run has used its AI budget (${rupees(e.spentInr)} of ${rupees(e.limitInr)}), so it stopped before finishing. Run it again, or ask an admin to raise the per-run AI budget for this agent.`
    : `Today's AI budget for the firm is used up (${rupees(e.spentInr)} of ${rupees(e.limitInr)}), so this run stopped. Run it again tomorrow, or ask an admin to raise the daily AI budget.`;
}

/** Most withheld locations kept in one run's AuditEvent meta. */
export const MAX_RECORDED_INJECTIONS = 50;

/** AuditEvent.action of the per-run guardrail record. */
export const GUARDRAIL_RUN_ACTION = "guardrail-run";

/** What an agent passes to ctx.model. The framework owns taskVersion / forceTier / secondOpinion. */
export type ModelCallRequest<T> = Omit<ModelRequest<T>, "runId" | "task" | "taskVersion" | "forceTier" | "secondOpinion"> & {
  task: AgentTask;
  /** Documents text quotes must come from (default: the user messages). Scoped agents only. */
  source?: string;
};

type CallOpts<T> = {
  privacy: Privacy;
  difficulty: Difficulty;
  dictionary?: DictionaryEntry[];
  maxTokens?: number;
  maxCostInr?: number;
  /** Per-call schema (spec.schemaPerCall). */
  schema?: ModelRequest<T>["schema"];
  /** Second argument of spec.validate (agent input, or the documents text for a checklist task). */
  validateWith: unknown;
  /** The call's own validators. */
  contradictions?: ModelRequest<T>["contradictions"];
};

export type GuardrailSessionDeps = {
  agent: ScopedAgentLike;
  scope: AgentScope;
  /** The router call bound to the run (runId added by the runner). */
  route: <T>(req: Omit<ModelRequest<T>, "runId">) => Promise<RouterResult<T>>;
  /** The runner's result handling: usable output (needs-review with output allowed) or throw. */
  unwrap: <T>(res: RouterResult<T>) => T;
  /**
   * DPDP (ADR-006): refuse an anonymize-then-cloud call whose masking dictionary is empty or could
   * not be built (fail closed). Default true; the runner turns it off only for internal test agents.
   */
  requireDictionary?: boolean;
};

/** What a person reads when a run has no list of names to hide from the AI. */
export const NO_DICTIONARY_MESSAGE =
  "No client or staff names were available to hide from the AI, so nothing was sent to it. Check the client's name and contact in the client master and run the agent again.";

/** A cloud call refused because the run's masking dictionary is missing (ADR-006, fail closed). */
export class DictionaryUnavailableError extends Error {
  constructor(problem?: string | null) {
    super(
      problem
        ? `The list of names to hide from the AI could not be built (${problem}), so nothing was sent to the AI. Run the agent again; if it fails again, tell an admin.`
        : NO_DICTIONARY_MESSAGE,
    );
    this.name = "DictionaryUnavailableError";
  }
}

/** Run dictionary + a call's own entries, one entry per value. */
function mergeDictionaries(a: readonly DictionaryEntry[], b: readonly DictionaryEntry[] | undefined): DictionaryEntry[] {
  if (!b?.length) return [...a];
  const seen = new Set(a.map((e) => e.value.trim().toLowerCase()));
  return [...a, ...b.filter((e) => !seen.has(e.value.trim().toLowerCase()))];
}

export type GuardrailSession = ReturnType<typeof createGuardrailSession>;

/** Stands in for a verdict quote that cites text the injection screen withheld (it is in no document the model was shown). */
export const WITHHELD_QUOTE = "(text withheld by the injection screen)";

/**
 * The checklist engine checks a verdict's quote against the full documents text; the model only saw
 * the screened text. A quote that is not in the screened text is replaced so the engine rejects it
 * (na + llm-evidence-missing) instead of accepting a quote of withheld text.
 */
function withoutWithheldQuote(verdict: unknown, shown: string, anyWithheld: boolean): unknown {
  if (!anyWithheld || isGuardrailOutcome(verdict)) return verdict;
  const ev = (verdict as { evidence?: { quote?: unknown } } | null)?.evidence;
  if (!ev || typeof ev.quote !== "string" || quoteInContext(ev.quote, shown)) return verdict;
  return { ...(verdict as object), evidence: { ...ev, quote: WITHHELD_QUOTE } };
}

export function createGuardrailSession(deps: GuardrailSessionDeps) {
  const { agent, scope, route, unwrap } = deps;
  const requireDictionary = deps.requireDictionary !== false;
  const stats = emptyGuardrailStats();
  let violation: ScopeViolationError | null = null;
  let input: unknown;
  /** ADR-006: the run's masking dictionary (client master, staff, names harvested from the inputs). */
  let runDictionary: DictionaryEntry[] = [];
  let dictionaryProblem: string | null = null;
  /** A refused cloud call that must fail the run even if the checklist engine caught it. */
  let fatal: DictionaryUnavailableError | null = null;
  /** Everything the injection screen kept out of a model call, by location (first seen first). */
  const withheld = new Map<string, WithheldItem & { tasks: string[] }>();

  const record = (e: ScopeViolationError) => {
    stats.scopeViolations += 1;
    violation ??= e;
    return e;
  };
  const violate = (message: string) => record(new ScopeViolationError(message));

  const noteWithheld = (task: string, items: readonly WithheldItem[]) => {
    for (const w of items) {
      const seen = withheld.get(w.location);
      if (seen) {
        if (!seen.tasks.includes(task)) seen.tasks.push(task);
        continue;
      }
      withheld.set(w.location, { location: w.location, patterns: [...w.patterns], excerpt: w.excerpt, tasks: [task] });
    }
    stats.injections = withheld.size;
  };

  /** The agent-side item screen (ctx.model.screen): withheld items are recorded for the run's flag. */
  const screen: ItemScreen = <P>(task: string, items: readonly P[], opts: ScreenOptions<P>) => {
    const r = screenItems(items, opts);
    stats.screened += items.length;
    noteWithheld(task, r.withheld);
    return r;
  };

  /** Documents cut at a task's input limit (ADR-009, LLM10): one warn row for the run, never silent. */
  const truncations: Truncation[] = [];
  /** Cut `text` to what is left of the call's input budget; record what was not sent. */
  const withinLimit = (task: string, text: string, budget: { tokens: number }, fallback: string): string => {
    const t = truncateToLimit(text, Math.max(0, budget.tokens), (line, i) => lineLocation(line, i, fallback));
    budget.tokens -= estimateTokens(t.kept);
    if (t.cut) truncations.push({ task, linesNotSent: t.cut.lines, firstLocation: t.cut.firstLocation });
    return t.kept;
  };

  /**
   * Backstop over what is actually sent: every line of every user / assistant message is screened;
   * withheld lines are left out, the rest is cut to the task's input limit and fenced. Returns the
   * messages to send and the text quotes are grounded against (exactly what was sent).
   */
  const screenMessages = (task: string, name: string, messages: Msg[]): { messages: Msg[]; source: string } => {
    const sent: Msg[] = [];
    const kept: string[] = [];
    const budget = { tokens: limitsFor(name).maxInputTokens };
    messages.forEach((m, i) => {
      const fallback = `${task} message ${i + 1}`;
      const s = screenDocumentText(m.content, fallback);
      stats.screened += s.lines;
      noteWithheld(task, s.withheld);
      const text = withinLimit(task, s.kept, budget, fallback);
      if (m.role === "user") kept.push(text);
      sent.push({ role: m.role, content: fenceUntrusted(text) });
    });
    return { messages: sent, source: kept.join("\n\n") };
  };

  /** Per task: model items checked against the documents and how many were not grounded (hallucination budget, LLM09). */
  const taskStats: Record<string, { checked: number; ungrounded: number }> = {};
  const countTask = (label: string, checked: number, ungrounded: number) => {
    const t = (taskStats[label] ??= { checked: 0, ungrounded: 0 });
    t.checked += checked;
    t.ungrounded += ungrounded;
  };
  const runBudget = runBudgetFor(agent.key);

  async function callSpec<T>(spec: AnyTaskSpec, messages: Msg[], o: CallOpts<T>, extra: Pick<ModelRequest<T>, "forceTier" | "secondOpinion"> = {}): Promise<T> {
    stats.modelCalls += 1;
    const validate = spec.validate;
    const own = o.contradictions;
    const contradictions =
      validate || own
        ? async (out: T) => {
            const issues: string[] = [];
            if (validate) issues.push(...validate(out, o.validateWith));
            if (own) issues.push(...(await own(out)));
            return issues;
          }
        : undefined;
    const limits = limitsFor(spec.name);
    const dictionary = mergeDictionaries(runDictionary, o.dictionary);
    // ADR-006 (DPDP): names are masked only through the dictionary, so a cloud call without one is refused.
    if (o.privacy === "anonymize-then-cloud" && requireDictionary && (dictionaryProblem || dictionary.length === 0)) {
      fatal ??= new DictionaryUnavailableError(dictionaryProblem);
      throw fatal;
    }
    let res: RouterResult<T>;
    try {
      res = await route<T>({
        task: spec.name as AgentTask,
        taskVersion: spec.version,
        schema: (o.schema ?? spec.schema) as ModelRequest<T>["schema"],
        messages: [{ role: "system", content: composeSystemPrompt(scope.department, spec) }, ...messages],
        privacy: o.privacy,
        difficulty: o.difficulty,
        ...(dictionary.length ? { dictionary } : {}),
        // ADR-009 (LLM10): the task's output cap and the run's cost budget always apply; a call may only ask for less.
        maxTokens: Math.min(o.maxTokens ?? limits.maxOutputTokens, limits.maxOutputTokens),
        maxCostInr: Math.min(o.maxCostInr ?? runBudget, runBudget),
        contradictions,
        ...extra,
      });
    } catch (e) {
      throw e instanceof BudgetExceededError ? new Error(budgetMessage(e)) : e;
    }
    return unwrap(res);
  }

  /** The call's schema: the task's own, or (schemaPerCall) a closed schema of the same shape. */
  function schemaFor<T>(spec: AnyTaskSpec, label: string, s: ModelRequest<T>["schema"] | undefined): ModelRequest<T>["schema"] | undefined {
    if (!s || s === spec.schema) return undefined;
    if (!spec.schemaPerCall) throw violate(`task ${label} must use its declared schema (pass spec.schema or nothing)`);
    if (shapeFingerprint(s as ZodTypeAny) !== shapeFingerprint(spec.schema as ZodTypeAny)) throw violate(`task ${label}: the per-call schema does not have the declared shape`);
    const open = unboundedStrings(s as ZodTypeAny);
    if (open.length) throw violate(`task ${label}: the per-call schema has free-form strings (${open.join("; ")})`);
    return s;
  }

  /** ctx.model for a scoped agent. */
  async function model<T>(req: ModelCallRequest<T>): Promise<T> {
    let spec: AnyTaskSpec;
    try {
      spec = resolveTask(agent.key, scope, String(req.task));
    } catch (e) {
      throw e instanceof ScopeViolationError ? record(e) : e;
    }
    const label = taskLabel(spec);
    const schema = schemaFor(spec, label, req.schema);
    if (req.messages.some((m) => m.role === "system")) throw violate(`task ${label}: the system prompt comes from the task registry; pass user / assistant messages only`);
    if (spec.difficulty && req.difficulty !== spec.difficulty) throw violate(`task ${label} declares difficulty "${spec.difficulty}"; the call asked for "${req.difficulty}"`);
    if (spec.privacy && req.privacy !== spec.privacy) throw violate(`task ${label} declares privacy "${spec.privacy}"; the call asked for "${req.privacy}"`);
    const screened = screenMessages(label, spec.name, req.messages);
    const out = await callSpec<T>(spec, screened.messages, {
      privacy: req.privacy,
      difficulty: spec.difficulty ?? req.difficulty,
      dictionary: req.dictionary,
      maxTokens: req.maxTokens,
      maxCostInr: req.maxCostInr,
      schema,
      validateWith: input,
      contradictions: req.contradictions,
    });
    // Quotes must come from what the model was actually shown (withheld lines are not in it).
    const source = req.source !== undefined ? screenDocumentText(req.source, label).kept : screened.source;
    const g = groundCheck(out, source, { schema: (schema ?? spec.schema) as ZodTypeAny });
    stats.groundChecked += g.checked;
    stats.ungrounded += g.ungrounded;
    countTask(label, g.checked, g.ungrounded);
    if (g.rootUngrounded) throw new GroundingError(label, g.issues);
    return g.output;
  }

  let verdicts = 0;
  /** ruleId → task label of the verdicts asked of the model (per-task hallucination counts in finish). */
  const verdictTask = new Map<string, string>();
  /** llmCheck for the checklist engine (documents = the text the verdict's quote is checked against). */
  const llmCheck: LlmCheck<unknown> = async (rule: RuleDefinition, _input, documents) => {
    if (!scope.ruleIds.includes(rule.id)) {
      stats.outOfScopeRules += 1;
      return { guardrail: "out-of-scope", message: `${rule.title}: rule ${rule.id} is not owned by the ${agent.key} agent's scope; no model was asked — review manually` };
    }
    const spec = checkTaskFor(agent.key, scope, rule.id);
    if (!spec) throw violate(`LLM rule ${rule.id} has no declared model task (declare "${checkTaskName(agent.key, rule.id)}" or "${genericCheckTaskName(agent.key)}")`);
    const label = taskLabel(spec);
    // The rule's question and evidence come from the partner-approved SOP pack; only the documents are untrusted.
    const fallback = `${rule.id} documents`;
    const docs = screenDocumentText(documents, fallback);
    stats.screened += docs.lines;
    noteWithheld(label, docs.withheld);
    const question = `Question: ${rule.check}\nEvidence to cite: ${rule.evidence}`;
    const shown = withinLimit(label, docs.kept, { tokens: limitsFor(spec.name).maxInputTokens - estimateTokens(question) }, fallback);
    const messages: Msg[] = [{ role: "user", content: `${question}\n\nDocuments:\n${fenceUntrusted(shown)}` }];
    // Checklist documents are client data: masked before any cloud call, or local-only when the task says so.
    const privacy: Privacy = spec.privacy === "local-only" ? "local-only" : "anonymize-then-cloud";
    const o: CallOpts<unknown> = { privacy, difficulty: spec.difficulty ?? "judgement", validateWith: shown };
    stats.judgements += 1;
    const first = await callSpec<unknown>(spec, messages, o);
    let verdict: unknown = first;
    if (needsAgreement(rule, spec)) {
      stats.agreementChecks += 1;
      const second = await callSpec<unknown>(spec, messages, o, { forceTier: AGREEMENT_TIER, secondOpinion: true });
      const settled = settleAgreement(rule, first, second);
      if (!settled.agreed) stats.disagreements += 1;
      verdict = settled.verdict;
    }
    verdict = withoutWithheldQuote(verdict, shown, shown !== documents);
    if (!isGuardrailOutcome(verdict) && (verdict as { status?: unknown } | null)?.status !== ABSTAIN_STATUS) {
      verdicts += 1;
      verdictTask.set(rule.id, label);
    }
    return verdict;
  };

  return {
    stats,
    model,
    llmCheck,
    /** Agent-side item screen; the runner hangs it on ctx.model (ADR-009). */
    screen,
    /** The `possible-prompt-injection` reviewer flag for this run, or null when nothing was withheld. */
    injectionResult(): ChecklistResultItem | null {
      return injectionResult([...withheld.values()]);
    },
    /** Withheld locations with the tasks they were kept out of (first seen first). */
    withheld(): (WithheldItem & { tasks: string[] })[] {
      return [...withheld.values()].map((w) => ({ ...w, patterns: [...w.patterns], tasks: [...w.tasks] }));
    },
    /** The `input-truncated` warn row for this run, or null when every call fitted its task's input limit. */
    truncationResult(): ChecklistResultItem | null {
      return truncationResult(truncations);
    },
    setInput(value: unknown) {
      input = value;
    },
    /**
     * ADR-006: the run's masking dictionary, merged into every model and LLM-rule call. `problem`
     * (a part of it could not be built) refuses every anonymize-then-cloud call of the run.
     */
    setDictionary(entries: readonly DictionaryEntry[], problem: string | null = null) {
      runDictionary = [...entries];
      dictionaryProblem = problem;
    },
    /** The run's masking dictionary (tests, diagnostics). */
    dictionary(): DictionaryEntry[] {
      return [...runDictionary];
    },
    /** Wrong-department input fails closed before any model call. */
    async sniff(files: SniffFile[]) {
      const r = await sniffInputs(scope, files);
      if (!r.ok) {
        stats.wrongInput = 1;
        throw new WrongInputError(wrongInputMessage(agent, r), r.suggestAgent);
      }
    },
    /** Rethrow a scope violation (or a cloud call refused for want of a dictionary) even if the agent's code or the checklist engine caught it. */
    assertNoViolation() {
      if (violation) throw violation;
      if (fatal) throw fatal;
    },
    /** Fold the checklist results into the stats (abstentions, ungrounded verdict quotes). */
    finish(results: readonly ChecklistResultItem[]) {
      stats.abstained = results.filter((r) => r.flags.includes("insufficient-evidence")).length;
      stats.groundChecked += verdicts;
      stats.ungrounded += results.filter((r) => r.flags.includes("llm-evidence-missing")).length;
      stats.truncatedCalls = truncations.length;
      for (const r of results) {
        const label = verdictTask.get(r.ruleId);
        if (label) countTask(label, 1, r.flags.includes("llm-evidence-missing") ? 1 : 0);
      }
    },
    /** prisma.auditEvent.create args for this run's guardrail record. */
    auditEvent(runId: string, outcome: "ok" | "failed") {
      return {
        data: {
          actorId: `agent:${runId}`,
          action: GUARDRAIL_RUN_ACTION,
          entity: "AgentRun",
          entityId: runId,
          meta: {
            agent: agent.key,
            department: scope.department,
            outcome,
            ...stats,
            injectionLocations: [...withheld.keys()].slice(0, MAX_RECORDED_INJECTIONS),
            // ADR-009 (LLM09): per-task grounding counts for the hallucination budget on the drift rows.
            tasks: Object.fromEntries(Object.entries(taskStats).map(([k, v]) => [k, { ...v }])),
            // ADR-009 (LLM03): which SDK and model ids produced this run.
            supplyChain: supplyChainMeta(),
          },
        },
      };
    },
  };
}
