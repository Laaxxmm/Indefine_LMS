import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_LIMITS,
  checkRateLimit,
  enforceRateLimit,
  envName,
  memoryRateLimitStore,
  parseRule,
  prismaRateLimitStore,
  rateLimitSentence,
  ruleFor,
  scopedRateLimiter,
  windowWords,
  type RawQueryDb,
  type RateLimitStore,
} from "./rate-limit";

// Compile-time: the Prisma client has the raw-query method the bucket store uses.
export const _prismaFits = (p: PrismaClient): RawQueryDb => p;

const T0 = new Date("2026-11-05T04:30:00.000Z"); // 10:00 IST
const MIN = 60_000;
const rule = { limit: 3, windowMs: 10 * MIN };

describe("configuration", () => {
  it("parses <requests>/<window> with s, m or h", () => {
    expect(parseRule("30/1h")).toEqual({ limit: 30, windowMs: 3_600_000 });
    expect(parseRule(" 5 / 90s ")).toEqual({ limit: 5, windowMs: 90_000 });
    expect(parseRule("10/15M")).toEqual({ limit: 10, windowMs: 900_000 });
    for (const bad of ["", "30", "30/h", "0/1h", "x/1h", "30/0s", "30/1d", "-1/1h", undefined, null]) expect(parseRule(bad), String(bad)).toBeNull();
  });

  it("uses the env override when well formed, else the default (with a warning for a bad value)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(envName("agent-run")).toBe("RATE_LIMIT_AGENT_RUN");
    expect(ruleFor("onboard", {})).toEqual(DEFAULT_LIMITS.onboard);
    expect(ruleFor("onboard", { RATE_LIMIT_ONBOARD: "" })).toEqual(DEFAULT_LIMITS.onboard);
    expect(ruleFor("agent-run", { RATE_LIMIT_AGENT_RUN: "5/10m" })).toEqual({ limit: 5, windowMs: 600_000 });
    expect(ruleFor("comms-draft", { RATE_LIMIT_COMMS_DRAFT: "lots" })).toEqual(DEFAULT_LIMITS["comms-draft"]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/RATE_LIMIT_COMMS_DRAFT="lots" is not/));
  });

  it("ships limits for /onboard, agent runs, comms drafting, identifier lookups and the Companion", () => {
    expect(DEFAULT_LIMITS).toEqual({
      onboard: { limit: 30, windowMs: 3_600_000 },
      "agent-run": { limit: 20, windowMs: 3_600_000 },
      "comms-draft": { limit: 30, windowMs: 3_600_000 },
      "identifier-search": { limit: 10, windowMs: 600_000 },
      companion: { limit: 20, windowMs: 60_000 },
    });
    expect(envName("identifier-search")).toBe("RATE_LIMIT_IDENTIFIER_SEARCH");
    expect(envName("companion")).toBe("RATE_LIMIT_COMPANION");
    expect(ruleFor("identifier-search", { RATE_LIMIT_IDENTIFIER_SEARCH: "5/30m" })).toEqual({ limit: 5, windowMs: 1_800_000 });
    expect(ruleFor("companion", { RATE_LIMIT_COMPANION: "40/1m" })).toEqual({ limit: 40, windowMs: 60_000 });
  });
});

describe("fixed window (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("allows `limit` requests, refuses the next with Retry-After to the window's end, and resets after it", async () => {
    const store = memoryRateLimitStore();
    for (let i = 1; i <= 3; i++) expect(await checkRateLimit("agent-run", "u-1", { store, rule })).toMatchObject({ allowed: true, remaining: 3 - i });
    vi.advanceTimersByTime(4 * MIN);
    const refused = await checkRateLimit("agent-run", "u-1", { store, rule });
    expect(refused).toMatchObject({ allowed: false, remaining: 0, limit: 3, retryAfterSec: 6 * 60, resetAt: new Date(T0.getTime() + 10 * MIN) });

    const res = await enforceRateLimit("agent-run", "u-1", { store, rule });
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("360");
    expect(res?.headers.get("RateLimit-Limit")).toBe("3");
    expect(res?.headers.get("RateLimit-Remaining")).toBe("0");
    expect(await res?.json()).toEqual({ error: "You have made too many agent runs in 10 minutes (the limit is 3). Wait 6 minutes, then try again.", retryAfter: 360 });

    vi.advanceTimersByTime(6 * MIN - 1000);
    expect((await checkRateLimit("agent-run", "u-1", { store, rule })).retryAfterSec).toBe(1);
    vi.advanceTimersByTime(1000); // the window has ended
    expect(await checkRateLimit("agent-run", "u-1", { store, rule })).toMatchObject({ allowed: true, remaining: 2, resetAt: new Date(T0.getTime() + 20 * MIN) });
    expect(await enforceRateLimit("agent-run", "u-1", { store, rule })).toBeNull();
  });

  it("counts per user and per scope", async () => {
    const store = memoryRateLimitStore();
    for (let i = 0; i < 3; i++) await checkRateLimit("onboard", "u-1", { store, rule });
    expect((await checkRateLimit("onboard", "u-1", { store, rule })).allowed).toBe(false);
    expect((await checkRateLimit("onboard", "u-2", { store, rule })).allowed).toBe(true);
    expect((await checkRateLimit("agent-run", "u-1", { store, rule })).allowed).toBe(true);
    expect([...store.buckets.keys()].sort()).toEqual(["agent-run:u-1", "onboard:u-1", "onboard:u-2"]);
  });

  it("concurrent requests cannot share the last slot: exactly `limit` of a burst are allowed", async () => {
    const store = memoryRateLimitStore();
    const burst = await Promise.all(Array.from({ length: 10 }, () => checkRateLimit("onboard", "u-1", { store, rule })));
    expect(burst.filter((d) => d.allowed)).toHaveLength(3);
  });

  it("fails CLOSED (503 + Retry-After, plain message), with an error logged, when the bucket store is unavailable", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: RateLimitStore = { hit: async () => Promise.reject(new Error("connection refused")) };
    const res = await enforceRateLimit("onboard", "u-1", { store: broken, rule });
    expect(res?.status).toBe(503);
    expect(res?.headers.get("Retry-After")).toBe("60");
    expect(await res?.json()).toEqual({ error: "The system is busy. Wait a minute, then try again.", retryAfter: 60 });
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/onboard: store unavailable, request refused with 503 \(fail closed\): connection refused/));
  });
});

describe("scopedRateLimiter (the seam for search and the Companion)", () => {
  it("counts the subject in the shared store under the scope's rule and answers in both modules' shapes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryRateLimitStore();
    const lim = scopedRateLimiter("identifier-search", { store, rule });
    for (let i = 0; i < 3; i++) expect(await lim.hit("identifier-search:u-1", T0)).toEqual({ ok: true, remaining: 2 - i });
    expect(await lim.hit("identifier-search:u-1", new Date(T0.getTime() + MIN))).toEqual({ ok: false, retryAfterSec: 540, retryAfterSeconds: 540 });
    expect(await lim.hit("u-2", T0)).toEqual({ ok: true, remaining: 2 }); // a bare subject works too
    expect([...store.buckets.keys()].sort()).toEqual(["identifier-search:u-1", "identifier-search:u-2"]);
    // A second instance sharing the store sees the same count (one database for every instance).
    expect((await scopedRateLimiter("identifier-search", { store, rule }).hit("identifier-search:u-1", T0)).ok).toBe(false);
  });

  it("uses the env override for its scope", async () => {
    const store = memoryRateLimitStore();
    const lim = scopedRateLimiter("companion", { store, env: { RATE_LIMIT_COMPANION: "1/1m" } });
    expect((await lim.hit("companion:abc", T0)).ok).toBe(true);
    expect(await lim.hit("companion:abc", T0)).toEqual({ ok: false, retryAfterSec: 60, retryAfterSeconds: 60 });
  });

  it("falls back to the module's in-process limiter (not to no limit) when the bucket table is unreachable", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: RateLimitStore = { hit: async () => Promise.reject(new Error("relation does not exist")) };
    let n = 0;
    const fallback = { hit: () => (++n > 1 ? { ok: false as const, retryAfterSeconds: 30 } : { ok: true as const, remaining: 0 }) };
    const lim = scopedRateLimiter("identifier-search", { store: broken, rule, fallback });
    expect(await lim.hit("identifier-search:u-1", T0)).toEqual({ ok: true, remaining: 0 });
    expect(await lim.hit("identifier-search:u-1", T0)).toEqual({ ok: false, retryAfterSec: 30, retryAfterSeconds: 30 });
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/identifier-search: store unavailable, using the in-process limit/));
  });

  it("writes plain 429 sentences with the window in words", () => {
    expect(windowWords(3_600_000)).toBe("an hour");
    expect(windowWords(7_200_000)).toBe("2 hours");
    expect(windowWords(60_000)).toBe("a minute");
    expect(windowWords(600_000)).toBe("10 minutes");
    expect(windowWords(90_000)).toBe("90 seconds");
    expect(rateLimitSentence({ scope: "comms-draft", limit: 30, retryAfterSec: 61, windowMs: 3_600_000 })).toBe(
      "You have made too many draft messages in an hour (the limit is 30). Wait 2 minutes, then try again.",
    );
    expect(rateLimitSentence({ scope: "identifier-search", limit: 10, retryAfterSec: 5, windowMs: 600_000 })).toBe(
      "You have made too many searches by PAN, GSTIN, phone or email in 10 minutes (the limit is 10). Wait 1 minute, then try again.",
    );
  });
});

describe("Postgres bucket store", () => {
  it("issues one atomic INSERT … ON CONFLICT DO UPDATE … RETURNING with the key and UTC cut-off, and maps the row", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db: RawQueryDb = {
      $queryRaw: (async (q: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: q.join("?"), values });
        return [{ count: BigInt(4), windowStart: new Date(T0.getTime() - MIN) }];
      }) as RawQueryDb["$queryRaw"],
    };
    const state = await prismaRateLimitStore(db).hit("onboard:u-1", T0, 10 * MIN);
    expect(state).toEqual({ count: 4, windowStart: new Date(T0.getTime() - MIN) });
    expect(calls).toHaveLength(1);
    const { sql, values } = calls[0];
    expect(sql).toMatch(/INSERT INTO "RateLimitBucket" \("key", "windowStart", "count", "updatedAt"\)/);
    expect(sql).toMatch(/ON CONFLICT \("key"\) DO UPDATE SET/);
    expect(sql).toMatch(/RETURNING "count", "windowStart"/);
    expect(sql).not.toMatch(/DELETE/i);
    expect(values).toEqual(["onboard:u-1", T0.toISOString(), T0.toISOString(), new Date(T0.getTime() - 10 * MIN).toISOString(), new Date(T0.getTime() - 10 * MIN).toISOString()]);
  });

  it("refuses an empty RETURNING", async () => {
    const db: RawQueryDb = { $queryRaw: (async () => []) as RawQueryDb["$queryRaw"] };
    await expect(prismaRateLimitStore(db).hit("k", T0, MIN)).rejects.toThrow(/returned no row/);
  });
});
