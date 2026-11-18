// Phase 11 audit trail through the agent service: every create / approve / export / proposal the
// review flow makes writes an AuditEvent (via logAudit), and refused actions write none.
import { describe, expect, it } from "vitest";
import { addComment, approvePack, exportDeliverable, finalizeRun, logMistake, readDeliverable, requestChanges, rerunAgent, startAgentRun, submitForReview } from "./service";
import { echoWorld, rows, user } from "../../../tests/fakes/agent-world";

type Ev = { actorId: string | null; action: string; entity: string; entityId: string | null; meta?: Record<string, unknown> };
const events = (w: ReturnType<typeof echoWorld>) => (rows(w.db, "auditEvent") as unknown as Ev[]).filter((e) => e.action !== "guardrail-run");
const actions = (w: ReturnType<typeof echoWorld>) => events(w).map((e) => e.action);

describe("agent service audit trail", () => {
  it("run → submit → request changes → re-run → submit → approve, each recorded with the actor", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    expect(events(w)).toEqual([expect.objectContaining({ actorId: "u-priya", action: "agent-run", entity: "AgentRun", entityId: "run-1", meta: { agent: "echo", jobTaskId: "job-1", status: "AGENT_DONE" } })]);

    await submitForReview(user("priya"), "run-1", w.deps);
    expect(events(w).at(-1)).toMatchObject({ actorId: "u-priya", action: "submit-for-review", entity: "JobTask", entityId: "job-1", meta: { from: "AGENT_DONE", to: "IN_REVIEW", runId: "run-1" } });

    await requestChanges(user("ravi"), "run-1", "Recheck INV-2", w.deps);
    expect(events(w).slice(-2)).toEqual([
      expect.objectContaining({ actorId: "u-ravi", action: "request-changes", entityId: "job-1", meta: expect.objectContaining({ from: "IN_REVIEW", to: "IN_PREP", note: "Recheck INV-2" }) }),
      expect.objectContaining({ actorId: "u-ravi", action: "agent-run", entityId: "run-2" }),
    ]);

    await rerunAgent(user("priya"), "run-2", "Updated register", w.deps);
    expect(actions(w).slice(-2)).toEqual(["rerun-agent", "agent-run"]);

    await submitForReview(user("priya"), "run-3", w.deps);
    const r = await approvePack(user("ravi"), "run-3", "Looks right", w.deps);
    expect(r).toMatchObject({ ok: true });
    expect(events(w).slice(-2)).toEqual([
      expect.objectContaining({ actorId: "u-ravi", action: "approve", entity: "JobTask", entityId: "job-1", meta: expect.objectContaining({ to: "APPROVED", runId: "run-3", note: "Looks right" }) }),
      expect.objectContaining({ actorId: "u-ravi", action: "finalize", entity: "AgentRun", entityId: "run-3", meta: { jobTaskId: "job-1", files: [expect.stringMatching(/^ACME01_Echo-register_2026-10_v\d+\.xlsx$/)] } }),
    ]);

    // The "Copy to Final" retry copies nothing more and records nothing more.
    const before = events(w).length;
    await finalizeRun(user("ravi"), "run-3", w.deps);
    expect(events(w)).toHaveLength(before);
  });

  it("refused actions write no AuditEvent", async () => {
    const w = echoWorld();
    expect(await startAgentRun(user("outsider"), "echo", "job-1", w.deps)).toMatchObject({ ok: false, status: 404 });
    expect(await startAgentRun(user("ravi"), "echo", "job-1", w.deps)).toMatchObject({ ok: false, status: 403 });
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    await submitForReview(user("priya"), "run-1", w.deps);
    expect(await approvePack(user("priya"), "run-1", null, w.deps)).toMatchObject({ ok: false, status: 403 }); // self-approval
    expect(actions(w)).toEqual(["agent-run", "submit-for-review"]);
  });

  it("a download is an export; a preview read is not", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    const d = rows(w.db, "deliverable")[0] as { id: string; name: string };
    expect(await readDeliverable(user("ravi"), d.id, w.deps)).toMatchObject({ ok: true });
    expect(actions(w)).toEqual(["agent-run"]);
    const f = await exportDeliverable(user("ravi"), d.id, w.deps);
    expect(f.ok).toBe(true);
    expect(events(w).at(-1)).toMatchObject({ actorId: "u-ravi", action: "export", entity: "Deliverable", entityId: d.id, meta: { name: d.name, bytes: expect.any(Number) } });
    expect(await exportDeliverable(user("outsider"), d.id, w.deps)).toMatchObject({ ok: false, status: 404 });
    expect(actions(w)).toEqual(["agent-run", "export"]);
  });

  it("comments and mistake proposals are recorded", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    await addComment(user("ravi"), "run-1", "Check INV-3", w.deps);
    const proposal = { id: "echo.big-invoice", title: "Invoices above ₹20,000", severity: "warn", kind: "deterministic", check: "echo.amount-over", evidence: "row", params: { limitPaise: 2000000 } };
    const m = await logMistake(user("ravi"), "run-1", { finding: "Missed INV-2 above limit", ruleProposal: proposal }, w.deps);
    expect(m.ok).toBe(true);
    expect(events(w).slice(-2)).toEqual([
      expect.objectContaining({ actorId: "u-ravi", action: "comment", entity: "AgentRun", entityId: "run-1", meta: { text: "Check INV-3" } }),
      expect.objectContaining({ actorId: "u-ravi", action: "propose", entity: "MistakeLog", entityId: (m as { data: { id: string } }).data.id, meta: { runId: "run-1", agent: "echo" } }),
    ]);
  });
});
