// getNextTask: same visibility as "Waiting for you", ranked overdue-first by internal then
// statutory due; the action per state; SOP steps with the current one marked; the checklist; open
// questions; the "nothing due" case; the ranking seam; the NextTaskView contract.
import { describe, expect, it } from "vitest";
import { echoWorld, user, NOW } from "../../../tests/fakes/agent-world";
import { AGENTS, visibleAgents } from "@/lib/agents/registry";
import { NextTaskViewZ } from "./contract";
import { coachRank } from "./coach-rank";
import { actionFor, defaultRank, getNextTask, getNextTaskView, listNextTaskCandidates, rankCandidates, rankedNextTasks, type NextTaskCandidate, type NextTaskDeps } from "./next-task";
import { PORTAL_NOTE, sopSteps, stepChecklist } from "./sop-steps";

const agents = visibleAgents({ FIRM_OS_ECHO_AGENT: "1" });
const day = (s: string) => new Date(`${s}T00:00:00+05:30`);

function world(opts: Parameters<typeof echoWorld>[0] = {}) {
  const w = echoWorld(opts);
  const deps: NextTaskDeps = { db: w.db, now: () => NOW, agents };
  return { ...w, deps };
}

/** Extra jobs for ACME01 (fc1), assigned to priya and reviewed by ravi unless overridden. */
function addJob(w: ReturnType<typeof world>, id: string, over: Record<string, unknown> = {}) {
  w.db.seed("jobTask", [{ id, firmClientId: "fc1", service: "Books", fy: "2026-27", period: "2026-10", title: `Job ${id}`, state: "ASSIGNED", assigneeId: "u-priya", reviewerId: "u-ravi", ...over }]);
}

function addRun(w: ReturnType<typeof world>, jobTaskId: string, runId: string, checklist: Record<string, unknown>[] = []) {
  w.db.seed("agentRun", [{ id: runId, jobTaskId, agent: "echo", sopPackVersion: "1.0.0", status: "AGENT_DONE", startedAt: NOW }]);
  w.db.seed(
    "checklistResult",
    checklist.map((c, i) => ({ id: `${runId}-c${i}`, agentRunId: runId, ruleId: `echo.rule-${i}`, severity: "warn", status: "fail", message: "Check this", source: "deterministic", createdAt: NOW, ...c })),
  );
}

describe("the next task for the assignee", () => {
  it("an ASSIGNED job: Run agent on the existing agent page, SOP step 1 current, plain why, contract-valid", async () => {
    const w = world();
    const view = await getNextTaskView(user("priya"), w.deps);
    expect(NextTaskViewZ.parse(view)).toEqual(view);
    expect(view.status).toBe("task");
    expect(view.remaining).toBe(0);
    const t = view.task!;
    expect(t.job).toMatchObject({ id: "job-1", title: "Echo register", clientCode: "ACME01", clientName: "Acme Pvt Ltd", part: "Preparer", internalDue: null, overdue: false });
    expect(t.state).toBe("ASSIGNED");
    expect(t.action).toEqual({ kind: "run-agent", label: "Run agent", href: "/agents/echo", agent: "echo", runId: null });
    expect(t.href).toBe("/workspace/job-1");
    expect(t.why).toBe("You prepare this job and it is ready for the agent. It has no due date yet.");
    expect(t.sopSteps.map((s) => s.status)).toEqual(["current", "todo", "todo", "todo", "todo", "todo"]);
    expect(t.sopSteps[0].title).toBe("Run Echo (framework test)");
    expect(t.sopSteps[0].detail).toContain("against SOP pack v1.0.0");
    expect(t.checklist[0]).toMatch(/^The documents the agent needs are in ClientDocs: /);
    expect(t.openQuestions).toEqual([]);
    expect(t.portalNote).toBeNull(); // Books is not filed on a portal
  });

  it("ranks overdue first, then internal due, then statutory due, then the oldest job; says why it is first", async () => {
    const w = world();
    addJob(w, "later", { internalDueOn: day("2026-11-20"), statutoryDueOn: day("2026-11-25") });
    addJob(w, "soon-b", { internalDueOn: day("2026-11-10"), statutoryDueOn: day("2026-11-14") });
    addJob(w, "soon-a", { internalDueOn: day("2026-11-10"), statutoryDueOn: day("2026-11-12") });
    addJob(w, "stat-overdue", { statutoryDueOn: day("2026-11-01") });
    addJob(w, "overdue", { internalDueOn: day("2026-11-02"), statutoryDueOn: day("2026-11-11") });
    const cands = await listNextTaskCandidates(user("priya"), w.deps);
    expect(defaultRank(cands, NOW).map((r) => r.candidate.id)).toEqual(["overdue", "stat-overdue", "soon-a", "soon-b", "later", "job-1"]);
    const view = await getNextTaskView(user("priya"), { ...w.deps, rank: defaultRank });
    expect(view.remaining).toBe(5);
    expect(view.task!.job).toMatchObject({ id: "overdue", internalDue: "02 Nov 2026", statutoryDue: "11 Nov 2026", overdue: true });
    expect(view.task!.why).toBe(
      "You prepare this job and it is ready for the agent. Its internal due date was 02 Nov 2026, 3 days ago. The statutory due date is 11 Nov 2026. It comes first because it is overdue.",
    );
  });

  it("by default the Daily Coach ranking decides: a passed statutory date beats a passed internal one, and says so", async () => {
    const w = world();
    addJob(w, "later", { internalDueOn: day("2026-11-20"), statutoryDueOn: day("2026-11-25") });
    addJob(w, "soon-a", { internalDueOn: day("2026-11-10"), statutoryDueOn: day("2026-11-12") });
    addJob(w, "stat-overdue", { statutoryDueOn: day("2026-11-01") });
    addJob(w, "overdue", { internalDueOn: day("2026-11-02"), statutoryDueOn: day("2026-11-11") });
    const cands = await listNextTaskCandidates(user("priya"), w.deps);
    expect(rankCandidates(cands, NOW).map((r) => r.candidate.id)).toEqual(coachRank(cands, NOW).map((r) => ("candidate" in r ? r.candidate.id : r.id)));
    const view = await getNextTaskView(user("priya"), w.deps);
    expect(view.task!.job.id).toBe("stat-overdue");
    expect(view.task!.why.endsWith("It comes first because its statutory due date has passed.")).toBe(true);
    expect((await rankedNextTasks(user("priya"), w.deps)).map((r) => r.candidate.id).slice(0, 2)).toEqual(["stat-overdue", "overdue"]);
  });

  it("due today and not yet due read plainly", async () => {
    const w = world({ jobState: "DRAFT" });
    addJob(w, "today", { internalDueOn: day("2026-11-05") });
    expect((await getNextTask(user("priya"), w.deps))!.why).toContain("Its internal due date is today, 05 Nov 2026.");
    const w2 = world({ jobState: "DRAFT" });
    addJob(w2, "next", { internalDueOn: day("2026-11-09"), statutoryDueOn: day("2026-11-11") });
    expect((await getNextTask(user("priya"), w2.deps))!.why).toContain("Internal due 09 Nov 2026. The statutory due date is 11 Nov 2026.");
  });

  it("the ranking seam: an injected ranker decides the order and its reason is used", async () => {
    const w = world();
    addJob(w, "b", { internalDueOn: day("2026-11-06") });
    const rank = (c: readonly NextTaskCandidate[]) => [...c].sort((x, y) => x.id.localeCompare(y.id)).map((candidate) => ({ candidate, reason: "The coach put it first." }));
    const t = (await getNextTask(user("priya"), { ...w.deps, rank }))!;
    expect(t.job.id).toBe("b");
    expect(t.why.endsWith("The coach put it first.")).toBe(true);
    // A ranker may also return bare candidates.
    expect((await getNextTask(user("priya"), { ...w.deps, rank: (c) => [...c].reverse() }))!.job.id).toBeDefined();
  });
});

describe("the action follows the state and the person", () => {
  it("AGENT_DONE: the preparer opens the pack to submit; the reviewer has nothing yet", async () => {
    const w = world({ jobState: "AGENT_DONE" });
    addRun(w, "job-1", "run-1", [{ severity: "block" }, { severity: "warn" }, { severity: "warn" }]);
    const t = (await getNextTask(user("priya"), w.deps))!;
    expect(t.action).toEqual({ kind: "submit", label: "Open pack to submit", href: "/agents/echo/runs/run-1", agent: "echo", runId: "run-1" });
    expect(t.sopSteps.map((s) => s.status)).toEqual(["done", "current", "todo", "todo", "todo", "todo"]);
    expect(t.checklist).toContain("Every block finding is read and explained (1 block finding on this run).");
    expect(t.checklist).toContain("Every warning is read (2 warnings).");
    expect(await getNextTask(user("ravi"), w.deps)).toBeNull();
  });

  it("IN_REVIEW: the reviewer reviews; the preparer is clear", async () => {
    const w = world({ jobState: "IN_REVIEW" });
    addRun(w, "job-1", "run-1");
    const t = (await getNextTask(user("ravi"), w.deps))!;
    expect(t.action.kind).toBe("review");
    expect(t.action.label).toBe("Review pack");
    expect(t.job.part).toBe("Reviewer");
    expect(t.why).toContain("The pack is waiting for your review.");
    expect(t.sopSteps.find((s) => s.status === "current")!.title).toBe("Review and approve");
    expect((await getNextTaskView(user("priya"), w.deps)).status).toBe("clear");
  });

  it("APPROVED: Mark filed goes to the assignee (who files), not the reviewer; the workspace shows it to both", async () => {
    const w = world({ jobState: "APPROVED" });
    addRun(w, "job-1", "run-1");
    const t = (await getNextTask(user("priya"), w.deps))!;
    expect(t.action).toMatchObject({ kind: "mark-filed", label: "Mark filed", href: "/agents/echo/runs/run-1" });
    expect(t.sopSteps.find((s) => s.status === "current")!.title).toBe("Hand over, then mark filed");
    expect(await getNextTask(user("ravi"), w.deps)).toBeNull();
    const job = { id: "job-1", state: "APPROVED" as const, service: "Books" as const, assigneeId: "u-priya", reviewerId: "u-ravi" };
    const latest = { id: "run-1", agent: "echo", reviewNotes: null, blockFails: 0, warnFails: 0 };
    expect(actionFor(user("ravi"), job, latest, agents, NOW, { queue: false })?.kind).toBe("mark-filed");
    expect(actionFor(user("outsider"), job, latest, agents, NOW, { queue: false })).toBeNull();
  });

  it("FILED_BY_HUMAN / CLOSING: Record Turia close; a GST job carries the portal note and the ARN in its checklist", async () => {
    const w = world({ jobState: "CLOSING", service: "GST" });
    addRun(w, "job-1", "run-1");
    const t = (await getNextTask(user("priya"), { ...w.deps, agents: [...agents] }))!;
    expect(t.action).toMatchObject({ kind: "turia-close", label: "Record Turia close" });
    expect(t.portalNote).toBe(PORTAL_NOTE);
    expect(t.portalNote).not.toMatch(/https?:|\.gov\./);
    expect(t.checklist).toContain("The Turia task is closed with the minutes you spent.");
    const ctx = { service: "GST" as const, agentTitle: "GST Prep", requiredInputs: [], packVersion: null, ruleCount: null, blockFails: 0, warnFails: 0, openQuestions: 0, ack: { required: true, label: "GST ARN" } };
    expect(stepChecklist("APPROVED", ctx)).toContain("You have the GST ARN to type in.");
    expect(sopSteps("APPROVED", ctx)[3].detail).toBe("File it on the GST portal yourself (DSC, OTP and payment stay with you), then mark the job filed with the GST ARN.");
  });

  it("a service with no agent yet: prepare by hand, opening the guided workspace", async () => {
    const w = world({ service: "TDS" });
    const t = (await getNextTask(user("priya"), { ...w.deps, agents: Object.values(AGENTS).filter((a) => !a.internal) }))!;
    expect(t.action).toEqual({ kind: "prepare-by-hand", label: "Open the job", href: "/workspace/job-1", agent: null, runId: null });
    expect(t.sopSteps[0].title).toBe("Prepare the work by hand");
    expect(t.why).toContain("There is no agent for this service yet");
  });

  it("open questions on the latest run are listed; abstentions are client requests", async () => {
    const w = world({ jobState: "AGENT_DONE" });
    addRun(w, "job-1", "run-1", [
      { status: "na", severity: "warn", ruleId: "echo.related-party", message: "Is INV-2 a related party?", evidence: { flags: ["insufficient-evidence"], location: "register.csv row 3" } },
      { status: "na", severity: "info", ruleId: "echo.other", message: "Check by hand", evidence: { flags: ["llm-unavailable"] } },
    ]);
    const t = (await getNextTask(user("priya"), w.deps))!;
    expect(t.openQuestions).toEqual([{ ruleId: "echo.related-party", kind: "insufficient-evidence", question: "Is INV-2 a related party?", location: "register.csv row 3", clientRequest: true }]);
    expect(t.checklist).toContain("Open questions are answered or listed for the client (1 question).");
  });
});

describe("visibility and the nothing-due case", () => {
  it("only jobs the person prepares or reviews: partners, admins and outsiders not on the job are clear", async () => {
    const w = world();
    for (const who of ["partner", "admin", "outsider", "meera"] as const) {
      const v = await getNextTaskView(user(who), w.deps);
      expect(v).toMatchObject({ status: "clear", remaining: 0, task: null });
      expect(NextTaskViewZ.parse(v)).toEqual(v);
    }
  });

  it("signed out or inactive: clear, nothing read", async () => {
    const w = world();
    expect((await getNextTaskView(null, w.deps)).status).toBe("clear");
    expect((await getNextTaskView(user("priya", { active: false }), w.deps)).status).toBe("clear");
  });

  it("DONE and DRAFT jobs are never next; nothing due → clear", async () => {
    for (const jobState of ["DONE", "DRAFT"]) {
      const w = world({ jobState });
      const v = await getNextTaskView(user("priya"), w.deps);
      expect(v.status).toBe("clear");
      expect(v.generatedAt).toBe(NOW.toISOString());
    }
  });
});

describe("sop steps", () => {
  const ctx = { service: "Books" as const, agentTitle: "Books Close", requiredInputs: ["trial balance"], packVersion: "1.2.0", ruleCount: 14, blockFails: 2, warnFails: 0, openQuestions: 0, ack: { required: false, label: "Acknowledgement reference" } };
  it("one current step per open state; all done when DONE; none current before assignment", () => {
    for (const s of ["ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING"] as const) {
      expect(sopSteps(s, ctx).filter((x) => x.status === "current")).toHaveLength(1);
    }
    expect(sopSteps("DONE", ctx).every((x) => x.status === "done")).toBe(true);
    expect(sopSteps("DRAFT", ctx).every((x) => x.status === "todo")).toBe(true);
    expect(sopSteps("ASSIGNED", ctx)[0].detail).toBe(
      "Check the documents are in the job's ClientDocs folder (trial balance), then run the agent. It writes a draft pack to Working against SOP pack v1.2.0 (14 checks) and never files anything.",
    );
    expect(stepChecklist("DRAFT", ctx)).toEqual(["A manager assigns the job before work starts."]);
    expect(stepChecklist("DONE", ctx)).toEqual(["Nothing more to do on this job."]);
    expect(stepChecklist("IN_REVIEW", ctx)).toContain("2 block findings remain: only a partner can approve over them, with a note.");
    expect(stepChecklist("IN_PREP", { ...ctx, reviewNotes: "Use the October TB" })).toContain("The notes from the last review are dealt with: Use the October TB");
    expect(stepChecklist("APPROVED", ctx)).toContain("The work is handed over as your SOP says.");
  });
});
