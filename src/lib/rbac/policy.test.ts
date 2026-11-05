import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/access";
import { actorOf } from "@/lib/agents/access";
import { listClientJobs, type ClientJobsDb } from "@/lib/agents/client-jobs";
import { canTransition, JOB_TASK_STATES, type JobTaskState } from "@/lib/agents/core/state";
import {
  ENTRA_GROUP_ROLES,
  FIRM_ROLE_LABELS,
  canActOnJob,
  canApproveSopRuleChange,
  canChangeThresholds,
  canDecideMistakes,
  canOnboard,
  canRetractFiling,
  canSeeAllRuns,
  canSeeMistakeLog,
  canSetDone,
  canSpotCheck,
  canViewCommsDraft,
  canViewJob,
  commsDraftScopeWhere,
  firmRole,
  jobScopeWhere,
  roleFromEntraGroups,
  runScopeWhere,
} from "./policy";

const u = (o: { id?: string; role?: string; level?: string; active?: boolean } = {}): SessionUser =>
  ({ id: "x", role: "EMPLOYEE", level: "EXECUTIVE", department: "GENERAL", active: true, ...o }) as unknown as SessionUser;

// The cast of the RBAC matrix. Assignee and reviewer are staff on the job; outsider is staff off it.
const P = {
  assignee: u({ id: "u-assignee" }),
  reviewer: u({ id: "u-reviewer", level: "SENIOR_EXECUTIVE" }),
  outsider: u({ id: "u-outsider", level: "ASSISTANT_MANAGER" }),
  manager: u({ id: "u-manager", level: "MANAGER" }),
  seniorManager: u({ id: "u-sm", level: "SENIOR_MANAGER" }),
  partner: u({ id: "u-partner", level: "PARTNER" }),
  adminPartner: u({ id: "u-ap", role: "ADMIN", level: "PARTNER" }),
  admin: u({ id: "u-admin", role: "ADMIN" }),
  inactivePartner: u({ id: "u-ip", level: "PARTNER", active: false }),
  inactiveAssignee: u({ id: "u-assignee", active: false }),
};
type Who = keyof typeof P;
const ALL = Object.keys(P) as Who[];
const JOB = { id: "job-1", state: "IN_REVIEW" as const, service: "GST" as const, assigneeId: "u-assignee", reviewerId: "u-reviewer" };

/** Asserts `pred` is true exactly for `allowed`, false for everyone else and for signed-out visitors. */
function matrix(pred: (user: SessionUser) => boolean, allowed: Who[]) {
  for (const who of ALL) expect(pred(P[who]), who).toBe(allowed.includes(who));
  expect(pred(null), "signed out").toBe(false);
  expect(pred(undefined), "no session").toBe(false);
}

describe("firmRole", () => {
  it.each([
    [{ role: "ADMIN" }, "admin"],
    [{ role: "ADMIN", level: "PARTNER" }, "admin"],
    [{ level: "PARTNER" }, "partner"],
    [{ level: "MANAGER" }, "manager"],
    [{ level: "SENIOR_MANAGER" }, "manager"],
    [{ level: "ASSISTANT_MANAGER" }, "staff"],
    [{ level: "SENIOR_EXECUTIVE" }, "staff"],
    [{ level: "ARTICLE" }, "staff"],
    [{ level: "LEAD" }, "staff"],
    [{}, "staff"],
  ])("%o → %s", (o, role) => {
    expect(firmRole(u(o))).toBe(role);
  });

  it("treats a missing session as staff", () => {
    expect(firmRole(null)).toBe("staff");
    expect(firmRole(undefined)).toBe("staff");
  });

  it("has a label for every role", () => {
    expect(Object.keys(FIRM_ROLE_LABELS).sort()).toEqual(["admin", "manager", "partner", "staff"]);
  });
});

describe("canOnboard", () => {
  it("allows partners, managers and admins", () => {
    expect(canOnboard(u({ level: "PARTNER" }))).toBe(true);
    expect(canOnboard(u({ level: "MANAGER" }))).toBe(true);
    expect(canOnboard(u({ level: "SENIOR_MANAGER" }))).toBe(true);
    expect(canOnboard(u({ role: "ADMIN" }))).toBe(true);
  });

  it("refuses staff, deactivated users and signed-out visitors", () => {
    expect(canOnboard(u())).toBe(false);
    expect(canOnboard(u({ level: "ASSISTANT_MANAGER" }))).toBe(false);
    expect(canOnboard(u({ level: "PARTNER", active: false }))).toBe(false);
    expect(canOnboard(null)).toBe(false);
  });
});

describe("RBAC denial matrix: staff cannot see unassigned client work", () => {
  it("jobs and runs: assignee and reviewer of the job; managers, partners and admins see all", () => {
    matrix((x) => canViewJob(x, JOB), ["assignee", "reviewer", "manager", "seniorManager", "partner", "adminPartner", "admin"]);
    matrix(canSeeAllRuns, ["manager", "seniorManager", "partner", "adminPartner", "admin"]);
  });

  it("Prisma scopes: staff are limited to their own jobs and runs; inactive and signed-out see nothing", () => {
    const mine = { OR: [{ assigneeId: "u-outsider" }, { reviewerId: "u-outsider" }] };
    expect(jobScopeWhere(P.outsider)).toEqual(mine);
    expect(runScopeWhere(P.outsider)).toEqual({ jobTask: mine });
    for (const who of ["manager", "partner", "admin"] as const) {
      expect(jobScopeWhere(P[who])).toEqual({});
      expect(runScopeWhere(P[who])).toEqual({});
    }
    for (const x of [P.inactivePartner, P.inactiveAssignee, null]) {
      expect(jobScopeWhere(x)).toEqual({ id: "__none__" });
      expect(runScopeWhere(x)).toEqual({ id: "__none__" });
    }
  });

  it("client page jobs (/clients/[id]) use the same scope: an unassigned staff member gets an empty query", async () => {
    const seen: unknown[] = [];
    const db = {
      jobTask: { findMany: async (args: { where: unknown }) => (seen.push(args.where), []) },
      user: { findMany: async () => [] },
    } as unknown as ClientJobsDb;
    expect(await listClientJobs(db, P.outsider, "client-1")).toEqual([]);
    expect(seen[0]).toEqual({ AND: [{ OR: [{ assigneeId: "u-outsider" }, { reviewerId: "u-outsider" }] }, { firmClient: { lmsClientId: "client-1" } }] });
    expect(await listClientJobs(db, P.inactiveAssignee, "client-1")).toEqual([]);
    expect(seen).toHaveLength(1); // the inactive user never reaches the query
  });

  it("close-loop actions: assignee, reviewer, managers and partners of the job; never admin-only IT or outsiders", () => {
    matrix((x) => canActOnJob(x, JOB), ["assignee", "reviewer", "manager", "seniorManager", "partner", "adminPartner"]);
  });

  it("comms drafts: the author, the job's people; managers, partners and admins", () => {
    const draft = { createdById: "u-reviewer", job: { assigneeId: "u-assignee", reviewerId: "u-reviewer" } };
    matrix((x) => canViewCommsDraft(x, draft), ["assignee", "reviewer", "manager", "seniorManager", "partner", "adminPartner", "admin"]);
    const orphan = { createdById: "u-reviewer", job: null };
    matrix((x) => canViewCommsDraft(x, orphan), ["reviewer", "manager", "seniorManager", "partner", "adminPartner", "admin"]);
    expect(commsDraftScopeWhere(P.outsider)).toEqual({ OR: [{ createdById: "u-outsider" }] });
    expect(commsDraftScopeWhere(P.outsider, ["job-9"])).toEqual({ OR: [{ createdById: "u-outsider" }, { jobTaskId: { in: ["job-9"] } }] });
    expect(commsDraftScopeWhere(P.partner, ["job-9"])).toEqual({});
    expect(commsDraftScopeWhere(P.inactivePartner)).toEqual({ id: "__none__" });
    expect(commsDraftScopeWhere(null)).toEqual({ id: "__none__" });
  });
});

describe("RBAC denial matrix: partner-only decisions", () => {
  it("only a partner approves SOP rule changes (MistakeLog decisions); managers and admins may read the log", () => {
    matrix(canDecideMistakes, ["partner", "adminPartner"]);
    matrix(canApproveSopRuleChange, ["partner", "adminPartner"]);
    matrix(canSeeMistakeLog, ["manager", "seniorManager", "partner", "adminPartner", "admin"]);
  });

  it("only a partner changes thresholds", () => {
    matrix(canChangeThresholds, ["partner", "adminPartner"]);
  });

  it("only a partner spot-checks manual Turia closes", () => {
    matrix(canSpotCheck, ["partner", "adminPartner"]);
  });
});

describe("RBAC denial matrix: filings and DONE", () => {
  const NOW = new Date("2026-11-05T06:30:00Z");
  const ctx = (who: Who, over: Partial<Parameters<typeof canTransition>[2]> = {}) => {
    const actor = actorOf(P[who]);
    return actor ? { actor, jobTaskId: JOB.id, service: JOB.service, assigneeId: JOB.assigneeId, reviewerId: JOB.reviewerId, now: NOW, ...over } : null;
  };

  it("managers and partners retract a filing (with a note); staff, admin IT and outsiders cannot", () => {
    matrix(canRetractFiling, ["manager", "seniorManager", "partner", "adminPartner"]);
    for (const from of ["FILED_BY_HUMAN", "CLOSING"] as const) {
      for (const who of ALL) {
        const c = ctx(who, { note: "wrong ARN" });
        const ok = !!c && canTransition(from, "APPROVED", c).ok;
        expect(ok, `${who} retract from ${from}`).toBe(canRetractFiling(P[who]));
      }
      expect(canTransition(from, "APPROVED", ctx("partner")!)).toMatchObject({ ok: false, code: "NOTE_REQUIRED" });
    }
  });

  it("nobody sets DONE: not by role, not from any state, not with a note or an ack ref", () => {
    for (const who of ALL) {
      expect(canSetDone(P[who])).toBe(false);
      const c = ctx(who, { note: "done", ackRef: "AA2710260012345" });
      if (!c) continue;
      for (const from of JOB_TASK_STATES.filter((s): s is Exclude<JobTaskState, "DONE"> => s !== "DONE")) {
        expect(canTransition(from, "DONE", c), `${who} ${from} → DONE`).toMatchObject({ ok: false, code: "GATE_REQUIRED" });
      }
    }
    expect(canSetDone(null)).toBe(false);
    // A forged token is refused too.
    const forged = { jobTaskId: JOB.id, mintedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000), evidence: {} };
    expect(canTransition("CLOSING", "DONE", { ...ctx("partner")!, gateToken: forged as never })).toMatchObject({ ok: false, code: "GATE_REQUIRED" });
  });
});

describe("Entra group hook (not wired yet)", () => {
  it("maps the Partners and Staff groups", () => {
    expect(roleFromEntraGroups(["67ed1191-302b-495a-913b-b93cc6ee118d"])).toBe("staff");
    expect(roleFromEntraGroups(["67ed1191-302b-495a-913b-b93cc6ee118d", "E5583268-4C8C-4ABF-8B35-3EF1F0D37A78"])).toBe("partner");
    expect(roleFromEntraGroups(["e5583268-4c8c-4abf-8b35-3ef1f0d37a78", "67ed1191-302b-495a-913b-b93cc6ee118d"])).toBe("partner");
  });

  it("returns null for unknown or missing groups", () => {
    expect(roleFromEntraGroups(["00000000-0000-0000-0000-000000000000"])).toBeNull();
    expect(roleFromEntraGroups([])).toBeNull();
    expect(roleFromEntraGroups(undefined)).toBeNull();
    expect(Object.keys(ENTRA_GROUP_ROLES)).toHaveLength(2);
  });
});
