import { describe, expect, it, vi } from "vitest";
import { loadRouterConfig } from "../../config";
import { ProviderError, ProviderOutputError, ProviderUnavailableError } from "../../errors";
import type { ProviderRequest } from "../../types";
import { classifyGrokRetry, createGrokProvider, XAI_CHAT_URL } from "../grok";
import { createProviders } from "../index";
import { createLocalProvider } from "../local";

const req: ProviderRequest = {
  model: "grok-4",
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  jsonSchema: { type: "object", properties: { output: { type: "string" } } },
  maxTokens: 100,
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const completion = (content: string | null, extra: Record<string, unknown> = {}) =>
  json({ model: "grok-4", choices: [{ message: { content, ...extra }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 8 } });

function fakeFetch(...responses: (Response | Error)[]) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void url;
    void init;
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  });
}
const sleep = () => vi.fn(async () => {});

describe("grok provider", () => {
  it("is disabled without XAI_API_KEY", async () => {
    const p = createGrokProvider({ apiKey: "" });
    expect(await p.isAvailable()).toBe(false);
    await expect(p.complete(req)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("posts an OpenAI-compatible JSON-schema request and parses the reply", async () => {
    const f = fakeFetch(completion('{"output":"ok","confidence":0.9}'));
    let t = 0;
    const p = createGrokProvider({ apiKey: "test-xai", fetch: f as unknown as typeof fetch, now: () => (t += 10) });
    expect(await p.isAvailable()).toBe(true);
    const res = await p.complete(req);
    expect(res).toMatchObject({ output: { output: "ok", confidence: 0.9 }, tokensIn: 40, tokensOut: 8, model: "grok-4", latencyMs: 10 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(XAI_CHAT_URL);
    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBe(0);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.response_format.type).toBe("json_schema");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-xai");
  });

  it("omits the system message when absent and falls back to request model", async () => {
    const f = fakeFetch(json({ choices: [{ message: { content: '{"a":1}' } }] }));
    const res = await createGrokProvider({ apiKey: "k", fetch: f as unknown as typeof fetch }).complete({ ...req, system: undefined });
    expect(res.model).toBe("grok-4");
    expect(res.tokensIn).toBe(0);
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).messages).toHaveLength(1);
  });

  it("retries 5xx / network with backoff and honours Retry-After", async () => {
    const s = sleep();
    const f = fakeFetch(json({}, 503), new TypeError("fetch failed"), json({}, 429, { "retry-after": "3" }), completion('{"x":1}'));
    const res = await createGrokProvider({ apiKey: "k", fetch: f as unknown as typeof fetch, retry: { sleep: s } }).complete(req);
    expect(res.output).toEqual({ x: 1 });
    expect(s.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([500, 1000, 3000]);
  });

  it("maps HTTP failures to provider error kinds", async () => {
    const run = async (r: Response | Error): Promise<ProviderError> =>
      createGrokProvider({ apiKey: "k", fetch: fakeFetch(r, r, r, r) as unknown as typeof fetch, retry: { sleep: sleep() } })
        .complete(req)
        .then(() => {
          throw new Error("expected failure");
        })
        .catch((e) => e as ProviderError);
    expect((await run(json({}, 500))).kind).toBe("outage");
    expect((await run(json({}, 429))).kind).toBe("rate_limit");
    expect((await run(json({}, 401))).kind).toBe("auth");
    expect((await run(json({ error: "bad" }, 400))).kind).toBe("bad_request");
    expect((await run(new Error("down"))).kind).toBe("outage");
  });

  it("maps refusal, truncation and invalid JSON", async () => {
    const p = (r: Response) => createGrokProvider({ apiKey: "k", fetch: fakeFetch(r) as unknown as typeof fetch }).complete(req).catch((e) => e);
    expect((await p(completion(null, { refusal: "no" }))).kind).toBe("refusal");
    const trunc = json({ choices: [{ message: { content: "{" }, finish_reason: "length" }] });
    expect(await p(trunc)).toBeInstanceOf(ProviderOutputError);
    expect(await p(completion("nope"))).toBeInstanceOf(ProviderOutputError);
  });

  it("aborts a request that exceeds the timeout", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise<Response>((_, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
      );
      const pending = createGrokProvider({ apiKey: "k", fetch: f as unknown as typeof fetch, timeoutMs: 1000, retry: { retries: 0 } })
        .complete(req)
        .catch((e) => e);
      await vi.advanceTimersByTimeAsync(1001);
      const err = await pending;
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe("outage");
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies retryability", () => {
    expect(classifyGrokRetry(new Error("x"))).toEqual({ retry: false });
  });
});

describe("local provider (stub, fails closed)", () => {
  it("is unavailable when LOCAL_LLM_BASE_URL is empty and throws ProviderUnavailableError", async () => {
    const p = createLocalProvider({ baseUrl: "  " });
    expect(p.id).toBe("local");
    expect(await p.isAvailable()).toBe(false);
    await expect(p.complete(req)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
  it("still throws when a base URL is set (Phase 2b not wired)", async () => {
    const p = createLocalProvider({ baseUrl: "http://mac-mini.lan:11434" });
    expect(await p.isAvailable()).toBe(true);
    await expect(p.complete(req)).rejects.toThrow(/Phase 2b/);
  });
  it("defaults to unavailable", async () => {
    expect(await createLocalProvider().isAvailable()).toBe(false);
  });
});

describe("createProviders", () => {
  it("wires all three from config", async () => {
    const set = createProviders(loadRouterConfig({}));
    expect(Object.keys(set).sort()).toEqual(["claude", "grok", "local"]);
    expect(await set.claude.isAvailable()).toBe(false);
    expect(await set.grok.isAvailable()).toBe(false);
    expect(await set.local.isAvailable()).toBe(false);
  });
});
