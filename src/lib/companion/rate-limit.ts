// Per-token request limit for GET next-task. RateLimiter is the seam: memoryRateLimiter (fixed
// window, in this server process) today; Phase 11's database limiter on RateLimitBucket
// (key "companion:<token hash>") implements the same interface and replaces it in defaults.ts.
//
// No entries are ever removed one by one: when the table reaches maxKeys it is replaced by a fresh
// one (every window starts over), which bounds memory without per-key deletion.
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

/** The process-wide limiter the route uses (one per server instance). */
export const companionRateLimiter: RateLimiter = memoryRateLimiter();
