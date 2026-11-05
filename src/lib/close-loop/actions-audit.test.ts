// Phase 11 audit trail for the human close-loop actions: mark filed and every other state edge
// (retract above all) write an AuditEvent; refused attempts write only the refusal.
import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { CloseLoopWorld } from "../../../tests/fakes/close-loop-world";
import { markFiled, setJobState, type CloseLoopDeps } from "./actions";
import type { CopyToFinal } from "./hooks";

const NOW = new Date("2026-11-02T05:00:00.000Z");
const person = (id: string, level = "EXECUTIVE") =>
  ({ id, name: id, email: `${id}@x`, image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level }) as unknown as Session["user"];

function setup() {
  const w = new CloseLoopWorld();
  w.clock = () => NOW;
  const manual = new ManualBridge(w.turiaRepo, () => NOW);
  const deps: CloseLoopDeps = { db: w.db, verifier: w.verifier, turia: manual, manual, copyToFinal: vi.fn<CopyToFinal>(async () => ({ copied: 1 })), now: () => NOW };
  return { w, deps };
}

describe("close-loop action audit trail", () => {
  it("mark filed records confirm-filed with the ack ref; a manager's retraction records retract-filing with the note", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "APPROVED", ackRef: null, filedAt: null, filedById: null });
    w.addEvent(job.id, "IN_REVIEW", "APPROVED", new Date(NOW.getTime() - 3_600_000), "u-ravi");
    await markFiled(job.id, { ackRef: "AA2710260012345" }, person("u-priya"), deps);
    expect(w.audits[0]).toMatchObject({ actorId: "u-priya", action: "confirm-filed", entity: "JobTask", entityId: job.id, meta: { from: "APPROVED", to: "FILED_BY_HUMAN", ackRef: "AA2710260012345" } });

    const state = w.job(job.id).state;
    await setJobState(job.id, { to: "APPROVED", expectedState: state, note: "Wrong ARN typed" }, person("u-mgr", "MANAGER"), deps);
    expect(w.audits.at(-1)).toMatchObject({ actorId: "u-mgr", action: "retract-filing", entity: "JobTask", entityId: job.id, meta: { from: state, to: "APPROVED", note: "Wrong ARN typed" } });
  });

  it("a refused edge writes no transition event; a DONE request writes only done-refused", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "FILED_BY_HUMAN" });
    await expect(setJobState(job.id, { to: "APPROVED", expectedState: "FILED_BY_HUMAN", note: "x" }, person("u-priya"), deps)).rejects.toThrow(/manager or a partner/);
    await expect(setJobState(job.id, { to: "DONE", expectedState: "FILED_BY_HUMAN" }, person("u-mgr", "MANAGER"), deps)).rejects.toThrow(/marked done only by the closing checks/);
    expect(w.audits.map((a) => a.action)).toEqual(["done-refused"]);
  });
});
