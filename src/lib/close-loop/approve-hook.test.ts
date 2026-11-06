// approvePack (the /agents review screen's "Approve pack") fires the close-loop afterTransition
// hook, injected into the agents service (withCloseLoopHook), the same dispatcher the
// /api/firm-os/jobs/[id]/state route runs. The hook copies Working → Final through finalizeRun;
// approvePack's own finalizeRun after it, and any later firing, must add nothing.
import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { approvePack, requestChanges, startAgentRun, submitForReview, type AgentServiceDeps } from "@/lib/agents/service";
import { FINAL, echoWorld, rows, user, type World } from "../../../tests/fakes/agent-world";
import { recordingHook } from "../../../tests/fakes/agent-close-loop";
import { afterTransition } from "./hooks";
import { closeLoopTransitionHook, withCloseLoopHook } from "./defaults";

const finals = (w: World) => rows(w.db, "deliverable").filter((d) => d.kind === "Final");
const audits = (w: World, action: string) => rows(w.db, "auditEvent").filter((a) => a.action === action);

async function toReview(w: World, deps: AgentServiceDeps) {
  await startAgentRun(user("priya"), "echo", "job-1", deps);
  await submitForReview(user("priya"), "run-1", deps);
}

describe("approvePack fires the close-loop hook", () => {
  it("once, on IN_REVIEW → APPROVED, as the approver; the hook copies to Final and approvePack's finalize adds nothing", async () => {
    const w = echoWorld();
    const { hook, outcomes } = recordingHook(w);
    const deps = withCloseLoopHook(w.deps, hook);
    await toReview(w, deps);
    hook.mockClear();
    outcomes.length = 0;

    const out = await approvePack(user("ravi"), "run-1", null, deps);
    expect(out).toEqual({ ok: true, data: { state: "APPROVED", final: ["ACME01_Echo-register_2026-10_v1.xlsx"] } });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0]).toMatchObject({ ok: true, jobTaskId: "job-1", from: "IN_REVIEW", to: "APPROVED" });
    expect(hook.mock.calls[0][1]).toMatchObject({ id: "u-ravi" });
    expect(outcomes).toEqual([{ hook: "approved", result: { status: "copied", copied: 1 } }]);
    expect(audits(w, "copy-to-final")).toEqual([expect.objectContaining({ actorId: "system:close-loop-hook", entityId: "job-1" })]);
    expect(finals(w)).toHaveLength(1);
    expect(w.fake.filesIn(w.drive, FINAL)).toEqual(["ACME01_Echo-register_2026-10_v1.xlsx"]);
  });

  it("a second firing (and a second copy) is a no-op: one Final row, one Final file", async () => {
    const w = echoWorld();
    const { hook, deps: hookDeps } = recordingHook(w);
    const deps = withCloseLoopHook(w.deps, hook);
    await toReview(w, deps);
    await approvePack(user("ravi"), "run-1", null, deps);
    const approved = hook.mock.calls.find((c) => c[0].to === "APPROVED")![0];

    // The same dispatcher again (the /state route, the reconciler or a retried request).
    expect(await afterTransition(approved, user("ravi"), hookDeps)).toEqual({ hook: "approved", result: { status: "already-final", finals: 1 } });
    // The copy itself again, bypassing the Final-rows short-circuit: finalizeRun is idempotent.
    await hookDeps.copyToFinal("job-1", user("ravi"));
    expect(finals(w)).toHaveLength(1);
    expect(w.fake.filesIn(w.drive, FINAL)).toEqual(["ACME01_Echo-register_2026-10_v1.xlsx"]);
    expect(audits(w, "copy-to-final")).toHaveLength(1);
    expect(w.fake.violations).toEqual([]);
  });

  it("a throwing hook never fails the approval: approvePack's finalize still copies", async () => {
    const w = echoWorld();
    const hook = vi.fn(async () => {
      throw new Error("hook exploded");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = withCloseLoopHook(w.deps, hook);
    await toReview(w, deps);
    expect(await approvePack(user("ravi"), "run-1", null, deps)).toMatchObject({ ok: true, data: { final: ["ACME01_Echo-register_2026-10_v1.xlsx"] } });
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/afterTransition hook failed for job-1 IN_REVIEW → APPROVED: hook exploded/));
    expect(rows(w.db, "jobTask")[0].state).toBe("APPROVED");
    expect(finals(w)).toHaveLength(1);
  });

  it("when SharePoint fails, the hook records the failure and approvePack returns the Copy to Final retry", async () => {
    const w = echoWorld();
    const { hook, outcomes } = recordingHook(w);
    w.deps.store = { ...w.deps.store, copyVersioned: async () => Promise.reject(new Error("Graph 503")) };
    const deps = withCloseLoopHook(w.deps, hook);
    await toReview(w, deps);
    expect(await approvePack(user("ravi"), "run-1", null, deps)).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/Copy to Final/) });
    expect(outcomes.at(-1)).toMatchObject({ hook: "approved", result: { status: "failed", reason: expect.stringMatching(/copying it to the Final folder failed/) } });
    expect(audits(w, "copy-to-final-failed")).toHaveLength(1);
    expect(rows(w.db, "jobTask")[0].state).toBe("APPROVED");
  });

  it("submit and request changes fire it too; the dispatcher has nothing to do on those edges", async () => {
    const w = echoWorld();
    const { hook, outcomes } = recordingHook(w);
    const deps = withCloseLoopHook(w.deps, hook);
    await toReview(w, deps);
    await requestChanges(user("ravi"), "run-1", "Recheck INV-2", deps);
    expect(hook.mock.calls.map((c) => `${c[0].from}→${c[0].to}`)).toEqual(["AGENT_DONE→IN_REVIEW", "IN_REVIEW→IN_PREP"]);
    expect(outcomes).toEqual([null, null]);
  });

  it("without an injected hook the service behaves as before (no close-loop import needed)", async () => {
    const w = echoWorld();
    await toReview(w, w.deps);
    expect(await approvePack(user("ravi"), "run-1", null, w.deps)).toMatchObject({ ok: true });
    expect(audits(w, "copy-to-final")).toHaveLength(0);
    expect(finals(w)).toHaveLength(1);
  });
});

describe("production wiring", () => {
  it("withCloseLoopHook injects closeLoopTransitionHook, which builds the close-loop deps per call", async () => {
    const w = echoWorld();
    expect(typeof withCloseLoopHook(w.deps).afterTransition).toBe("function");
    const build = vi.fn(() => recordingHook(w).deps);
    const hook = closeLoopTransitionHook(build);
    const t = { ok: true as const, jobTaskId: "job-1", from: "AGENT_DONE" as const, to: "IN_REVIEW" as const, edge: "submit" as never, eventId: "e", at: new Date() };
    expect(await hook(t, user("priya") as Session["user"])).toBeNull();
    expect(build).toHaveBeenCalledTimes(1);
  });
});
