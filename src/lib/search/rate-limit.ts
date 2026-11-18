// Rate limit for identifier searches (PAN, GSTIN, phone, email), per person. Production uses the
// database-backed limiter (src/lib/hardening/rate-limit.ts, scope "identifier-search", 10 per 10
// minutes by default, RATE_LIMIT_IDENTIFIER_SEARCH to change it), so every app instance shares one
// count; if the bucket table cannot be reached, the in-memory sliding window below decides for
// this process instead. Tests pass memoryRateLimiter() through deps.limiter, or call
// setIdentifierRateLimiter(). Anything that implements SearchRateLimiter works.
import { DEFAULT_LIMITS, scopedRateLimiter } from "@/lib/hardening/rate-limit";

export type RateDecision = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export interface SearchRateLimiter {
  /** Count one search for `key` at `now` and say whether it is allowed. */
  hit(key: string, now: Date): Promise<RateDecision>;
}

export type RateLimitPolicy = { limit: number; windowMs: number };

/** 10 identifier searches per person in any 10 minutes (the same default as the database limiter). */
export const IDENTIFIER_SEARCH_LIMIT: RateLimitPolicy = DEFAULT_LIMITS["identifier-search"];

/** Sliding-window limiter held in memory. Refused attempts are not counted. */
export function memoryRateLimiter(policy: RateLimitPolicy = IDENTIFIER_SEARCH_LIMIT): SearchRateLimiter {
  const hits = new Map<string, number[]>();
  return {
    async hit(key, now) {
      const t = now.getTime();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < policy.windowMs);
      if (recent.length >= policy.limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + policy.windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { ok: true, remaining: policy.limit - recent.length };
    },
  };
}

/** The shared, database-backed limiter (RateLimitBucket "identifier-search:<userId>"), memory fallback. */
export function databaseIdentifierRateLimiter(): SearchRateLimiter {
  return scopedRateLimiter("identifier-search", { fallback: memoryRateLimiter() });
}

let current: SearchRateLimiter | null = null;

/** The limiter identifier searches use by default (the database-backed one). */
export function identifierRateLimiter(): SearchRateLimiter {
  current ??= databaseIdentifierRateLimiter();
  return current;
}

/** Replace the default limiter (tests, or a different store). */
export function setIdentifierRateLimiter(limiter: SearchRateLimiter): void {
  current = limiter;
}

/** The sentence a person sees when refused (independent of which limiter refused). */
export function rateLimitMessage(retryAfterSeconds: number): string {
  const waitMin = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You have searched by PAN, GSTIN, phone or email too many times in a short while. Wait ${waitMin} ${waitMin === 1 ? "minute" : "minutes"} and try again, or search by the client's name or code.`;
}
