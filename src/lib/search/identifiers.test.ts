// findByIdentifier: exact only, masked results, an AuditEvent per lookup with the hash (never the
// identifier), a per-person rate limit with a plain message, fail-closed when audit cannot be written.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS, PEOPLE, searchWorld, type SearchWorld } from "../../../tests/fakes/search-world";
import type { SearchDeps } from "./db";
import { AUDIT_ACTION, AUDIT_ENTITY, findByIdentifier, hashIdentifier, identifierHash } from "./identifiers";
import { IDENTIFIER_SEARCH_LIMIT, memoryRateLimiter, rateLimitMessage, type SearchRateLimiter } from "./rate-limit";

let w: SearchWorld;
let clock: Date;
let deps: SearchDeps;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const audits = () => w.tables.auditEvent as Array<{ actorId: string; action: string; entity: string; entityId: string | null; meta: Record<string, unknown> }>;

beforeEach(() => {
  w = searchWorld();
  clock = new Date("2026-11-05T10:00:00Z");
  deps = { db: w.db, limiter: memoryRateLimiter(), clPaths: false, now: () => clock };
});

describe("exact match only", () => {
  it("a full PAN finds the client, masked", async () => {
    const r = await findByIdentifier(PEOPLE.priya, ` ${IDS.acmePan.toLowerCase()} `, { deps });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ kind: "pan", masked: "XXXXXX234F", searchedTypes: ["client"] });
    expect(r.hits.map((h) => h.id)).toEqual(["c-acme"]);
    expect(r.hits[0]).toMatchObject({ type: "client", matched: "PAN XXXXXX234F", href: "/clients/c-acme", rank: 0, refs: { clientId: "c-acme", firmClientId: "fc-acme" } });
    expect(r.hits[0].context).toBe("Matched PAN XXXXXX234F · Client code ACME01 · Private limited · Chennai");
    expect(JSON.stringify(r)).not.toContain(IDS.acmePan);
  });

  it("a PAN also finds the proprietor whose GSTIN carries it", async () => {
    const r = await findByIdentifier(PEOPLE.priya, IDS.rameshPan, { deps });
    expect(r.ok && r.hits.map((h) => [h.id, h.matched])).toEqual([["c-ramesh", "PAN within GSTIN 29XXXXXXXXXM1Z2"]]);
  });

  it("a prefix of a PAN returns nothing and says what to type; nothing is searched or logged", async () => {
    for (const part of [IDS.acmePan.slice(0, 6), IDS.acmePan.slice(0, 9)]) {
      const r = await findByIdentifier(PEOPLE.admin, part, { deps });
      expect(r).toEqual({ ok: false, reason: "partial", message: "Search by PAN needs the full 10-character PAN." });
    }
    expect(w.calls.filter((c) => c.model === "client")).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("phone in any common format, GSTIN and email (case-insensitive) match exactly", async () => {
    const phone = await findByIdentifier(PEOPLE.arun, "+91 98765-43210", { deps });
    expect(phone.ok && phone.hits.map((h) => [h.id, h.matched])).toEqual([["c-acme", "phone XXXXXX3210"]]);
    const gstin = await findByIdentifier(PEOPLE.arun, IDS.acmeGstin, { deps });
    expect(gstin.ok && gstin.hits.map((h) => [h.id, h.matched])).toEqual([["c-acme", "GSTIN 33XXXXXXXXXF1Z5"]]);
    const email = await findByIdentifier(PEOPLE.arun, IDS.acmeEmail.toUpperCase(), { deps });
    expect(email.ok && email.hits.map((h) => [h.id, h.matched])).toEqual([["c-acme", "email r***@acme.example"]]);
    const none = await findByIdentifier(PEOPLE.arun, "9000000000", { deps });
    expect(none.ok && none.hits).toEqual([]);
  });

  it("text, Aadhaar and too-short input are refused with sentences", async () => {
    expect(await findByIdentifier(PEOPLE.arun, "Acme", { deps })).toMatchObject({ ok: false, reason: "invalid", message: "Enter a full PAN, GSTIN, 10-digit mobile number or email address." });
    expect(await findByIdentifier(PEOPLE.arun, "1234 5678 9012", { deps })).toMatchObject({ ok: false, reason: "unsupported" });
    expect(await findByIdentifier(PEOPLE.arun, "x", { deps })).toMatchObject({ ok: false, reason: "invalid", message: "Type at least 2 characters to search." });
  });
});

describe("visibility", () => {
  it("onboarding runs are found only by people who may open /onboard", async () => {
    const mgr = await findByIdentifier(PEOPLE.manager, IDS.zenPan, { deps });
    expect(mgr.ok && mgr.hits.map((h) => [h.type, h.id, h.matched])).toEqual([["onboarding", "ob-zen", "PAN XXXXXX111Q"]]);
    expect(mgr.ok && mgr.searchedTypes).toEqual(["client", "onboarding"]);
    const staff = await findByIdentifier(PEOPLE.priya, IDS.zenPan, { deps });
    expect(staff.ok && staff.hits).toEqual([]);
    expect(staff.ok && staff.searchedTypes).toEqual(["client"]);
    for (const q of [IDS.zenGstin, IDS.zenPhone, IDS.zenEmail]) {
      const r = await findByIdentifier(PEOPLE.partner, q, { deps });
      expect(r.ok && r.hits.map((h) => h.id), q).toEqual(["ob-zen"]);
    }
  });

  it("signed-out and inactive people get nothing and nothing is logged", async () => {
    expect(await findByIdentifier(null, IDS.acmePan, { deps })).toMatchObject({ ok: false, reason: "signed-out", message: "Sign in to search." });
    expect(await findByIdentifier(PEOPLE.gone, IDS.acmePan, { deps })).toMatchObject({ ok: false, reason: "inactive" });
    expect(audits()).toEqual([]);
  });

  it("types narrows the lookup", async () => {
    const r = await findByIdentifier(PEOPLE.manager, IDS.zenPan, { deps, types: ["client"] });
    expect(r.ok && r.searchedTypes).toEqual(["client"]);
    expect(r.ok && r.hits).toEqual([]);
  });
});

describe("audit", () => {
  it("every lookup writes who, the types, the count and the sha256 of the normalised identifier — never the identifier", async () => {
    await findByIdentifier(PEOPLE.manager, "+91 99887 76655", { deps, purpose: "privacy-request" });
    expect(audits()).toHaveLength(1);
    const [ev] = audits();
    expect(ev).toMatchObject({ actorId: "u-manager", action: AUDIT_ACTION, entity: AUDIT_ENTITY, entityId: null });
    expect(ev.meta).toEqual({ identifierKind: "phone", queryHash: sha(IDS.zenPhone), entityTypes: ["client", "onboarding"], resultCount: 1, outcome: "ok", purpose: "privacy-request" });
    const raw = JSON.stringify(ev);
    expect(raw).not.toContain(IDS.zenPhone);
    expect(raw).not.toContain("6655");
  });

  it("the hash is the same however the identifier was typed", () => {
    expect(hashIdentifier("aaaca 1234f")).toBe(sha(IDS.acmePan));
    expect(identifierHash({ kind: "email", value: IDS.acmeEmail })).toBe(hashIdentifier(IDS.acmeEmail.toUpperCase()));
    expect(hashIdentifier("acme")).toBeNull();
  });

  it("fails closed: if the audit cannot be written, no results are returned", async () => {
    w.failAudit = true;
    await expect(findByIdentifier(PEOPLE.priya, IDS.acmePan, { deps })).rejects.toThrow();
  });
});

describe("rate limit", () => {
  it("refuses after the limit with a plain message, logs the refusal, and recovers when the window passes", async () => {
    deps.limiter = memoryRateLimiter({ limit: 2, windowMs: 60_000 });
    expect((await findByIdentifier(PEOPLE.priya, IDS.acmePan, { deps })).ok).toBe(true);
    expect((await findByIdentifier(PEOPLE.priya, IDS.acmePhone, { deps })).ok).toBe(true);
    const third = await findByIdentifier(PEOPLE.priya, IDS.acmeEmail, { deps });
    expect(third).toMatchObject({ ok: false, reason: "rate-limited", retryAfterSeconds: 60 });
    if (third.ok) return;
    expect(third.message).toBe("You have searched by PAN, GSTIN, phone or email too many times in a short while. Wait 1 minute and try again, or search by the client's name or code.");
    expect(audits().map((a) => a.meta.outcome)).toEqual(["ok", "ok", "rate-limited"]);
    expect(audits()[2].meta.resultCount).toBe(0);
    // other people are not affected
    expect((await findByIdentifier(PEOPLE.arun, IDS.acmePan, { deps })).ok).toBe(true);
    clock = new Date(clock.getTime() + 61_000);
    expect((await findByIdentifier(PEOPLE.priya, IDS.acmePan, { deps })).ok).toBe(true);
  });

  it("the default policy is 10 per 10 minutes; any limiter can be plugged in", async () => {
    expect(IDENTIFIER_SEARCH_LIMIT).toEqual({ limit: 10, windowMs: 600_000 });
    const seen: string[] = [];
    const custom: SearchRateLimiter = { hit: async (key) => (seen.push(key), { ok: false, retryAfterSeconds: 240 }) };
    const r = await findByIdentifier(PEOPLE.priya, IDS.acmePan, { deps: { ...deps, limiter: custom } });
    expect(seen).toEqual(["identifier-search:u-priya"]);
    expect(r.ok === false && r.message).toContain("Wait 4 minutes");
    expect(rateLimitMessage(30)).toContain("Wait 1 minute ");
    expect(rateLimitMessage(30)).not.toMatch(/\b4\d\d\b/);
  });
});
