// Personal data breach register (BreachIncident) and its notification clocks. The Board report is
// expected within 72 hours of the firm becoming aware (DPDP Rules 2025 — legal to verify, see
// policy.ts BREACH_CLOCKS); affected people are to be told without delay (firm target: 72 hours).
// The clock starts at detectedAt, the moment the firm became aware.
//
// Containment notes have no column of their own, so each step is an AuditEvent on entity
// "BreachIncident" (create, contain, board-notified, principals-notified, update, close).
// Steps are recorded, never removed; the runbook is docs/runbooks/breach.md.
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { isActive } from "@/lib/access";
import { formatDateTimeIst } from "@/lib/agents/core/format";
import { scrubFreeText } from "@/lib/corrections/mask";
import { Refusal, fail, ok, type ServiceResult } from "@/lib/corrections/result";
import { istLocalToUtc } from "@/lib/ist";
import { BREACH_NOT_ALLOWED, SIGN_IN, canUseBreachRegister } from "./access";
import type { PrivacyDb } from "./inventory";
import { BREACH_CLOCKS, BREACH_SEVERITIES, BREACH_STATUS_LABELS, type BreachSeverity, type BreachStatus } from "./policy";
import { writeAudit, type Tx } from "./register";

export interface BreachDeps {
  db: PrivacyDb;
  now: () => Date;
}

const HOUR = 3_600_000;

export type ClockState = "done" | "due" | "overdue";

export interface Clock {
  label: string;
  dueAt: string;
  dueLabel: string;
  state: ClockState;
  /** Whole hours left (negative once overdue); null when done. */
  hoursLeft: number | null;
  /** "41 hours left", "Overdue by 5 hours", "Done 06 Nov 2026 10:00". */
  text: string;
  basis: string;
  verify: string;
}

type IncidentTimes = { detectedAt: Date; boardNotifiedAt: Date | null; principalsNotifiedAt: Date | null };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function clock(kind: keyof typeof BREACH_CLOCKS, detectedAt: Date, doneAt: Date | null, now: Date): Clock {
  const c = BREACH_CLOCKS[kind];
  const due = new Date(detectedAt.getTime() + c.hours * HOUR);
  const base = { label: c.label, dueAt: due.toISOString(), dueLabel: `${formatDateTimeIst(due)} IST`, basis: c.basis, verify: c.verify };
  if (doneAt) return { ...base, state: "done", hoursLeft: null, text: `Done ${formatDateTimeIst(doneAt)} IST${doneAt > due ? " (late)" : ""}` };
  const msLeft = due.getTime() - now.getTime();
  if (msLeft < 0) {
    const late = Math.max(1, Math.ceil(-msLeft / HOUR));
    return { ...base, state: "overdue", hoursLeft: -late, text: `Overdue by ${plural(late, "hour")}` };
  }
  const left = Math.floor(msLeft / HOUR);
  return { ...base, state: "due", hoursLeft: left, text: left < 1 ? "Less than 1 hour left" : `${plural(left, "hour")} left` };
}

/** Board and affected-people clocks for one incident at `now`. */
export function breachClocks(i: IncidentTimes, now: Date): { board: Clock; principals: Clock } {
  return { board: clock("board", i.detectedAt, i.boardNotifiedAt, now), principals: clock("principals", i.detectedAt, i.principalsNotifiedAt, now) };
}

export interface BreachRow {
  id: string;
  summary: string;
  severity: BreachSeverity;
  status: BreachStatus;
  statusLabel: string;
  affectedCount: number | null;
  detectedLabel: string;
  board: Clock;
  principals: Clock;
}

type IncidentRecord = IncidentTimes & { id: string; summary: string; severity: string; status: string; affectedCount: number | null };

export function toBreachRow(i: IncidentRecord, now: Date): BreachRow {
  const status = (i.status in BREACH_STATUS_LABELS ? i.status : "OPEN") as BreachStatus;
  return {
    id: i.id,
    summary: i.summary,
    severity: ((BREACH_SEVERITIES as readonly string[]).includes(i.severity) ? i.severity : "medium") as BreachSeverity,
    status,
    statusLabel: BREACH_STATUS_LABELS[status],
    affectedCount: i.affectedCount,
    detectedLabel: `${formatDateTimeIst(i.detectedAt)} IST`,
    ...breachClocks(i, now),
  };
}

export async function listBreaches(db: Pick<PrivacyDb, "breachIncident">, now: Date): Promise<BreachRow[]> {
  const rows = await db.breachIncident.findMany({ orderBy: { detectedAt: "desc" }, take: 500 });
  return rows.map((r) => toBreachRow(r, now));
}

function guard(user: SessionUser): { ok: false; status: 401 | 403; error: string } | null {
  if (!user || !isActive(user)) return fail(401, SIGN_IN) as { ok: false; status: 401; error: string };
  if (!canUseBreachRegister(user)) return fail(403, BREACH_NOT_ALLOWED) as { ok: false; status: 403; error: string };
  return null;
}

/** "YYYY-MM-DDTHH:mm" from a datetime-local input, read as IST. */
function parseIstLocal(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.trim())) return null;
  const d = istLocalToUtc(v.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface RecordBreachInput {
  detectedAt: string;
  summary: string;
  severity: string;
  affectedCount?: number | null;
}

export async function recordBreach(user: SessionUser, input: RecordBreachInput, deps: BreachDeps): Promise<ServiceResult<{ id: string }>> {
  const denied = guard(user);
  if (denied) return denied;
  const now = deps.now();
  const detectedAt = parseIstLocal(input.detectedAt);
  if (!detectedAt) return fail(400, "Enter when the firm became aware of the breach (date and time, IST).");
  if (detectedAt.getTime() > now.getTime() + 60_000) return fail(400, "The time the firm became aware can't be in the future. Check the date and time.");
  const summary = input.summary?.trim() ?? "";
  if (summary.length < 10) return fail(400, "Describe what happened in a sentence or two (at least 10 characters). Leave out personal details.");
  if (!(BREACH_SEVERITIES as readonly string[]).includes(input.severity)) return fail(400, "Pick a severity: low, medium or high.");
  if (input.affectedCount != null && (!Number.isInteger(input.affectedCount) || input.affectedCount < 0)) return fail(400, "Enter the number of people affected as a whole number, or leave it empty if not known yet.");
  const actorId = user!.id;
  const created = await deps.db.$transaction(async (tx: Tx) => {
    const r = await tx.breachIncident.create({
      data: { detectedAt, summary: scrubFreeText(summary).slice(0, 2000), severity: input.severity, affectedCount: input.affectedCount ?? null, status: "OPEN", createdById: actorId },
      select: { id: true },
    });
    await writeAudit(tx, { actorId, action: "create", entity: "BreachIncident", entityId: r.id, meta: { severity: input.severity } });
    return r;
  });
  return ok({ id: created.id });
}

export type BreachAction =
  | { action: "contain"; note: string }
  | { action: "board-notified"; at: string; note?: string | null }
  | { action: "principals-notified"; at: string; note?: string | null }
  | { action: "update"; severity?: string | null; affectedCount?: number | null }
  | { action: "close"; note: string };

export async function updateBreach(user: SessionUser, id: string, input: BreachAction, deps: BreachDeps): Promise<ServiceResult<BreachRow>> {
  const denied = guard(user);
  if (denied) return denied;
  const actorId = user!.id;
  const now = deps.now();
  try {
    const row = await deps.db.$transaction(async (tx: Tx) => {
      const i = await tx.breachIncident.findUnique({ where: { id } });
      if (!i) throw new Refusal(404, "That incident wasn't found. Go back to the breach register and open it again.");
      if (i.status === "CLOSED") throw new Refusal(409, "This incident is closed. Record a new incident if something more has happened.");
      const data: Prisma.BreachIncidentUpdateInput = {};
      let meta: Prisma.InputJsonObject = {};
      const note = "note" in input && input.note ? scrubFreeText(input.note).slice(0, 1000) : null;

      if (input.action === "contain") {
        if (!note || note.length < 10) throw new Refusal(400, "Say what was done to contain the breach (at least 10 characters).");
        if (i.status === "OPEN") data.status = "CONTAINED";
        meta = { note };
      } else if (input.action === "board-notified" || input.action === "principals-notified") {
        const at = parseIstLocal(input.at);
        if (!at) throw new Refusal(400, "Enter when the notice was sent (date and time, IST).");
        if (at.getTime() < i.detectedAt.getTime()) throw new Refusal(400, "A notice can't be sent before the firm became aware of the breach. Check the date and time.");
        if (at.getTime() > now.getTime() + 60_000) throw new Refusal(400, "The notice time can't be in the future. Check the date and time.");
        const board = input.action === "board-notified";
        if (board) data.boardNotifiedAt = at;
        else data.principalsNotifiedAt = at;
        const bothDone = (board ? at : i.boardNotifiedAt) && (board ? i.principalsNotifiedAt : at);
        if (bothDone) data.status = "NOTIFIED";
        meta = { at: at.toISOString(), ...(note ? { note } : {}) };
      } else if (input.action === "update") {
        if (input.severity != null) {
          if (!(BREACH_SEVERITIES as readonly string[]).includes(input.severity)) throw new Refusal(400, "Pick a severity: low, medium or high.");
          data.severity = input.severity;
        }
        if (input.affectedCount != null) {
          if (!Number.isInteger(input.affectedCount) || input.affectedCount < 0) throw new Refusal(400, "Enter the number of people affected as a whole number.");
          data.affectedCount = input.affectedCount;
        }
        if (!Object.keys(data).length) throw new Refusal(400, "Change the severity or the number of people affected, then save.");
        meta = { severity: input.severity ?? null, affectedCount: input.affectedCount ?? null };
      } else {
        if (!note || note.length < 10) throw new Refusal(400, "Write a closing note (at least 10 characters): what happened, what was done, what changes.");
        if (!i.boardNotifiedAt || !i.principalsNotifiedAt) {
          throw new Refusal(409, "Record when the Data Protection Board and the affected people were told before closing the incident.");
        }
        data.status = "CLOSED";
        meta = { note };
      }
      const updated = await tx.breachIncident.update({ where: { id }, data });
      await writeAudit(tx, { actorId, action: input.action, entity: "BreachIncident", entityId: id, meta });
      return toBreachRow(updated, now);
    });
    return ok(row);
  } catch (e) {
    if (e instanceof Refusal) return fail(e.status, e.message);
    throw e;
  }
}

export interface BreachEvent {
  id: string;
  label: string;
  atLabel: string;
  actorName: string;
  detail: string | null;
}

const BREACH_ACTION_LABELS: Record<string, string> = {
  create: "Incident recorded",
  contain: "Containment step",
  "board-notified": "Data Protection Board told",
  "principals-notified": "Affected people told",
  update: "Details updated",
  close: "Incident closed",
};

export async function getBreach(db: PrivacyDb, id: string, now: Date) {
  const i = await db.breachIncident.findUnique({ where: { id } });
  if (!i) return null;
  const events = await db.auditEvent.findMany({ where: { entity: "BreachIncident", entityId: id }, orderBy: { createdAt: "asc" }, select: { id: true, action: true, actorId: true, createdAt: true, meta: true } });
  const ids = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
  const people = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(people.map((p) => [p.id, p.name ?? p.email]));
  const timeline: BreachEvent[] = events.map((e) => {
    const m = (e.meta ?? {}) as Prisma.JsonObject;
    const detail = [typeof m.at === "string" ? `Sent ${formatDateTimeIst(new Date(m.at))} IST` : null, typeof m.note === "string" ? m.note : null, typeof m.severity === "string" ? `Severity ${m.severity}` : null]
      .filter(Boolean)
      .join(" — ");
    return { id: e.id, label: BREACH_ACTION_LABELS[e.action] ?? e.action, atLabel: formatDateTimeIst(e.createdAt), actorName: (e.actorId && names.get(e.actorId)) || "(unknown)", detail: detail || null };
  });
  return { ...toBreachRow(i, now), timeline };
}
export type BreachDetail = NonNullable<Awaited<ReturnType<typeof getBreach>>>;
