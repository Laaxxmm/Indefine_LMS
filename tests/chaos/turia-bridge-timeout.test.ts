// Chaos: the Turia bridge times out — before its write, after its write (the reply is lost), or
// hangs outright — during onboarding and during the close loop. Real saga, real ManualBridge,
// real close-loop actions + gate, in-memory stores.
// What a person sees: the onboarding stops at "Turia client and services" (or "Assignment …")
// with the timeout in the message, and Retry finishes it with every Turia checklist issued
// exactly once; a second click while a step hangs is refused ("already running"); a timed-out
// "Record Turia close" can simply be repeated and the job closes once.
import { afterEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import type { Session } from "next-auth";
import { normalizeSteps, SagaError } from "@/lib/agents/onboarding/saga";
import type { TuriaAdapter } from "@/lib/integrations/turia/adapter";
import { ManualBridge, type NewTuriaSync, type TuriaSyncRepo } from "@/lib/integrations/turia/manual-bridge";
import { confirmTuriaClose, markFiled, type CloseLoopDeps } from "@/lib/close-loop/actions";
import type { CopyToFinal } from "@/lib/close-loop/hooks";
import { CloseLoopWorld } from "../fakes/close-loop-world";
import { FakeTuriaRepo } from "../fakes/fake-turia-repo";
import { NOW, expectCompleteNoDuplicates, onboardingWorld } from "./support/onboarding-world";

const TIMEOUT_MS = 30_000;

class TuriaTimeoutError extends Error {
  constructor() {
    super(`Turia bridge timed out after ${TIMEOUT_MS} ms`);
    this.name = "TuriaTimeoutError";
  }
}

type BridgeMethod = "createClient" | "addService" | "createTask" | "closeTask";

/**
 * The bridge times out on call number `onCall` of `method`: "before" = nothing written, "after" =
 * the TuriaSync row was written and then the reply was lost.
 */
function timeoutOn(adapter: TuriaAdapter, method: BridgeMethod, when: "before" | "after", onCall = 1): TuriaAdapter {
  let calls = 0;
  return new Proxy(adapter, {
    get(target, key, recv) {
      const v = Reflect.get(target, key, recv);
      if (typeof v !== "function") return v;
      if (key !== method) return v.bind(target);
      return async (...args: unknown[]) => {
        calls++;
        if (calls !== onCall) return v.apply(target, args);
        if (when === "before") throw new TuriaTimeoutError();
        await v.apply(target, args);
        throw new TuriaTimeoutError();
      };
    },
  });
}

/** The bridge never answers `method` (a hung request in a process that later dies). */
function hangOn(adapter: TuriaAdapter, method: BridgeMethod): TuriaAdapter {
  return new Proxy(adapter, {
    get(target, key, recv) {
      const v = Reflect.get(target, key, recv);
      if (typeof v !== "function") return v;
      if (key !== method) return v.bind(target);
      return () => new Promise(() => {});
    },
  });
}

afterEach(() => vi.useRealTimers());

describe("onboarding: Turia bridge timeout", () => {
  it("timeout before the write: the Turia step fails with the reason shown; Retry issues each checklist once", async () => {
    const w = await onboardingWorld();
    const failed = await w.saga({ turia: timeoutOn(w.manual, "addService", "before", 2) }).execute(w.runId, "u-partner");
    expect(failed.status).toBe("FAILED");
    // Stored as a classification for IT (onboarding/run-errors.ts); the page shows a plain sentence for it.
    expect(failed.error).toBe("Turia client and services failed: Turia: timed out");
    expect(await w.stepStatuses()).toMatchObject({ lmsClient: "done", turia: "failed", sharepoint: "pending", jobs: "pending" });
    expect(w.repo.rows.map((r) => r.operation)).toEqual(["createClient", "addService"]); // what landed before the timeout

    const resumed = await w.saga().resume(w.runId, "u-partner");
    expect(resumed.status).toBe("DONE");
    const turia = normalizeSteps(resumed.steps).find((s) => s.key === "turia")!;
    expect(turia).toMatchObject({ status: "waiting", attempts: 2 });
    expect(turia.action).toMatch(/Complete 4 Turia checklists/); // the person still has 4 checklists, not 5 or 6
    expectCompleteNoDuplicates(w);
  });

  it("timeout after the write (reply lost): Retry reuses the row that landed instead of issuing a second checklist", async () => {
    const w = await onboardingWorld();
    await w.saga({ turia: timeoutOn(w.manual, "createClient", "after") }).execute(w.runId, "u-partner");
    expect(w.repo.rows.map((r) => r.operation)).toEqual(["createClient"]); // landed, reply lost
    const resumed = await w.saga().resume(w.runId, "u-partner");
    expect(resumed.status).toBe("DONE");
    expectCompleteNoDuplicates(w); // still exactly one createClient checklist
  });

  it("timeout on a first-period Turia task (assignment step): jobs are kept, Retry issues the remaining tasks once", async () => {
    const w = await onboardingWorld();
    const failed = await w.saga({ turia: timeoutOn(w.manual, "createTask", "after", 2) }).execute(w.runId, "u-partner");
    expect(failed.error).toBe("Assignment, deadlines and Turia tasks failed: Turia: timed out");
    expect(await w.stepStatuses()).toMatchObject({ jobs: "done", assignment: "failed", summary: "pending" });
    expect(w.store.jobTasks).toHaveLength(w.plan.jobs.length);
    expect((await w.saga().resume(w.runId, "u-partner")).status).toBe("DONE");
    expectCompleteNoDuplicates(w);
  });

  it("a hung bridge call: a second Create/Retry is refused while it runs; after the stale window a new process takes over and finishes once", async () => {
    const w = await onboardingWorld();
    void w.saga({ turia: hangOn(w.manual, "addService") }).execute(w.runId, "u-partner"); // never settles
    await vi.waitFor(async () => expect((await w.stepStatuses()).turia).toBe("running"));

    // The person clicks Retry while the first execution is stuck: refused, nothing issued twice.
    const busy = await w.saga().resume(w.runId, "u-partner").catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(SagaError);
    expect((busy as SagaError).code).toBe("busy");
    expect((busy as SagaError).message).toBe("This onboarding is already running. Wait for it to finish, then refresh.");
    expect(w.repo.rows.map((r) => r.operation)).toEqual(["createClient"]);

    // That process died. Eleven minutes later the RUNNING claim is stale and Retry takes over.
    const later = new Date(NOW.getTime() + 11 * 60_000);
    const resumed = await w.saga({ now: () => later }).resume(w.runId, "u-partner");
    expect(resumed.status).toBe("DONE");
    expect(normalizeSteps(resumed.steps).find((s) => s.key === "turia")).toMatchObject({ attempts: 2 });
    expectCompleteNoDuplicates(w);
  });
});

describe("close loop: Turia close times out", () => {
  const T = new Date("2026-11-02T05:00:00.000Z"); // Mon 10:30 IST
  const priya = { id: "u-priya", name: "Priya", email: "priya@x", image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level: "EXECUTIVE" } as unknown as Session["user"];

  /** A TuriaSync table whose next create() lands and then loses its reply. */
  function lossyRepo(inner: TuriaSyncRepo): TuriaSyncRepo & { armed: boolean } {
    const r = {
      armed: true,
      findByKey: (k: string) => inner.findByKey(k),
      get: (id: string) => inner.get(id),
      update: (id: string, p: Parameters<TuriaSyncRepo["update"]>[1]) => inner.update(id, p),
      async create(row: NewTuriaSync) {
        const rec = await inner.create(row);
        if (r.armed) {
          r.armed = false;
          throw new TuriaTimeoutError();
        }
        return rec;
      },
    };
    return r;
  }

  it("the person sees the timeout, records the Turia close again, and the job reaches DONE with one closeTask row", async () => {
    const w = new CloseLoopWorld();
    w.clock = () => T;
    const repo = lossyRepo(w.turiaRepo);
    const manual = new ManualBridge(repo, () => T);
    const copyToFinal: CopyToFinal = async () => ({ copied: 0 });
    const deps: CloseLoopDeps = { db: w.db, verifier: w.verifier, turia: manual, manual, copyToFinal, now: () => T };
    const job = w.addJob({ state: "APPROVED", ackRef: null, filedAt: null, filedById: null });
    w.addEvent(job.id, "IN_REVIEW", "APPROVED", new Date(T.getTime() - 3_600_000), "u-ravi");
    w.addFinal(job);

    const filed = await markFiled(job.id, { ackRef: "AA2710260012345" }, priya, deps);
    expect(filed.state).toBe("CLOSING");

    await expect(confirmTuriaClose(job.id, { turiaTaskRef: "TT-4411", minutes: 90 }, priya, deps)).rejects.toThrow(`Turia bridge timed out after ${TIMEOUT_MS} ms`);
    expect(w.job(job.id).state).toBe("CLOSING"); // not DONE on a failed confirmation
    expect(w.syncs.filter((s) => s.operation === "closeTask")).toHaveLength(1); // the row landed, unconfirmed

    const again = await confirmTuriaClose(job.id, { turiaTaskRef: "TT-4411", minutes: 90 }, priya, deps);
    expect(again.close.ok).toBe(true);
    expect(w.job(job.id).state).toBe("DONE");
    const closes = w.syncs.filter((s) => s.operation === "closeTask");
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ status: "CLOSED", turiaRef: "TT-4411", minutesLogged: 90 });
    expect(w.events.filter((e) => e.jobTaskId === job.id && e.toState === "DONE")).toHaveLength(1);
  });

  it("closeTask is keyed by job: a repeated close reuses the confirmed row, and a different ref conflicts instead of double-closing", async () => {
    const repo = new FakeTuriaRepo();
    const manual = new ManualBridge(repo, () => T);
    const first = await manual.closeTask("TT-1", 30, { jobTaskId: "job-9" });
    await manual.confirm(first.syncId, { turiaRef: "TT-1", minutes: 30, confirmedBy: "u-priya" });
    const retry = await manual.closeTask("TT-1", 30, { jobTaskId: "job-9" });
    expect(retry).toMatchObject({ syncId: first.syncId, reused: true, status: "CLOSED" });
    await expect(manual.confirm(retry.syncId, { turiaRef: "TT-2", minutes: 30, confirmedBy: "u-priya" })).rejects.toThrow(/Already confirmed with Turia ref TT-1/);
    expect(repo.rows).toHaveLength(1);
  });
});
