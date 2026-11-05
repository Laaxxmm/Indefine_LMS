// Response cache: the LRU itself, the key, and the router wiring (same request in one client scope
// reuses the validated answer; anything that differs, another client, a failed re-validation or a
// non-"ok" result calls the provider).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RESPONSE_CACHE_DEFAULTS, createResponseCache, responseCacheKey, type CacheKeyParts, type CachedResponse } from "../cache";
import { loadRouterConfig } from "../config";
import { createRouter, type ModelCallRepo, type ModelCallRow } from "../router";
import type { ModelProvider, ModelRequest, ProviderRequest } from "../types";

const value = (output: unknown): CachedResponse => ({ output, provider: "claude", model: "m", confidence: 0.9, escalated: false, anonymized: true, needsPartnerReview: false });

describe("createResponseCache", () => {
  it("returns what was set, as a copy; an entry in use survives, an unused one is dropped", () => {
    const c = createResponseCache({ maxEntries: 4 });
    c.set("a", value({ n: 1 }));
    c.set("b", value({ n: 2 })); // young generation full (2 of 4): it becomes the old one
    const got = c.get("a")!; // used again: copied back to the young generation
    (got.output as { n: number }).n = 99; // a caller mutating its copy changes nothing cached
    expect(c.get("a")!.output).toEqual({ n: 1 });
    c.set("c", value({ n: 3 })); // rotates again: the generation holding b is dropped
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBeDefined();
    expect(c.size).toBeLessThanOrEqual(4);
  });

  it("expires entries after the TTL, honours the character budget, and invalidates", () => {
    let t = 0;
    const c = createResponseCache({ ttlMs: 1000, maxChars: 30, now: () => t });
    c.set("a", value("x".repeat(10)));
    c.set("b", value("y".repeat(10))); // 24 chars ≥ half the budget: rotates
    c.set("c", value("z".repeat(10)));
    c.set("d", value("w".repeat(10))); // rotates again: a and b are gone
    expect(c.get("a")).toBeUndefined();
    expect(c.get("c")).toBeDefined();
    c.set("huge", value("w".repeat(100))); // larger than the whole budget: not kept
    expect(c.get("huge")).toBeUndefined();
    t = 5000;
    expect(c.get("c")).toBeUndefined();
    c.set("e", value(1));
    expect(c.get("e")).toBeDefined();
    c.invalidate("e");
    expect(c.get("e")).toBeUndefined();
  });

  it("stays within its entry cap under many writes", () => {
    const c = createResponseCache({ maxEntries: 10 });
    for (let i = 0; i < 1000; i++) c.set(`k${i}`, value(i));
    expect(c.size).toBeLessThanOrEqual(10);
    expect(c.get("k999")).toBeDefined();
    expect(c.get("k0")).toBeUndefined();
  });

  it("defaults", () => {
    expect(RESPONSE_CACHE_DEFAULTS).toEqual({ maxEntries: 500, maxChars: 4_000_000, ttlMs: 43_200_000 });
    const cfg = loadRouterConfig({});
    expect(cfg.responseCacheMax).toBe(500);
    expect(cfg.responseCacheTtlMs).toBe(43_200_000);
    expect(loadRouterConfig({ AI_RESPONSE_CACHE_MAX: "0" }).responseCacheMax).toBe(0);
    expect(loadRouterConfig({ AI_RESPONSE_CACHE_MAX: "-3", AI_RESPONSE_CACHE_TTL_MS: "5" }).responseCacheMax).toBe(500);
    expect(loadRouterConfig({ AI_RESPONSE_CACHE_TTL_MS: "5" }).responseCacheTtlMs).toBe(43_200_000);
  });
});

describe("responseCacheKey", () => {
  const base: CacheKeyParts = {
    scope: "job:1",
    task: "gst.classify-ledgers@1",
    forceTier: null,
    privacy: "anonymize-then-cloud",
    difficulty: "judgement",
    maxTokens: 4096,
    jsonSchema: { type: "object" },
    maskedMessages: [{ role: "user", content: "PAN ⟨PAN_1⟩" }],
    rawMessages: [{ role: "user", content: "PAN AAAPA1234A" }],
  };
  it("changes with every part", () => {
    const k = responseCacheKey(base);
    expect(responseCacheKey({ ...base })).toBe(k);
    const variants: Partial<CacheKeyParts>[] = [
      { scope: "job:2" },
      { task: "gst.classify-ledgers@2" },
      { task: "gst.classify-ledgers@1#2" },
      { forceTier: "HARD" },
      { privacy: "public" },
      { difficulty: "sop" },
      { maxTokens: 100 },
      { jsonSchema: { type: "array" } },
      { maskedMessages: [{ role: "user", content: "PAN ⟨PAN_2⟩" }] },
      { rawMessages: [{ role: "user", content: "PAN AAAPB1234B" }] },
    ];
    for (const v of variants) expect(responseCacheKey({ ...base, ...v })).not.toBe(k);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------- router wiring

const Out = z.object({ total: z.number() });

function world(opts: { scope?: (runId: string) => Promise<string | null>; answers?: unknown[]; cache?: boolean } = {}) {
  const calls: ProviderRequest[] = [];
  const answers = [...(opts.answers ?? [])];
  const claude: ModelProvider = {
    id: "claude",
    isAvailable: async () => true,
    async complete<T>(req: ProviderRequest) {
      calls.push(req);
      const output = answers.length ? answers.shift() : { total: 7 };
      return { output: { output, confidence: 0.9 } as T, model: req.model, tokensIn: 100, tokensOut: 10, latencyMs: 1 };
    },
  };
  const off: ModelProvider = { id: "local", isAvailable: async () => false, complete: async () => Promise.reject(new Error("off")) };
  const rows: ModelCallRow[] = [];
  const repo: ModelCallRepo = {
    record: async (r) => void rows.push(r),
    costInrSince: async () => 0,
    costInrForRun: async () => 0,
    ...(opts.scope ? { cacheScopeOf: opts.scope } : {}),
  };
  const cache = opts.cache === false ? undefined : createResponseCache();
  const router = createRouter({ providers: { claude, grok: { ...off, id: "grok" }, local: off }, repo, config: loadRouterConfig({}), cache });
  return { router, calls, rows, cache };
}

const req = (over: Partial<ModelRequest<{ total: number }>> = {}): ModelRequest<{ total: number }> => ({
  task: "gst.classify-ledgers",
  taskVersion: 1,
  privacy: "anonymize-then-cloud",
  difficulty: "judgement",
  schema: Out,
  runId: "run-1",
  messages: [{ role: "user", content: "Ledger: Diesel for staff car, PAN AAAPA1234A" }],
  ...over,
});

describe("router + response cache", () => {
  it("the same request twice in a run: one provider call, one ModelCall row; the reuse costs nothing", async () => {
    const w = world();
    const first = await w.router.run(req());
    const second = await w.router.run(req());
    expect(first).toMatchObject({ status: "ok", output: { total: 7 }, attempts: 1 });
    expect(second).toMatchObject({ status: "ok", output: { total: 7 }, attempts: 0, tokensIn: 0, tokensOut: 0, costInr: 0, provider: "claude", anonymized: true });
    expect(w.calls).toHaveLength(1);
    expect(w.rows).toHaveLength(1);
  });

  it("a re-run of the same job (scope job:…) reuses it; another job — another client — does not", async () => {
    const jobOf: Record<string, string> = { "run-1": "job-A", "run-2": "job-A", "run-3": "job-B" };
    const w = world({ scope: async (id) => `job:${jobOf[id]}` });
    await w.router.run(req({ runId: "run-1" }));
    await w.router.run(req({ runId: "run-2" }));
    expect(w.calls).toHaveLength(1);
    await w.router.run(req({ runId: "run-3" }));
    expect(w.calls).toHaveLength(2);
  });

  it("without a scope lookup (or when it fails) the cache is per run", async () => {
    const w = world();
    await w.router.run(req({ runId: "run-1" }));
    await w.router.run(req({ runId: "run-2" }));
    expect(w.calls).toHaveLength(2);
    const f = world({ scope: async () => Promise.reject(new Error("db down")) });
    await f.router.run(req({ runId: "run-1" }));
    await f.router.run(req({ runId: "run-1" }));
    await f.router.run(req({ runId: "run-9" }));
    expect(f.calls).toHaveLength(2);
  });

  it("anything that changes the request misses: text, raw values behind the same mask, version, agreement re-ask, tier, schema", async () => {
    const w = world();
    await w.router.run(req());
    await w.router.run(req({ messages: [{ role: "user", content: "Ledger: Diesel for staff car, PAN AAAPB9876B" }] })); // same masked text, other PAN
    await w.router.run(req({ taskVersion: 2 }));
    await w.router.run(req({ secondOpinion: true, forceTier: "HARD" }));
    await w.router.run(req({ schema: z.object({ total: z.number(), note: z.string().optional() }) }));
    expect(w.calls).toHaveLength(5);
  });

  it("a cached answer that no longer passes the request's validators is dropped and the provider is asked", async () => {
    const w = world({ answers: [{ total: 7 }, { total: 8 }] });
    await w.router.run(req());
    const res = await w.router.run(req({ contradictions: (o) => (o.total === 7 ? ["7 does not tie to the register"] : []) }));
    expect(res).toMatchObject({ status: "ok", output: { total: 8 } });
    expect(w.calls).toHaveLength(2);
    // Another schema is another key: the cached { total: 8 } is not served; the provider's answer
    // ({ total: 7 }) fails the stricter schema and the router escalates as usual.
    const strict = await w.router.run(req({ schema: z.object({ total: z.number().max(5) }) as never }));
    expect(strict.status).toBe("needs-review");
    expect(w.calls.length).toBeGreaterThan(2);
  });

  it("prismaModelCallRepo.cacheScopeOf: the AgentRun's JobTask, else null", async () => {
    const { prismaModelCallRepo } = await import("../db");
    const db = { modelCall: {}, agentRun: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "run-1" ? { jobTaskId: "job-A" } : null) } };
    const repo = prismaModelCallRepo(db as never);
    expect(await repo.cacheScopeOf!("run-1")).toBe("job:job-A");
    expect(await repo.cacheScopeOf!("comms-run")).toBeNull();
    expect(await prismaModelCallRepo({ modelCall: {} } as never).cacheScopeOf!("run-1")).toBeNull();
  });

  it("only 'ok' results are kept: a needs-review answer is asked again next time", async () => {
    const w = world({ answers: [{ wrong: 1 }, { wrong: 1 }, { total: 3 }] });
    const first = await w.router.run(req());
    expect(first.status).toBe("needs-review");
    const again = await w.router.run(req());
    expect(again).toMatchObject({ status: "ok", output: { total: 3 } });
    expect(w.calls).toHaveLength(3);
  });

  it("free-text requests (no schema) are cached as strings", async () => {
    const w = world({ answers: ["Dear client"] });
    const r1 = await w.router.run({ ...req(), schema: undefined } as ModelRequest<string>);
    const r2 = await w.router.run({ ...req(), schema: undefined } as ModelRequest<string>);
    expect(r1).toMatchObject({ status: "ok", output: "Dear client" });
    expect(r2).toMatchObject({ status: "ok", output: "Dear client", attempts: 0 });
    expect(w.calls).toHaveLength(1);
  });

  it("no cache dependency: every request calls the provider", async () => {
    const w = world({ cache: false });
    await w.router.run(req());
    await w.router.run(req());
    expect(w.calls).toHaveLength(2);
  });
});
