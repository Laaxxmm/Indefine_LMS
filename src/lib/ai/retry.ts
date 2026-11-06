// Exponential backoff shared by the cloud providers. Deterministic: no jitter, injectable
// sleep, so tests run instantly and identically every time.

export interface RetryOptions {
  /** Retries after the first attempt (default 3 → up to 4 attempts). */
  retries: number;
  /** First backoff in ms; doubles each retry (default 500 → 500, 1000, 2000). */
  baseDelayMs: number;
  /** Upper bound on any single wait, including a server-sent Retry-After (default 30 s). */
  maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const DEFAULT_RETRY: RetryOptions = { retries: 3, baseDelayMs: 500, maxDelayMs: 30_000, sleep: defaultSleep };

export function backoffDelay(attempt: number, opts: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs">, retryAfterMs?: number): number {
  const exp = opts.baseDelayMs * 2 ** attempt;
  const wait = retryAfterMs !== undefined && retryAfterMs > exp ? retryAfterMs : exp;
  return Math.min(wait, opts.maxDelayMs);
}

/** Parse a Retry-After header value (seconds or HTTP date) into ms. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * Run fn; when it throws and isRetryable(err) is true, wait and try again. The last error is
 * rethrown unchanged so the caller can classify it.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (err: unknown) => { retry: boolean; retryAfterMs?: number },
  opts: RetryOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const verdict = isRetryable(err);
      if (!verdict.retry || attempt >= opts.retries) throw err;
      await opts.sleep(backoffDelay(attempt, opts, verdict.retryAfterMs));
    }
  }
}
