// Per-token request limit for GET next-task. RateLimiter is the seam. Production (defaults.ts)
// uses the database limiter on RateLimitBucket (src/lib/hardening/rate-limit.ts, scope
// "companion", key "companion:<token hash>", 20 a minute by default, RATE_LIMIT_COMPANION to
// change it), shared by every app instance; memoryRateLimiter (fixed window, this process) is its
// fallback when the bucket table cannot be reached, and what tests use.
//
// No entries are ever removed one by one: when the table reaches maxKeys it is replaced by a fresh
// one (every window starts over), which bounds memory without per-key deletion.
import { scopedRateLimiter } from "@/lib/hardening/rate-limit";
import { COMPANION_RATE_LIMIT } from "./config";

export type RateDecision = { ok: true; remaining: number } | { ok: false; retryAfterSec: number };

export interface RateLimiter {
  hit(key: string, now: Date): RateDecision | Promise<RateDecision>;
}

type Bucket = { start: number; count: number };

export function memoryRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number } = COMPANION_RATE_LIMIT): RateLimiter {
  const maxKeys = opts.maxKeys ?? 10_000;
  let buckets = new Map<string, Bucket>();
  return {
    hit(key, now) {
      const t = now.getTime();
      let b = buckets.get(key);
      if (!b || t - b.start >= opts.windowMs || t < b.start) {
        if (!b && buckets.size >= maxKeys) buckets = new Map();
        b = { start: t, count: 0 };
        buckets.set(key, b);
      }
      b.count += 1;
      if (b.count > opts.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.start + opts.windowMs - t) / 1000)) };
      return { ok: true, remaining: opts.limit - b.count };
    },
  };
}

/** The in-process limiter (one per server instance): the database limiter's fallback. */
export const companionRateLimiter: RateLimiter = memoryRateLimiter();

/** What the route uses: the shared database count per token, falling back to companionRateLimiter. */
export const databaseCompanionRateLimiter: RateLimiter = scopedRateLimiter("companion", { fallback: companionRateLimiter });
