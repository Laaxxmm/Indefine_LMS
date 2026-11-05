// Drift monitoring storage (ADR-008 §9). Reads the signals the pure rates in src/lib/ai/usage.ts
// need — the runs' `guardrail-run` AuditEvents, AgentRun rows (runs and request-changes) and
// MistakeLog proposals — and writes one `guardrail-breach` AuditEvent per agent per IST day
// (entityId "<agent>:<YYYY-MM-DD>"; an existing one is never written again). No schema change:
// counts live in AuditEvent.meta. Called when /admin/firm-os/models loads. The client is injected.
import type { GuardrailDay, GuardrailRunSignal, ReviewSignal } from "@/lib/ai/usage";
import { logAudit } from "@/lib/audit/log";
import { GUARDRAIL_RUN_ACTION } from "./session";

export const GUARDRAIL_BREACH_ACTION = "guardrail-breach";
export const GUARDRAIL_BREACH_ENTITY = "AgentGuardrails";

type AppDb = (typeof import("@/lib/prisma"))["prisma"];
export type DriftDb = Pick<AppDb, "auditEvent" | "agentRun" | "mistakeLog">;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Guardrail-run records, runs / request-changes and MistakeLog proposals created in [from, to). */
export async function loadGuardrailSignals(from: Date, to: Date, db: DriftDb): Promise<{ runs: GuardrailRunSignal[]; reviews: ReviewSignal[] }> {
  const range = { gte: from, lt: to };
  const [events, agentRuns, mistakes] = await Promise.all([
    db.auditEvent.findMany({ where: { action: GUARDRAIL_RUN_ACTION, createdAt: range }, select: { createdAt: true, meta: true }, orderBy: { createdAt: "asc" } }),
    db.agentRun.findMany({ where: { startedAt: range }, select: { agent: true, status: true, startedAt: true } }),
    db.mistakeLog.findMany({ where: { createdAt: range }, select: { agent: true, createdAt: true } }),
  ]);
  const runs: GuardrailRunSignal[] = [];
  for (const e of events) {
    const m = (e.meta ?? {}) as Record<string, unknown>;
    if (typeof m.agent !== "string") continue;
    runs.push({
      createdAt: e.createdAt,
      agent: m.agent,
      judgements: num(m.judgements),
      abstained: num(m.abstained),
      groundChecked: num(m.groundChecked),
      ungrounded: num(m.ungrounded),
      agreementChecks: num(m.agreementChecks),
      disagreements: num(m.disagreements),
      scopeViolations: num(m.scopeViolations),
      wrongInput: num(m.wrongInput),
    });
  }
  const reviews: ReviewSignal[] = [];
  for (const r of agentRuns) {
    reviews.push({ createdAt: r.startedAt, agent: r.agent, kind: "run" });
    // A run sent back by its reviewer; counted on the day the run was produced.
    if (r.status === "CHANGES_REQUESTED") reviews.push({ createdAt: r.startedAt, agent: r.agent, kind: "changes-requested" });
  }
  for (const m of mistakes) reviews.push({ createdAt: m.createdAt, agent: m.agent, kind: "mistake" });
  return { runs, reviews };
}

export const breachEntityId = (agent: string, day: string) => `${agent}:${day}`;

/** One `guardrail-breach` AuditEvent per agent per day with a breach; returns the entity ids written now. */
export async function recordGuardrailBreaches(days: GuardrailDay[], db: Pick<AppDb, "auditEvent">): Promise<string[]> {
  const breached = days.filter((d) => d.breaches.length > 0);
  if (!breached.length) return [];
  const ids = breached.map((d) => breachEntityId(d.agent, d.day));
  const existing = await db.auditEvent.findMany({ where: { action: GUARDRAIL_BREACH_ACTION, entity: GUARDRAIL_BREACH_ENTITY, entityId: { in: ids } }, select: { entityId: true } });
  const done = new Set(existing.map((e) => e.entityId));
  const written: string[] = [];
  for (const d of breached) {
    const id = breachEntityId(d.agent, d.day);
    if (done.has(id)) continue;
    await logAudit(db, {
      actorId: null,
      action: GUARDRAIL_BREACH_ACTION,
      entity: GUARDRAIL_BREACH_ENTITY,
      entityId: id,
      meta: { agent: d.agent, day: d.day, breaches: d.breaches.map((b) => ({ ...b, rate: b.rate === null ? null : Math.round(b.rate * 10_000) / 10_000 })) },
    });
    done.add(id);
    written.push(id);
  }
  return written;
}
