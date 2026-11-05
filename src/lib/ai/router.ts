// ModelRouter — the single entry point for every model call in Firm OS (orchestrator "MODEL USE").
//
//   decideRoute()  pure routing policy (table-tested): which provider, tier, and whether to mask.
//   run()          mask → budget check → call → unmask → validate → escalate / fail over → log.
//
// Contract with the model: every provider is asked for { output, confidence } (the caller's Zod
// schema wrapped by routerOutputJsonSchema). `confidence` is the model's self-assessment in
// [0, 1]; below ROUTER_MIN_CONF (default 0.75) the router escalates exactly as for a schema
// failure. Each attempt is one ModelCall row with the sha256 of the MASKED prompt — never raw
// prompt text. The anonymizer token map lives only inside one run() call.
import { createHash } from "node:crypto";
import type { ZodTypeAny } from "zod";
import { createTokenMap, mask, unmaskDeep, type TokenMap } from "./anonymizer";
import { loadRouterConfig, type RouterConfig } from "./config";
import {
  BudgetExceededError,
  NoProviderAvailableError,
  ProviderError,
  ProviderOutputError,
  ProviderUnavailableError,
} from "./errors";
import { routerOutputJsonSchema } from "./json-schema";
import { costInr, estimateTokens } from "./pricing";
import { createProviders, type ProviderSet } from "./providers";
import { istDayStart } from "@/lib/ist";
import type {
  Difficulty,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  Msg,
  Privacy,
  ProviderId,
  ProviderRequest,
  Tier,
} from "./types";

export type {
  AgentName,
  AgentTask,
  DictionaryEntry,
  Difficulty,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  Msg,
  Privacy,
  ProviderId,
  ProviderRequest,
  ProviderResult,
  Tier,
} from "./types";
export { BudgetExceededError, NoProviderAvailableError, ProviderError, ProviderUnavailableError } from "./errors";

/** Maximum escalations per run() call (fast → smart → hard). */
export const MAX_ESCALATIONS = 2;

// ---------------------------------------------------------------- routing policy (pure)

export interface RouteInput {
  difficulty: Difficulty;
  privacy: Privacy;
  /** 0 for the first attempt; +1 per escalation. */
  escalationLevel: number;
  available: Record<ProviderId, boolean>;
  /** Pinned cloud tier (ADR-008 agreement re-ask): that tier only, no escalation. */
  forceTier?: Exclude<Tier, "LOCAL">;
}

export type RouteDecision =
  | {
      kind: "call";
      provider: ProviderId;
      tier: Tier;
      /** Mask before / unmask after. False only for `public` data or the in-house local model. */
      anonymize: boolean;
      needsPartnerReview: boolean;
      /** Whether a failed validation may escalate to a further attempt. */
      canEscalate: boolean;
    }
  | { kind: "queue"; reason: string }
  | { kind: "unavailable"; reason: string };

function ladder(difficulty: Difficulty, localFirst: boolean): Tier[] {
  if (difficulty === "novel") return ["HARD"];
  if (difficulty === "judgement") return ["SMART", "HARD"];
  return localFirst ? ["LOCAL", "FAST", "SMART"] : ["FAST", "SMART", "HARD"];
}

export function decideRoute(input: RouteInput): RouteDecision {
  const { difficulty, privacy, escalationLevel, available } = input;
  const needsPartnerReview = difficulty === "novel";

  // PII-tier work never leaves the building: local or a human, nothing else.
  if (privacy === "local-only") {
    if (!available.local) {
      return { kind: "queue", reason: "privacy is local-only and the local model is unavailable; queued for a human." };
    }
    return { kind: "call", provider: "local", tier: "LOCAL", anonymize: false, needsPartnerReview, canEscalate: false };
  }

  const rungs = input.forceTier ? [input.forceTier] : ladder(difficulty, difficulty === "sop" && available.local);
  const idx = Math.min(escalationLevel, rungs.length - 1);
  const tier = rungs[idx];
  const canEscalate = idx < Math.min(MAX_ESCALATIONS, rungs.length - 1);
  if (tier === "LOCAL") {
    return { kind: "call", provider: "local", tier, anonymize: false, needsPartnerReview, canEscalate };
  }
  const provider: ProviderId | null = available.claude ? "claude" : available.grok ? "grok" : null;
  if (!provider) {
    return { kind: "unavailable", reason: "Claude is unavailable and Grok is not configured (XAI_API_KEY empty)." };
  }
  return { kind: "call", provider, tier, anonymize: privacy !== "public", needsPartnerReview, canEscalate };
}

// ---------------------------------------------------------------- logging + results

export type ModelCallStatus = "OK" | "SCHEMA_FAIL" | "LOW_CONFIDENCE" | "PROVIDER_ERROR" | "QUEUED_FOR_HUMAN" | "BUDGET_REFUSED";

export interface ModelCallRow {
  runId: string;
  agent: string | null;
  task: string;
  provider: ProviderId | null;
  model: string | null;
  tier: Tier | null;
  privacy: Privacy;
  difficulty: Difficulty;
  escalated: boolean;
  escalationLevel: number;
  anonymized: boolean;
  status: ModelCallStatus;
  confidence: number | null;
  tokensIn: number;
  tokensOut: number;
  costInr: number;
  latencyMs: number;
  promptHash: string;
  error: string | null;
}

/** Where ModelCall rows go. Default: Prisma (src/lib/ai/db.ts). Tests use an in-memory fake. */
export interface ModelCallRepo {
  record(row: ModelCallRow): Promise<void>;
  /** Sum of costInr for calls created at or after `since`. */
  costInrSince(since: Date): Promise<number>;
  costInrForRun(runId: string): Promise<number>;
}

interface Totals {
  tokensIn: number;
  tokensOut: number;
  costInr: number;
}

export type RouterResult<T> =
  | (ModelResponse<T> & { status: "ok"; needsPartnerReview: boolean; attempts: number })
  | (Omit<ModelResponse<T>, "output"> & {
      status: "needs-review";
      /** Last schema-valid output, if any attempt produced one (low confidence / contradiction). */
      output: T | null;
      issues: string[];
      needsPartnerReview: true;
      attempts: number;
    })
  | { status: "queued"; reason: string; needsPartnerReview: true; runId: string; attempts: 0 };

export interface RouterDeps {
  providers: ProviderSet;
  repo: ModelCallRepo;
  config: RouterConfig;
  now?: () => Date;
}

/** Appended to the system prompt of every call. */
export const ROUTER_INSTRUCTIONS = [
  "Return a JSON object with exactly two fields: `output` (your answer, in the requested shape) and `confidence` (0 to 1: how sure you are that `output` is complete and correct).",
  "Placeholders such as ⟨PAN_1⟩ or ⟨NAME_2⟩ stand for withheld client data. Copy them exactly, character for character, wherever the value belongs. Never guess what they hide.",
].join("\n");

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function splitSystem(messages: Msg[]): Pick<ProviderRequest, "system" | "messages"> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages.filter((m): m is Msg & { role: "user" | "assistant" } => m.role !== "system");
  return { system: [system, ROUTER_INSTRUCTIONS].filter(Boolean).join("\n\n"), messages: rest.map((m) => ({ role: m.role, content: m.content })) };
}

/** ModelCall.task: `<task>`, `<task>@<version>` for a registered prompt, `…#2` for an agreement re-ask. */
export function modelCallTask(req: Pick<ModelRequest, "task" | "taskVersion" | "secondOpinion">): string {
  return `${req.task}${req.taskVersion !== undefined ? `@${req.taskVersion}` : ""}${req.secondOpinion ? "#2" : ""}`;
}

function zodIssues(err: { issues: { path: (string | number)[]; message: string }[] }): string[] {
  return err.issues.map((i) => `${i.path.length ? i.path.join(".") : "output"}: ${i.message}`);
}

// ---------------------------------------------------------------- run()

export interface Router {
  run<T>(req: ModelRequest<T>): Promise<RouterResult<T>>;
}

export function createRouter(deps: RouterDeps): Router {
  const { providers, repo, config } = deps;
  const now = deps.now ?? (() => new Date());

  async function checkBudget(req: Pick<ModelRequest, "runId" | "maxCostInr">, estimateInr: number): Promise<BudgetExceededError | null> {
    if (req.maxCostInr !== undefined) {
      const spent = await repo.costInrForRun(req.runId);
      if (spent + estimateInr > req.maxCostInr) return new BudgetExceededError("run", req.maxCostInr, spent);
    }
    if (config.dailyBudgetInr > 0) {
      const spent = await repo.costInrSince(istDayStart(now()));
      if (spent + estimateInr > config.dailyBudgetInr) return new BudgetExceededError("day", config.dailyBudgetInr, spent);
    }
    return null;
  }

  async function run<T>(req: ModelRequest<T>): Promise<RouterResult<T>> {
    const agent = req.task.includes(".") ? req.task.slice(0, req.task.indexOf(".")) : null;
    const available: Record<ProviderId, boolean> = {
      local: await providers.local.isAvailable(),
      claude: await providers.claude.isAvailable(),
      grok: await providers.grok.isAvailable(),
    };
    const map: TokenMap = createTokenMap();
    const maskText = (s: string) => mask(s, { dictionary: req.dictionary, map }).masked;
    // The masked copy is always built: it is what cloud providers get and what we hash.
    const maskedMessages: Msg[] = req.messages.map((m) => ({ role: m.role, content: maskText(m.content) }));
    const jsonSchema = routerOutputJsonSchema(req.schema as ZodTypeAny | undefined);
    const maxTokens = req.maxTokens ?? config.defaultMaxTokens;
    const priceCtx = { usdInr: config.usdInr, grokPriceUsdPerMTok: config.grokPriceUsdPerMTok };

    const totals: Totals = { tokensIn: 0, tokensOut: 0, costInr: 0 };
    let level = 0;
    let attempts = 0;
    let feedback: string | null = null;
    let lastProviderError: unknown;

    const base = { runId: req.runId, agent, task: modelCallTask(req), privacy: req.privacy, difficulty: req.difficulty };
    const hashOf = (fb: string | null) => sha256(JSON.stringify(fb ? [...maskedMessages, { role: "user", content: maskText(fb) }] : maskedMessages));
    const record = (row: Partial<ModelCallRow> & Pick<ModelCallRow, "status">) =>
      repo.record({
        ...base,
        provider: null,
        model: null,
        tier: null,
        escalated: level > 0,
        escalationLevel: level,
        anonymized: false,
        confidence: null,
        tokensIn: 0,
        tokensOut: 0,
        costInr: 0,
        latencyMs: 0,
        promptHash: hashOf(feedback),
        error: null,
        ...row,
      });

    for (;;) {
      const d = decideRoute({ difficulty: req.difficulty, privacy: req.privacy, escalationLevel: level, available, forceTier: req.forceTier });
      if (d.kind === "queue") {
        await record({ status: "QUEUED_FOR_HUMAN", error: d.reason });
        return { status: "queued", reason: d.reason, needsPartnerReview: true, runId: req.runId, attempts: 0 };
      }
      if (d.kind === "unavailable") {
        await record({ status: "PROVIDER_ERROR", error: d.reason });
        if (lastProviderError instanceof ProviderError) throw lastProviderError;
        throw new NoProviderAvailableError(d.reason, lastProviderError);
      }

      const provider: ModelProvider = providers[d.provider];
      const model = d.tier === "LOCAL" ? config.models.LOCAL : d.provider === "grok" ? config.models.GROK : config.models[d.tier];
      const source = d.anonymize ? maskedMessages : req.messages;
      const fbText = feedback === null ? null : d.anonymize ? maskText(feedback) : feedback;
      const sent = splitSystem(fbText === null ? source : [...source, { role: "user", content: fbText }]);
      const preq: ProviderRequest = { model, ...sent, jsonSchema, maxTokens };
      const callRow = { provider: d.provider, model, tier: d.tier, anonymized: d.anonymize };

      const estimate = costInr(d.provider, model, estimateTokens(JSON.stringify(preq.messages) + (preq.system ?? "")), 0, priceCtx);
      const refusal = await checkBudget(req, estimate);
      if (refusal) {
        await record({ ...callRow, status: "BUDGET_REFUSED", error: refusal.message });
        throw refusal;
      }

      attempts++;
      const started = now().getTime();
      let raw: { output?: unknown; confidence?: unknown } | null = null;
      let issues: string[] = [];
      let usage = { tokensIn: 0, tokensOut: 0, model, latencyMs: 0 };
      try {
        const res = await provider.complete<{ output?: unknown; confidence?: unknown }>(preq);
        raw = res.output && typeof res.output === "object" ? res.output : null;
        usage = { tokensIn: res.tokensIn, tokensOut: res.tokensOut, model: res.model, latencyMs: res.latencyMs };
        if (!raw) issues = ["response was not a JSON object"];
      } catch (err) {
        const latencyMs = now().getTime() - started;
        if (err instanceof ProviderOutputError) {
          usage = { tokensIn: err.tokensIn, tokensOut: err.tokensOut, model, latencyMs };
          issues = [err.message];
        } else {
          await record({ ...callRow, status: "PROVIDER_ERROR", latencyMs, error: err instanceof Error ? err.message : String(err) });
          if (err instanceof ProviderUnavailableError || (err instanceof ProviderError && err.failoverable)) {
            // Fail closed for this provider and re-route: local → cloud (or queue), Claude → Grok.
            available[d.provider] = false;
            lastProviderError = err;
            continue;
          }
          throw err; // auth / bad request / refusal: surfaced, never silently retried elsewhere
        }
      }

      const cost = costInr(d.provider, usage.model, usage.tokensIn, usage.tokensOut, priceCtx);
      totals.tokensIn += usage.tokensIn;
      totals.tokensOut += usage.tokensOut;
      totals.costInr = Math.round((totals.costInr + cost) * 10_000) / 10_000;

      // ---- validate (on the UNMASKED output, so schema regexes see real values)
      let output: T | null = null;
      let schemaOk = false;
      let confidence = 0;
      if (raw) {
        const value = d.anonymize ? unmaskDeep(raw.output, map) : raw.output;
        if (typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1) confidence = raw.confidence;
        else issues.push("confidence: must be a number between 0 and 1");
        if (req.schema) {
          const parsed = req.schema.safeParse(value);
          if (parsed.success) {
            output = parsed.data;
            schemaOk = true;
          } else issues.push(...zodIssues(parsed.error));
        } else if (typeof value === "string") {
          output = value as T;
          schemaOk = true;
        } else issues.push("output: expected a string");
      }
      let status: ModelCallStatus = "OK";
      if (!schemaOk || !raw) status = "SCHEMA_FAIL";
      else if (issues.length > 0 || confidence < config.minConfidence) {
        status = "LOW_CONFIDENCE";
        if (confidence < config.minConfidence) issues.push(`confidence ${confidence} is below ROUTER_MIN_CONF ${config.minConfidence}`);
      } else if (req.contradictions && output !== null) {
        const found = await req.contradictions(output);
        if (found.length > 0) {
          status = "LOW_CONFIDENCE";
          issues.push(...found.map((f) => `contradiction: ${f}`));
        }
      }

      await record({
        ...callRow,
        model: usage.model,
        status,
        confidence: raw ? confidence : null,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costInr: cost,
        latencyMs: usage.latencyMs,
        error: issues.length ? maskText(issues.join("; ")).slice(0, 1000) : null, // masked even for local/public
      });

      const common = {
        provider: d.provider,
        model: usage.model,
        confidence,
        escalated: level > 0,
        anonymized: d.anonymize,
        ...totals,
        attempts,
      };
      if (status === "OK" && output !== null) {
        return { status: "ok", output, needsPartnerReview: d.needsPartnerReview, ...common };
      }
      if (!d.canEscalate || level >= MAX_ESCALATIONS) {
        return { status: "needs-review", output, issues, needsPartnerReview: true, ...common };
      }
      level++;
      feedback = `Your previous answer was rejected: ${issues.join("; ")}. Return a corrected answer in the same JSON shape.`;
    }
  }

  return { run };
}

// ---------------------------------------------------------------- default wiring

let defaultRouter: Router | undefined;

/** Route one model request with the env-configured providers and the Prisma ModelCall log. */
export async function run<T>(req: ModelRequest<T>): Promise<RouterResult<T>> {
  if (!defaultRouter) {
    const { prismaModelCallRepo } = await import("./db");
    const config = loadRouterConfig();
    defaultRouter = createRouter({ providers: createProviders(config), repo: prismaModelCallRepo(), config });
  }
  return defaultRouter.run(req);
}
