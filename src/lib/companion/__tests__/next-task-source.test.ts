// fromNextTaskView: the companion side panel's queue comes from the shared next-task queue, so the
// panel and /focus always put the same job first and say the same "why". The response keeps the
// companion's shape (steps, checklist, values, link, later, counts).
import { describe, expect, it } from "vitest";
import { echoWorld, user, NOW } from "../../../../tests/fakes/agent-world";
import { visibleAgents } from "@/lib/agents/registry";
import { getNextTask, getNextTaskView, rankedNextTasks, type NextTaskDeps } from "@/lib/workspace/next-task";
import { companionActionFor, createCompanionProvider, fromNextTaskView } from "../provider";

const agents = visibleAgents({ FIRM_OS_ECHO_AGENT: "1" });
const day = (s: string) => new Date(`${s}T00:00:00+05:30`);

function world() {
  const w = echoWorld();
  const deps: NextTaskDeps = { db: w.db, now: () => NOW, agents };
  const add = (id: string, over: Record<string, unknown> = {}) =>
    w.db.seed("jobTask", [{ id, firmClientId: "fc1", service: "Books", fy: "2026-27", period: "2026-10", title: `Job ${id}`, state: "ASSIGNED", assigneeId: "u-priya", reviewerId: "u-ravi", ...over }]);
  const provider = createCompanionProvider({ db: w.db as never, source: fromNextTaskView({ db: w.db, agents }) });
  return { w, deps, add, provider };
}

describe("fromNextTaskView", () => {
  it("the panel's task is getNextTask's choice, with the same why; the rest of the queue keeps the same order", async () => {
    const { deps, add, provider } = world();
    add("later", { internalDueOn: day("2026-11-20"), statutoryDueOn: day("2026-11-25") });
    add("stat-overdue", { statutoryDueOn: day("2026-11-01") });
    add("soon", { internalDueOn: day("2026-11-10"), statutoryDueOn: day("2026-11-12") });
    add("int-overdue", { internalDueOn: day("2026-11-02"), statutoryDueOn: day("2026-11-11") });
    const priya = user("priya");
    const focus = (await getNextTask(priya, deps))!;
    const res = await provider.nextTask(priya, NOW);
    if (res.status !== "task") throw new Error("expected a task");
    expect(res.task.jobId).toBe(focus.job.id);
    expect(res.task.jobId).toBe("stat-overdue");
    expect(res.task.why).toBe(focus.why);
    const ranked = (await rankedNextTasks(priya, deps)).map((r) => r.candidate.id);
    expect(res.later.map((l) => l.jobId)).toEqual(ranked.slice(1, 1 + res.later.length));
    expect(res.counts).toEqual({ open: ranked.length, overdue: 2 });
    // The companion's own shape is unchanged.
    expect(res.task.steps.filter((s) => s.current)).toHaveLength(1);
    expect(res.task.nextAction.length).toBeGreaterThan(0);
    expect(res.task.link.label).toBe("Open in Firm OS");
  });

  it("agrees for the reviewer too, and is clear exactly when /focus is", async () => {
    const { w, deps, add, provider } = world();
    add("rev", { state: "IN_REVIEW", internalDueOn: day("2026-11-06") });
    w.db.seed("agentRun", [{ id: "run-rev", jobTaskId: "rev", agent: "echo", sopPackVersion: "1.0.0", status: "AGENT_DONE", startedAt: NOW }]);
    const ravi = user("ravi");
    const view = await getNextTaskView(ravi, deps);
    const res = await provider.nextTask(ravi, NOW);
    if (res.status !== "task") throw new Error("expected a task");
    expect(res.task.jobId).toBe(view.task!.job.id);
    expect(res.task.part).toBe(view.task!.job.part);
    expect(res.task.link.path).toBe("/agents/echo/runs/run-rev");

    const outsider = user("outsider");
    expect((await getNextTaskView(outsider, deps)).status).toBe("clear");
    expect((await provider.nextTask(outsider, NOW)).status).toBe("none");
  });

  it("maps each next-task action to the panel's verb", () => {
    const a = (kind: string) => ({ kind, label: "", href: "/x", agent: null, runId: null }) as never;
    expect(companionActionFor({ state: "ASSIGNED", action: a("run-agent") })).toBe("collect");
    expect(companionActionFor({ state: "IN_PREP", action: a("run-agent") })).toBe("prepare");
    expect(companionActionFor({ state: "IN_PREP", action: a("prepare-by-hand") })).toBe("prepare");
    expect(companionActionFor({ state: "AGENT_DONE", action: a("submit") })).toBe("check");
    expect(companionActionFor({ state: "IN_REVIEW", action: a("review") })).toBe("review");
    expect(companionActionFor({ state: "APPROVED", action: a("mark-filed") })).toBe("file");
    expect(companionActionFor({ state: "CLOSING", action: a("turia-close") })).toBe("close");
  });

  it("signed out: nothing", async () => {
    const { deps } = world();
    expect(await fromNextTaskView(deps).rank(null as never, NOW)).toEqual([]);
  });
});
