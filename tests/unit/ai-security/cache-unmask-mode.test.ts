// Re-audit NEW-10 (LOW): the response cache key ignored the request's unmask mode, so an answer
// unmasked under "all" (every placeholder restored) was served from cache to a "grounded" request
// in the same scope — which would have kept a non-grounded placeholder masked. Ported from the
// re-audit PoC ai-unmask-cache-errors.test.ts part (2), "GAP". Synthetic values; fake provider.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createResponseCache } from "@/lib/ai/cache";
import { loadRouterConfig } from "@/lib/ai/config";
import { createRouter, type ModelCallRepo } from "@/lib/ai/router";
import type { ModelProvider, ProviderRequest, ProviderResult } from "@/lib/ai/types";

const PAN = "ABCDE1234F";
function setup() {
  const calls: ProviderRequest[] = [];
  const claude: ModelProvider = {
    id: "claude",
    isAvailable: async () => true,
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      calls.push(req);
      return { output: { output: { v: "note ⟨PAN_1⟩ end" }, confidence: 1 } as T, model: req.model, tokensIn: 1, tokensOut: 1, latencyMs: 1 };
    },
  };
  const off = (id: "grok" | "local"): ModelProvider => ({ id, isAvailable: async () => false, complete: async () => Promise.reject(new Error("off")) });
  const repo: ModelCallRepo = { record: async () => {}, costInrSince: async () => 0, costInrForRun: async () => 0, cacheScopeOf: async () => "job:J1" };
  const router = createRouter({ providers: { claude, grok: off("grok"), local: off("local") }, repo, config: loadRouterConfig({ AI_DAILY_BUDGET_INR: "0" }), cache: createResponseCache() });
  return { router, calls };
}
const req = (runId: string, unmask: "all" | "grounded" | "findings") => ({
  task: "gst.x" as const,
  privacy: "anonymize-then-cloud" as const,
  difficulty: "sop" as const,
  runId,
  schema: z.object({ v: z.string() }),
  unmask,
  messages: [{ role: "user" as const, content: `PAN ${PAN} for review` }],
});

describe("NEW-10: the response cache key includes the unmask mode", () => {
  it("PoC: an 'all'-unmasked answer is not served to a 'grounded' request in the same scope", async () => {
    const t = setup();
    const all = await t.router.run(req("run-A", "all"));
    const grounded = await t.router.run(req("run-B", "grounded"));
    expect(all.status === "ok" && all.output.v).toBe(`note ${PAN} end`);
    expect(t.calls).toHaveLength(2); // a separate call, not a cache hit
    expect(grounded.status === "ok" && grounded.output.v).toBe("note ⟨PAN_1⟩ end"); // "note ABCDE1234F end" is not in the documents
  });

  it("the same mode in the same scope is still a cache hit", async () => {
    const t = setup();
    await t.router.run(req("run-A", "grounded"));
    await t.router.run(req("run-B", "grounded"));
    expect(t.calls).toHaveLength(1);
    await t.router.run(req("run-C", "findings"));
    expect(t.calls).toHaveLength(2);
  });
});
