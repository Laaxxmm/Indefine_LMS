import type { PrismaClient } from "@prisma/client";
import { describe, it, expect, vi } from "vitest";
import { registerCloseGate, type Actor } from "./state";
import { transitionJobTask, updateFor, type JobTaskDb, type JobTaskRow, type JobTaskTx } from "./state-db";

// Compile-time: the real Prisma client satisfies the narrow interface the service takes.
export const _prismaFits = (p: PrismaClient): JobTaskDb => p;

const NOW = new Date("2026-11-05T06:30:00.000Z");
const T0 = new Date("2026-11-01T04:00:00.000Z");
const mint = registerCloseGate();

const partner: Actor = { kind: "human", userId: "u-partner", roles: ["partner"] };
const reviewer: Actor = { kind: "human", userId: "u-ravi", roles: ["staff"] };
const staff: Actor = { kind: "human", userId: "u-priya", roles: ["staff"] };
const system: Actor = { kind: "system", name: "close-gate" };

type Event = { id: string; jobTaskId: string; fromState: string; toState: string; actorId: string; note: string | null };

/** In-memory fake of the four tables the service touches. Transactions run the callback directly. */
function fakeDb(row: Partial<JobTaskRow> & Record<string, unknown>, opts: { blockFails?: number; hasRun?: boolean; raceOnUpdate?: boolean } = {}) {
  const state = {
    row: { id: "job-1", state: "IN_REVIEW", service: "GST", assigneeId: "u-priya", reviewerId: "u-ravi", ackRef: null, updatedAt: T0, ...row } as JobTaskRow &
      Record<string, unknown>,
    events: [] as Event[],
    transactions: 0,
  };
  const tx: JobTaskTx = {
    jobTask: {
      findUnique: vi.fn(async ({ where }) => (where.id === state.row.id ? { ...state.row } : null)),
      updateMany: vi.fn(async ({ where, data }) => {
        if (opts.raceOnUpdate) return { count: 0 };
        const r = state.row;
        if (where.id !== r.id || where.state !== r.state || where.updatedAt.getTime() !== r.updatedAt.getTime()) return { count: 0 };
        state.row = { ...r, ...data, updatedAt: new Date(r.updatedAt.getTime() + 1000) };
        return { count: 1 };
      }),
    },
    jobTaskEvent: {
      create: vi.fn(async ({ data }) => {
        const e = { id: `ev-${state.events.length + 1}`, ...data };
        state.events.push(e);
        return { id: e.id };
      }),
    },
    agentRun: { findFirst: vi.fn(async () => (opts.hasRun === false ? null : { id: "run-9" })) },
    checklistResult: { count: vi.fn(async () => opts.blockFails ?? 0) },
  };
  const db: JobTaskDb = {
    $transaction: async (fn) => {
      state.transactions += 1;
      return fn(tx);
    },
  };
  return { db, tx, state };
}

describe("transitionJobTask", () => {
  it("approves in one transaction and appends an event", async () => {
    const { db, state, tx } = fakeDb({});
    const r = await transitionJobTask(db, "job-1", "APPROVED", reviewer, { expectedState: "IN_REVIEW", now: NOW });
    expect(r).toEqual({ ok: true, jobTaskId: "job-1", from: "IN_REVIEW", to: "APPROVED", edge: "approve", eventId: "ev-1", at: NOW });
    expect(state.transactions).toBe(1);
    expect(state.row.state).toBe("APPROVED");
    expect(state.events).toEqual([{ id: "ev-1", jobTaskId: "job-1", fromState: "IN_REVIEW", toState: "APPROVED", actorId: "u-ravi", note: null }]);
    expect(tx.jobTask.updateMany).toHaveBeenCalledWith({ where: { id: "job-1", state: "IN_REVIEW", updatedAt: T0 }, data: { state: "APPROVED" } });
    expect(tx.checklistResult.count).toHaveBeenCalledWith({ where: { agentRunId: "run-9", severity: "block", status: "fail" } });
  });

  it("returns NOT_FOUND for a missing job", async () => {
    const { db } = fakeDb({});
    expect(await transitionJobTask(db, "job-x", "APPROVED", reviewer, { expectedState: "IN_REVIEW", now: NOW })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("refuses when the state changed since the caller read it", async () => {
    const { db, state } = fakeDb({ state: "APPROVED" });
    const r = await transitionJobTask(db, "job-1", "APPROVED", reviewer, { expectedState: "IN_REVIEW", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(state.events).toHaveLength(0);
  });

  it("refuses when a concurrent write lands between read and update", async () => {
    const { db, state } = fakeDb({}, { raceOnUpdate: true });
    const r = await transitionJobTask(db, "job-1", "APPROVED", reviewer, { expectedState: "IN_REVIEW", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(state.events).toHaveLength(0);
  });

  it("a second identical request loses the race", async () => {
    const { db, state } = fakeDb({});
    const first = await transitionJobTask(db, "job-1", "APPROVED", reviewer, { expectedState: "IN_REVIEW", now: NOW });
    const second = await transitionJobTask(db, "job-1", "APPROVED", reviewer, { expectedState: "IN_REVIEW", now: NOW });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(state.events).toHaveLength(1);
  });

  it("counts block failures on the latest run inside the transaction", async () => {
    const { db, state } = fakeDb({}, { blockFails: 2 });
    const r = await transitionJobTask(db, "job-1", "APPROVED", reviewer, { expectedState: "IN_REVIEW", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "BLOCKING_FAILURES" });
    expect(state.row.state).toBe("IN_REVIEW");
    const p = await transitionJobTask(db, "job-1", "APPROVED", partner, { expectedState: "IN_REVIEW", note: "False positive: counterparty GSTIN verified", now: NOW });
    expect(p.ok).toBe(true);
    expect(state.events[0].note).toBe("False positive: counterparty GSTIN verified");
  });

  it("treats a job with no agent run as having no block failures", async () => {
    const { db, tx } = fakeDb({}, { hasRun: false, blockFails: 5 });
    expect((await transitionJobTask(db, "job-1", "APPROVED", reviewer, { expectedState: "IN_REVIEW", now: NOW })).ok).toBe(true);
    expect(tx.checklistResult.count).not.toHaveBeenCalled();
  });

  it("does not count failures for other edges", async () => {
    const { db, tx } = fakeDb({ state: "AGENT_DONE" });
    expect((await transitionJobTask(db, "job-1", "IN_REVIEW", staff, { expectedState: "AGENT_DONE", now: NOW })).ok).toBe(true);
    expect(tx.agentRun.findFirst).not.toHaveBeenCalled();
  });

  it("FILED_BY_HUMAN stamps filedAt, filedById and the trimmed ack ref", async () => {
    const { db, state } = fakeDb({ state: "APPROVED" });
    const r = await transitionJobTask(db, "job-1", "FILED_BY_HUMAN", staff, { expectedState: "APPROVED", ackRef: "  AA291126001234X ", now: NOW });
    expect(r.ok).toBe(true);
    expect(state.row).toMatchObject({ state: "FILED_BY_HUMAN", filedAt: NOW, filedById: "u-priya", ackRef: "AA291126001234X" });
    expect(state.events[0].note).toBe("ack ref AA291126001234X");
  });

  it("FILED_BY_HUMAN without the ARN is refused and writes nothing", async () => {
    const { db, state, tx } = fakeDb({ state: "APPROVED" });
    const r = await transitionJobTask(db, "job-1", "FILED_BY_HUMAN", staff, { expectedState: "APPROVED", ackRef: "  ", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "ACK_REF_REQUIRED" });
    expect(tx.jobTask.updateMany).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(0);
  });

  it("retracting a filing clears the confirmation and records the old ref", async () => {
    const { db, state } = fakeDb({ state: "CLOSING", ackRef: "AA2911260012345", filedAt: T0, filedById: "u-priya" });
    const r = await transitionJobTask(db, "job-1", "APPROVED", partner, { expectedState: "CLOSING", note: "Filed against wrong period", now: NOW });
    expect(r.ok).toBe(true);
    expect(state.row).toMatchObject({ state: "APPROVED", filedAt: null, filedById: null, ackRef: null });
    expect(state.events[0].note).toBe("Filed against wrong period · retracted ack ref AA2911260012345");
  });

  it("DONE needs a gate token; with one it stamps doneAt and burns the token", async () => {
    const { db, state } = fakeDb({ state: "CLOSING" });
    expect(await transitionJobTask(db, "job-1", "DONE", partner, { expectedState: "CLOSING", now: NOW })).toMatchObject({ ok: false, code: "GATE_REQUIRED" });

    const token = mint({ jobTaskId: "job-1", now: NOW, evidence: { deliverableIds: ["d1"] } });
    const r = await transitionJobTask(db, "job-1", "DONE", system, { expectedState: "CLOSING", gateToken: token, now: NOW });
    expect(r).toMatchObject({ ok: true, to: "DONE", edge: "close" });
    expect(state.row).toMatchObject({ state: "DONE", doneAt: NOW });
    expect(state.events[0]).toMatchObject({ fromState: "CLOSING", toState: "DONE", actorId: "system:close-gate" });

    const again = fakeDb({ state: "CLOSING" });
    expect(await transitionJobTask(again.db, "job-1", "DONE", system, { expectedState: "CLOSING", gateToken: token, now: NOW })).toMatchObject({
      ok: false,
      code: "GATE_REQUIRED",
    });
  });

  it("uses the real clock when no now is injected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { db, state } = fakeDb({ state: "APPROVED" });
      await transitionJobTask(db, "job-1", "FILED_BY_HUMAN", staff, { expectedState: "APPROVED", ackRef: "ARN1", note: "filed" });
      expect(state.row.filedAt).toEqual(NOW);
      expect(state.events[0].note).toBe("filed · ack ref ARN1");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("updateFor", () => {
  it("sets only state for ordinary edges", () => {
    expect(updateFor("IN_PREP", "ASSIGNED", staff, null, NOW)).toEqual({ state: "IN_PREP" });
    expect(updateFor("APPROVED", "IN_REVIEW", reviewer, null, NOW)).toEqual({ state: "APPROVED" });
  });
  it("records no filer for a non-human actor", () => {
    expect(updateFor("FILED_BY_HUMAN", "APPROVED", system, null, NOW)).toEqual({ state: "FILED_BY_HUMAN", filedAt: NOW, filedById: null, ackRef: null });
  });
});
