// Chaos: the database goes away mid-onboarding (Railway Postgres restart, failover, deploy that
// kills the process). The side effects of step N have happened, but the write that records step N
// as done never lands, and the request dies with the connection error. A NEW process (new saga
// instance) then resumes from what OnboardingRun.steps says.
// What a person sees: the run shows "Creating…" with step N still "running"; a click on Retry from
// another tab while the claim is fresh is refused ("already running"); once the claim is stale
// (10 min) Retry carries on from step N and the client ends up onboarded with nothing created
// twice — one LMS client, one CL- site and tree, one checklist per Turia operation, one JobTask
// per period.
//
// Finding (UI, reported, not fixed here): OnboardPanel offers Retry only for FAILED / BLOCKED, so a
// run left RUNNING by a crashed process has no Retry button until someone resumes it through the
// API. The saga itself supports the stale takeover tested below.
import { describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { STEP_KEYS, SagaError, normalizeSteps, type RunPatch, type SagaStore, type StepKey } from "@/lib/agents/onboarding/saga";
import type { MemoryOnboardingStore } from "../fakes/fake-onboarding-store";
import { NOW, expectCompleteNoDuplicates, onboardingWorld } from "./support/onboarding-world";

const DB_GONE = "Can't reach database server: Connection terminated unexpectedly";

/**
 * The saga's database through a connection that drops the moment the saga tries to record `crashAfter`
 * as finished (done / waiting), and stays down — every call fails — until restart().
 */
class DroppingDb implements SagaStore {
  down = false;
  crashed = false;
  constructor(
    private readonly inner: MemoryOnboardingStore,
    private readonly crashAfter: StepKey,
  ) {}
  private gate() {
    if (this.down) throw new Error(DB_GONE);
  }
  restart() {
    this.down = false;
  }
  async saveRun(id: string, patch: RunPatch) {
    this.gate();
    const finished = patch.steps?.find((s) => s.key === this.crashAfter && (s.status === "done" || s.status === "waiting"));
    if (finished && !this.crashed) {
      this.crashed = true;
      this.down = true; // the step's side effects happened; recording them does not
      throw new Error(DB_GONE);
    }
    return this.inner.saveRun(id, patch);
  }
  getRun: SagaStore["getRun"] = async (id) => (this.gate(), this.inner.getRun(id));
  claimRun: SagaStore["claimRun"] = async (id, staleBefore) => (this.gate(), this.inner.claimRun(id, staleBefore));
  createOrLinkClient: SagaStore["createOrLinkClient"] = async (i) => (this.gate(), this.inner.createOrLinkClient(i));
  setClientSite: SagaStore["setClientSite"] = async (id, url) => (this.gate(), this.inner.setClientSite(id, url));
  ensureEngagements: SagaStore["ensureEngagements"] = async (i) => (this.gate(), this.inner.ensureEngagements(i));
  ensureJobTasks: SagaStore["ensureJobTasks"] = async (i) => (this.gate(), this.inner.ensureJobTasks(i));
  listJobTasks: SagaStore["listJobTasks"] = async (id) => (this.gate(), this.inner.listJobTasks(id));
  activeUser: SagaStore["activeUser"] = async (id) => (this.gate(), this.inner.activeUser(id));
  audit: SagaStore["audit"] = async (e) => (this.gate(), this.inner.audit(e));
}

const ELEVEN_MIN = 11 * 60_000;

describe("database restart mid-saga → a new process resumes from OnboardingRun.steps", () => {
  // summary has no side effects worth crashing after; every other step does.
  for (const step of STEP_KEYS.filter((k) => k !== "summary")) {
    it(`crash just as "${step}" finishes: the run stays RUNNING at that step; after the stale window a new process finishes it with no duplicates`, async () => {
      const w = await onboardingWorld();
      const db = new DroppingDb(w.store, step);

      // Process 1 dies with the connection error.
      await expect(w.saga({ store: db }).execute(w.runId, "u-partner")).rejects.toThrow(DB_GONE);
      db.restart();

      // What the database says (what the Progress card shows): RUNNING, step still "running".
      const stuck = await w.stored();
      expect(stuck.status).toBe("RUNNING");
      const idx = STEP_KEYS.indexOf(step);
      const steps = normalizeSteps(stuck.steps);
      expect(steps[idx]).toMatchObject({ status: "running", attempts: 1 });
      for (const later of steps.slice(idx + 1)) expect(later.status).toBe("pending");

      // Process 2, right away (another tab's Retry): the claim is fresh → refused, nothing re-run.
      const busy = await w.saga({ store: db }).resume(w.runId, "u-partner").catch((e: unknown) => e);
      expect(busy).toBeInstanceOf(SagaError);
      expect((busy as SagaError).code).toBe("busy");

      // Process 3, after the stale window: resumes at the interrupted step and completes.
      const done = await w.saga({ store: db, now: () => new Date(NOW.getTime() + ELEVEN_MIN) }).resume(w.runId, "u-partner");
      expect(done.status).toBe("DONE");
      const after = normalizeSteps(done.steps);
      expect(after[idx]).toMatchObject({ attempts: 2 });
      expect(after.every((s) => s.status === "done" || s.status === "waiting")).toBe(true);
      // Steps recorded "done" are not re-run; "waiting" ones (Turia checklists) are re-checked, which
      // re-uses the issued checklists — expectCompleteNoDuplicates below proves nothing is issued twice.
      steps.slice(0, idx).forEach((before, i) => {
        if (before.status === "done") expect(after[i].attempts).toBe(1);
      });
      expectCompleteNoDuplicates(w);
      expect(w.store.audits.map((a) => a.action)).toEqual(["onboarding.done"]);
    });
  }

  it("the database is down when the run starts: nothing is claimed or created; Create works once it is back", async () => {
    const w = await onboardingWorld();
    const db = new DroppingDb(w.store, "lmsClient");
    db.down = true;
    db.crashed = true;
    await expect(w.saga({ store: db }).execute(w.runId, "u-partner")).rejects.toThrow(DB_GONE);
    expect((await w.stored()).status).toBe("CONFIRMED"); // untouched: Create is still offered
    expect(w.store.clients).toEqual([]);
    expect(w.fake.mutations).toEqual([]);
    db.restart();
    expect((await w.saga({ store: db }).execute(w.runId, "u-partner")).status).toBe("DONE");
    expectCompleteNoDuplicates(w);
  });
});
