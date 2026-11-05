// Per-user rate limits for the model-backed and heavy Firm OS routes (Phase 11): /onboard,
// agent runs (run, re-run, request changes), comms drafting, identifier lookups (PAN / GSTIN /
// phone / email, per person) and the Companion's next-task (per pairing token). Fixed window per
// subject and scope, stored in RateLimitBucket (key "<scope>:<subject>", windowStart, count) so
// every app instance shares one count. A request over the limit gets 429 with Retry-After
// (seconds to the window's end).
//
// Limits are configuration: DEFAULT_LIMITS below, overridable per scope by env
//   RATE_LIMIT_ONBOARD="30/1h"   RATE_LIMIT_AGENT_RUN="20/1h"   RATE_LIMIT_COMMS_DRAFT="30/1h"
//   RATE_LIMIT_IDENTIFIER_SEARCH="10/10m"   RATE_LIMIT_COMPANION="20/1m"
// ("<requests>/<window>", window in s, m or h). A malformed value is ignored with a warning (the
// default stays); changing a limit is a threshold change (partner, src/lib/rbac/policy.ts).
//
// Modules with their own limiter seam (search's SearchRateLimiter, the companion's RateLimiter)
// plug in scopedRateLimiter(scope): the same database count behind their interface, falling back
// to their in-process limiter if the bucket table cannot be reached.
//
// The counter is one atomic statement (INSERT … ON CONFLICT DO UPDATE … RETURNING), so concurrent
// requests cannot both take the last slot. If the bucket table cannot be reached the request is
// let through and the error logged: the routes behind the limit need the same database, and a
// rate-limit fault must not become an outage (fail-open, documented in docs/runbooks/breach.md).
import { NextResponse } from "next/server";

export const RATE_LIMIT_SCOPES = ["onboard", "agent-run", "comms-draft", "identifier-search", "companion"] as const;
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];
export type RateLimitRule = { limit: number; windowMs: number };

const HOUR = 60 * 60_000;
export const DEFAULT_LIMITS: Readonly<Record<RateLimitScope, RateLimitRule>> = {
  onboard: { limit: 30, windowMs: HOUR }, // a full onboarding is ~5-8 calls: ~4 clients per person per hour
  "agent-run": { limit: 20, windowMs: HOUR }, // each run is a model-backed draft pack
  "comms-draft": { limit: 30, windowMs: HOUR },
  "identifier-search": { limit: 10, windowMs: 10 * 60_000 }, // per person: exact PAN / GSTIN / phone / email lookups (no enumeration)
  companion: { limit: 20, windowMs: 60_000 }, // per pairing token: the side panel polls once a minute
};

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
  /** Length of the window, for the sentence a person reads. */
  windowMs: number;
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
    windowMs: rule.windowMs,
  };
}

const SCOPE_LABEL: Record<RateLimitScope, string> = {
  onboard: "onboarding requests",
  "agent-run": "agent runs",
  "comms-draft": "draft messages",
  "identifier-search": "searches by PAN, GSTIN, phone or email",
  companion: "Companion refreshes",
};

/** "an hour", "10 minutes", "a minute", "30 seconds": the window in words for a 429 sentence. */
export function windowWords(windowMs: number): string {
  const s = Math.round(windowMs / 1000);
  if (s % 3600 === 0) return s === 3600 ? "an hour" : `${s / 3600} hours`;
  if (s % 60 === 0) return s === 60 ? "a minute" : `${s / 60} minutes`;
  return `${s} seconds`;
}

/** The plain sentence for a refused decision (what is wrong, what to do; no codes). */
export function rateLimitSentence(d: Pick<RateLimitDecision, "scope" | "limit" | "retryAfterSec" | "windowMs">): string {
  const minutes = Math.max(1, Math.ceil(d.retryAfterSec / 60));
  return `You have made too many ${SCOPE_LABEL[d.scope]} in ${windowWords(d.windowMs)} (the limit is ${d.limit}). Wait ${minutes} minute${minutes === 1 ? "" : "s"}, then try again.`;
}

/** The 429 for a refused decision: Retry-After plus the RateLimit-* headers. */
export function tooManyRequests(d: RateLimitDecision): NextResponse {
  return NextResponse.json(
    { error: rateLimitSentence(d), retryAfter: d.retryAfterSec },
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

/** For route handlers: null when the request may proceed, else the 429 to return. Fails open on a store error. */
export async function enforceRateLimit(scope: RateLimitScope, userId: string, opts: RateLimitOptions = {}): Promise<NextResponse | null> {
  let d: RateLimitDecision;
  try {
    d = await checkRateLimit(scope, userId, opts);
  } catch (e) {
    console.error(`[rate-limit] ${scope}: store unavailable, request allowed: ${(e as Error).message}`);
    return null;
  }
  if (d.allowed) return null;
  console.warn(`[rate-limit] ${scope}: ${userId} over ${d.limit}; retry in ${d.retryAfterSec}s`);
  return tooManyRequests(d);
}

// ------------------------------------------------------------------ seams for module limiters

/** The decision shape module limiters use (search: retryAfterSeconds, companion: retryAfterSec). */
export type ScopedDecision = { ok: true; remaining: number } | { ok: false; retryAfterSec: number; retryAfterSeconds: number };

/** Anything with a hit(key, now) answering { ok, remaining } or { ok: false, retryAfterSec | retryAfterSeconds } (the search and companion limiters). */
export type FallbackLimiter = { hit(key: string, now: Date): unknown };

/**
 * A limiter for a module's own seam, counted in RateLimitBucket under `scope` (so every app
 * instance shares the count). The module passes keys as "<scope>:<subject>" (or just the
 * subject); the subject is counted with the scope's rule (DEFAULT_LIMITS / RATE_LIMIT_*). If the
 * bucket table cannot be reached, `fallback` (the module's in-process limiter) decides instead, so
 * a database fault narrows the limit to one instance rather than lifting it.
 */
export function scopedRateLimiter(scope: RateLimitScope, opts: RateLimitOptions & { fallback?: FallbackLimiter } = {}) {
  return {
    async hit(key: string, now: Date): Promise<ScopedDecision> {
      const subject = key.startsWith(`${scope}:`) ? key.slice(scope.length + 1) : key;
      try {
        const d = await checkRateLimit(scope, subject, { ...opts, now });
        if (d.allowed) return { ok: true, remaining: d.remaining };
        console.warn(`[rate-limit] ${scope}: over ${d.limit}; retry in ${d.retryAfterSec}s`);
        return { ok: false, retryAfterSec: d.retryAfterSec, retryAfterSeconds: d.retryAfterSec };
      } catch (e) {
        console.error(`[rate-limit] ${scope}: store unavailable, using the in-process limit: ${(e as Error).message}`);
        if (!opts.fallback) return { ok: true, remaining: 0 };
        const f = (await opts.fallback.hit(key, now)) as { ok: boolean; remaining?: number; retryAfterSec?: number; retryAfterSeconds?: number };
        if (f.ok) return { ok: true, remaining: f.remaining ?? 0 };
        const wait = f.retryAfterSec ?? f.retryAfterSeconds ?? 60;
        return { ok: false, retryAfterSec: wait, retryAfterSeconds: wait };
      }
    },
  };
}
