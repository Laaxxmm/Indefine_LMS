// Human close-loop actions end to end over the fake world: mark filed → hook → CLOSING → Turia
// close → gate → DONE; access rules; DONE can never be requested directly.
import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { TuriaConfirmError } from "@/lib/integrations/turia/errors";
import { CloseLoopWorld } from "../../../tests/fakes/close-loop-world";
import { canActOnJob, confirmTuriaClose, markFiled, setJobState, type CloseLoopDeps } from "./actions";
import { CloseLoopError } from "./errors";
import { GATE_ACTOR_REF, parseGateEvidence } from "./gate";
import type { CopyToFinal } from "./hooks";

const NOW = new Date("2026-11-02T05:00:00.000Z");
const person = (id: string, level = "EXECUTIVE", over: Record<string, unknown> = {}) =>
  ({ id, name: id, email: `${id}@x`, image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level, ...over }) as unknown as Session["user"];
const priya = person("u-priya");
const ravi = person("u-ravi", "SENIOR_EXECUTIVE");
const other = person("u-other");
const manager = person("u-mgr", "MANAGER");
const partnerAdmin = person("u-partner", "PARTNER", { role: "ADMIN" });
const itAdmin = person("u-it", "EXECUTIVE", { role: "ADMIN" });

function setup() {
  const w = new CloseLoopWorld();
  w.clock = () => NOW;
  const manual = new ManualBridge(w.turiaRepo, () => NOW);
  const copyToFinal = vi.fn<CopyToFinal>(async () => ({ copied: 1 }));
  const deps: CloseLoopDeps = { db: w.db, verifier: w.verifier, turia: manual, manual, copyToFinal, now: () => NOW };
  return { w, deps, copyToFinal };
}

/** An APPROVED GST job whose Final file is already in SharePoint. */
function approvedJob(w: CloseLoopWorld) {
  const job = w.addJob({ state: "APPROVED", ackRef: null, filedAt: null, filedById: null });
  w.addEvent(job.id, "IN_REVIEW", "APPROVED", new Date(NOW.getTime() - 3_600_000), "u-ravi");
  w.addFinal(job);
  return job;
}

async function rejects(p: Promise<unknown>, code: string, msg?: RegExp) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(CloseLoopError);
  expect((e as CloseLoopError).code).toBe(code);
  if (msg) expect((e as Error).message).toMatch(msg);
}

describe("golden path: mark filed → Turia close → DONE", () => {
  it("assignee files with ARN, the hook moves to CLOSING, the Turia close lets the gate close the job", async () => {
    const { w, deps } = setup();
    const job = approvedJob(w);

    const filed = await markFiled(job.id, { ackRef: "AA2710260012345" }, priya, deps);
    expect(filed).toMatchObject({ state: "CLOSING", ackRef: "AA2710260012345", turia: { status: "needs-input" } });
    expect(filed.prompt).toMatch(/Turia/);
    expect(w.job(job.id)).toMatchObject({ filedById: "u-priya", state: "CLOSING" });

    const r = await confirmTuriaClose(job.id, { turiaTaskRef: "TT-77", minutes: 120 }, priya, deps);
    expect(r.turia).toMatchObject({ status: "CLOSED", turiaRef: "TT-77", minutesLogged: 120 });
    expect(r.close).toMatchObject({ ok: true, state: "DONE" });
    expect(w.job(job.id).state).toBe("DONE");
    const doneEv = w.events.find((e) => e.toState === "DONE")!;
    expect(doneEv.actorId).toBe(GATE_ACTOR_REF);
    expect(parseGateEvidence(doneEv.note)?.turia).toMatchObject({ turiaRef: "TT-77", minutesLogged: 120, confirmedById: "u-priya" });
    expect(w.audits.map((a) => a.action)).toEqual(["confirm-filed", "turia-close-confirmed", "close"]);
    expect(w.audits[0]).toMatchObject({ actorId: "u-priya", entity: "JobTask", entityId: job.id, meta: { from: "APPROVED", to: "FILED_BY_HUMAN" } });
  });

  it("with the Turia ref and minutes given at filing, the checklist is issued straight away", async () => {
    const { w, deps } = setup();
    const job = approvedJob(w);
    const filed = await markFiled(job.id, { ackRef: "AA1", turiaTaskRef: "TT-1", minutes: 30 }, priya, deps);
    expect(filed.turia).toMatchObject({ status: "issued" });
    const r = await confirmTuriaClose(job.id, { turiaTaskRef: "TT-1", minutes: 35 }, priya, deps);
    expect(w.syncs).toHaveLength(1);
    expect(r.close.ok).toBe(true);
  });

  it("Turia closed but no Final file: the job stays CLOSING with the reason", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "APPROVED", ackRef: null, filedAt: null, filedById: null });
    await markFiled(job.id, { ackRef: "AA1" }, priya, deps);
    const r = await confirmTuriaClose(job.id, { turiaTaskRef: "TT-2", minutes: 10 }, priya, deps);
    expect(r.close).toMatchObject({ ok: false, state: "CLOSING" });
    expect(!r.close.ok && r.close.reasons.join(" ")).toMatch(/No Final deliverable/);
    expect(w.job(job.id).state).toBe("CLOSING");
  });

  it("a Turia close on a FILED_BY_HUMAN job (hook missed) moves it to CLOSING first", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "FILED_BY_HUMAN" });
    w.addEvent(job.id, "APPROVED", "FILED_BY_HUMAN", new Date(NOW.getTime() - 60_000));
    w.addFinal(job);
    const r = await confirmTuriaClose(job.id, { turiaTaskRef: "TT-3", minutes: 15 }, ravi, deps);
    expect(r.close.ok).toBe(true);
    expect(w.events.map((e) => `${e.fromState}>${e.toState}:${e.actorId}`)).toContain("FILED_BY_HUMAN>CLOSING:system:close-loop-hook");
  });

  it("confirming again with a different ref is a conflict; the same ref is idempotent", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    w.syncs.length = 0;
    await confirmTuriaClose(job.id, { turiaTaskRef: "TT-5", minutes: 5 }, priya, deps);
    const j2 = w.addJob();
    w.addFiledHistory(j2.id);
    await confirmTuriaClose(j2.id, { turiaTaskRef: "TT-6", minutes: 5 }, priya, deps);
    await confirmTuriaClose(j2.id, { turiaTaskRef: "TT-6", minutes: 5 }, priya, deps);
    const e = await confirmTuriaClose(j2.id, { turiaTaskRef: "TT-OTHER", minutes: 5 }, priya, deps).catch((x) => x);
    expect(e).toBeInstanceOf(TuriaConfirmError);
    expect(e.code).toBe("conflict");
  });
});

describe("refusals", () => {
  it("GST filing without the ARN is invalid; the job stays APPROVED", async () => {
    const { w, deps } = setup();
    const job = approvedJob(w);
    await rejects(markFiled(job.id, {}, priya, deps), "invalid", /Enter the acknowledgement number for this GST filing/);
    expect(w.job(job.id).state).toBe("APPROVED");
  });

  it("marking a job filed that is not APPROVED is a conflict", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "IN_REVIEW" });
    await rejects(markFiled(job.id, { ackRef: "A" }, priya, deps), "conflict");
  });

  it("Turia close before filing is a state error", async () => {
    const { w, deps } = setup();
    const job = approvedJob(w);
    await rejects(confirmTuriaClose(job.id, { turiaTaskRef: "T", minutes: 5 }, priya, deps), "state", /after the job is marked filed/);
  });

  it("unknown job → not-found", async () => {
    const { deps } = setup();
    await rejects(markFiled("nope", { ackRef: "A" }, priya, deps), "not-found");
  });
});

describe("access", () => {
  it.each([
    ["assignee", priya, true],
    ["reviewer", ravi, true],
    ["manager", manager, true],
    ["partner who is also an LMS admin", partnerAdmin, true],
    ["other staff", other, false],
    ["IT admin", itAdmin, false],
    ["inactive assignee", person("u-priya", "EXECUTIVE", { active: false }), false],
    ["signed out", null, false],
  ])("%s → %s", async (_n, user, allowed) => {
    expect(canActOnJob(user, { assigneeId: "u-priya", reviewerId: "u-ravi" })).toBe(allowed);
    const { w, deps } = setup();
    const job = approvedJob(w);
    const p = markFiled(job.id, { ackRef: "AA1" }, user, deps);
    if (allowed) await expect(p).resolves.toMatchObject({ state: "CLOSING" });
    else await rejects(p, "forbidden");
  });
});

describe("setJobState: DONE is never settable directly", () => {
  it("a request for DONE is refused with gate-required, audited, and changes nothing", async () => {
    const { w, deps } = setup();
    const { job } = w.readyJob();
    await rejects(setJobState(job.id, { to: "DONE", expectedState: "CLOSING" }, partnerAdmin, deps), "gate-required", /marked done only by the closing checks/);
    expect(w.job(job.id).state).toBe("CLOSING");
    expect(w.events.some((e) => e.toState === "DONE")).toBe(false);
    expect(w.audits).toEqual([expect.objectContaining({ action: "done-refused", actorId: "u-partner", entityId: job.id })]);
  });

  it("FILED_BY_HUMAN must go through Mark filed", async () => {
    const { w, deps } = setup();
    await rejects(setJobState(approvedJob(w).id, { to: "FILED_BY_HUMAN", expectedState: "APPROVED" }, priya, deps), "invalid");
  });

  it("approval by the reviewer runs the Final-copy hook", async () => {
    const { w, deps, copyToFinal } = setup();
    const job = w.addJob({ state: "IN_REVIEW", ackRef: null, filedAt: null, filedById: null });
    const r = await setJobState(job.id, { to: "APPROVED", expectedState: "IN_REVIEW" }, ravi, deps);
    expect(r).toMatchObject({ state: "APPROVED", hook: { hook: "approved", result: { status: "copied", copied: 1 } } });
    expect(copyToFinal).toHaveBeenCalledWith(job.id, ravi);
  });

  it("state-machine refusals keep their meaning (self-approval → forbidden, illegal edge → state)", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "IN_REVIEW" });
    await rejects(setJobState(job.id, { to: "APPROVED", expectedState: "IN_REVIEW" }, priya, deps), "forbidden");
    await rejects(setJobState(job.id, { to: "CLOSING", expectedState: "IN_REVIEW" }, manager, deps), "state");
    await rejects(setJobState(job.id, { to: "IN_PREP", expectedState: "IN_REVIEW" }, manager, deps), "invalid", /what needs to change/);
    await rejects(setJobState(job.id, { to: "IN_PREP", expectedState: "AGENT_DONE", note: "x" }, manager, deps), "conflict");
  });
});
