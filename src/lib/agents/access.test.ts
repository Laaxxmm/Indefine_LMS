import { describe, expect, it } from "vitest";
import {
  actorOf,
  canDecideMistakes,
  canSeeAllRuns,
  canUseAgents,
  canViewJob,
  firmRolesOf,
  jobScopeWhere,
  reviewActions,
  runScopeWhere,
  type JobAccessView,
} from "./access";
import { isEchoAgentEnabled } from "./flags";
import { getAgent, visibleAgents } from "./registry";
import { user } from "../../../tests/fakes/agent-world";

const NOW = new Date("2026-11-05T06:30:00Z");
const job = (state: JobAccessView["state"]): JobAccessView => ({ id: "job-1", state, service: "Books", assigneeId: "u-priya", reviewerId: "u-ravi" });

describe("roles", () => {
  it("derives Firm OS roles from active / level / role", () => {
    expect(firmRolesOf(user("priya"))).toEqual(["staff"]);
    expect(firmRolesOf(user("meera"))).toEqual(["staff", "manager"]);
    expect(firmRolesOf(user("meera", { level: "SENIOR_MANAGER" }))).toEqual(["staff", "manager"]);
    expect(firmRolesOf(user("partner"))).toEqual(["staff", "partner"]);
    expect(firmRolesOf(user("admin"))).toEqual(["staff", "admin"]);
    expect(firmRolesOf(user("priya", { active: false }))).toEqual([]);
    expect(firmRolesOf(null)).toEqual([]);
    expect(actorOf(user("meera"))).toEqual({ kind: "human", userId: "u-meera", roles: ["staff", "manager"] });
    expect(actorOf(undefined)).toBeNull();
  });

  it("who sees everything, who decides mistakes", () => {
    expect(canUseAgents(user("priya"))).toBe(true);
    expect(canSeeAllRuns(user("priya"))).toBe(false);
    expect(canSeeAllRuns(user("admin"))).toBe(true);
    expect(canSeeAllRuns(user("meera"))).toBe(true);
    expect(canDecideMistakes(user("partner"))).toBe(true);
    expect(canDecideMistakes(user("meera"))).toBe(true);
    expect(canDecideMistakes(user("admin"))).toBe(false);
    expect(canDecideMistakes(user("ravi"))).toBe(false);
  });
});

describe("visibility", () => {
  it("staff see only jobs they prepare or review", () => {
    const j = job("IN_REVIEW");
    expect(canViewJob(user("priya"), j)).toBe(true);
    expect(canViewJob(user("ravi"), j)).toBe(true);
    expect(canViewJob(user("outsider"), j)).toBe(false);
    expect(canViewJob(user("partner"), j)).toBe(true);
    expect(canViewJob(null, j)).toBe(false);
  });

  it("Prisma scopes", () => {
    expect(runScopeWhere(user("priya"))).toEqual({ jobTask: { OR: [{ assigneeId: "u-priya" }, { reviewerId: "u-priya" }] } });
    expect(runScopeWhere(user("partner"))).toEqual({});
    expect(runScopeWhere(null)).toEqual({ id: "__none__" });
    expect(jobScopeWhere(user("priya"))).toEqual({ OR: [{ assigneeId: "u-priya" }, { reviewerId: "u-priya" }] });
    expect(jobScopeWhere(user("admin"))).toEqual({});
    expect(jobScopeWhere(user("priya", { active: false }))).toEqual({ id: "__none__" });
  });
});

describe("reviewActions (from the state machine)", () => {
  it("assignee: run on ASSIGNED / IN_PREP, submit on AGENT_DONE, never approve own job", () => {
    expect(reviewActions(user("priya"), job("ASSIGNED"), 0, NOW)).toMatchObject({ run: true, submit: false, approve: false });
    expect(reviewActions(user("priya"), job("IN_PREP"), 0, NOW).run).toBe(true);
    expect(reviewActions(user("priya"), job("AGENT_DONE"), 0, NOW)).toMatchObject({ run: false, submit: true, rerun: true });
    expect(reviewActions(user("priya"), job("IN_REVIEW"), 0, NOW)).toMatchObject({ approve: false, requestChanges: false, rerun: false });
  });

  it("re-run with a note (AGENT_DONE → IN_PREP): the assignee, a manager or a partner; not the reviewer or admin; only in AGENT_DONE", () => {
    for (const who of ["priya", "meera", "partner"] as const) expect(reviewActions(user(who), job("AGENT_DONE"), 0, NOW).rerun).toBe(true);
    for (const who of ["ravi", "admin", "outsider"] as const) expect(reviewActions(user(who), job("AGENT_DONE"), 0, NOW).rerun).toBe(false);
    for (const s of ["ASSIGNED", "IN_PREP", "IN_REVIEW", "APPROVED", "CLOSING"] as const) expect(reviewActions(user("priya"), job(s), 0, NOW).rerun).toBe(false);
  });

  it("reviewer: request changes / approve on IN_REVIEW; not over block failures", () => {
    expect(reviewActions(user("ravi"), job("IN_REVIEW"), 0, NOW)).toMatchObject({ approve: true, requestChanges: true, approveNeedsNote: false, run: false });
    expect(reviewActions(user("ravi"), job("IN_REVIEW"), 2, NOW)).toMatchObject({ approve: false, requestChanges: true, approveNeedsNote: true });
    expect(reviewActions(user("partner"), job("IN_REVIEW"), 2, NOW)).toMatchObject({ approve: true, approveNeedsNote: true });
    expect(reviewActions(user("ravi"), job("IN_PREP"), 0, NOW).run).toBe(false);
  });

  it("outsiders and admins-only get nothing actionable", () => {
    expect(reviewActions(user("outsider"), job("IN_REVIEW"), 0, NOW)).toEqual({ run: false, submit: false, rerun: false, requestChanges: false, approve: false, approveNeedsNote: false, proposeMistake: false });
    expect(reviewActions(user("admin"), job("IN_REVIEW"), 0, NOW)).toMatchObject({ approve: false, requestChanges: false, run: false });
    expect(reviewActions(user("meera"), job("APPROVED"), 0, NOW)).toMatchObject({ run: false, submit: false, approve: false });
  });
});

describe("registry and flags", () => {
  it("echo is hidden unless FIRM_OS_ECHO_AGENT is on", () => {
    expect(isEchoAgentEnabled({})).toBe(false);
    expect(isEchoAgentEnabled({ FIRM_OS_ECHO_AGENT: "Yes" })).toBe(true);
    // Internal agents (echo) are flag-gated; production agents registered later stay visible.
    expect(visibleAgents({}).filter((a) => a.internal).map((a) => a.key)).toEqual([]);
    expect(visibleAgents({ FIRM_OS_ECHO_AGENT: "1" }).map((a) => a.key)).toContain("echo");
    expect(getAgent("echo")?.key).toBe("echo");
    expect(getAgent("toString")).toBeUndefined();
  });
});
