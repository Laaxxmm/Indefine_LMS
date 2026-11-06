import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";
import {
  ACK_REF_REQUIRED,
  CLOSE_GATE_TOKEN_TTL_MS,
  JOB_TASK_STATES,
  actorRef,
  canTransition,
  consumeCloseGateToken,
  gateTokenProblem,
  isJobTaskState,
  isLegalEdge,
  nextStates,
  registerCloseGate,
  transitionTable,
  type Actor,
  type CloseGateToken,
  type JobTaskState,
  type TransitionContext,
} from "./state";

const NOW = new Date("2026-11-05T06:30:00.000Z");
const mint = registerCloseGate();

const partner: Actor = { kind: "human", userId: "u-partner", roles: ["partner"] };
const manager: Actor = { kind: "human", userId: "u-manager", roles: ["manager"] };
const assignee: Actor = { kind: "human", userId: "u-priya", roles: ["staff"] };
const reviewer: Actor = { kind: "human", userId: "u-ravi", roles: ["staff"] };
const otherStaff: Actor = { kind: "human", userId: "u-other", roles: ["staff"] };
const admin: Actor = { kind: "human", userId: "u-admin", roles: ["admin"] };
const agent: Actor = { kind: "agent", runId: "run-1" };
const system: Actor = { kind: "system", name: "close-loop-hook" };

const ctx = (over: Partial<TransitionContext> = {}): TransitionContext => ({
  actor: partner,
  jobTaskId: "job-1",
  service: "GST",
  assigneeId: "u-priya",
  reviewerId: "u-ravi",
  blockingFailures: 0,
  note: "reason given",
  ackRef: "AA2911260012345",
  gateToken: null,
  now: NOW,
  ...over,
});

// Independent statement of the ADR-005 graph (the module's table must match it exactly).
const LEGAL: Record<JobTaskState, JobTaskState[]> = {
  DRAFT: ["ASSIGNED"],
  ASSIGNED: ["IN_PREP"],
  IN_PREP: ["AGENT_DONE", "IN_REVIEW"],
  AGENT_DONE: ["IN_PREP", "IN_REVIEW"],
  IN_REVIEW: ["IN_PREP", "APPROVED"],
  APPROVED: ["FILED_BY_HUMAN"],
  FILED_BY_HUMAN: ["APPROVED", "CLOSING"],
  CLOSING: ["APPROVED", "DONE"],
  DONE: [],
};

// The most permissive valid actor for each legal edge (used to prove legality on the graph).
function bestActor(from: JobTaskState, to: JobTaskState): Actor {
  if (from === "IN_PREP" && to === "AGENT_DONE") return agent;
  if (from === "FILED_BY_HUMAN" && to === "CLOSING") return system;
  return partner;
}

describe("JOB_TASK_STATES", () => {
  it("lists the nine states in pipeline order", () => {
    expect(JOB_TASK_STATES).toEqual(["DRAFT", "ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING", "DONE"]);
  });
  it("recognises states", () => {
    expect(isJobTaskState("DONE")).toBe(true);
    expect(isJobTaskState("done")).toBe(false);
    expect(isJobTaskState(3)).toBe(false);
  });
});

describe("all 81 (from, to) pairs", () => {
  const pairs = JOB_TASK_STATES.flatMap((from) => JOB_TASK_STATES.map((to) => [from, to] as const));
  it("covers 81 combinations", () => expect(pairs).toHaveLength(81));

  it.each(pairs)("%s → %s", (from, to) => {
    const legal = LEGAL[from].includes(to);
    expect(isLegalEdge(from, to)).toBe(legal);
    const token = to === "DONE" ? mint({ jobTaskId: "job-1", now: NOW, evidence: {} }) : null;
    const d = canTransition(from, to, ctx({ actor: bestActor(from, to), gateToken: token }));
    expect(d.ok).toBe(legal);
    if (!d.ok) {
      if (from === to) expect(d.code).toBe("SAME_STATE");
      else if (to === "DONE") expect(d.code).toBe("GATE_REQUIRED");
      else expect(d.code).toBe("ILLEGAL_EDGE");
    }
  });

  it("nextStates matches the graph for every state", () => {
    for (const s of JOB_TASK_STATES) expect(nextStates(s)).toEqual(LEGAL[s]);
  });

  it("transitionTable lists exactly the legal edges", () => {
    const table = transitionTable().map((e) => `${e.from}>${e.to}`).sort();
    const expected = JOB_TASK_STATES.flatMap((f) => LEGAL[f].map((t) => `${f}>${t}`)).sort();
    expect(table).toEqual(expected);
    expect(transitionTable().every((e) => e.who.length > 0)).toBe(true);
  });

  it("DONE is terminal and only CLOSING leads to it", () => {
    expect(nextStates("DONE")).toEqual([]);
    expect(JOB_TASK_STATES.filter((s) => isLegalEdge(s, "DONE"))).toEqual(["CLOSING"]);
  });

  it("rejects unknown states", () => {
    const d = canTransition("NOPE" as JobTaskState, "DONE", ctx());
    expect(d).toMatchObject({ ok: false, code: "UNKNOWN_STATE" });
    const d2 = canTransition("DRAFT", "LATER" as JobTaskState, ctx());
    expect(d2).toMatchObject({ ok: false, code: "UNKNOWN_STATE", reason: "That job stage isn't one Firm OS knows. Reload the page and try again." });
  });
});

describe("role requirements per edge", () => {
  type Case = [string, JobTaskState, JobTaskState, Actor, Partial<TransitionContext>, string | true];
  const cases: Case[] = [
    // assign
    ["manager assigns", "DRAFT", "ASSIGNED", manager, {}, true],
    ["staff cannot assign", "DRAFT", "ASSIGNED", assignee, {}, "FORBIDDEN"],
    ["admin cannot assign", "DRAFT", "ASSIGNED", admin, {}, "FORBIDDEN"],
    ["assign needs an assignee", "DRAFT", "ASSIGNED", partner, { assigneeId: null }, "ASSIGNEE_REQUIRED"],
    // start prep
    ["assignee starts prep", "ASSIGNED", "IN_PREP", assignee, {}, true],
    ["agent runner starts prep", "ASSIGNED", "IN_PREP", agent, {}, true],
    ["other staff cannot start prep", "ASSIGNED", "IN_PREP", otherStaff, {}, "FORBIDDEN"],
    ["system cannot start prep", "ASSIGNED", "IN_PREP", system, {}, "FORBIDDEN"],
    // agent finished
    ["agent marks AGENT_DONE", "IN_PREP", "AGENT_DONE", agent, {}, true],
    ["partner cannot fake AGENT_DONE", "IN_PREP", "AGENT_DONE", partner, {}, "FORBIDDEN"],
    // manual prep
    ["assignee submits manual prep", "IN_PREP", "IN_REVIEW", assignee, {}, true],
    ["agent cannot submit for review", "IN_PREP", "IN_REVIEW", agent, {}, "FORBIDDEN"],
    // re-run
    ["assignee re-runs with note", "AGENT_DONE", "IN_PREP", assignee, {}, true],
    ["re-run needs a note", "AGENT_DONE", "IN_PREP", assignee, { note: "  " }, "NOTE_REQUIRED"],
    ["other staff cannot re-run", "AGENT_DONE", "IN_PREP", otherStaff, {}, "FORBIDDEN"],
    // submit for review
    ["assignee submits for review", "AGENT_DONE", "IN_REVIEW", assignee, {}, true],
    ["manager submits for review", "AGENT_DONE", "IN_REVIEW", manager, {}, true],
    ["other staff cannot submit", "AGENT_DONE", "IN_REVIEW", otherStaff, {}, "FORBIDDEN"],
    // request changes
    ["reviewer requests changes", "IN_REVIEW", "IN_PREP", reviewer, {}, true],
    ["request changes needs a note", "IN_REVIEW", "IN_PREP", reviewer, { note: null }, "NOTE_REQUIRED"],
    ["assignee cannot request changes", "IN_REVIEW", "IN_PREP", assignee, {}, "FORBIDDEN"],
    // approve
    ["reviewer approves", "IN_REVIEW", "APPROVED", reviewer, {}, true],
    ["manager approves", "IN_REVIEW", "APPROVED", manager, {}, true],
    ["other staff cannot approve", "IN_REVIEW", "APPROVED", otherStaff, {}, "FORBIDDEN"],
    ["agent cannot approve", "IN_REVIEW", "APPROVED", agent, {}, "FORBIDDEN"],
    ["manager-assignee cannot self-approve", "IN_REVIEW", "APPROVED", { kind: "human", userId: "u-priya", roles: ["manager"] }, {}, "SELF_APPROVAL"],
    ["reviewer who is also assignee cannot approve", "IN_REVIEW", "APPROVED", reviewer, { assigneeId: "u-ravi" }, "SELF_APPROVAL"],
    ["partner may approve own job", "IN_REVIEW", "APPROVED", { kind: "human", userId: "u-priya", roles: ["partner"] }, {}, true],
    ["block failures stop a manager", "IN_REVIEW", "APPROVED", manager, { blockingFailures: 2 }, "BLOCKING_FAILURES"],
    ["block failures stop the reviewer", "IN_REVIEW", "APPROVED", reviewer, { blockingFailures: 1 }, "BLOCKING_FAILURES"],
    ["partner overrides block failures with a note", "IN_REVIEW", "APPROVED", partner, { blockingFailures: 1 }, true],
    ["partner override needs a note", "IN_REVIEW", "APPROVED", partner, { blockingFailures: 1, note: "" }, "NOTE_REQUIRED"],
    ["approve without note when clean", "IN_REVIEW", "APPROVED", reviewer, { note: null }, true],
    // confirm filed
    ["staff confirms GST filing with ARN", "APPROVED", "FILED_BY_HUMAN", otherStaff, {}, true],
    ["GST filing needs ARN", "APPROVED", "FILED_BY_HUMAN", assignee, { ackRef: null }, "ACK_REF_REQUIRED"],
    ["blank ARN is missing", "APPROVED", "FILED_BY_HUMAN", assignee, { ackRef: "   " }, "ACK_REF_REQUIRED"],
    ["ROC filing needs SRN", "APPROVED", "FILED_BY_HUMAN", assignee, { service: "ROC", ackRef: undefined }, "ACK_REF_REQUIRED"],
    ["IncomeTax filing needs ack", "APPROVED", "FILED_BY_HUMAN", assignee, { service: "IncomeTax", ackRef: "" }, "ACK_REF_REQUIRED"],
    ["TDS filing needs token no.", "APPROVED", "FILED_BY_HUMAN", assignee, { service: "TDS", ackRef: null }, "ACK_REF_REQUIRED"],
    ["Books close needs no ack", "APPROVED", "FILED_BY_HUMAN", assignee, { service: "Books", ackRef: null }, true],
    ["Audit needs no ack", "APPROVED", "FILED_BY_HUMAN", assignee, { service: "Audit", ackRef: null }, true],
    ["optional ack still validated", "APPROVED", "FILED_BY_HUMAN", assignee, { service: "Engagement", ackRef: "<script>" }, "ACK_REF_INVALID"],
    ["over-long ack rejected", "APPROVED", "FILED_BY_HUMAN", assignee, { ackRef: "A".repeat(65) }, "ACK_REF_INVALID"],
    ["SRN with slash and dash accepted", "APPROVED", "FILED_BY_HUMAN", assignee, { service: "ROC", ackRef: "AB1234567/2026-27" }, true],
    ["agent cannot confirm filing", "APPROVED", "FILED_BY_HUMAN", agent, {}, "FORBIDDEN"],
    ["system cannot confirm filing", "APPROVED", "FILED_BY_HUMAN", system, {}, "FORBIDDEN"],
    ["admin-only user cannot confirm filing", "APPROVED", "FILED_BY_HUMAN", admin, {}, "FORBIDDEN"],
    // start closing
    ["hook starts closing", "FILED_BY_HUMAN", "CLOSING", system, {}, true],
    ["staff starts closing", "FILED_BY_HUMAN", "CLOSING", assignee, {}, true],
    ["agent cannot start closing", "FILED_BY_HUMAN", "CLOSING", agent, {}, "FORBIDDEN"],
    // retract
    ["manager retracts filing", "FILED_BY_HUMAN", "APPROVED", manager, {}, true],
    ["retract needs a note", "FILED_BY_HUMAN", "APPROVED", manager, { note: "" }, "NOTE_REQUIRED"],
    ["staff cannot retract", "FILED_BY_HUMAN", "APPROVED", assignee, {}, "FORBIDDEN"],
    ["partner retracts from CLOSING", "CLOSING", "APPROVED", partner, {}, true],
    ["staff cannot retract from CLOSING", "CLOSING", "APPROVED", otherStaff, {}, "FORBIDDEN"],
  ];

  it.each(cases)("%s", (_name, from, to, actor, over, expected) => {
    const d = canTransition(from, to, ctx({ actor, ...over }));
    if (expected === true) expect(d).toMatchObject({ ok: true });
    else expect(d).toMatchObject({ ok: false, code: expected });
  });

  it("ack ref table covers every service", () => {
    expect(ACK_REF_REQUIRED).toEqual({ GST: true, ROC: true, IncomeTax: true, TDS: true, Books: false, Audit: false, Engagement: false });
  });

  it("returns the edge name on success", () => {
    expect(canTransition("IN_REVIEW", "IN_PREP", ctx({ actor: reviewer }))).toEqual({ ok: true, edge: "request-changes" });
    expect(canTransition("IN_REVIEW", "APPROVED", ctx({ actor: reviewer }))).toEqual({ ok: true, edge: "approve" });
  });
});

describe("DONE gate", () => {
  const closeCtx = (token: unknown, over: Partial<TransitionContext> = {}) =>
    ctx({ actor: system, gateToken: token as CloseGateToken, ...over });

  it("nobody reaches DONE without a token, not even a partner", () => {
    for (const actor of [partner, manager, assignee, agent, system, admin]) {
      expect(canTransition("CLOSING", "DONE", ctx({ actor, gateToken: null }))).toMatchObject({ ok: false, code: "GATE_REQUIRED" });
    }
  });

  it("a minted token for the job closes it", () => {
    const token = mint({ jobTaskId: "job-1", now: NOW, evidence: { deliverableIds: ["d1"], turiaSyncId: "t1" } });
    expect(canTransition("CLOSING", "DONE", closeCtx(token))).toEqual({ ok: true, edge: "close" });
    expect(token.evidence).toEqual({ deliverableIds: ["d1"], turiaSyncId: "t1" });
    expect(Object.isFrozen(token)).toBe(true);
  });

  it("a forged look-alike object is rejected", () => {
    const forged = { jobTaskId: "job-1", mintedAt: NOW, expiresAt: new Date(NOW.getTime() + 1000), evidence: {} };
    expect(canTransition("CLOSING", "DONE", closeCtx(forged))).toMatchObject({ ok: false, code: "GATE_REQUIRED" });
    expect(gateTokenProblem(forged, "job-1", NOW)).toBe("FORGED");
    expect(gateTokenProblem("token", "job-1", NOW)).toBe("FORGED");
    expect(gateTokenProblem(undefined, "job-1", NOW)).toBe("MISSING");
  });

  it("a token for another job is rejected", () => {
    const token = mint({ jobTaskId: "job-2", now: NOW, evidence: {} });
    expect(gateTokenProblem(token, "job-1", NOW)).toBe("WRONG_JOB");
    expect(canTransition("CLOSING", "DONE", closeCtx(token))).toMatchObject({ ok: false, reason: expect.stringContaining("for a different job") });
  });

  it("a token expires after the TTL and is not valid before minting", () => {
    const token = mint({ jobTaskId: "job-1", now: NOW, evidence: {} });
    expect(gateTokenProblem(token, "job-1", new Date(NOW.getTime() + CLOSE_GATE_TOKEN_TTL_MS))).toBeNull();
    expect(gateTokenProblem(token, "job-1", new Date(NOW.getTime() + CLOSE_GATE_TOKEN_TTL_MS + 1))).toBe("EXPIRED");
    expect(gateTokenProblem(token, "job-1", new Date(NOW.getTime() - 1))).toBe("EXPIRED");
  });

  it("a token is single-use", () => {
    const token = mint({ jobTaskId: "job-1", now: NOW, evidence: {} });
    expect(consumeCloseGateToken(token)).toBe(true);
    expect(consumeCloseGateToken(token)).toBe(false);
    expect(gateTokenProblem(token, "job-1", NOW)).toBe("CONSUMED");
    expect(consumeCloseGateToken({} as CloseGateToken)).toBe(false);
  });

  it("the token does not open DONE from any other state", () => {
    for (const from of JOB_TASK_STATES.filter((s) => s !== "CLOSING")) {
      const token = mint({ jobTaskId: "job-1", now: NOW, evidence: {} });
      expect(canTransition(from, "DONE", closeCtx(token)).ok).toBe(false);
    }
  });

  it("the minter refuses an empty job id", () => {
    expect(() => mint({ jobTaskId: "", now: NOW, evidence: {} })).toThrow(/jobTaskId/);
  });

  it("the gate can be registered only once per module instance", () => {
    expect(() => registerCloseGate()).toThrow(/already registered/);
  });

  it("only src/lib/close-loop/gate.ts may claim the minter (repo scan)", () => {
    const root = process.cwd();
    const allowed = new Set([
      "src/lib/agents/core/state.ts",
      "src/lib/agents/core/state.test.ts",
      "src/lib/agents/core/state-db.test.ts",
      "src/lib/close-loop/gate.ts",
      "src/lib/close-loop/gate.test.ts",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) walk(abs);
        else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
          const rel = relative(root, abs).replace(/\\/g, "/");
          if (!allowed.has(rel) && readFileSync(abs, "utf8").includes("registerCloseGate")) offenders.push(rel);
        }
      }
    };
    walk(join(root, "src"));
    walk(join(root, "scripts"));
    expect(offenders).toEqual([]);
  });
});

describe("actorRef", () => {
  it("formats each actor kind", () => {
    expect(actorRef(partner)).toBe("u-partner");
    expect(actorRef(agent)).toBe("agent:run-1");
    expect(actorRef(system)).toBe("system:close-loop-hook");
  });
});
