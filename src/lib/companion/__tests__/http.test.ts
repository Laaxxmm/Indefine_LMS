// GET next-task at the HTTP edge: CORS only for the configured extension origin (never with
// credentials, never a cookie), the 401/403/429/500 sentences, the per-token limit and the 200 shape.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { COMPANION_EXTENSION_ID, COMPANION_ORIGIN_ENV, COMPANION_RATE_LIMIT, allowedExtensionOrigins } from "../config";
import { corsOrigin, handleNextTask, handlePreflight, type NextTaskDeps } from "../http";
import { MSG } from "../messages";
import { memoryRateLimiter } from "../rate-limit";
import { fakeDb, fakeToken, user, type TokenRow } from "./fakes";

const EXT = "chrome-extension://" + "abcdefghijklmnop".repeat(2);
const OTHER_EXT = "chrome-extension://" + "ponmlkjihgfedcba".repeat(2);
const NOW = new Date("2026-11-05T06:30:00Z");
const DAY = 86_400_000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NONE = { status: "none", generatedAt: NOW.toISOString(), message: MSG.caughtUp, counts: { open: 0, overdue: 0 } } as const;

const people = [user({ id: "u-partner", level: "PARTNER" }), user({ id: "u-staff" }), user({ id: "u-gone", level: "PARTNER", active: false })];

function setup(opts: { owner?: string; token?: Partial<TokenRow>; settings?: Record<string, boolean>; limit?: number } = {}) {
  const t = fakeToken("t");
  const db = fakeDb({
    users: people,
    settings: opts.settings,
    tokens: [{ id: "tok-1", userId: opts.owner ?? "u-partner", tokenHash: sha(t), label: "Desk", createdAt: NOW, lastUsedAt: null, revokedAt: null, ...opts.token }],
  });
  const provider = { nextTask: vi.fn(async () => NONE) };
  const deps: NextTaskDeps = { db: db as never, provider: provider as never, limiter: memoryRateLimiter({ limit: opts.limit ?? 20, windowMs: 60_000 }), origins: [EXT], now: () => NOW };
  return { t, db, provider, deps };
}

const get = (headers: Record<string, string> = {}) => new Request("https://lms.indefine.in/api/firm-os/companion/next-task", { headers });
const bearer = (t: string, origin: string | null = EXT) => get({ authorization: `Bearer ${t}`, ...(origin ? { origin } : {}) });

describe("CORS", () => {
  it("echoes only the configured extension origin, never allows credentials, never sets a cookie", async () => {
    const { t, deps } = setup();
    const r = await handleNextTask(bearer(t), deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(EXT);
    expect(r.headers.get("access-control-allow-credentials")).toBeNull();
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.headers.get("vary")).toBe("Origin");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses any other browser origin with a plain 403, before touching the database", async () => {
    for (const origin of ["https://evil.example", OTHER_EXT, "null", "https://lms.indefine.in"]) {
      const { t, db, provider, deps } = setup();
      const r = await handleNextTask(bearer(t, origin), deps);
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: MSG.wrongOrigin });
      expect(r.headers.get("access-control-allow-origin")).toBeNull();
      expect(db.calls).toEqual([]);
      expect(provider.nextTask).not.toHaveBeenCalled();
    }
  });

  it("answers a request with no Origin (not a browser page) without a CORS grant — the token is the gate", async () => {
    const { t, deps } = setup();
    const r = await handleNextTask(bearer(t, null), deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("preflight: 204 with GET + Authorization for the extension origin; 403 without a grant otherwise", () => {
    const ok = handlePreflight(new Request("https://x/", { method: "OPTIONS", headers: { origin: EXT } }), [EXT]);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(EXT);
    expect(ok.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(ok.headers.get("access-control-allow-headers")).toBe("Authorization");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    const refused: Array<Record<string, string>> = [{ origin: "https://evil.example" }, { origin: OTHER_EXT }, {}];
    for (const headers of refused) {
      const no = handlePreflight(new Request("https://x/", { method: "OPTIONS", headers }), [EXT]);
      expect(no.status).toBe(403);
      expect(no.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(handlePreflight(new Request("https://x/", { method: "OPTIONS", headers: { origin: EXT } }), []).status).toBe(403);
  });

  // verify:rbac lets this OPTIONS handler skip auth and policy (scripts/lib/rbac-check.ts
  // PREFLIGHT_ROUTES) only because it never hands out data: no body, ever, even with a valid token.
  it("preflight returns no body and no task data, for an allowed origin, a refused one, and a request carrying a valid token", async () => {
    const { t } = setup();
    const cases: Array<Record<string, string>> = [{ origin: EXT }, { origin: "https://evil.example" }, {}, { origin: EXT, authorization: `Bearer ${t}` }];
    for (const headers of cases) {
      const r = handlePreflight(new Request("https://x/api/firm-os/companion/next-task", { method: "OPTIONS", headers }), [EXT]);
      expect(await r.text(), JSON.stringify(headers)).toBe("");
      expect(r.headers.get("content-type")).toBeNull();
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });

  it("allows the extension's own fixed id by default; the environment overrides it, strictly", () => {
    expect(allowedExtensionOrigins({})).toEqual([`chrome-extension://${COMPANION_EXTENSION_ID}`]);
    expect(allowedExtensionOrigins({ [COMPANION_ORIGIN_ENV]: "  " })).toEqual([`chrome-extension://${COMPANION_EXTENSION_ID}`]);
    expect(allowedExtensionOrigins({ [COMPANION_ORIGIN_ENV]: ` ${EXT}/ , ${OTHER_EXT}` })).toEqual([EXT, OTHER_EXT]);
    expect(allowedExtensionOrigins({ [COMPANION_ORIGIN_ENV]: "*, https://lms.indefine.in, chrome-extension://short, chrome-extension://" + "z".repeat(32) })).toEqual([]);
    expect(corsOrigin(get({ origin: EXT }), [EXT])).toEqual({ allowed: EXT, rejected: false });
  });
});

describe("pairing refusals (401)", () => {
  it.each([
    ["no Authorization header", () => get({ origin: EXT }), MSG.tokenMissing],
    ["an empty bearer", () => get({ origin: EXT, authorization: "Bearer " }), MSG.tokenMissing],
    ["a malformed token", () => bearer("not-a-token"), MSG.tokenUnknown],
    ["an unknown token", () => bearer(fakeToken("u")), MSG.tokenUnknown],
  ])("%s", async (_name, build, message) => {
    const { provider, deps } = setup();
    const r = await handleNextTask(build(), deps);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: message });
    expect(r.headers.get("www-authenticate")).toBe("Bearer");
    expect(r.headers.get("access-control-allow-origin")).toBe(EXT); // the panel can read the sentence
    expect(provider.nextTask).not.toHaveBeenCalled();
  });

  it("a revoked token, and a token 90 days old, are refused with what to do next", async () => {
    const revoked = setup({ token: { revokedAt: new Date(NOW.getTime() - 1000) } });
    const r1 = await handleNextTask(bearer(revoked.t), revoked.deps);
    expect(r1.status).toBe(401);
    expect((await r1.json()).error).toBe(MSG.tokenRevoked);
    const expired = setup({ token: { createdAt: new Date(NOW.getTime() - 90 * DAY) } });
    const r2 = await handleNextTask(bearer(expired.t), expired.deps);
    expect(r2.status).toBe(401);
    expect((await r2.json()).error).toBe("Your pairing has expired. Create a new one on the Companion page in Firm OS.");
    expect(expired.db.tokens[0].lastUsedAt).toBeNull();
  });

  it("messages are plain sentences with no status codes or internal names", () => {
    for (const m of Object.values(MSG)) {
      expect(m).toMatch(/^[A-Z].*[.]$/);
      expect(m).not.toMatch(/\b(40[0-9]|42[0-9]|50[0-9])\b|_|unauthori[sz]ed|forbidden|token_|ERR/i);
    }
  });
});

describe("access (403) and success (200)", () => {
  it("refuses a deactivated person and someone without companion access", async () => {
    const gone = setup({ owner: "u-gone" });
    const r1 = await handleNextTask(bearer(gone.t), gone.deps);
    expect(r1.status).toBe(403);
    expect((await r1.json()).error).toBe(MSG.accountInactive);
    const staff = setup({ owner: "u-staff" });
    const r2 = await handleNextTask(bearer(staff.t), staff.deps);
    expect(r2.status).toBe(403);
    expect((await r2.json()).error).toBe(MSG.noAccess);
    expect(staff.provider.nextTask).not.toHaveBeenCalled();
  });

  it("serves staff whose companion setting is on, passes the token owner to the provider and marks the token used", async () => {
    const { t, db, provider, deps } = setup({ owner: "u-staff", settings: { "u-staff": true } });
    const r = await handleNextTask(bearer(t), deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(NONE);
    expect(provider.nextTask).toHaveBeenCalledWith(expect.objectContaining({ id: "u-staff", active: true, role: "EMPLOYEE" }), NOW);
    expect(db.tokens[0].lastUsedAt).toEqual(NOW);
  });

  it("a provider failure is a plain 500, with the detail only in the server log", async () => {
    const { t, provider, deps } = setup();
    provider.nextTask.mockRejectedValueOnce(new Error("connection reset by db-host-7"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleNextTask(bearer(t), deps);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: MSG.serverError });
    expect(log).toHaveBeenCalled();
  });
});

describe("rate limit (429)", () => {
  it(`allows ${COMPANION_RATE_LIMIT.limit} requests a minute per token by default`, () => {
    expect(COMPANION_RATE_LIMIT).toEqual({ limit: 20, windowMs: 60_000 });
  });

  it("limits per token with a plain sentence and Retry-After; other tokens and the next window are unaffected", async () => {
    const { t, db, deps } = setup({ limit: 3 });
    for (let i = 0; i < 3; i++) expect((await handleNextTask(bearer(t), deps)).status).toBe(200);
    const limited = await handleNextTask(bearer(t), deps);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: MSG.rateLimited });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("access-control-expose-headers")).toBe("Retry-After");
    const lookups = db.calls.filter((c) => c.method === "findUnique" && c.model === "companionToken").length;
    expect(lookups).toBe(3); // the limited request never reached the database

    const other = fakeToken("o");
    db.tokens.push({ id: "tok-2", userId: "u-partner", tokenHash: sha(other), label: "Laptop", createdAt: NOW, lastUsedAt: null, revokedAt: null });
    expect((await handleNextTask(bearer(other), deps)).status).toBe(200);

    const later = { ...deps, now: () => new Date(NOW.getTime() + 60_000) };
    expect((await handleNextTask(bearer(t), later)).status).toBe(200);
  });

  it("the in-memory limiter bounds its table without removing keys one by one", () => {
    const lim = memoryRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    expect(lim.hit("a", NOW)).toEqual({ ok: true, remaining: 0 });
    expect(lim.hit("a", NOW)).toMatchObject({ ok: false, retryAfterSec: 60 });
    lim.hit("b", NOW);
    lim.hit("c", NOW); // table full: starts over
    expect(lim.hit("a", NOW)).toEqual({ ok: true, remaining: 0 });
    // A clock that goes backwards opens a new window instead of a negative Retry-After.
    expect(lim.hit("a", new Date(NOW.getTime() - 5000))).toEqual({ ok: true, remaining: 0 });
  });
});
