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

export type ConcurrencyOptions = { max: number; maxQueue: number; maxWaitMs: number };

export type SlotRefusal = { ok: false; reason: "queue-full" | "timeout"; retryAfterSec: number };
export type SlotResult<T> = { ok: true; value: T } | SlotRefusal;

export interface ConcurrencyLimiter {
  readonly options: Readonly<ConcurrencyOptions>;
  /** Work running now. */
  readonly active: number;
  /** Work waiting for a slot. */
  readonly waiting: number;
  /** Runs `fn` when a slot is free (waiting in FIFO order), or refuses when the queue is full / the wait runs out. */
  run<T>(fn: () => Promise<T>): Promise<SlotResult<T>>;
}

const RETRY_AFTER_SEC = 60;

export function createConcurrencyLimiter(options: ConcurrencyOptions): ConcurrencyLimiter {
  const opts = { max: Math.max(1, Math.floor(options.max)), maxQueue: Math.max(0, Math.floor(options.maxQueue)), maxWaitMs: Math.max(0, options.maxWaitMs) };
  let active = 0;
  const queue: { grant: () => void }[] = [];

  /** "granted" once this caller holds a slot; otherwise why it was refused. */
  function acquire(): Promise<"granted" | "queue-full" | "timeout"> {
    if (active < opts.max) {
      active++;
      return Promise.resolve("granted");
    }
    if (queue.length >= opts.maxQueue) return Promise.resolve("queue-full");
    return new Promise((resolve) => {
      const waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve("granted");
        },
      };
      const timer = setTimeout(() => {
        const i = queue.indexOf(waiter);
        if (i >= 0) queue.splice(i, 1);
        resolve("timeout");
      }, opts.maxWaitMs);
      queue.push(waiter);
    });
  }

  function release() {
    const next = queue.shift();
    if (next) next.grant(); // the slot passes straight to the next waiter; `active` is unchanged
    else active--;
  }

  return {
    options: opts,
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
    async run<T>(fn: () => Promise<T>): Promise<SlotResult<T>> {
      const got = await acquire();
      if (got !== "granted") return { ok: false, reason: got, retryAfterSec: RETRY_AFTER_SEC };
      try {
        return { ok: true, value: await fn() };
      } finally {
        release();
      }
    },
  };
}

// ------------------------------------------------------------------ agent runs

export const AGENT_RUN_DEFAULTS: Readonly<ConcurrencyOptions> = { max: 2, maxQueue: 6, maxWaitMs: 90_000 };

const positiveInt = (v: string | undefined, fallback: number, min: number) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= min ? n : fallback;
};

/** AGENT_RUN_CONCURRENCY / AGENT_RUN_QUEUE / AGENT_RUN_QUEUE_WAIT_MS, else the defaults. */
export function agentRunOptions(env: Record<string, string | undefined> = process.env): ConcurrencyOptions {
  return {
    max: positiveInt(env.AGENT_RUN_CONCURRENCY, AGENT_RUN_DEFAULTS.max, 1),
    maxQueue: positiveInt(env.AGENT_RUN_QUEUE, AGENT_RUN_DEFAULTS.maxQueue, 0),
    maxWaitMs: positiveInt(env.AGENT_RUN_QUEUE_WAIT_MS, AGENT_RUN_DEFAULTS.maxWaitMs, 0),
  };
}

const globalSlots = globalThis as unknown as { __firmOsAgentRunSlots?: ConcurrencyLimiter };

/** The process-wide agent-run limiter (built on first use from the env). */
export function agentRunSlots(): ConcurrencyLimiter {
  return (globalSlots.__firmOsAgentRunSlots ??= createConcurrencyLimiter(agentRunOptions()));
}

/** The plain message for a refused agent run. */
export function agentRunBusyMessage(r: SlotRefusal, max: number): string {
  const running = `${max === 1 ? "An agent run is" : `${max} agent runs are`} already in progress on the server`;
  return r.reason === "timeout"
    ? `${running} and yours waited too long for a turn. The system is busy — try again in a minute.`
    : `${running} and others are waiting. The system is busy — try again in a minute.`;
}
