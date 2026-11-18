// Claude provider — the ONLY place in the codebase that imports @anthropic-ai/sdk (with the
// other providers/ files, enforced by verify:ai-boundary). It receives an already-masked
// request from the router and never sees raw client PII.
//
// Structured output: `output_config.format` (JSON schema), the current Messages API way to get
// schema-constrained JSON. Forced tool_choice is rejected by the current Opus/Sonnet models, so
// tool use is not used for this.
//
// Determinism: the spec asks for temperature 0, but the SDK installed here (1.5.0) sends
// anthropic-version 2026-10-21, on which `temperature`/`top_p`/`top_k` return HTTP 400 on every
// model (and the current models accept only the defaults anyway). We therefore send no sampling
// parameters; determinism comes from the JSON schema constraint plus the router's validation.
import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { ProviderError, ProviderOutputError, ProviderUnavailableError } from "../errors";
import { DEFAULT_RETRY, parseRetryAfter, withRetry, type RetryOptions } from "../retry";
import type { ModelProvider, ProviderRequest, ProviderResult } from "../types";

/** The slice of the SDK client this provider uses — tests pass a fake with the same shape. */
export interface ClaudeClientLike {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): PromiseLike<Pick<Anthropic.Message, "content" | "model" | "stop_reason" | "usage">>;
  };
}

export interface ClaudeProviderOptions {
  apiKey?: string;
  /** Injected client (tests). When absent one is built from apiKey with SDK retries off. */
  client?: ClaudeClientLike;
  /** Per-attempt timeout in ms (default 60 s). */
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  now?: () => number;
}

export function createClaudeProvider(opts: ClaudeProviderOptions = {}): ModelProvider {
  const apiKey = opts.apiKey ?? "";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retry: RetryOptions = { ...DEFAULT_RETRY, ...opts.retry };
  const now = opts.now ?? Date.now;
  let client: ClaudeClientLike | undefined = opts.client;

  function getClient(): ClaudeClientLike {
    if (!client) {
      if (!apiKey) throw new ProviderUnavailableError("claude", "ANTHROPIC_API_KEY is not set.");
      // Our own retry loop below (deterministic, observable) replaces the SDK's.
      client = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs });
    }
    return client;
  }

  return {
    id: "claude",
    async isAvailable() {
      return Boolean(opts.client) || apiKey.length > 0;
    },
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      const c = getClient();
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: req.model,
        max_tokens: req.maxTokens,
        messages: req.messages,
        ...(req.system ? { system: req.system } : {}),
        output_config: { format: { type: "json_schema", schema: transformJSONSchema(req.jsonSchema) } },
      };
      const started = now();
      let res: Awaited<ReturnType<ClaudeClientLike["messages"]["create"]>>;
      try {
        res = await withRetry(() => Promise.resolve(c.messages.create(params, { timeout: timeoutMs })), classifyRetry, retry);
      } catch (err) {
        throw toProviderError(err);
      }
      const latencyMs = now() - started;
      const usage = res.usage;
      const tokensIn = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
      const tokensOut = usage?.output_tokens ?? 0;

      if (res.stop_reason === "refusal") {
        throw new ProviderError("claude", "refusal", "Claude declined this request (stop_reason: refusal).");
      }
      if (res.stop_reason === "max_tokens") {
        throw new ProviderOutputError("claude", "Claude output was cut off at max_tokens.", tokensIn, tokensOut);
      }
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      let output: T;
      try {
        output = JSON.parse(text) as T;
      } catch {
        throw new ProviderOutputError("claude", "Claude did not return valid JSON.", tokensIn, tokensOut);
      }
      return { output, model: res.model ?? req.model, tokensIn, tokensOut, latencyMs };
    },
  };
}

function status(err: unknown): number | undefined {
  return err instanceof Anthropic.APIError && typeof err.status === "number" ? err.status : undefined;
}

/** 429, 5xx (incl. 529 overloaded) and connection/timeout errors are worth retrying. */
export function classifyRetry(err: unknown): { retry: boolean; retryAfterMs?: number } {
  if (err instanceof Anthropic.APIConnectionError) return { retry: true };
  const s = status(err);
  if (s === undefined) return { retry: false };
  if (s === 429 || s === 408 || s >= 500) {
    const headers = (err as InstanceType<typeof Anthropic.APIError>).headers;
    return { retry: true, retryAfterMs: parseRetryAfter(headers?.get?.("retry-after")) };
  }
  return { retry: false };
}

export function toProviderError(err: unknown): Error {
  if (err instanceof ProviderUnavailableError || err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError("claude", "outage", `Claude unreachable: ${err.message}`);
  }
  const s = status(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (s === undefined) return new ProviderError("claude", "outage", `Claude call failed: ${msg}`);
  if (s === 429) return new ProviderError("claude", "rate_limit", `Claude rate limited (429): ${msg}`, s);
  if (s === 401 || s === 403) return new ProviderError("claude", "auth", `Claude rejected the credentials (${s}).`, s);
  if (s >= 500 || s === 408) return new ProviderError("claude", "outage", `Claude unavailable (${s}): ${msg}`, s);
  return new ProviderError("claude", "bad_request", `Claude rejected the request (${s}): ${msg}`, s);
}
