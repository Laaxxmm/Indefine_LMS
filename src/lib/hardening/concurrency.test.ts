// Security audit #8: the rate limiter failed open when the DB pool was exhausted (P2024), and a
// burst of agent runs could exhaust the 5-connection pool. Ported from the audit PoC
// (.audit-sec/secrets/area-a-secrets-config.test.ts "rate limiter fails open"): the same throwing
// store now gets 503, and agent runs are capped per process.
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAILURE_MODE, RATE_LIMIT_SCOPES, enforceRateLimit, type RateLimitStore } from "./rate-limit";
import { AGENT_RUN_DEFAULTS, agentRunBusyMessage, agentRunOptions, agentRunSlots, createConcurrencyLimiter } from "./concurrency";
import { toJson } from "@/lib/agents/http";
import { startAgentRun, rerunAgent } from "@/lib/agents/service";
import { echoWorld, rows, user } from "../../../tests/fakes/agent-world";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() })); // http.ts imports it; toJson does not use it

const P2024 = () => Object.assign(new Error("Timed out fetching a new connection from the connection pool"), { code: "P2024" });

afterEach(() => vi.useRealTimers());

describe("rate limiter with an unavailable store (PoC #8)", () => {
  it.each(RATE_LIMIT_SCOPES)("%s fails closed on a P2024 pool timeout: 503 with Retry-After, never null", async (scope) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const store: RateLimitStore = { hit: async () => { throw P2024(); } };
    expect(FAILURE_MODE[scope]).toBe("closed");
    const res = await enforceRateLimit(scope, "user-x", { store });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    expect(res!.headers.get("Retry-After")).toBe("60");
    expect((await res!.json()).error).toBe("The system is busy — try again in a minute.");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("P2024"));
    expect(err).not.toHaveBeenCalledWith(expect.stringContaining("request allowed"));
  });

  it("a burst of 25 concurrent requests against a dead store: every one is refused, none runs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store: RateLimitStore = { hit: async () => { throw P2024(); } };
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => enforceRateLimit("agent-run", `u-${i % 3}`, { store })));
    expect(out.every((r) => r?.status === 503)).toBe(true);
  });
});

describe("concurrency limiter", () => {
  const gate = () => {
    let open!: () => void;
    const p = new Promise<void>((r) => (open = r));
    return { p, open };
  };

  it("never runs more than `max` at once; waiters run in FIFO order; a full queue is refused at once", async () => {
    const lim = createConcurrencyLimiter({ max: 2, maxQueue: 3, maxWaitMs: 10_000 });
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const g = gate();
    const work = (i: number) => async () => {
      running++;
      peak = Math.max(peak, running);
      order.push(i);
      await g.p;
      running--;
      return i;
    };
    const results = Array.from({ length: 10 }, (_, i) => lim.run(work(i)));
    await Promise.resolve();
    expect(lim.active).toBe(2);
    expect(lim.waiting).toBe(3);
    g.open();
    const settled = await Promise.all(results);
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(settled.filter((r) => r.ok).map((r) => (r.ok ? r.value : -1))).toEqual([0, 1, 2, 3, 4]);
    expect(settled.slice(5).every((r) => !r.ok && r.reason === "queue-full" && r.retryAfterSec === 60)).toBe(true);
    expect(lim.active).toBe(0);
    expect(lim.waiting).toBe(0);
  });

  it("a waiter that waits past maxWaitMs is refused (timeout) and leaves the queue", async () => {
    vi.useFakeTimers();
    const lim = createConcurrencyLimiter({ max: 1, maxQueue: 5, maxWaitMs: 1000 });
    const g = gate();
    const first = lim.run(() => g.p);
    const second = lim.run(async () => "ran");
    await Promise.resolve();
    expect(lim.waiting).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await second).toEqual({ ok: false, reason: "timeout", retryAfterSec: 60 });
    expect(lim.waiting).toBe(0);
    g.open();
    expect(await first).toEqual({ ok: true, value: undefined });
    expect(lim.active).toBe(0);
  });

  it("a throwing task releases its slot", async () => {
    const lim = createConcurrencyLimiter({ max: 1, maxQueue: 0, maxWaitMs: 0 });
    await expect(lim.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(lim.active).toBe(0);
    expect(await lim.run(async () => 1)).toEqual({ ok: true, value: 1 });
  });

  it("agent-run defaults: 2 at once, 6 waiting, 90 s; env overrides; bad values ignored; one process-wide limiter", () => {
    expect(AGENT_RUN_DEFAULTS).toEqual({ max: 2, maxQueue: 6, maxWaitMs: 90_000 });
    expect(agentRunOptions({})).toEqual(AGENT_RUN_DEFAULTS);
    expect(agentRunOptions({ AGENT_RUN_CONCURRENCY: "1", AGENT_RUN_QUEUE: "0", AGENT_RUN_QUEUE_WAIT_MS: "5000" })).toEqual({ max: 1, maxQueue: 0, maxWaitMs: 5000 });
    expect(agentRunOptions({ AGENT_RUN_CONCURRENCY: "0", AGENT_RUN_QUEUE: "-1", AGENT_RUN_QUEUE_WAIT_MS: "soon" })).toEqual(AGENT_RUN_DEFAULTS);
    expect(agentRunSlots()).toBe(agentRunSlots());
    expect(agentRunBusyMessage({ ok: false, reason: "queue-full", retryAfterSec: 60 }, 2)).toBe("2 agent runs are already in progress on the server and others are waiting. The system is busy — try again in a minute.");
  });
});

describe("agent runs through the service: a burst cannot exceed the slots", () => {
  /** Holds every model call until released, so runs stay "in progress". */
  function heldWorld() {
    const w = echoWorld();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const inner = w.deps.router;
    w.deps.router = { ...inner, run: (async (...args: Parameters<typeof inner.run>) => { await held; return inner.run(...args); }) as typeof inner.run };
    return { w, release };
  }

  it("with 1 slot and no queue, a second concurrent run gets 503 + Retry-After and writes nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { w, release } = heldWorld();
    const runSlots = createConcurrencyLimiter({ max: 1, maxQueue: 0, maxWaitMs: 0 });
    const deps = { ...w.deps, runSlots };
    const first = startAgentRun(user("priya"), "echo", "job-1", deps);
    await new Promise((r) => setTimeout(r, 0));
    const second = await startAgentRun(user("meera"), "echo", "job-1", deps);
    expect(second).toMatchObject({ ok: false, status: 503, retryAfterSec: 60 });
    expect(!second.ok && second.error).toMatch(/An agent run is already in progress on the server .* try again in a minute\./);
    const res = toJson(second);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    release();
    expect(await first).toMatchObject({ ok: true, data: { status: "AGENT_DONE" } });
    expect(rows(w.db, "agentRun")).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("run refused: queue-full"));
  });

  it("a refused re-run leaves the job where it was (the slot is taken before the transition)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = echoWorld();
    expect(await startAgentRun(user("priya"), "echo", "job-1", w.deps)).toMatchObject({ ok: true });
    const busy = createConcurrencyLimiter({ max: 1, maxQueue: 0, maxWaitMs: 0 });
    let free!: () => void;
    void busy.run(() => new Promise<void>((r) => (free = r))); // someone else's run holds the only slot
    const r = await rerunAgent(user("priya"), "run-1", "use the October register", { ...w.deps, runSlots: busy });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(rows(w.db, "jobTask")[0].state).toBe("AGENT_DONE");
    expect(rows(w.db, "agentRun")).toHaveLength(1);
    free();
  });
});
