// The one way Firm OS writes an AuditEvent (Phase 11): every create / approve / close / export /
// model escalation / retract / spot-check / onboard / comms draft goes through logAudit().
// scripts/verify-audit-coverage.ts checks statically that every mutating Firm OS route reaches it.
//
// AuditEvent is append-only and kept (ADR-006 retention table): it records who did what to which
// row, never raw client text. `meta` is a small JSON summary (ids, states, counts, refs); anything
// larger than META_MAX_BYTES is replaced by a marker instead of being stored.
//
// Takes any client with `auditEvent.create` — PrismaClient, an interactive-transaction client
// (`tx`), or the narrow fakes the close loop and agent tests use — so the write can join the
// caller's transaction.
import type { Prisma } from "@prisma/client";

export type AuditEventRow = {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  meta?: Prisma.InputJsonValue;
};

/** The one method logAudit needs. PrismaClient and Prisma.TransactionClient satisfy it. */
export interface AuditDb {
  auditEvent: {
    create(args: { data: AuditEventRow; select: { id: true } }): PromiseLike<{ id: string }>;
  };
}

export type AuditInput = {
  /** User id, or `agent:<runId>` / `system:<name>`; null when nobody is signed in (refused attempts). */
  actorId: string | null | undefined;
  /** Verb: lower case, `a-z 0-9 . : _ -` (e.g. "approve", "turia-close-confirmed", "onboarding.start"). */
  action: string;
  /** Prisma model name the event is about ("JobTask", "AgentRun", "TuriaSync", ...). */
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
};

export const ACTION_RE = /^[a-z0-9][a-z0-9.:_-]{0,63}$/;
export const ENTITY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const META_MAX_BYTES = 8 * 1024;

export class AuditInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditInputError";
  }
}

/** A plain JSON copy (Dates become ISO strings, undefined drops out), capped at META_MAX_BYTES. */
export function auditMeta(meta: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (meta == null) return undefined;
  const text = JSON.stringify(meta);
  if (text === undefined) return undefined;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > META_MAX_BYTES) return { truncated: true, bytes, keys: Object.keys(meta).slice(0, 20) };
  return JSON.parse(text) as Prisma.InputJsonValue;
}

/** The row logAudit would write (validated); exported for tests and dry runs. */
export function auditRow(e: AuditInput): AuditEventRow {
  if (!ACTION_RE.test(e.action)) throw new AuditInputError(`Audit action "${e.action}" must be lower case a-z 0-9 . : _ - (max 64)`);
  if (!ENTITY_RE.test(e.entity)) throw new AuditInputError(`Audit entity "${e.entity}" must be a model name`);
  const row: AuditEventRow = { actorId: e.actorId ?? null, action: e.action, entity: e.entity, entityId: e.entityId ?? null };
  const meta = auditMeta(e.meta);
  if (meta !== undefined) row.meta = meta;
  return row;
}

/** Appends one AuditEvent through `db` (a client or a transaction) and returns its id. */
export async function logAudit(db: AuditDb, e: AuditInput): Promise<{ id: string }> {
  return db.auditEvent.create({ data: auditRow(e), select: { id: true } });
}

/** An injected store's audit method (onboarding's SagaStore and OnboardingDeps): persists one row. */
export type AuditSink = {
  audit(event: { actorId: string; action: string; entity: string; entityId: string | null; meta?: Record<string, unknown> }): Promise<void>;
};

/**
 * An AuditDb over an injected store's audit method, for modules whose database is an injected
 * store (so tests and chaos runs can swap it): they still write through logAudit — the same
 * validated action and entity, the same JSON-copied, capped meta — and the store persists the row
 * it is handed (production: prismaSagaStore.audit → logAudit on Prisma). The new row's id is not
 * known through a sink, so the result's id is empty; callers that need it pass a real client.
 */
export function auditDbFromSink(sink: AuditSink): AuditDb {
  return {
    auditEvent: {
      create: async ({ data }) => {
        const meta = data.meta as Record<string, unknown> | undefined;
        await sink.audit({ actorId: data.actorId ?? "system:unknown", action: data.action, entity: data.entity, entityId: data.entityId, ...(meta === undefined ? {} : { meta }) });
        return { id: "" };
      },
    },
  };
}
