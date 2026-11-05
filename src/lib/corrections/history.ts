// Correction history of one record: every AuditEvent { action: "correct" } for it, newest first,
// as "who, when, field, before → after, reason", plus the fields the viewer may correct right now
// (the History panel's form). Values are shown exactly as the audit stored them: class A data stays
// masked; dates, people and option values are turned into words here.
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import type { prisma } from "@/lib/prisma";
import { formatDate, formatDateTimeIst } from "@/lib/agents/core/format";
import { ALLOW_LIST, ENTITY_MODEL, ENTITY_NOUN, UNKNOWN_ENTITY_MESSAGE, isCorrectionEntity, type CorrectionEntity, type InputKind, type Row } from "./allowlist";
import { mayCorrect, mayViewHistory } from "./access";
import { fail, ok, type ServiceResult } from "./result";

export type HistoryDb = Pick<typeof prisma, "client" | "firmClient" | "jobTask" | "engagement" | "commsDraft" | "user" | "auditEvent">;

export interface HistoryEntry {
  id: string;
  /** ISO instant. */
  at: string;
  /** "05 Nov 2026 14:30" (IST). */
  atLabel: string;
  actorName: string;
  field: string;
  label: string;
  before: string;
  after: string;
  reason: string;
  privacyRequestId: string | null;
}

export interface EditableField {
  field: string;
  label: string;
  input: InputKind;
  options?: readonly { value: string; label: string }[];
}

export interface HistoryView {
  entity: CorrectionEntity;
  id: string;
  noun: string;
  entries: HistoryEntry[];
  editable: EditableField[];
  /** Active people, for "user" inputs (only when one is editable). */
  people: { id: string; name: string }[];
}

type Finder = { findUnique(args: { where: { id: string } }): Promise<Row | null> };

const DATE_FIELDS = new Set(["internalDueOn", "onboardedOn"]);
const USER_FIELDS = new Set(["primaryHandlerId", "assigneeId", "reviewerId"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** A stored audit value in words. */
export function displayValue(entity: CorrectionEntity, field: string, value: unknown, names: ReadonlyMap<string, string>): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (DATE_FIELDS.has(field) && typeof value === "string" && ISO_RE.test(value)) return formatDate(new Date(value));
  if (USER_FIELDS.has(field) && typeof value === "string") return names.get(value) ?? "(a former user)";
  const option = ALLOW_LIST[entity][field]?.options?.find((o) => o.value === value);
  if (option) return option.label;
  if (typeof value === "number") return value.toLocaleString("en-IN");
  return String(value);
}

export async function loadCorrectionHistory(
  user: SessionUser,
  q: { entity: string; id: string },
  deps: { db: HistoryDb },
): Promise<ServiceResult<HistoryView>> {
  if (!isCorrectionEntity(q.entity)) return fail(400, UNKNOWN_ENTITY_MESSAGE);
  const entity = q.entity;
  const record = await (deps.db[ENTITY_MODEL[entity]] as unknown as Finder).findUnique({ where: { id: q.id } });
  if (!record) return fail(404, `That ${ENTITY_NOUN[entity]} wasn't found. It may have been archived, or the link is out of date.`);
  const ctx = {
    assigneeId: (record.assigneeId as string | null) ?? null,
    reviewerId: (record.reviewerId as string | null) ?? null,
    createdById: (record.createdById as string | null) ?? null,
  };
  if (!mayViewHistory(user, entity, ctx)) return fail(403, `You can't see the history of this ${ENTITY_NOUN[entity]}. Ask a partner if you need it.`);

  const events = await deps.db.auditEvent.findMany({
    where: { action: "correct", entity, entityId: q.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, actorId: true, createdAt: true, meta: true },
  });

  let assigneeManagerId: string | null = null;
  if ((entity === "JobTask" || entity === "Engagement") && ctx.assigneeId) {
    assigneeManagerId = (await deps.db.user.findUnique({ where: { id: ctx.assigneeId }, select: { managerId: true } }))?.managerId ?? null;
  }
  const editable: EditableField[] = Object.entries(ALLOW_LIST[entity])
    .filter(([, spec]) => mayCorrect(user, spec.who, { createdById: ctx.createdById, assigneeManagerId }))
    .map(([field, spec]) => ({ field, label: spec.label, input: spec.input, ...(spec.options ? { options: spec.options } : {}) }));

  const metas = events.map((e) => (e.meta ?? {}) as Prisma.JsonObject);
  const ids = new Set<string>();
  for (const e of events) if (e.actorId) ids.add(e.actorId);
  for (const m of metas) if (USER_FIELDS.has(String(m.field))) for (const v of [m.before, m.after]) if (typeof v === "string") ids.add(v);
  const needPeople = editable.some((f) => f.input === "user");
  const users = await deps.db.user.findMany({
    where: needPeople ? { OR: [{ id: { in: [...ids] } }, { active: true, excludedFromScoring: false }] } : { id: { in: [...ids] } },
    select: { id: true, name: true, email: true, active: true, excludedFromScoring: true },
    orderBy: { name: "asc" },
  });
  const names = new Map(users.map((u) => [u.id, u.name ?? u.email]));

  const entries: HistoryEntry[] = events.map((e, i) => {
    const m = metas[i];
    const field = String(m.field ?? "");
    return {
      id: e.id,
      at: e.createdAt.toISOString(),
      atLabel: formatDateTimeIst(e.createdAt),
      actorName: (e.actorId && names.get(e.actorId)) || "(unknown)",
      field,
      label: String(m.label ?? field),
      before: displayValue(entity, field, m.before, names),
      after: displayValue(entity, field, m.after, names),
      reason: String(m.reason ?? ""),
      privacyRequestId: typeof m.privacyRequestId === "string" ? m.privacyRequestId : null,
    };
  });

  const people = needPeople ? users.filter((u) => u.active && !u.excludedFromScoring).map((u) => ({ id: u.id, name: u.name ?? u.email })) : [];
  return ok({ entity, id: q.id, noun: ENTITY_NOUN[entity], entries, editable, people });
}
