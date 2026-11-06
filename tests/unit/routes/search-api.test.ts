// /api/firm-os/search: auth (401 / 403) → zod (400) → search() → JSON, against the in-memory world.
// GET refuses identifiers (they stay out of URLs); POST takes them. Messages are plain sentences.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// These routes sit behind the Firm OS master switch (src/lib/workspace/flag.ts); it is on for these tests.
beforeEach(() => vi.stubEnv("FIRM_OS_ENABLED", "1"));
import type { Session } from "next-auth";
import { IDS, PEOPLE, searchWorld, type SearchWorld } from "../../fakes/search-world";
import { memoryRateLimiter, type SearchRateLimiter } from "@/lib/search/rate-limit";

const state = vi.hoisted(() => ({ world: null as unknown as SearchWorld, limiter: null as unknown as SearchRateLimiter, explode: false }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/search/defaults", () => ({
  defaultSearchDeps: () => {
    if (state.explode) throw Object.assign(new Error(`Invalid prisma.client.findMany() where pan = ${"AAACA1234F"}`), { code: "P2010" });
    return { db: state.world.db, limiter: state.limiter, clPaths: false, now: () => new Date("2026-11-05T10:00:00Z") };
  },
}));

const { auth } = await import("@/lib/auth");
const route = await import("@/app/api/firm-os/search/route");

const as = (u: Session["user"] | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? { user: u, expires: "2099-01-01" } : null);
const get = (qs: string) => route.GET(new Request(`http://x/api/firm-os/search${qs}`));
const post = (body: unknown) => route.POST(new Request("http://x/api/firm-os/search", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const NO_CODES = /\b[45]\d\d\b|P\d{4}|[A-Z]+_[A-Z]+/;

beforeEach(() => {
  state.world = searchWorld();
  state.limiter = memoryRateLimiter();
  state.explode = false;
});
afterEach(() => vi.clearAllMocks());

describe("auth", () => {
  it("401 when signed out, 403 when deactivated, with sentences", async () => {
    as(null);
    for (const r of [await get("?q=acme"), await post({ q: "acme" })]) {
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "Sign in to search." });
    }
    as(PEOPLE.gone);
    const r = await get("?q=acme");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("Your account is not active, so search is not available. Ask an admin to reactivate it.");
  });
});

describe("validation", () => {
  it("400 for a missing, short or long query and an unknown type", async () => {
    as(PEOPLE.priya);
    for (const [r, msg] of [
      [await get(""), "Type at least 2 characters to search."],
      [await get("?q=%20a%20"), "Type at least 2 characters to search."],
      [await get(`?q=${"x".repeat(101)}`), "Searches can be up to 100 characters. Shorten the search and try again."],
      [await get("?q=acme&type=invoices"), "Pick one of the listed types, or search all types."],
      [await post("not json"), "Type at least 2 characters to search."],
      [await post({ q: 42 }), "Type at least 2 characters to search."],
    ] as const) {
      expect(r.status).toBe(400);
      const body = await r.json();
      expect(body.error).toBe(msg);
      expect(body.error).not.toMatch(NO_CODES);
    }
  });

  it("GET refuses a PAN, phone or email (or part of one); nothing is searched", async () => {
    as(PEOPLE.priya);
    for (const q of [IDS.acmePan, encodeURIComponent(IDS.acmeEmail), IDS.acmePhone, "AAACA12"]) {
      const r = await get(`?q=${q}`);
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("Searches by PAN, GSTIN, phone or email cannot be sent in a web address. Type the full value in the search box and press Enter.");
    }
    expect(state.world.calls).toEqual([]);
    expect(state.world.tables.auditEvent).toEqual([]);
  });
});

describe("search", () => {
  it("GET text: grouped results the person may open, never cached", async () => {
    as(PEOPLE.priya);
    const r = await get("?q=acme");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const body = await r.json();
    expect(body.mode).toBe("text");
    const jobs = body.groups.find((g: { type: string }) => g.type === "job");
    expect(jobs.hits.map((h: { id: string }) => h.id)).toEqual(["job-acme-gst"]);
    expect(body.types).not.toContain("onboarding");
  });

  it("GET with a type returns that group only", async () => {
    as(PEOPLE.manager);
    const body = await (await get("?q=zenith&type=onboarding")).json();
    expect(body.groups.map((g: { type: string }) => g.type)).toEqual(["onboarding"]);
  });

  it("POST identifier: exact, masked, audited", async () => {
    as(PEOPLE.priya);
    const r = await post({ q: IDS.acmePan, type: null });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(IDS.acmePan);
    expect(JSON.parse(text)).toMatchObject({ mode: "identifier", query: "XXXXXX234F", total: 1 });
    expect(state.world.tables.auditEvent).toHaveLength(1);
  });

  it("429 with Retry-After and a sentence when rate-limited", async () => {
    as(PEOPLE.priya);
    state.limiter = memoryRateLimiter({ limit: 1, windowMs: 120_000 });
    expect((await post({ q: IDS.acmePan })).status).toBe(200);
    const r = await post({ q: IDS.acmePhone });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("120");
    const { error } = await r.json();
    expect(error).toBe("You have searched by PAN, GSTIN, phone or email too many times in a short while. Wait 2 minutes and try again, or search by the client's name or code.");
  });

  it("500 with a plain sentence when the database fails; the log carries no query", async () => {
    as(PEOPLE.priya);
    state.explode = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await post({ q: IDS.acmePan });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Search is not available right now. Try again in a minute." });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(IDS.acmePan);
  });
});
