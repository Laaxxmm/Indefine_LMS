import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, Prisma } from "@prisma/client";
import { AuditInputError, META_MAX_BYTES, auditMeta, auditRow, logAudit, type AuditDb } from "./log";

// Compile-time: the Prisma client and an interactive-transaction client both satisfy AuditDb.
export const _prismaFits = (p: PrismaClient): AuditDb => p;
export const _txFits = (tx: Prisma.TransactionClient): AuditDb => tx;

function fakeDb() {
  const rows: unknown[] = [];
  const db: AuditDb = { auditEvent: { create: vi.fn(async (a: { data: unknown }) => (rows.push(a.data), { id: `a${rows.length}` })) } };
  return { db, rows };
}

describe("logAudit", () => {
  it("writes one row through the given client and returns its id", async () => {
    const { db, rows } = fakeDb();
    expect(await logAudit(db, { actorId: "u-1", action: "approve", entity: "JobTask", entityId: "job-1", meta: { runId: "run-1" } })).toEqual({ id: "a1" });
    expect(rows).toEqual([{ actorId: "u-1", action: "approve", entity: "JobTask", entityId: "job-1", meta: { runId: "run-1" } }]);
    expect(db.auditEvent.create).toHaveBeenCalledWith({ data: rows[0], select: { id: true } });
  });

  it("defaults a missing actor / entity id to null and leaves meta out when there is none", async () => {
    const { db, rows } = fakeDb();
    await logAudit(db, { actorId: undefined, action: "done-refused", entity: "JobTask" });
    await logAudit(db, { actorId: null, action: "reconcile", entity: "JobTask", entityId: null, meta: null });
    expect(rows).toEqual([
      { actorId: null, action: "done-refused", entity: "JobTask", entityId: null },
      { actorId: null, action: "reconcile", entity: "JobTask", entityId: null },
    ]);
  });

  it("joins the caller's transaction: the write goes to whatever client is passed", async () => {
    const outer = fakeDb();
    const tx = fakeDb();
    await logAudit(tx.db, { actorId: "u-1", action: "close", entity: "JobTask", entityId: "job-1" });
    expect(tx.rows).toHaveLength(1);
    expect(outer.rows).toHaveLength(0);
  });

  it.each(["", "Approve", "has space", "x".repeat(65), "-lead", "a/b"])("refuses action %j before writing", async (action) => {
    const { db, rows } = fakeDb();
    await expect(logAudit(db, { actorId: "u", action, entity: "JobTask" })).rejects.toBeInstanceOf(AuditInputError);
    expect(rows).toEqual([]);
  });

  it.each(["", "job task", "1Job", "x".repeat(65)])("refuses entity %j", (entity) => {
    expect(() => auditRow({ actorId: "u", action: "approve", entity })).toThrow(AuditInputError);
  });

  it("accepts the action forms in use", () => {
    for (const action of ["approve", "turia-close-confirmed", "onboarding.start", "copy-to-final-failed", "spot-check", "model-escalation", "a:b_c"]) {
      expect(auditRow({ actorId: null, action, entity: "AgentRun" }).action).toBe(action);
    }
  });
});

describe("auditMeta", () => {
  it("stores a plain JSON copy: Dates as ISO strings, undefined dropped", () => {
    expect(auditMeta({ at: new Date("2026-11-05T06:30:00Z"), skip: undefined, n: 2, list: ["a"] })).toEqual({ at: "2026-11-05T06:30:00.000Z", n: 2, list: ["a"] });
    expect(auditMeta(undefined)).toBeUndefined();
    expect(auditMeta(null)).toBeUndefined();
  });

  it("replaces an oversized meta by a marker instead of storing it", () => {
    const big = { text: "x".repeat(META_MAX_BYTES + 10), id: "r1" };
    expect(auditMeta(big)).toEqual({ truncated: true, bytes: expect.any(Number), keys: ["text", "id"] });
    expect(auditMeta({ text: "x".repeat(100) })).toEqual({ text: "x".repeat(100) });
  });
});
