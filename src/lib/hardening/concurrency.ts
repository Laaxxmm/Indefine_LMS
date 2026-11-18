// Per-process concurrency cap with a short FIFO queue (security audit #8).
//
// An agent run is a model-backed draft pack that holds Prisma connections for its whole length, and
// the pool is 5 connections (src/lib/prisma.ts). A burst of runs used to exhaust the pool, and the
// rate limiter's own bucket query then timed out (P2024). agentRunSlots() lets AGENT_RUN_CONCURRENCY
// runs (default 2) proceed at once per process; up to AGENT_RUN_QUEUE more (default 6) wait their
// turn for at most AGENT_RUN_QUEUE_WAIT_MS (default 90 s); anything beyond that is refused at once
// with a plain "busy, try again in a minute" (503 + Retry-After at the route).
//
// The queue is in memory, per process: on Railway that is one instance. The limiter is pinned on
// globalThis so every Next bundle layer that imports this module shares the one queue.

//
// Re-audit NEW-14: one person could fill both slots and the whole queue, and everyone else was then
// refused. Work carries a key (the person's user id): each key may have `perKeyActive` running
// (default 1) and `perKeyQueued` waiting (default 1); a key's next work waits for its own previous run
// even when a slot is free, and anything beyond is refused at once with its own plain sentence.

export type ConcurrencyOptions = {
  max: number;
  maxQueue: number;
  maxWaitMs: number;
  /** Most running per key (per person). Absent: no per-key cap. */
  perKeyActive?: number;
  /** Most waiting per key. Absent with perKeyActive: 0. */
  perKeyQueued?: number;
};

export type SlotRefusal = { ok: false; reason: "queue-full" | "timeout" | "key-busy"; retryAfterSec: number };
export type SlotResult<T> = { ok: true; value: T } | SlotRefusal;

export interface ConcurrencyLimiter {
  readonly options: Readonly<ConcurrencyOptions>;
  /** Work running now. */
  readonly active: number;
  /** Work waiting for a slot. */
  readonly waiting: number;
  /**
   * Runs `fn` when a slot is free (waiting in FIFO order, skipping keys at their own cap), or refuses
   * when the queue is full, the key already has its share, or the wait runs out.
   */
  run<T>(fn: () => Promise<T>, key?: string): Promise<SlotResult<T>>;
}

const RETRY_AFTER_SEC = 60;

type Waiter = { key: string | null; grant: () => void };

export function createConcurrencyLimiter(options: ConcurrencyOptions): ConcurrencyLimiter {
  const perKeyActive = options.perKeyActive === undefined ? undefined : Math.max(1, Math.floor(options.perKeyActive));
  const opts: ConcurrencyOptions = {
    max: Math.max(1, Math.floor(options.max)),
    maxQueue: Math.max(0, Math.floor(options.maxQueue)),
    maxWaitMs: Math.max(0, options.maxWaitMs),
    ...(perKeyActive !== undefined ? { perKeyActive, perKeyQueued: Math.max(0, Math.floor(options.perKeyQueued ?? 0)) } : {}),
  };
  let active = 0;
  const queue: Waiter[] = [];
  const activeBy = new Map<string, number>();
  const queuedBy = new Map<string, number>();
  // Counts per key; a key at zero keeps its entry (one per person who ever ran an agent: a few dozen).
  const bump = (m: Map<string, number>, key: string | null, d: number) => {
    if (key !== null) m.set(key, Math.max(0, (m.get(key) ?? 0) + d));
  };
  /** May work of this key start now (its own running cap)? */
  const keyFree = (key: string | null) => key === null || opts.perKeyActive === undefined || (activeBy.get(key) ?? 0) < opts.perKeyActive;

  /** Hand free slots to the first waiters whose key is under its cap (FIFO otherwise). */
  function pump() {
    while (active < opts.max) {
      const i = queue.findIndex((w) => keyFree(w.key));
      if (i < 0) return;
      const [w] = queue.splice(i, 1);
      bump(queuedBy, w.key, -1);
      active++;
      bump(activeBy, w.key, 1);
      w.grant();
    }
  }

  /** "granted" once this caller holds a slot; otherwise why it was refused. */
  function acquire(key: string | null): Promise<"granted" | "queue-full" | "timeout" | "key-busy"> {
    if (key !== null && opts.perKeyActive !== undefined && (activeBy.get(key) ?? 0) + (queuedBy.get(key) ?? 0) >= opts.perKeyActive + (opts.perKeyQueued ?? 0)) {
      return Promise.resolve("key-busy");
    }
    if (active < opts.max && keyFree(key)) {
      active++;
      bump(activeBy, key, 1);
      return Promise.resolve("granted");
    }
    if (queue.length >= opts.maxQueue) return Promise.resolve("queue-full");
    return new Promise((resolve) => {
      const waiter: Waiter = {
        key,
        grant: () => {
          clearTimeout(timer);
          resolve("granted");
        },
      };
      const timer = setTimeout(() => {
        const i = queue.indexOf(waiter);
        if (i >= 0) {
          queue.splice(i, 1);
          bump(queuedBy, key, -1);
        }
        resolve("timeout");
      }, opts.maxWaitMs);
      queue.push(waiter);
      bump(queuedBy, key, 1);
    });
  }

  function release(key: string | null) {
    active--;
    bump(activeBy, key, -1);
    pump();
  }

  return {
    options: opts,
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
    async run<T>(fn: () => Promise<T>, key?: string): Promise<SlotResult<T>> {
      const k = key ?? null;
      const got = await acquire(k);
      if (got !== "granted") return { ok: false, reason: got, retryAfterSec: RETRY_AFTER_SEC };
      try {
        return { ok: true, value: await fn() };
      } finally {
        release(k);
      }
    },
  };
}

// ------------------------------------------------------------------ agent runs

/** Per person: 1 run at a time and 1 more waiting (re-audit NEW-14; AGENT_RUN_PER_USER / AGENT_RUN_PER_USER_QUEUE). */
export const AGENT_RUN_DEFAULTS: Readonly<Required<ConcurrencyOptions>> = { max: 2, maxQueue: 6, maxWaitMs: 90_000, perKeyActive: 1, perKeyQueued: 1 };

const positiveInt = (v: string | undefined, fallback: number, min: number) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= min ? n : fallback;
};

/** AGENT_RUN_CONCURRENCY / AGENT_RUN_QUEUE / AGENT_RUN_QUEUE_WAIT_MS / AGENT_RUN_PER_USER / AGENT_RUN_PER_USER_QUEUE, else the defaults. */
export function agentRunOptions(env: Record<string, string | undefined> = process.env): ConcurrencyOptions {
  return {
    max: positiveInt(env.AGENT_RUN_CONCURRENCY, AGENT_RUN_DEFAULTS.max, 1),
    maxQueue: positiveInt(env.AGENT_RUN_QUEUE, AGENT_RUN_DEFAULTS.maxQueue, 0),
    maxWaitMs: positiveInt(env.AGENT_RUN_QUEUE_WAIT_MS, AGENT_RUN_DEFAULTS.maxWaitMs, 0),
    perKeyActive: positiveInt(env.AGENT_RUN_PER_USER, AGENT_RUN_DEFAULTS.perKeyActive, 1),
    perKeyQueued: positiveInt(env.AGENT_RUN_PER_USER_QUEUE, AGENT_RUN_DEFAULTS.perKeyQueued, 0),
  };
}

const globalSlots = globalThis as unknown as { __firmOsAgentRunSlots?: ConcurrencyLimiter };

/** The process-wide agent-run limiter (built on first use from the env). */
export function agentRunSlots(): ConcurrencyLimiter {
  return (globalSlots.__firmOsAgentRunSlots ??= createConcurrencyLimiter(agentRunOptions()));
}

/** The plain message for a refused agent run. */
export function agentRunBusyMessage(r: SlotRefusal, max: number): string {
  if (r.reason === "key-busy") return "You already have an agent run going and another one waiting. Wait for those to finish, then start this one again.";
  const running = `${max === 1 ? "An agent run is" : `${max} agent runs are`} already in progress on the server`;
  return r.reason === "timeout"
    ? `${running} and yours waited too long for a turn. The system is busy — try again in a minute.`
    : `${running} and others are waiting. The system is busy — try again in a minute.`;
}
