// Drift monitoring storage: guardrail-run AuditEvents, runs / request-changes and MistakeLog
// proposals in; one guardrail-breach AuditEvent per agent per day out (never twice).
import { describe, expect, it, vi } from "vitest";
import type { GuardrailDay } from "@/lib/ai/usage";
import { GUARDRAIL_BREACH_ACTION, GUARDRAIL_BREACH_ENTITY, breachEntityId, loadGuardrailSignals, recordGuardrailBreaches } from "./drift-db";

const AT = new Date("2026-11-05T05:00:00Z");

describe("loadGuardrailSignals", () => {
  it("maps guardrail-run meta (bad meta skipped), runs, request-changes and mistakes", async () => {
    const db = {
      auditEvent: {
        findMany: vi.fn(async () => [
          { createdAt: AT, meta: { agent: "gst", judgements: 3, abstained: 1, groundChecked: 9, ungrounded: 1, agreementChecks: 2, disagreements: 1, scopeViolations: 0, wrongInput: 0, injections: 2, tasks: { "gst.read-hsn@2": { checked: 8, ungrounded: 1 }, bad: "x" } } },
          { createdAt: AT, meta: { judgements: 5 } },
          { createdAt: AT, meta: { agent: "tax", judgements: "x" } },
        ]),
      },
      agentRun: { findMany: vi.fn(async () => [{ agent: "gst", status: "CHANGES_REQUESTED", startedAt: AT }, { agent: "gst", status: "AGENT_DONE", startedAt: AT }]) },
      mistakeLog: { findMany: vi.fn(async () => [{ agent: "gst", createdAt: AT }]) },
    };
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-06T00:00:00Z");
    const s = await loadGuardrailSignals(from, to, db as never);
    expect(db.auditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { action: "guardrail-run", createdAt: { gte: from, lt: to } } }));
    expect(s.runs).toEqual([
      { createdAt: AT, agent: "gst", judgements: 3, abstained: 1, groundChecked: 9, ungrounded: 1, agreementChecks: 2, disagreements: 1, scopeViolations: 0, wrongInput: 0, injections: 2, tasks: { "gst.read-hsn@2": { checked: 8, ungrounded: 1 } } },
      { createdAt: AT, agent: "tax", judgements: 0, abstained: 0, groundChecked: 0, ungrounded: 0, agreementChecks: 0, disagreements: 0, scopeViolations: 0, wrongInput: 0, injections: 0, tasks: {} },
    ]);
    expect(s.reviews.map((r) => r.kind)).toEqual(["run", "changes-requested", "run", "mistake"]);
  });
});

describe("recordGuardrailBreaches", () => {
  const day = (agent: string, d: string, breached: boolean): GuardrailDay => ({
    agent,
    day: d,
    rates: {} as GuardrailDay["rates"],
    scopeViolations: 0,
    wrongInput: 0,
    hallucination: [],
    injections: 1,
    breaches: breached ? [{ metric: "abstain", rate: 0.456789, count: 5, threshold: 0.3, sample: 11 }] : [],
  });

  it("writes one event per breached agent-day, skips existing ones and quiet days", async () => {
    const created: unknown[] = [];
    const db = {
      auditEvent: {
        findMany: vi.fn(async () => [{ entityId: breachEntityId("gst", "2026-11-04") }]),
        create: vi.fn(async (a: unknown) => void created.push(a)),
      },
    };
    const written = await recordGuardrailBreaches([day("gst", "2026-11-04", true), day("gst", "2026-11-05", true), day("tax", "2026-11-05", false)], db as never);
    expect(written).toEqual(["gst:2026-11-05"]);
    expect(db.auditEvent.findMany).toHaveBeenCalledWith({ where: { action: GUARDRAIL_BREACH_ACTION, entity: GUARDRAIL_BREACH_ENTITY, entityId: { in: ["gst:2026-11-04", "gst:2026-11-05"] } }, select: { entityId: true } });
    expect(created).toEqual([
      {
        data: {
          actorId: null,
          action: "guardrail-breach",
          entity: "AgentGuardrails",
          entityId: "gst:2026-11-05",
          meta: { agent: "gst", day: "2026-11-05", breaches: [{ metric: "abstain", rate: 0.4568, count: 5, threshold: 0.3, sample: 11 }], injections: 1 },
        },
        select: { id: true }, // written through logAudit (src/lib/audit/log.ts)
      },
    ]);
  });
  it("nothing breached → no query at all", async () => {
    const db = { auditEvent: { findMany: vi.fn(), create: vi.fn() } };
    expect(await recordGuardrailBreaches([day("gst", "2026-11-05", false)], db as never)).toEqual([]);
    expect(db.auditEvent.findMany).not.toHaveBeenCalled();
  });
});
