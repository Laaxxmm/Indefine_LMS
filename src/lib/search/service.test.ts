// search(): classification → identifier lookup / exact-only / providers; grouping, caps, type
// filter, the types a person may search, and plain messages.
import { beforeEach, describe, expect, it } from "vitest";
import { IDS, PEOPLE, searchWorld, type SearchWorld } from "../../../tests/fakes/search-world";
import type { SearchDeps } from "./db";
import { memoryRateLimiter } from "./rate-limit";
import { search, searchableTypes } from "./service";
import type { SearchResponse } from "./types";

let w: SearchWorld;
let deps: SearchDeps;
beforeEach(() => {
  w = searchWorld();
  deps = { db: w.db, limiter: memoryRateLimiter(), clPaths: false, now: () => new Date("2026-11-05T10:00:00Z") };
});

async function ok(...args: Parameters<typeof search>): Promise<SearchResponse> {
  const r = await search(...args);
  if (!r.ok) throw new Error(`expected ok, got ${r.status}: ${r.error}`);
  return r.data;
}

describe("refusals", () => {
  it("signed out, inactive, too short", async () => {
    expect(await search(null, { q: "acme" }, deps)).toEqual({ ok: false, status: 401, error: "Sign in to search." });
    expect(await search(PEOPLE.gone, { q: "acme" }, deps)).toMatchObject({ ok: false, status: 403, error: "Your account is not active, so search is not available. Ask an admin to reactivate it." });
    expect(await search(PEOPLE.priya, { q: "a" }, deps)).toEqual({ ok: false, status: 400, error: "Type at least 2 characters to search." });
  });

  it("rate-limited identifier searches are refused with the plain message", async () => {
    deps.limiter = memoryRateLimiter({ limit: 1, windowMs: 60_000 });
    expect((await search(PEOPLE.priya, { q: IDS.acmePan }, deps)).ok).toBe(true);
    const r = await search(PEOPLE.priya, { q: IDS.acmePan }, deps);
    expect(r).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 60 });
    expect(r.ok === false && r.error).toMatch(/^You have searched by PAN/);
  });
});

describe("text search", () => {
  it("groups by type, best-ranked group first, each hit with label, context and link", async () => {
    const r = await ok(PEOPLE.manager, { q: "ACME01" }, deps);
    expect(r.mode).toBe("text");
    expect(r.groups[0]).toMatchObject({ type: "client", label: "Clients" });
    expect(r.groups[0].hits[0]).toMatchObject({ id: "c-acme", rank: 0, href: "/clients/c-acme" });
    expect(r.groups.map((g) => g.type)).toEqual(expect.arrayContaining(["job", "run", "deliverable", "draft", "client-job"]));
    expect(r.total).toBe(r.groups.reduce((n, g) => n + g.hits.length, 0));
    expect(r.message).toBeNull();
  });

  it("staff see only what they may open; the type list matches", async () => {
    const r = await ok(PEOPLE.priya, { q: "acme" }, deps);
    const byType = Object.fromEntries(r.groups.map((g) => [g.type, g.hits.map((h) => h.id)]));
    expect(byType.job).toEqual(["job-acme-gst"]);
    expect(byType.run).toEqual(["run-gst-2", "run-gst-1"]);
    expect(byType.draft).toEqual(["draft-chase"]);
    expect(byType.onboarding).toBeUndefined();
    expect(r.types).toEqual(["client", "job", "run", "deliverable", "draft", "client-job", "document"]);
    expect(searchableTypes(PEOPLE.manager)).toContain("onboarding");
    expect(searchableTypes(PEOPLE.gone)).toEqual([]);
  });

  it("a type filter returns that group only, up to 25", async () => {
    const r = await ok(PEOPLE.admin, { q: "acme", type: "client" }, deps);
    expect(r.groups.map((g) => g.type)).toEqual(["client"]);
    expect(r.groups[0].hits.map((h) => h.id)).toEqual(["c-acme", "c-acmeold"]);
  });

  it("a type the person may not search says so", async () => {
    const r = await ok(PEOPLE.priya, { q: "zenith", type: "onboarding" }, deps);
    expect(r.groups).toEqual([]);
    expect(r.message).toBe("You do not have access to onboarding. Search all types instead.");
  });

  it("caps each type at 10 and the whole answer at 50, flagging more", async () => {
    w.seed(
      "client",
      Array.from({ length: 30 }, (_, i) => ({ id: `c-bulk-${i}`, name: `Bulk Client ${String(i).padStart(2, "0")}`, folderName: `Bulk ${i}`, entityType: "OTHER", city: null, active: true, updatedAt: new Date(Date.UTC(2026, 0, 1 + i)) })),
    );
    const all = await ok(PEOPLE.admin, { q: "bulk" }, deps);
    expect(all.groups[0].hits).toHaveLength(10);
    expect(all.groups[0].more).toBe(true);
    expect(all.groups[0].hits[0].id).toBe("c-bulk-29"); // most recent first on equal rank
    const one = await ok(PEOPLE.admin, { q: "bulk", type: "client" }, deps);
    expect(one.groups[0].hits).toHaveLength(25);
  });
});

describe("identifiers in the search box", () => {
  it("a full PAN is an exact, masked, audited lookup", async () => {
    const r = await ok(PEOPLE.priya, { q: IDS.acmePan }, deps);
    expect(r).toMatchObject({ query: "XXXXXX234F", mode: "identifier", identifier: { kind: "pan", masked: "XXXXXX234F" }, total: 1, message: null });
    expect(r.groups[0].hits[0]).toMatchObject({ id: "c-acme", matched: "PAN XXXXXX234F" });
    expect(JSON.stringify(r)).not.toContain(IDS.acmePan);
    expect(w.tables.auditEvent).toHaveLength(1);
  });

  it("no match says so plainly", async () => {
    const r = await ok(PEOPLE.priya, { q: "ZZZZZ9999Z" }, deps);
    expect(r.total).toBe(0);
    expect(r.message).toBe("Nothing you can open has this PAN. Check it and try again, or search by the client's name or code.");
  });

  it("an identifier with a type that holds none explains where it can look, without logging a search", async () => {
    const r = await ok(PEOPLE.priya, { q: IDS.acmePan, type: "run" }, deps);
    expect(r.groups).toEqual([]);
    expect(r.message).toBe("Search by PAN, GSTIN, phone or email finds clients only. Search all types instead.");
    expect(w.tables.auditEvent).toHaveLength(0);
    const m = await ok(PEOPLE.manager, { q: IDS.acmePan, type: "run" }, deps);
    expect(m.message).toContain("finds clients and onboarding records only");
  });

  it("part of a PAN finds nothing (codes only) and says what to type; not logged", async () => {
    const r = await ok(PEOPLE.admin, { q: IDS.acmePan.slice(0, 7) }, deps);
    expect(r).toMatchObject({ query: "", mode: "partial", total: 0, message: "Search by PAN needs the full 10-character PAN." });
    expect(w.tables.auditEvent).toHaveLength(0);
    const clientCalls = w.calls.filter((c) => c.model === "client");
    for (const c of clientCalls) expect(JSON.stringify(c.args)).not.toMatch(/contains/);
  });

  it("part of a PAN that equals a client code still finds that client", async () => {
    w.seed("client", [{ id: "c-codey", name: "Code Shaped Pvt Ltd", folderName: "Code Shaped", entityType: "PVT_LTD", city: null, active: true, updatedAt: new Date("2026-10-01T00:00:00Z") }]);
    w.seed("firmClient", [{ id: "fc-codey", lmsClientId: "c-codey", clientCode: "CODES01" }]);
    const r = await ok(PEOPLE.admin, { q: "codes01" }, deps);
    expect(r.mode).toBe("partial");
    expect(r.groups[0].hits.map((h) => h.id)).toEqual(["c-codey"]);
    expect(r.message).toBeNull();
  });

  it("an Aadhaar number is refused with a sentence and nothing is searched", async () => {
    const r = await ok(PEOPLE.admin, { q: "1234 5678 9012" }, deps);
    expect(r).toMatchObject({ mode: "unsupported", total: 0 });
    expect(r.message).toMatch(/does not keep Aadhaar numbers/);
    expect(w.calls).toEqual([]);
  });
});
