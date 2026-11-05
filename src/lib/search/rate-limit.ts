// Rate limit for identifier searches (PAN, GSTIN, phone, email), per person. The default is an
// in-memory sliding window, enough for one Node process. Phase 11 adds a database-backed limiter in
// src/lib/hardening (RateLimitBucket); to switch, pass it as `limiter` in defaultSearchDeps()
// (src/lib/search/defaults.ts) or call setIdentifierRateLimiter() once at start-up. Anything that
// implements SearchRateLimiter works.

export type RateDecision = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export interface SearchRateLimiter {
  /** Count one search for `key` at `now` and say whether it is allowed. */
  hit(key: string, now: Date): Promise<RateDecision>;
}

export type RateLimitPolicy = { limit: number; windowMs: number };

/** 10 identifier searches per person in any 10 minutes. */
export const IDENTIFIER_SEARCH_LIMIT: RateLimitPolicy = { limit: 10, windowMs: 10 * 60_000 };

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

let current: SearchRateLimiter = memoryRateLimiter();

/** The limiter identifier searches use by default. */
export function identifierRateLimiter(): SearchRateLimiter {
  return current;
}

/** Replace the default limiter (e.g. with the Phase 11 database-backed one). */
export function setIdentifierRateLimiter(limiter: SearchRateLimiter): void {
  current = limiter;
}

/** The sentence a person sees when refused (independent of which limiter refused). */
export function rateLimitMessage(retryAfterSeconds: number): string {
  const waitMin = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You have searched by PAN, GSTIN, phone or email too many times in a short while. Wait ${waitMin} ${waitMin === 1 ? "minute" : "minutes"} and try again, or search by the client's name or code.`;
}
