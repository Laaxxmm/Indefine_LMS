// correctField(): the one way Firm OS fixes a wrong entry. Allow-listed fields only
// (allowlist.ts); everything runs in one transaction:
//
//   load the record → may this person correct it? → record-level guards → parse + check the new
//   value → database checks (uniqueness, active people) → UPDATE the one column →
//   AuditEvent { action: "correct", entity, entityId, meta: { field, label, before, after, reason } }
//
// before / after are masked for class A data and the reason passes the anonymizer (ADR-006: the
// audit keeps no raw client personal data). Nothing is ever removed: a correction is an UPDATE plus
// an audit row, and the history view reads those audit rows back.
//
// The audit row is written directly with prisma.auditEvent.create. When the hardening branch's
// logAudit() (src/lib/audit) is merged, switch the single write in writeCorrectionAudit() to it.
import type { Prisma } from "@prisma/client";
import type { prisma as prismaClient } from "@/lib/prisma";
import { isActive, type SessionUser } from "@/lib/access";
import { turnoverBand } from "@/lib/clients/core";
import {
  ALLOW_LIST,
  ENTITY_MODEL,
  ENTITY_NOUN,
  RECORD_GUARDS,
  UNKNOWN_ENTITY_MESSAGE,
  isCorrectionEntity,
  refusalFor,
  type CorrectionEntity,
  type Row,
} from "./allowlist";
import { NOT_ALLOWED_MESSAGE, mayCorrect, type PermissionContext } from "./access";
import { maskForAudit, scrubFreeText, type AuditValue } from "./mask";
import { Refusal, fail, isUniqueViolation, ok, type ServiceResult } from "./result";

export type CorrectionsDb = Pick<typeof prismaClient, "client" | "firmClient" | "jobTask" | "engagement" | "commsDraft" | "user" | "auditEvent" | "$transaction">;
/** The client inside db.$transaction(fn) (the last $transaction overload is the interactive one). */
type Tx = Parameters<Parameters<CorrectionsDb["$transaction"]>[0]>[0];

export interface CorrectionInput {
  entity: string;
  id: string;
  field: string;
  newValue: unknown;
  reason: string;
  /** Set when the correction answers a DPDP correction request (src/lib/privacy). */
  privacyRequestId?: string | null;
}

export interface CorrectionDone {
  entity: CorrectionEntity;
  id: string;
  field: string;
  label: string;
  before: AuditValue;
  after: AuditValue;
  auditEventId: string;
  /** A follow-up the person should do outside Firm OS (e.g. change the code in Turia too). */
  note: string | null;
}

export interface CorrectionDeps {
  db: CorrectionsDb;
  /** Runs after the transaction committed (production: rebuild the /clients workbook). Failures are logged, never returned. */
  afterCommit?: (done: CorrectionDone) => void | Promise<void>;
}

export const REASON_MESSAGE = "Say briefly why the entry was wrong (at least 5 characters), so the history explains the change.";
export const SAME_VALUE_MESSAGE = "That is already the value on record, so there is nothing to correct.";

type Delegate = {
  findUnique(args: { where: { id: string } }): Promise<Row | null>;
  update(args: { where: { id: string }; data: Row }): Promise<unknown>;
};
const delegate = (tx: Tx, entity: CorrectionEntity) => tx[ENTITY_MODEL[entity]] as unknown as Delegate;

const notFound = (entity: CorrectionEntity) =>
  `That ${ENTITY_NOUN[entity]} wasn't found. It may have been archived, or the link is out of date. Go back and open it again.`;

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

async function permissionContext(tx: Tx, entity: CorrectionEntity, record: Row): Promise<PermissionContext> {
  if (entity === "CommsDraft") return { createdById: (record.createdById as string | null) ?? null };
  if (entity === "JobTask" || entity === "Engagement") {
    const assigneeId = record.assigneeId as string | null;
    if (!assigneeId) return { assigneeManagerId: null };
    const assignee = await tx.user.findUnique({ where: { id: assigneeId }, select: { managerId: true } });
    return { assigneeManagerId: assignee?.managerId ?? null };
  }
  return {};
}

const USER_FIELDS = new Set(["primaryHandlerId", "assigneeId", "reviewerId"]);

/** Checks that need other rows: unique codes and PANs, and that a picked person is a real, active user. */
async function databaseChecks(tx: Tx, entity: CorrectionEntity, field: string, value: unknown, id: string): Promise<void> {
  if (USER_FIELDS.has(field) && typeof value === "string") {
    const u = await tx.user.findUnique({ where: { id: value }, select: { active: true, excludedFromScoring: true } });
    if (!u || !u.active) throw new Refusal(400, "That person isn't an active user. Pick someone from the list.");
    if (u.excludedFromScoring) throw new Refusal(400, "That account is a shared mailbox, not a person. Pick a person from the list.");
  }
  if (entity === "FirmClient" && field === "clientCode") {
    const taken = await tx.firmClient.findFirst({ where: { clientCode: String(value), id: { not: id } }, select: { lmsClientId: true } });
    if (taken) {
      const other = await tx.client.findUnique({ where: { id: taken.lmsClientId }, select: { name: true } });
      throw new Refusal(409, `Client code ${String(value)} is already used by ${other?.name ?? "another client"}. Pick a different code.`);
    }
  }
  if (entity === "Client" && field === "pan" && value) {
    const dup = await tx.client.findFirst({ where: { pan: String(value), id: { not: id } }, select: { name: true } });
    if (dup) throw new Refusal(409, `That PAN already belongs to ${dup.name}. Check the PAN, or correct the other client first.`);
  }
}

function uniqueMessage(entity: CorrectionEntity, field: string): string {
  if (entity === "JobTask") return "Another job for this client already has that title and period. Check the client's job list before correcting.";
  if (field === "clientCode") return "Another client already uses that code. Pick a different code.";
  if (field === "pan") return "Another client already has that PAN. Check the PAN, or correct the other client first.";
  return "Another record already has that value. Check the value and try again.";
}

async function writeCorrectionAudit(tx: Tx, data: { actorId: string; entity: CorrectionEntity; entityId: string; meta: Prisma.InputJsonObject }): Promise<string> {
  const ev = await tx.auditEvent.create({ data: { action: "correct", ...data }, select: { id: true } });
  return ev.id;
}

export async function correctField(user: SessionUser, input: CorrectionInput, deps: CorrectionDeps): Promise<ServiceResult<CorrectionDone>> {
  if (!user || !isActive(user)) return fail(401, "Sign in with an active account to make a correction.");
  const { entity, id, field } = input;
  if (!isCorrectionEntity(entity)) return fail(400, UNKNOWN_ENTITY_MESSAGE);
  const refusal = refusalFor(entity, field);
  if (refusal) return fail(400, refusal);
  const spec = ALLOW_LIST[entity][field];
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 5) return fail(400, REASON_MESSAGE);
  if (reason.length > 500) return fail(400, "Keep the reason to 500 characters or fewer.");

  let done: CorrectionDone;
  try {
    done = await deps.db.$transaction(async (tx) => {
      const record = await delegate(tx, entity).findUnique({ where: { id } });
      if (!record) throw new Refusal(404, notFound(entity));
      if (!mayCorrect(user, spec.who, await permissionContext(tx, entity, record))) throw new Refusal(403, NOT_ALLOWED_MESSAGE[spec.who]);
      const guard = RECORD_GUARDS[entity](record);
      if (guard) throw new Refusal(guard.status, guard.error);

      const parsed = spec.parse(input.newValue);
      if (!parsed.ok) throw new Refusal(400, parsed.error);
      const problem = spec.check?.(parsed.value, record);
      if (problem) throw new Refusal(problem.status, problem.error);
      const before = record[field];
      if (sameValue(before, parsed.value)) throw new Refusal(400, SAME_VALUE_MESSAGE);
      await databaseChecks(tx, entity, field, parsed.value, id);

      const data: Row = { [field]: parsed.value };
      if (entity === "Client" && field === "turnover") data.turnoverBand = turnoverBand(parsed.value as number);
      await delegate(tx, entity).update({ where: { id }, data });

      const maskedBefore = maskForAudit(spec.pii, before);
      const maskedAfter = maskForAudit(spec.pii, parsed.value);
      const auditEventId = await writeCorrectionAudit(tx, {
        actorId: user.id,
        entity,
        entityId: id,
        meta: {
          field,
          label: spec.label,
          before: maskedBefore,
          after: maskedAfter,
          reason: scrubFreeText(reason),
          ...(input.privacyRequestId ? { privacyRequestId: input.privacyRequestId } : {}),
        },
      });
      return { entity, id, field, label: spec.label, before: maskedBefore, after: maskedAfter, auditEventId, note: spec.afterNote ?? null };
    });
  } catch (e) {
    if (e instanceof Refusal) return fail(e.status, e.message);
    if (isUniqueViolation(e)) return fail(409, uniqueMessage(entity, field));
    throw e;
  }

  try {
    await deps.afterCommit?.(done);
  } catch (e) {
    console.error("correction follow-up failed:", (e as Error).message);
  }
  return ok(done);
}

let cached: CorrectionDeps | null = null;

/** Prisma + the /clients workbook rebuild after a client master correction. Built on first use. */
export async function defaultCorrectionDeps(): Promise<CorrectionDeps> {
  if (cached) return cached;
  const { prisma } = await import("@/lib/prisma");
  const deps: CorrectionDeps = {
    db: prisma,
    afterCommit: async (done) => {
      if (done.entity !== "Client") return;
      const { scheduleWorkbookRebuild } = await import("@/lib/clients/workbook");
      scheduleWorkbookRebuild();
    },
  };
  cached = deps;
  return deps;
}
