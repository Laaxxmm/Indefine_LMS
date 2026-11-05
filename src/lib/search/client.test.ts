// requestSearch: text goes as GET with the query in the URL; identifiers (or parts of them) go as a
// POST body and never appear in a URL; failures become sentences.
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSearch } from "./client";

type Init = { method?: string; body?: string } | undefined;
const calls: Array<{ url: string; init: Init }> = [];

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: Init) => {
      calls.push({ url, init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("requestSearch", () => {
  it("text: GET with q and type in the URL", async () => {
    mockFetch(200, { query: "acme", groups: [] });
    const r = await requestSearch("acme traders", "client");
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("/api/firm-os/search?q=acme+traders&type=client");
    expect(calls[0].init?.method).toBeUndefined();
  });

  it("PAN, phone, email and parts of them: POST body, nothing in the URL", async () => {
    mockFetch(200, { query: "XXXXXX234F", groups: [] });
    for (const q of ["AAACA1234F", "98765 43210", "ravi@acme.example", "AAACA12"]) {
      await requestSearch(q, null);
      const last = calls[calls.length - 1];
      expect(last.url).toBe("/api/firm-os/search");
      expect(last.init?.method).toBe("POST");
      expect(JSON.parse(last.init?.body ?? "{}")).toEqual({ q, type: null });
    }
  });

  it("server sentences pass through; anything else becomes a plain sentence", async () => {
    mockFetch(429, { error: "Wait 2 minutes and try again." });
    expect(await requestSearch("AAACA1234F", null)).toEqual({ ok: false, error: "Wait 2 minutes and try again." });
    mockFetch(502, "<html>Bad gateway</html>");
    expect(await requestSearch("acme", null)).toEqual({ ok: false, error: "Search did not work this time. Try again in a minute." });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await requestSearch("acme", null)).toEqual({ ok: false, error: "Search could not reach the server. Check your connection and try again." });
  });

  it("an aborted request is reported as aborted, not as an error to show", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    expect(await requestSearch("acme", null)).toEqual({ ok: false, error: "", aborted: true });
  });
});
