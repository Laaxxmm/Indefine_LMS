// Local open-weight provider — a STUB that fails closed this week (orchestrator "MODEL USE").
// isAvailable() is false while LOCAL_LLM_BASE_URL is empty; complete() always throws
// ProviderUnavailableError. The router treats that as "local is down": non-PII tasks fall back
// to the cheapest anonymized cloud tier, `privacy: 'local-only'` tasks are queued for a human.
// Phase 2b replaces complete() with an OpenAI-compatible client (JSON mode, 60 s timeout,
// retry 1) — no file outside src/lib/ai/providers/ and config should need to change.
import { ProviderUnavailableError } from "../errors";
import type { ModelProvider, ProviderRequest, ProviderResult } from "../types";

export interface LocalProviderOptions {
  baseUrl?: string;
}

export function createLocalProvider(opts: LocalProviderOptions = {}): ModelProvider {
  const baseUrl = (opts.baseUrl ?? "").trim();
  return {
    id: "local",
    async isAvailable() {
      return baseUrl.length > 0;
    },
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      void req;
      throw new ProviderUnavailableError(
        "local",
        baseUrl
          ? "Local open-weight provider is not wired yet (Phase 2b); failing closed."
          : "LOCAL_LLM_BASE_URL is empty; local open-weight provider is unavailable.",
      );
    },
  };
}
