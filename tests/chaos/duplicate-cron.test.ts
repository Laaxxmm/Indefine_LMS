// Chaos: the close-loop cron fires more often than it should — the GitHub Actions schedule, a manual
// workflow re-run and a Railway cron all hitting /api/cron/firm-os/close-loop, every 30 minutes, for
// two working days — while SharePoint has an outage in the middle. Real reconciler, gate and
// ManualBridge over the in-memory close-loop world.
// What a person sees: one reminder per job per IST day, one escalation per recipient per job per
// day, a job that becomes closable is closed once (one DONE event), a DONE job whose Final file
// vanished raises one alert (never reopened), and an outage produces no false alarm.
//
// Sequential duplicate firing is covered here (green today). CONCURRENT firing (two requests in
// the same instant) double-nudges until CoachEvent.dedupeKey is used by the reconciler — see
// tests/chaos/after-merge/duplicate-cron-concurrent.pending.ts (depends on phase 11 merge).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { closeJob } from "@/lib/close-loop/gate";
import { reconcile, type ReconcileSummary } from "@/lib/close-loop/reconcile";
import { CloseLoopWorld } from "../fakes/close-loop-world";

const MON_0900_IST = new Date("2026-11-02T03:30:00.000Z");
const MIN = 60_000;
const FIRINGS_PER_TICK = 3; // schedule + manual re-run + second scheduler

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function world() {
  const w = new CloseLoopWorld();
  w.clock = () => new Date(); // follows the fake system time
  const deps = { db: w.db, verifier: w.verifier, turia: new ManualBridge(w.turiaRepo) };
  return { w, deps };
}

/** Every 30 minutes from 09:00 to 18:30 IST on `day` (0 = Mon), each tick fired several times. */
async function stormDay(deps: Parameters<typeof reconcile>[0], day: number, onTick?: (at: Date) => void): Promise<ReconcileSummary[]> {
  const out: ReconcileSummary[] = [];
  for (let slot = 0; slot < 20; slot++) {
    const at = new Date(MON_0900_IST.getTime() + day * 24 * 60 * MIN + slot * 30 * MIN + 2 * MIN);
    vi.setSystemTime(at);
    onTick?.(at);
    for (let f = 0; f < FIRINGS_PER_TICK; f++) out.push(await reconcile(deps));
  }
  return out;
}

const sum = (xs: ReconcileSummary[], k: "reminders" | "escalations") => xs.reduce((s, x) => s + x[k], 0);

describe("duplicate cron firing over two working days", () => {
  it("held job: exactly one reminder per IST day and one escalation per recipient once 24 h have passed", async () => {
    const { w, deps } = world();
    const filedAt = new Date(MON_0900_IST.getTime() + 30 * MIN); // Mon 09:30 IST, Final in place, Turia not closed
    const job = w.addJob({ filedAt });
    w.addFiledHistory(job.id, filedAt);
    w.addFinal(job);

    const mon = await stormDay(deps, 0);
    const tue = await stormDay(deps, 1);

    expect(sum(mon, "reminders")).toBe(1);
    expect(sum(mon, "escalations")).toBe(0);
    expect(sum(tue, "reminders")).toBe(1);
    expect(sum(tue, "escalations")).toBe(2); // reviewer + manager, once
    const byKey = w.coach.map((c) => `${c.kind}:${c.userId}`).sort();
    expect(byKey).toEqual(["escalation:u-mgr", "escalation:u-ravi", "reminder:u-priya", "reminder:u-priya"]);
    expect(w.job(job.id).state).toBe("CLOSING");
  });

  it("a job whose Turia close arrives mid-storm is closed exactly once (one DONE event, one close audit)", async () => {
    const { w, deps } = world();
    const filedAt = new Date(MON_0900_IST.getTime() - 60 * MIN);
    const job = w.addJob({ filedAt });
    w.addFiledHistory(job.id, filedAt);
    w.addFinal(job);
    await stormDay(deps, 0, (at) => {
      if (at.getTime() >= MON_0900_IST.getTime() + 3 * 60 * MIN && !w.syncs.some((s) => s.jobTaskId === job.id)) w.addCloseSync(job.id); // 12:00 IST
    });
    expect(w.job(job.id).state).toBe("DONE");
    expect(w.events.filter((e) => e.jobTaskId === job.id && e.toState === "DONE")).toHaveLength(1);
    expect(w.audits.filter((a) => a.action === "close" && a.entityId === job.id)).toHaveLength(1);
    expect(w.coach.filter((c) => c.jobTaskId === job.id && c.kind === "reminder")).toHaveLength(1); // the 09:02 reminder only
  });

  it("DONE job loses its Final file during a SharePoint outage: no alarm while unverifiable, then one alert, never reopened", async () => {
    const { w, deps } = world();
    const { job, deliverable } = w.readyJob({ filedAt: new Date(MON_0900_IST.getTime() - 120 * MIN) });
    vi.setSystemTime(MON_0900_IST);
    expect((await closeJob(job.id, { kind: "system", name: "setup" }, deps)).ok).toBe(true);
    const doneAt = w.job(job.id).doneAt;

    const summaries = await stormDay(deps, 0, (at) => {
      const h = (at.getTime() - MON_0900_IST.getTime()) / (60 * MIN);
      w.verifierError = h >= 2 && h < 4 ? new Error("Graph 503 after retries") : null; // 11:00–13:00 IST outage
      if (h >= 3 && w.sp.has(deliverable.driveItemId!)) w.loseFile(deliverable.driveItemId!); // removed during the outage
    });

    expect(summaries.some((s) => s.unverifiable.includes(job.id))).toBe(true);
    expect(summaries.filter((s) => s.alerts.includes(job.id))).toHaveLength(1); // first check after the outage, once
    expect(w.audits.filter((a) => a.action === "done-alert")).toHaveLength(1);
    expect(w.coach.filter((c) => c.kind === "escalation").map((c) => c.userId).sort()).toEqual(["u-mgr", "u-ravi"]);
    expect(w.job(job.id)).toMatchObject({ state: "DONE", doneAt }); // alert, never reopen
  });

  it("outside working hours the extra firings do nothing at all", async () => {
    const { w, deps } = world();
    const job = w.addJob({ filedAt: new Date(MON_0900_IST.getTime() - 26 * 60 * MIN) });
    w.addFiledHistory(job.id, job.filedAt!);
    w.addFinal(job);
    for (const iso of ["2026-11-01T05:00:00Z", "2026-11-02T14:00:00Z", "2026-11-02T20:30:00Z"]) {
      vi.setSystemTime(new Date(iso)); // Sun 10:30, Mon 19:30, Tue 02:00 IST
      for (let f = 0; f < FIRINGS_PER_TICK; f++) expect((await reconcile(deps)).skipped).toBe("outside-working-hours");
    }
    expect(w.coach).toEqual([]);
    expect(w.audits).toEqual([]);
  });
});
