// ADR-005 database backstop, close-gate side: closeJob arms the DONE trigger (set_config) inside its
// own transaction, once, for the job it closes; a refused close never arms it. The trigger itself
// (prisma/migrations/20261106000000_firm_os_done_trigger) runs only against Postgres (CI e2e job).
import { describe, expect, it } from "vitest";
import { CloseLoopWorld } from "../../../tests/fakes/close-loop-world";
import { CLOSE_GATE_SETTING } from "@/lib/agents/core/state-db";
import { GATE_ACTOR, closeJob } from "./gate";

const NOW = new Date("2026-11-02T05:00:00.000Z");

function setup() {
  const w = new CloseLoopWorld();
  w.clock = () => NOW;
  return { w, deps: { db: w.db, verifier: w.verifier, now: () => NOW } };
}

describe("close gate arms the DONE trigger", () => {
  it("one set_config for this job, in the gate's transaction, and the job is DONE", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    const r = await closeJob(job.id, GATE_ACTOR, deps);
    expect(r).toMatchObject({ ok: true, state: "DONE" });
    expect(w.transactions).toBe(1);
    expect(w.rawQueries).toEqual([{ sql: "SELECT set_config(?, ?, true)", values: [CLOSE_GATE_SETTING, job.id], transaction: 1 }]);
  });

  it("a refused close (Turia not closed) never arms it", async () => {
    const { w, deps } = setup();
    const job = w.addJob();
    w.addFiledHistory(job.id);
    w.addFinal(job);
    expect(await closeJob(job.id, GATE_ACTOR, deps)).toMatchObject({ ok: false, state: "CLOSING" });
    expect(w.rawQueries).toEqual([]);
  });
});
