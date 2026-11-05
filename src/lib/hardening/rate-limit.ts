// Per-user rate limits for the model-backed and heavy Firm OS routes (Phase 11): /onboard,
// agent runs (run, re-run, request changes) and comms drafting. Fixed window per user and scope,
// stored in RateLimitBucket (key "<scope>:<userId>", windowStart, count) so every app instance
// shares one count. A request over the limit gets 429 with Retry-After (seconds to the window's end).
//
// Limits are configuration: DEFAULT_LIMITS below, overridable per scope by env
//   RATE_LIMIT_ONBOARD="30/1h"   RATE_LIMIT_AGENT_RUN="20/1h"   RATE_LIMIT_COMMS_DRAFT="30/1h"
// ("<requests>/<window>", window in s, m or h). A malformed value is ignored with a warning (the
// default stays); changing a limit is a threshold change (partner, src/lib/rbac/policy.ts).
//
// The counter is one atomic statement (INSERT … ON CONFLICT DO UPDATE … RETURNING), so concurrent
// requests cannot both take the last slot.
//
// If the bucket table cannot be reached (Prisma pool timeout P2024 under a burst, database down),
// every scope here FAILS CLOSED: the request gets 503 "The system is busy — try again in a minute"
// with Retry-After, and the error is logged. All three scopes guard model-backed, costly work, so
// letting requests through while the limiter is blind would let the very burst that exhausted the
// pool run unmetered (security audit #8). A future low-risk scope may set "open" in FAILURE_MODE.
// Agent runs are also capped per process (src/lib/hardening/concurrency.ts, applied in
// src/lib/agents/service.ts), so a burst cannot exhaust the 5-connection pool in the first place.
import { NextResponse } from "next/server";

export const RATE_LIMIT_SCOPES = ["onboard", "agent-run", "comms-draft"] as const;
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];
export type RateLimitRule = { limit: number; windowMs: number };

const HOUR = 60 * 60_000;
export const DEFAULT_LIMITS: Readonly<Record<RateLimitScope, RateLimitRule>> = {
  onboard: { limit: 30, windowMs: HOUR }, // a full onboarding is ~5-8 calls: ~4 clients per person per hour
  "agent-run": { limit: 20, windowMs: HOUR }, // each run is a model-backed draft pack
  "comms-draft": { limit: 30, windowMs: HOUR },
};

/**
 * What happens when the bucket store errors. "closed": 503 + Retry-After, the request does not run;
 * "open": the request runs and the error is logged. Every current scope is model-backed: closed.
 */
export const FAILURE_MODE: Readonly<Record<RateLimitScope, "closed" | "open">> = {
  onboard: "closed",
  "agent-run": "closed",
  "comms-draft": "closed",
};

/** Seconds a client is asked to wait after a 503 (blind limiter, full agent-run queue). */
export const BUSY_RETRY_AFTER_SEC = 60;
export const BUSY_MESSAGE = "The system is busy — try again in a minute.";

export const envName = (scope: RateLimitScope) => `RATE_LIMIT_${scope.toUpperCase().replace(/-/g, "_")}`;

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: HOUR };

/** "30/1h" → { limit: 30, windowMs: 3_600_000 }; null when malformed. */
export function parseRule(value: string | undefined | null): RateLimitRule | null {
  const m = value?.trim().match(/^(\d{1,6})\s*\/\s*(\d{1,6})\s*([smh])$/i);
  if (!m) return null;
  const limit = Number(m[1]);
  const windowMs = Number(m[2]) * UNIT_MS[m[3].toLowerCase()];
  return limit >= 1 && windowMs >= 1000 ? { limit, windowMs } : null;
}

/** The rule in force for a scope: env override if well-formed, else the default. */
export function ruleFor(scope: RateLimitScope, env: Record<string, string | undefined> = process.env): RateLimitRule {
  const raw = env[envName(scope)];
  if (raw === undefined || raw === "") return DEFAULT_LIMITS[scope];
  const parsed = parseRule(raw);
  if (!parsed) console.warn(`[rate-limit] ${envName(scope)}="${raw}" is not "<requests>/<window>" (e.g. 30/1h); using ${DEFAULT_LIMITS[scope].limit}/${DEFAULT_LIMITS[scope].windowMs / 1000}s`);
  return parsed ?? DEFAULT_LIMITS[scope];
}

// ------------------------------------------------------------------ stores

export type BucketState = { count: number; windowStart: Date };

/** Counts one request in the key's current window (starting a new window when the old one has ended). */
export interface RateLimitStore {
  hit(key: string, now: Date, windowMs: number): Promise<BucketState>;
}

/** The raw-query method of PrismaClient (tagged template). */
export interface RawQueryDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/**
 * RateLimitBucket through one atomic Postgres statement. Timestamps travel as UTC ISO strings
 * cast to `timestamp` (the column type Prisma uses for DateTime), so the session time zone does not
 * matter. Exercised against Postgres only (CI e2e job); unit tests check the statement and mapping.
 */
export function prismaRateLimitStore(db: RawQueryDb): RateLimitStore {
  return {
    async hit(key, now, windowMs) {
      const at = now.toISOString();
      const cutoff = new Date(now.getTime() - windowMs).toISOString();
      const rows = await db.$queryRaw<{ count: number | bigint; windowStart: Date }[]>`
        INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "updatedAt")
        VALUES (${key}, ${at}::timestamp, 1, ${at}::timestamp)
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "RateLimitBucket"."windowStart" <= ${cutoff}::timestamp THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
          "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= ${cutoff}::timestamp THEN EXCLUDED."windowStart" ELSE "RateLimitBucket"."windowStart" END,
          "updatedAt" = EXCLUDED."updatedAt"
        RETURNING "count", "windowStart"`;
      const row = rows[0];
      if (!row) throw new Error("RateLimitBucket upsert returned no row");
      return { count: Number(row.count), windowStart: new Date(row.windowStart) };
    },
  };
}

/** Same semantics in memory (tests, and a single-process fallback). */
export function memoryRateLimitStore(): RateLimitStore & { buckets: Map<string, BucketState> } {
  const buckets = new Map<string, BucketState>();
  return {
    buckets,
    async hit(key, now, windowMs) {
      const b = buckets.get(key);
      const next = !b || b.windowStart.getTime() <= now.getTime() - windowMs ? { count: 1, windowStart: now } : { count: b.count + 1, windowStart: b.windowStart };
      buckets.set(key, next);
      return { ...next };
    },
  };
}

let defaultStore: RateLimitStore | null = null;

/** Prisma-backed store, built on first use (keeps route imports cheap; tests mock "@/lib/prisma"). */
async function appStore(): Promise<RateLimitStore> {
  if (!defaultStore) {
    const { prisma } = await import("@/lib/prisma");
    defaultStore = prismaRateLimitStore(prisma);
  }
  return defaultStore;
}

// ------------------------------------------------------------------ decisions

export type RateLimitDecision = {
  allowed: boolean;
  scope: RateLimitScope;
  limit: number;
  remaining: number;
  /** Whole seconds until the window ends (≥ 1). */
  retryAfterSec: number;
  resetAt: Date;
};

export type RateLimitOptions = { store?: RateLimitStore; now?: Date; rule?: RateLimitRule; env?: Record<string, string | undefined> };

export async function checkRateLimit(scope: RateLimitScope, userId: string, opts: RateLimitOptions = {}): Promise<RateLimitDecision> {
  const rule = opts.rule ?? ruleFor(scope, opts.env);
  const now = opts.now ?? new Date();
  const store = opts.store ?? (await appStore());
  const b = await store.hit(`${scope}:${userId}`, now, rule.windowMs);
  const resetAt = new Date(b.windowStart.getTime() + rule.windowMs);
  return {
    allowed: b.count <= rule.limit,
    scope,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - b.count),
    retryAfterSec: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    resetAt,
  };
}

const SCOPE_LABEL: Record<RateLimitScope, string> = { onboard: "onboarding requests", "agent-run": "agent runs", "comms-draft": "draft messages" };

/** The 429 for a refused decision: Retry-After plus the RateLimit-* headers. */
export function tooManyRequests(d: RateLimitDecision): NextResponse {
  const minutes = Math.ceil(d.retryAfterSec / 60);
  return NextResponse.json(
    { error: `Too many ${SCOPE_LABEL[d.scope]}: the limit is ${d.limit} per window. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, retryAfter: d.retryAfterSec },
    {
      status: 429,
      headers: {
        "Retry-After": String(d.retryAfterSec),
        "RateLimit-Limit": String(d.limit),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(d.retryAfterSec),
      },
    },
  );
}

/** The 503 for "try again shortly": a plain message and Retry-After in seconds. */
export function serviceBusy(retryAfterSec = BUSY_RETRY_AFTER_SEC, message = BUSY_MESSAGE): NextResponse {
  return NextResponse.json({ error: message, retryAfter: retryAfterSec }, { status: 503, headers: { "Retry-After": String(retryAfterSec) } });
}

/**
 * For route handlers: null when the request may proceed, else the response to return — 429 over the
 * limit, or 503 + Retry-After when the bucket store is unavailable (the scopes fail closed).
 */
export async function enforceRateLimit(scope: RateLimitScope, userId: string, opts: RateLimitOptions = {}): Promise<NextResponse | null> {
  let d: RateLimitDecision;
  try {
    d = await checkRateLimit(scope, userId, opts);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    const why = `${typeof code === "string" ? `${code} ` : ""}${(e as Error).message}`;
    if (FAILURE_MODE[scope] === "open") {
      console.error(`[rate-limit] ${scope}: store unavailable, request allowed (fail open): ${why}`);
      return null;
    }
    console.error(`[rate-limit] ${scope}: store unavailable, request refused with 503 (fail closed): ${why}`);
    return serviceBusy();
  }
  if (d.allowed) return null;
  console.warn(`[rate-limit] ${scope}: ${userId} over ${d.limit}; retry in ${d.retryAfterSec}s`);
  return tooManyRequests(d);
}
