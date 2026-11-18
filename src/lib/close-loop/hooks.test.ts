// Close-loop hooks: APPROVED → Final copy; FILED_BY_HUMAN → Turia close step + CLOSING.
import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { BlockedError } from "@/lib/integrations/sharepoint/errors";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { UiAutomationBridge } from "@/lib/integrations/turia/ui-bridge";
import type { TransitionResult } from "@/lib/agents/core/state-db";
import { CloseLoopWorld } from "../../../tests/fakes/close-loop-world";
import { afterTransition, onApproved, onFiledByHuman, type CopyToFinal } from "./hooks";

const NOW = new Date("2026-11-02T05:00:00.000Z");
const user = { id: "u-ravi", name: "Ravi", email: "r@x", role: "EMPLOYEE", active: true, level: "SENIOR_EXECUTIVE", department: "GENERAL" } as unknown as Session["user"];

function setup() {
  const w = new CloseLoopWorld();
  w.clock = () => NOW;
  const copyToFinal = vi.fn<CopyToFinal>(async () => ({ copied: 2 }));
  const turia = new ManualBridge(w.turiaRepo, () => NOW);
  return { w, deps: { db: w.db, turia, copyToFinal, now: () => NOW }, copyToFinal };
}

describe("onApproved", () => {
  it("copies to Final as the approver and records it", async () => {
    const { w, deps, copyToFinal } = setup();
    const job = w.addJob({ state: "APPROVED" });
    expect(await onApproved(job.id, user, deps)).toEqual({ status: "copied", copied: 2 });
    expect(copyToFinal).toHaveBeenCalledWith(job.id, user);
    expect(w.audits[0]).toMatchObject({ action: "copy-to-final", actorId: "system:close-loop-hook", meta: { copied: 2 } });
  });

  it("does nothing when Final copies already exist (idempotent)", async () => {
    const { w, deps, copyToFinal } = setup();
    const job = w.addJob({ state: "APPROVED" });
    w.addFinal(job);
    expect(await onApproved(job.id, user, deps)).toEqual({ status: "already-final", finals: 1 });
    expect(copyToFinal).not.toHaveBeenCalled();
  });

  it("a blocked or failing copy is reported and audited, never thrown", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "APPROVED" });
    const blocked = await onApproved(job.id, user, { ...deps, copyToFinal: async () => Promise.reject(new BlockedError("Grant Sites.ReadWrite.All")) });
    expect(blocked).toEqual({ status: "blocked", reason: "Grant Sites.ReadWrite.All" });
    const failed = await onApproved(job.id, user, { ...deps, copyToFinal: async () => Promise.reject(new Error("409 conflict")) });
    expect(failed).toEqual({ status: "failed", reason: "409 conflict" });
    expect(w.audits.map((a) => a.action)).toEqual(["copy-to-final-blocked", "copy-to-final-failed"]);
  });
});

describe("onFiledByHuman", () => {
  it("issues the Turia close checklist at once and moves the job to CLOSING", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "FILED_BY_HUMAN" });
    const r = await onFiledByHuman(job.id, deps, { turiaTaskRef: "TT-9", minutes: 45, actorId: "u-priya" });
    expect(r.turia).toMatchObject({ status: "issued", mode: "MANUAL", reused: false });
    expect(r.turia.status === "issued" && r.turia.checklist?.operation).toBe("closeTask");
    expect(w.syncs).toHaveLength(1);
    expect(w.syncs[0]).toMatchObject({ jobTaskId: job.id, operation: "closeTask", status: "CHECKLIST_ISSUED" });
    expect(r.closing).toMatchObject({ ok: true, from: "FILED_BY_HUMAN", to: "CLOSING" });
    expect(w.job(job.id).state).toBe("CLOSING");
    expect(w.events.at(-1)).toMatchObject({ actorId: "system:close-loop-hook", toState: "CLOSING" });
    expect(r.prompt).toMatch(/Close the Turia task now/);
  });

  it("uses the confirmed createTask ref when none is given; re-issuing reuses the row", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "FILED_BY_HUMAN" });
    w.addCloseSync(job.id, { operation: "createTask", status: "CONFIRMED", turiaRef: "TT-CREATED", evidence: { key: `createTask:${job.id}` } });
    const r = await onFiledByHuman(job.id, deps, { minutes: 30 });
    expect(r.turia).toMatchObject({ status: "issued" });
    const close = w.syncs.find((s) => s.operation === "closeTask")!;
    expect(JSON.stringify(close.evidence)).toContain("TT-CREATED");
    const again = await onFiledByHuman(job.id, deps, { minutes: 30 });
    expect(again.turia).toMatchObject({ status: "issued", reused: true });
    expect(again.closing).toMatchObject({ ok: false, code: "ILLEGAL_EDGE" });
  });

  it("without a task ref or minutes the step waits for staff input, and the job still moves to CLOSING", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "FILED_BY_HUMAN" });
    const r = await onFiledByHuman(job.id, deps);
    expect(r.turia).toEqual({ status: "needs-input", missing: ["turiaTaskRef", "minutes"] });
    expect(w.job(job.id).state).toBe("CLOSING");
    const r2 = await onFiledByHuman(w.addJob({ state: "FILED_BY_HUMAN" }).id, deps, { turiaTaskRef: "TT-1" });
    expect(r2.turia).toEqual({ status: "needs-input", missing: ["minutes"] });
  });

  it("a blocked bridge (UI automation off) is recorded; closing still happens", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "FILED_BY_HUMAN" });
    const r = await onFiledByHuman(job.id, { ...deps, turia: new UiAutomationBridge({ env: {} }) }, { turiaTaskRef: "TT-1", minutes: 10 });
    expect(r.turia).toMatchObject({ status: "blocked" });
    expect(w.job(job.id).state).toBe("CLOSING");
    expect(w.audits[0]).toMatchObject({ action: "turia-close-step-failed" });
    const failing = { ...deps.turia, mode: "MANUAL" as const, closeTask: async () => Promise.reject(new Error("db down")) };
    const r2 = await onFiledByHuman(w.addJob({ state: "FILED_BY_HUMAN" }).id, { ...deps, turia: failing as unknown as ManualBridge }, { turiaTaskRef: "T", minutes: 1 });
    expect(r2.turia).toEqual({ status: "failed", reason: "db down" });
  });

  it("an unknown job", async () => {
    const { deps } = setup();
    const r = await onFiledByHuman("missing", deps);
    expect(r.closing).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(r.turia).toMatchObject({ status: "failed" });
  });
});

describe("afterTransition", () => {
  const ok = (from: string, to: string, jobTaskId: string) =>
    ({ ok: true, jobTaskId, from, to, edge: "approve", eventId: "e", at: NOW }) as Extract<TransitionResult, { ok: true }>;

  it("dispatches APPROVED (from review) and FILED_BY_HUMAN; nothing for other edges", async () => {
    const { w, deps, copyToFinal } = setup();
    const a = w.addJob({ state: "APPROVED" });
    expect(await afterTransition(ok("IN_REVIEW", "APPROVED", a.id), user, deps)).toMatchObject({ hook: "approved", result: { status: "copied" } });
    expect(await afterTransition(ok("FILED_BY_HUMAN", "APPROVED", a.id), user, deps)).toBeNull();
    const f = w.addJob({ state: "FILED_BY_HUMAN" });
    expect(await afterTransition(ok("APPROVED", "FILED_BY_HUMAN", f.id), user, deps)).toMatchObject({ hook: "filed", result: { closing: { ok: true } } });
    expect(await afterTransition(ok("ASSIGNED", "IN_PREP", f.id), user, deps)).toBeNull();
    expect(copyToFinal).toHaveBeenCalledTimes(1);
  });
});
