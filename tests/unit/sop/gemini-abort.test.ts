// SOP review L1: callGemini takes the caller's AbortSignal, so an abandoned call stops at once:
// the request is aborted and its own 429 / 5xx retry wait ends, instead of running on to the 45 s
// timeout (and sending again). fetch is a fake; no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callGemini } from "@/lib/gemini";

let generateCalls = 0;
beforeEach(() => {
  generateCalls = 0;
  process.env.GEMINI_API_KEY = "<test key, not real>";
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/v1beta/models?")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
      generateCalls++;
      if (init?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return new Response("busy", { status: 503 }); // "high demand": callGemini waits 3 s and sends again
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

describe("callGemini with a signal", () => {
  it("an abort during the wait between its own retries stops it: no second request", async () => {
    const abandon = new AbortController();
    const out = callGemini("Match the bank statement with the ledger.", undefined, { dictionary: [], signal: abandon.signal });
    const check = expect(out).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(generateCalls).toBe(1);
    abandon.abort();
    await check;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(generateCalls).toBe(1);
  });

  it("without a signal it still retries a busy model (unchanged)", async () => {
    const out = callGemini("Match the bank statement with the ledger.", undefined, { dictionary: [] });
    const check = expect(out).rejects.toThrow(/503/);
    await vi.advanceTimersByTimeAsync(14_000);
    await check;
    expect(generateCalls).toBe(3);
  });
});
