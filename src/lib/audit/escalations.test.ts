import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ESCALATION_ACTION, ESCALATION_ENTITY, auditModelEscalations, type EscalatedCall, type EscalationDb } from "./escalations";

// Compile-time: the real Prisma client satisfies the narrow client the sweep takes.
export const _prismaFits = (p: PrismaClient): EscalationDb => p;

const NOW = new Date("2026-11-06T00:30:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function world(calls: (Partial<EscalatedCall> & { id: string; escalated?: boolean })[]) {
  const audits: { action: string; entity: string; entityId: string | null; actorId: string | null; meta?: unknown }[] = [];
  const rows = calls.map((c) => ({ runId: "run-1", agent: "gst", task: "gst.extract", provider: "claude", tier: "SMART", escalationLevel: 1, status: "OK", createdAt: new Date(NOW.getTime() - DAY), escalated: true, ...c }));
  const db: EscalationDb = {
    modelCall: {
      findMany: async ({ where, take }) =>
        rows.filter((r) => r.escalated === where.escalated && r.createdAt >= where.createdAt.gte && r.createdAt < where.createdAt.lt).slice(0, take),
    },
    auditEvent: {
      create: async ({ data }) => (audits.push({ ...data }), { id: `a${audits.length}` }),
      findMany: async ({ where }) => audits.filter((a) => a.action === where.action && a.entity === where.entity && where.entityId.in.includes(a.entityId ?? "")).map((a) => ({ entityId: a.entityId })),
    },
  };
  return { db, audits };
}

describe("auditModelEscalations", () => {
  it("writes one model-escalation AuditEvent per escalated call in the window, with ids and tiers only", async () => {
    const { db, audits } = world([{ id: "mc-1" }, { id: "mc-2", escalationLevel: 2, tier: "HARD" }, { id: "mc-old", createdAt: new Date(NOW.getTime() - 8 * DAY) }, { id: "mc-plain", escalated: false }]);
    expect(await auditModelEscalations(db, { now: NOW })).toEqual({ scanned: 2, written: 2 });
    expect(audits.map((a) => a.entityId)).toEqual(["mc-1", "mc-2"]);
    expect(audits[1]).toMatchObject({
      actorId: "system:model-router",
      action: ESCALATION_ACTION,
      entity: ESCALATION_ENTITY,
      meta: { runId: "run-1", agent: "gst", task: "gst.extract", provider: "claude", tier: "HARD", escalationLevel: 2, status: "OK", via: "sweep" },
    });
  });

  it("is idempotent: a second sweep writes nothing", async () => {
    const { db, audits } = world([{ id: "mc-1" }]);
    await auditModelEscalations(db, { now: NOW });
    expect(await auditModelEscalations(db, { now: NOW })).toEqual({ scanned: 1, written: 0 });
    expect(audits).toHaveLength(1);
  });

  it("honours the look-back window and the per-sweep cap; no calls → no audit query", async () => {
    const { db, audits } = world([{ id: "mc-1", createdAt: new Date(NOW.getTime() - 2 * DAY) }, { id: "mc-2" }]);
    expect(await auditModelEscalations(db, { now: NOW, lookbackDays: 0.5 })).toEqual({ scanned: 0, written: 0 });
    expect(await auditModelEscalations(db, { now: NOW, max: 1 })).toEqual({ scanned: 1, written: 1 });
    expect(audits.map((a) => a.entityId)).toEqual(["mc-1"]);
  });
});
