// The real ModelRouter over providers with faked transports: Grok is the REAL createGrokProvider
// with a fake fetch (its retries, Retry-After handling and error mapping all run), the local
// provider is the REAL fail-closed stub, and Claude is a contract fake that answers — or fails —
// exactly as createClaudeProvider surfaces it after its own retries (ProviderError outage /
// rate_limit / auth, same messages). The Anthropic SDK may only be imported under
// src/lib/ai/providers/ (verify:ai-boundary), so the SDK-level retry, backoff and Retry-After
// behaviour of the Claude provider is covered by src/lib/ai/providers/__tests__/claude.test.ts.
// Nothing reaches the network. A dated in-memory ModelCall log backs the per-run and per-IST-day
// budget checks exactly as the Prisma repo does.
import { z } from "zod";
import { loadRouterConfig } from "@/lib/ai/config";
import { ProviderError } from "@/lib/ai/errors";
import { createGrokProvider } from "@/lib/ai/providers/grok";
import { createLocalProvider } from "@/lib/ai/providers/local";
import { createRouter, type ModelCallRepo, type ModelCallRow } from "@/lib/ai/router";
import type { ProviderSet } from "@/lib/ai/providers";
import { createRuleRegistry } from "@/lib/agents/core/checklist";
import type { AgentDefinition, InputFile } from "@/lib/agents/core/runner";
import type { ModelProvider, Privacy, ProviderRequest, ProviderResult } from "@/lib/ai/types";

export const MODEL_NOW = new Date("2026-11-05T06:30:00.000Z"); // Thu 12:00 IST

type ClaudeReply = { body: unknown; tokensIn: number; tokensOut: number };
type ClaudeStep = ClaudeReply | Error | ((req: ProviderRequest) => ClaudeReply);

/** A successful Claude reply carrying `{ output, confidence }` (usage as the API reports it). */
export const claudeOk = (body: unknown, usage = { input_tokens: 10_000, output_tokens: 2_000 }): ClaudeReply => ({ body, tokensIn: usage.input_tokens, tokensOut: usage.output_tokens });

/**
 * What createClaudeProvider throws once its retries are spent (src/lib/ai/providers/claude.ts
 * toProviderError): 5xx / 529 → outage, 429 → rate_limit (both fail over), 401 / 403 → auth (surfaced).
 */
export function claudeDown(status: number): ProviderError {
  if (status === 429) return new ProviderError("claude", "rate_limit", "Claude rate limited (429): rate_limit_error", 429);
  if (status === 401 || status === 403) return new ProviderError("claude", "auth", `Claude rejected the credentials (${status}).`, status);
  return new ProviderError("claude", "outage", `Claude unavailable (${status}): ${status === 529 ? "overloaded_error" : "api_error"}`, status);
}

/** Claude as the router sees it: serves `steps` in order, then repeats `fallback` (if any). */
export function fakeClaude(available: boolean, steps: ClaudeStep[], fallback?: ClaudeStep) {
  const requests: ProviderRequest[] = [];
  const provider: ModelProvider = {
    id: "claude",
    isAvailable: async () => available,
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      requests.push(req);
      const step = steps.length ? steps.shift() : fallback;
      if (!step) throw new Error("fake Claude: no scripted reply left");
      if (step instanceof Error) throw step;
      const r = typeof step === "function" ? step(req) : step;
      return { output: r.body as T, model: req.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, latencyMs: 40 };
    },
  };
  return { provider, requests };
}

/** Fake xAI chat-completions endpoint: `answer` builds the model's JSON from the (masked) request. */
export function fakeXai(answer: ((body: { messages: { role: string; content: string }[] }) => unknown) | { status: number }) {
  const bodies: string[] = [];
  const fetch: typeof globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    bodies.push(body);
    if ("status" in answer) return new Response("upstream down", { status: answer.status });
    const content = JSON.stringify(answer(JSON.parse(body)));
    return new Response(JSON.stringify({ model: "grok-4", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

/** ModelCall rows with their creation time, so "since IST midnight" means what it means in Prisma. */
export function datedRepo(now: () => Date, seed: Array<Partial<ModelCallRow> & { at: Date; costInr: number }> = []) {
  const rows: Array<ModelCallRow & { at: Date }> = seed.map((s) => ({ ...blankRow(), ...s }) as ModelCallRow & { at: Date });
  const repo: ModelCallRepo = {
    async record(row) {
      rows.push({ ...row, at: now() });
    },
    async costInrSince(since) {
      return rows.filter((r) => r.at.getTime() >= since.getTime()).reduce((s, r) => s + r.costInr, 0);
    },
    async costInrForRun(runId) {
      return rows.filter((r) => r.runId === runId).reduce((s, r) => s + r.costInr, 0);
    },
  };
  return { repo, rows };
}

function blankRow(): ModelCallRow {
  return {
    runId: "earlier-run", agent: null, task: "system.earlier", provider: "claude", model: "claude-haiku-5-5", tier: "FAST", privacy: "anonymize-then-cloud",
    difficulty: "sop", escalated: false, escalationLevel: 0, anonymized: true, status: "OK", confidence: 0.9, tokensIn: 0, tokensOut: 0, costInr: 0,
    latencyMs: 0, promptHash: "x", error: null,
  };
}

export interface ModelWorldOptions {
  claude: ClaudeStep[] | null; // null = ANTHROPIC_API_KEY unset
  claudeFallback?: ClaudeStep;
  grok?: Parameters<typeof fakeXai>[0]; // absent = XAI_API_KEY unset
  localBaseUrl?: string;
  env?: Record<string, string>;
  now?: () => Date;
  seed?: Parameters<typeof datedRepo>[1];
}

export function modelWorld(o: ModelWorldOptions) {
  const now = o.now ?? (() => MODEL_NOW);
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);
  const claude = fakeClaude(o.claude !== null, o.claude ?? [], o.claudeFallback);
  const xai = fakeXai(o.grok ?? { status: 500 });
  const providers: ProviderSet = {
    claude: claude.provider,
    grok: createGrokProvider({ apiKey: o.grok ? "test-xai" : "", fetch: xai.fetch, retry: { sleep } }),
    local: createLocalProvider({ baseUrl: o.localBaseUrl ?? "" }),
  };
  const log = datedRepo(now, o.seed);
  const config = loadRouterConfig({ AI_DAILY_BUDGET_INR: "500", ...o.env });
  const router = createRouter({ providers, repo: log.repo, config, now });
  return { router, rows: log.rows, claude, xai, sleeps, config };
}

// ------------------------------------------------------------------ a minimal agent with real model calls

const Count = z.object({ n: z.number().int() });

/**
 * An internal test agent whose extract() makes `calls` model calls through the runner's model
 * binding (so router failures surface exactly as for a production agent). One XLSX deliverable.
 */
export function modelCallingAgent(opts: { calls: number; privacy?: Privacy; maxCostInr?: number }): AgentDefinition<InputFile[], { answers: number[] }> {
  return {
    key: "chaos",
    title: "Chaos probe",
    service: "Books",
    sopPackKey: "chaos",
    modelAgent: "books",
    internal: true,
    inputSchema: z.array(z.any()) as unknown as AgentDefinition<InputFile[], { answers: number[] }>["inputSchema"],
    async extract({ model }) {
      const answers: number[] = [];
      for (let i = 1; i <= opts.calls; i++) {
        const out = await model({
          task: `books.chaos-step-${i}`,
          privacy: opts.privacy ?? "anonymize-then-cloud",
          difficulty: "sop",
          schema: Count,
          maxCostInr: opts.maxCostInr,
          messages: [{ role: "user", content: `Step ${i}: count the ledgers named in the register.` }],
        });
        answers.push(out.n);
      }
      return { answers };
    },
    compute: (e) => ({ calls: e.answers.length }),
    checklistRegistry: createRuleRegistry({}),
    deliverables: () => [{ type: "xlsx", title: "Chaos probe", sheets: [{ name: "Probe", columns: [{ header: "n", key: "n" }], rows: [{ n: 1 }] }] }],
    defaultChecklist: { schemaVersion: 1, key: "chaos", version: "1.0.0", rules: [] },
  };
}

export const CHAOS_PACK = { key: "chaos", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Chaos probe", checklist: { schemaVersion: 1, key: "chaos", version: "1.0.0", rules: [] } };
