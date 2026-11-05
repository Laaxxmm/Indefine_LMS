import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ProviderError, ProviderOutputError, ProviderUnavailableError } from "../../errors";
import type { ProviderRequest } from "../../types";
import { classifyRetry, createClaudeProvider, toProviderError, type ClaudeClientLike } from "../claude";

const req: ProviderRequest = {
  model: "claude-haiku-5-5",
  system: "You extract data.",
  messages: [{ role: "user", content: "Extract from ⟨PAN_1⟩" }],
  jsonSchema: {
    type: "object",
    properties: { output: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 } },
    required: ["output", "confidence"],
  },
  maxTokens: 512,
};

type CreateResult = Awaited<ReturnType<ClaudeClientLike["messages"]["create"]>>;
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: null } as unknown as Anthropic.Usage;
const ok = (text: string, stop: Anthropic.Message["stop_reason"] = "end_turn"): CreateResult => ({
  content: [{ type: "text", text, citations: null } as Anthropic.TextBlock],
  model: "claude-haiku-5-5",
  stop_reason: stop,
  usage,
});
const apiErr = (status: number, headers: Record<string, string> = {}) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "boom" } }, "boom", new Headers(headers));

function fakeClient(...results: (CreateResult | Error)[]) {
  const create = vi.fn(async () => {
    const next = results.shift();
    if (!next) throw new Error("no more fake results");
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { messages: { create } } as unknown as ClaudeClientLike, create };
}

const noSleep = () => vi.fn(async () => {});

describe("claude provider", () => {
  it("sends a JSON-schema structured-output request with no sampling params and reports usage", async () => {
    const { client, create } = fakeClient(ok('{"output":"x","confidence":0.9}'));
    let t = 1000;
    const p = createClaudeProvider({ client, timeoutMs: 5000, now: () => (t += 250) });
    const res = await p.complete<{ output: string; confidence: number }>(req);
    expect(res.output).toEqual({ output: "x", confidence: 0.9 });
    expect(res.tokensIn).toBe(105);
    expect(res.tokensOut).toBe(20);
    expect(res.latencyMs).toBe(250);
    const [params, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, { timeout: number }];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.max_tokens).toBe(512);
    expect(params.system).toBe("You extract data.");
    expect(params).not.toHaveProperty("temperature");
    const format = (params.output_config as { format: { type: string; schema: Record<string, unknown> } }).format;
    expect(format.type).toBe("json_schema");
    expect(format.schema.additionalProperties).toBe(false);
    expect(options.timeout).toBe(5000);
  });

  it("omits system when absent", async () => {
    const { client, create } = fakeClient(ok('{"output":"x","confidence":1}'));
    await createClaudeProvider({ client }).complete({ ...req, system: undefined });
    expect(create.mock.calls[0]).toBeDefined();
    expect((create.mock.calls[0] as unknown as [Record<string, unknown>])[0]).not.toHaveProperty("system");
  });

  it("retries overloaded (529) and 5xx with exponential backoff, then succeeds", async () => {
    const sleep = noSleep();
    const { client, create } = fakeClient(apiErr(529), apiErr(503), ok('{"output":"y","confidence":0.8}'));
    const res = await createClaudeProvider({ client, retry: { sleep } }).complete(req);
    expect(res.output).toEqual({ output: "y", confidence: 0.8 });
    expect(create).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([500, 1000]);
  });

  it("honours Retry-After on 429", async () => {
    const sleep = noSleep();
    const { client } = fakeClient(apiErr(429, { "retry-after": "2" }), ok('{"output":"y","confidence":0.8}'));
    await createClaudeProvider({ client, retry: { sleep } }).complete(req);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("surfaces an outage after retries are exhausted", async () => {
    const sleep = noSleep();
    const { client, create } = fakeClient(apiErr(500), apiErr(500), apiErr(500));
    const err = await createClaudeProvider({ client, retry: { sleep, retries: 2 } }).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("outage");
    expect(err.failoverable).toBe(true);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("treats connection errors as retryable outages", async () => {
    const { client } = fakeClient(
      new Anthropic.APIConnectionError({ message: "socket hang up" }),
      new Anthropic.APIConnectionTimeoutError({ message: "timed out" }),
    );
    const err = await createClaudeProvider({ client, retry: { sleep: noSleep(), retries: 1 } }).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("outage");
  });

  it("does not retry 400 / 401", async () => {
    const a = fakeClient(apiErr(400));
    const e400 = await createClaudeProvider({ client: a.client, retry: { sleep: noSleep() } }).complete(req).catch((e) => e);
    expect(e400.kind).toBe("bad_request");
    expect(e400.failoverable).toBe(false);
    expect(a.create).toHaveBeenCalledTimes(1);
    const b = fakeClient(apiErr(401));
    const e401 = await createClaudeProvider({ client: b.client, retry: { sleep: noSleep() } }).complete(req).catch((e) => e);
    expect(e401.kind).toBe("auth");
  });

  it("maps refusal, truncation and bad JSON", async () => {
    const r = await createClaudeProvider({ client: fakeClient(ok("", "refusal")).client }).complete(req).catch((e) => e);
    expect(r).toBeInstanceOf(ProviderError);
    expect(r.kind).toBe("refusal");
    const m = await createClaudeProvider({ client: fakeClient(ok('{"out', "max_tokens")).client }).complete(req).catch((e) => e);
    expect(m).toBeInstanceOf(ProviderOutputError);
    const j = await createClaudeProvider({ client: fakeClient(ok("not json")).client }).complete(req).catch((e) => e);
    expect(j).toBeInstanceOf(ProviderOutputError);
    expect(j.tokensOut).toBe(20);
  });

  it("is unavailable without a key and fails closed", async () => {
    const p = createClaudeProvider({ apiKey: "" });
    expect(await p.isAvailable()).toBe(false);
    await expect(p.complete(req)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("is available with a key (builds a real SDK client lazily, no network here)", async () => {
    const p = createClaudeProvider({ apiKey: "test-key-not-real" });
    expect(await p.isAvailable()).toBe(true);
  });

  it("classifies errors", () => {
    expect(classifyRetry(new Error("x"))).toEqual({ retry: false });
    expect(classifyRetry(apiErr(408)).retry).toBe(true);
    expect(classifyRetry(apiErr(404)).retry).toBe(false);
    expect((toProviderError(apiErr(429)) as ProviderError).kind).toBe("rate_limit");
    expect((toProviderError(apiErr(504)) as ProviderError).kind).toBe("outage");
    expect((toProviderError(new Error("weird")) as ProviderError).kind).toBe("outage");
    const pe = new ProviderError("claude", "auth", "x");
    expect(toProviderError(pe)).toBe(pe);
  });
});
