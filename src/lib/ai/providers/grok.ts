// Grok (xAI) provider — secondary cloud provider for escalation and Claude-outage failover.
// xAI has no SDK in this repo; its API is OpenAI-compatible, so this is a plain fetch against
// /v1/chat/completions with a JSON-schema response_format. Disabled when XAI_API_KEY is empty.
// Receives the same masked request as Claude — the anonymizer runs in the router, not here.
import { ProviderError, ProviderOutputError, ProviderUnavailableError } from "../errors";
import { DEFAULT_RETRY, parseRetryAfter, withRetry, type RetryOptions } from "../retry";
import type { ModelProvider, ProviderRequest, ProviderResult } from "../types";

export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";

export interface GrokProviderOptions {
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  now?: () => number;
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null,
    body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}
class NetworkError extends Error {}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createGrokProvider(opts: GrokProviderOptions = {}): ModelProvider {
  const apiKey = opts.apiKey ?? "";
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retry: RetryOptions = { ...DEFAULT_RETRY, ...opts.retry };
  const now = opts.now ?? Date.now;

  async function once(body: string): Promise<ChatCompletion> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(XAI_CHAT_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body,
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new HttpStatusError(res.status, res.headers.get("retry-after"), await res.text().catch(() => ""));
    }
    return (await res.json()) as ChatCompletion;
  }

  return {
    id: "grok",
    async isAvailable() {
      return apiKey.length > 0;
    },
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      if (!apiKey) throw new ProviderUnavailableError("grok", "XAI_API_KEY is not set; Grok is disabled.");
      const messages = [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        ...req.messages,
      ];
      const body = JSON.stringify({
        model: req.model,
        messages,
        temperature: 0,
        max_tokens: req.maxTokens,
        response_format: { type: "json_schema", json_schema: { name: "router_output", schema: req.jsonSchema, strict: true } },
      });
      const started = now();
      let data: ChatCompletion;
      try {
        data = await withRetry(() => once(body), classifyGrokRetry, retry);
      } catch (err) {
        throw toGrokError(err);
      }
      const latencyMs = now() - started;
      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ?? 0;
      const choice = data.choices?.[0];
      if (choice?.message?.refusal) {
        throw new ProviderError("grok", "refusal", "Grok declined this request.");
      }
      if (choice?.finish_reason === "length") {
        throw new ProviderOutputError("grok", "Grok output was cut off at max_tokens.", tokensIn, tokensOut);
      }
      let output: T;
      try {
        output = JSON.parse(choice?.message?.content ?? "") as T;
      } catch {
        throw new ProviderOutputError("grok", "Grok did not return valid JSON.", tokensIn, tokensOut);
      }
      return { output, model: data.model ?? req.model, tokensIn, tokensOut, latencyMs };
    },
  };
}

export function classifyGrokRetry(err: unknown): { retry: boolean; retryAfterMs?: number } {
  if (err instanceof NetworkError) return { retry: true };
  if (err instanceof HttpStatusError && (err.status === 429 || err.status === 408 || err.status >= 500)) {
    return { retry: true, retryAfterMs: parseRetryAfter(err.retryAfter) };
  }
  return { retry: false };
}

function toGrokError(err: unknown): Error {
  if (err instanceof NetworkError) return new ProviderError("grok", "outage", `Grok unreachable: ${err.message}`);
  if (err instanceof HttpStatusError) {
    const s = err.status;
    if (s === 429) return new ProviderError("grok", "rate_limit", "Grok rate limited (429).", s);
    if (s === 401 || s === 403) return new ProviderError("grok", "auth", `Grok rejected the credentials (${s}).`, s);
    if (s >= 500 || s === 408) return new ProviderError("grok", "outage", `Grok unavailable (${s}).`, s);
    return new ProviderError("grok", "bad_request", `Grok rejected the request: ${err.message}`, s);
  }
  return new ProviderError("grok", "outage", `Grok call failed: ${err instanceof Error ? err.message : String(err)}`);
}
