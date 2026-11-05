// Partner spot-checks of manual Turia closes (ADR-005: "ManualBridge makes condition 2 self-reported;
// the partner 10% spot-check is the control"). The close gate selects ~10% of manual closes
// deterministically and, in the DONE transaction, writes AuditEvent `spot-check-selected`
// (entity TuriaSync, entityId = the TuriaSync id, meta.jobTaskId). That event is the queue: a
// partner opens the job in Turia, checks the task ref and the minutes, and records "Checked in
// Turia" with an optional note. The check sets TuriaSync.spotChecked / spotCheckedById /
// spotCheckedAt / spotCheckNote (once; a second check is refused) and writes AuditEvent `spot-check`.
// Partners only (src/lib/rbac/policy.ts canSpotCheck). Nothing here changes the job or Turia.
import type { SessionUser } from "@/lib/access";
import { formatDateTimeIst } from "@/lib/agents/core/format";
import { canSpotCheck } from "@/lib/rbac/policy";
import { logAudit } from "./log";

export const SPOT_CHECK_SELECTED = "spot-check-selected";
export const SPOT_CHECK_ACTION = "spot-check";
export const SPOT_CHECK_NOTE_MAX = 500;
const LIST_LIMIT = 500;
const CHECKED_SHOWN = 50;

type AppDb = (typeof import("@/lib/prisma"))["prisma"];
/** The delegates used. The app's Prisma client satisfies it; tests pass a fake. */
export type SpotCheckDb = Pick<AppDb, "auditEvent" | "turiaSync" | "user">;

export type SpotCheckRow = {
  syncId: string;
  jobTaskId: string | null;
  job: { title: string; period: string; fy: string; service: string; clientCode: string } | null;
  turiaRef: string | null;
  minutesLogged: number | null;
  confirmedBy: string;
  /** When the gate selected it (IST). */
  selectedAt: string;
  checked: { by: string; at: string; note: string | null } | null;
};

export type SpotCheckList = { pending: SpotCheckRow[]; checked: SpotCheckRow[] };

export type SpotCheckResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const fail = (status: 400 | 403 | 404 | 409, error: string) => ({ ok: false as const, status, error });
const NOT_PARTNER = "Only a partner can see and record Turia spot checks. Ask a partner.";

/** Selected manual closes: still to check (oldest selection first) and recently checked (newest first). */
export async function listSpotChecks(db: SpotCheckDb, user: SessionUser): Promise<SpotCheckResult<SpotCheckList>> {
  if (!canSpotCheck(user)) return fail(403, NOT_PARTNER);
  const selections = await db.auditEvent.findMany({
    where: { action: SPOT_CHECK_SELECTED, entity: "TuriaSync" },
    orderBy: { createdAt: "asc" },
    take: LIST_LIMIT,
    select: { entityId: true, createdAt: true },
  });
  const selectedAt = new Map<string, Date>();
  for (const s of selections) if (s.entityId && !selectedAt.has(s.entityId)) selectedAt.set(s.entityId, s.createdAt);
  if (!selectedAt.size) return { ok: true, data: { pending: [], checked: [] } };

  const syncs = await db.turiaSync.findMany({
    where: { id: { in: [...selectedAt.keys()] } },
    select: {
      id: true,
      jobTaskId: true,
      turiaRef: true,
      minutesLogged: true,
      confirmedById: true,
      spotChecked: true,
      spotCheckedById: true,
      spotCheckedAt: true,
      spotCheckNote: true,
      jobTask: { select: { title: true, period: true, fy: true, service: true, firmClient: { select: { clientCode: true } } } },
    },
  });
  const ids = [...new Set(syncs.flatMap((s) => [s.confirmedById, s.spotCheckedById]).filter((x): x is string => !!x))];
  const people = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? people.find((p) => p.id === id)?.email ?? id) : "—");

  // Sort key: when it was checked, else when it was selected.
  const when = new Map(syncs.map((s) => [s.id, s.spotCheckedAt?.getTime() ?? selectedAt.get(s.id)!.getTime()]));
  const rows = syncs.map(
    (s): SpotCheckRow => ({
      syncId: s.id,
      jobTaskId: s.jobTaskId,
      job: s.jobTask ? { title: s.jobTask.title, period: s.jobTask.period, fy: s.jobTask.fy, service: s.jobTask.service, clientCode: s.jobTask.firmClient.clientCode } : null,
      turiaRef: s.turiaRef,
      minutesLogged: s.minutesLogged,
      confirmedBy: nameOf(s.confirmedById),
      selectedAt: formatDateTimeIst(selectedAt.get(s.id)!),
      checked: s.spotChecked ? { by: nameOf(s.spotCheckedById), at: s.spotCheckedAt ? formatDateTimeIst(s.spotCheckedAt) : "—", note: s.spotCheckNote } : null,
    }),
  );
  const t = (r: SpotCheckRow) => when.get(r.syncId) ?? 0;
  const pending = rows.filter((r) => !r.checked).sort((a, b) => t(a) - t(b) || a.syncId.localeCompare(b.syncId));
  const checked = rows.filter((r) => r.checked).sort((a, b) => t(b) - t(a) || a.syncId.localeCompare(b.syncId)).slice(0, CHECKED_SHOWN);
  return { ok: true, data: { pending, checked } };
}

/** "Checked in Turia": a partner records the spot check of one selected close, once. */
export async function markSpotChecked(
  db: SpotCheckDb,
  user: SessionUser,
  syncId: string,
  note: string | null | undefined,
  now: Date = new Date(),
): Promise<SpotCheckResult<{ syncId: string; checkedAt: string }>> {
  if (!user || !canSpotCheck(user)) return fail(403, NOT_PARTNER);
  const text = note?.trim() || null;
  if (text && text.length > SPOT_CHECK_NOTE_MAX) return fail(400, `Keep the note under ${SPOT_CHECK_NOTE_MAX.toLocaleString("en-IN")} characters.`);
  const selection = await db.auditEvent.findFirst({ where: { action: SPOT_CHECK_SELECTED, entity: "TuriaSync", entityId: syncId }, select: { meta: true } });
  if (!selection) return fail(404, "This Turia close was not picked for a spot check, so there is nothing to record. Reload the spot-check list.");
  const r = await db.turiaSync.updateMany({
    where: { id: syncId, spotChecked: false },
    data: { spotChecked: true, spotCheckedById: user.id, spotCheckedAt: now, spotCheckNote: text },
  });
  if (r.count !== 1) {
    const exists = await db.turiaSync.findUnique({ where: { id: syncId }, select: { id: true } });
    return exists ? fail(409, "Someone already recorded this spot check, and the first record stands. Reload the list to see it.") : fail(404, "That Turia close wasn't found. Reload the spot-check list.");
  }
  const jobTaskId = (selection.meta as { jobTaskId?: unknown } | null)?.jobTaskId;
  await logAudit(db, { actorId: user.id, action: SPOT_CHECK_ACTION, entity: "TuriaSync", entityId: syncId, meta: { jobTaskId: typeof jobTaskId === "string" ? jobTaskId : null, hasNote: !!text } });
  return { ok: true, data: { syncId, checkedAt: now.toISOString() } };
}
