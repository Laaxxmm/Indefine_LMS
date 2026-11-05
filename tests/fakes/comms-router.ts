// A real ModelRouter (src/lib/ai/router.ts createRouter) over a scripted Claude provider, for the
// comms drafting tests: the anonymizer, schema validation, contradictions and escalation all run
// for real; only the provider's answers are scripted. `calls` is exactly what left the building.
import { loadRouterConfig } from "@/lib/ai/config";
import { NoProviderAvailableError } from "@/lib/ai/errors";
import { createRouter, type ModelCallRepo, type ModelCallRow } from "@/lib/ai/router";
import type { ModelProvider, ProviderId, ProviderRequest } from "@/lib/ai/types";

/** A scripted answer: the model's `output` (wrapped with a confidence), a function of the masked request, or an Error to throw. */
export type Step = unknown | Error | ((req: ProviderRequest, input: Record<string, unknown>) => unknown);

const off = (id: ProviderId): ModelProvider => ({
  id,
  isAvailable: async () => false,
  complete: async () => {
    throw new NoProviderAvailableError(`${id} off`);
  },
});

export function scriptedRouter(steps: Step[], opts: { available?: boolean; confidence?: number } = {}) {
  const calls: ProviderRequest[] = [];
  const rows: ModelCallRow[] = [];
  const queue = [...steps];
  const claude: ModelProvider = {
    id: "claude",
    isAvailable: async () => opts.available ?? true,
    async complete<T>(req: ProviderRequest) {
      calls.push(req);
      const step = queue.shift();
      if (step === undefined) throw new Error("comms test router: no scripted step left");
      if (step instanceof Error) throw step;
      const input = JSON.parse(req.messages[0].content) as Record<string, unknown>;
      const output = typeof step === "function" ? (step as (r: ProviderRequest, i: Record<string, unknown>) => unknown)(req, input) : step;
      return { output: { output, confidence: opts.confidence ?? 0.95 } as T, model: req.model, tokensIn: 400, tokensOut: 200, latencyMs: 5 };
    },
  };
  const repo: ModelCallRepo = {
    record: async (r) => void rows.push(r),
    costInrSince: async () => 0,
    costInrForRun: async () => 0,
  };
  const router = createRouter({
    providers: { claude, grok: off("grok"), local: off("local") },
    repo,
    config: loadRouterConfig({}), // providers are injected; no key is read
    now: () => new Date("2026-11-05T06:00:00Z"),
  });
  return { router, calls, rows, remaining: () => queue.length };
}

/** Everything the provider was sent, as one string (system prompt + messages), for leak checks. */
export const sentText = (calls: ProviderRequest[]) => calls.map((c) => `${c.system ?? ""}\n${c.messages.map((m) => m.content).join("\n")}`).join("\n");
