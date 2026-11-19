// Turia task/list row -> the few fields Firm OS keeps (ADR-003 amendment, DPDP minimum).
//
// Kept: Turia's task id and number, task name, client name (and code when Turia gives one),
// department, status, due / completed / created dates, and the ids and names of the assignees and
// reviewers. Dropped on purpose: descriptions, comments, amounts, client contact details and every
// other field Turia sends. Pure: no Prisma, no fetch, no clock.
//
// Field names come from what Neo Centra already reads on task/list (id, uniqueidentity, taskname,
// clientname, assignee[], reviewer[], taskstatus, completedon, createdon) and, for the ones the
// existing code does not show on task/list (department, due date, client code, status name), the
// spellings task/get uses plus the likely variants. The dry-run preview shows what was found.
import { createHash } from "node:crypto";

export type TuriaPerson = { id: string; name: string };

export interface MirrorFields {
  id: string;
  identity: string | null;
  taskName: string;
  clientName: string;
  clientKey: string;
  clientCode: string | null;
  department: string | null;
  status: string | null;
  statusName: string | null;
  dueOn: Date | null;
  completedOn: Date | null;
  turiaCreatedOn: Date | null;
  assignees: TuriaPerson[];
  reviewers: TuriaPerson[];
}

type Raw = Record<string, unknown>;

/** Turia's status code for a completed task (Neo Centra incentive engine: TASK_COMPLETED = "3"). */
export const TURIA_COMPLETED_STATUS = "3";

const COMPLETED_KEYS = ["completedon", "completeddate", "completed_on", "completiondate", "closedon", "closeddate", "finishedon", "completedat"];
const DUE_KEYS = ["targetduedate", "duedate", "due_date", "taskduedate", "enddate"];
const DEPARTMENT_KEYS = ["departmentname", "department", "deptname"];
const CLIENT_CODE_KEYS = ["clientcode", "client_code", "clientuniqueidentity", "clientidentity", "clientuniqueid"];
const STATUS_NAME_KEYS = ["taskstatusname", "statusname", "status_name"];

/** A string or number value, trimmed; objects, arrays and blanks are null. */
function text(v: unknown, max = 200): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function firstText(t: Raw, keys: readonly string[], max = 200): string | null {
  for (const k of keys) {
    const v = text(t[k], max);
    if (v) return v;
  }
  return null;
}

/** Epoch ms / seconds, ISO, or dd-mm-yyyy -> Date; anything else null. */
export function toDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const fromNumber = (n: number) => (n > 1e12 ? new Date(n) : n > 1e9 ? new Date(n * 1000) : null);
  if (typeof v === "number") return Number.isFinite(v) ? fromNumber(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d+$/.test(s)) return fromNumber(parseInt(s, 10));
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

function firstDate(t: Raw, keys: readonly string[]): Date | null {
  for (const k of keys) {
    const d = toDate(t[k]);
    if (d) return d;
  }
  return null;
}

function people(v: unknown): TuriaPerson[] {
  if (!Array.isArray(v)) return [];
  const out = new Map<string, TuriaPerson>();
  for (const u of v as Raw[]) {
    if (!u || typeof u !== "object") continue;
    const id = text(u.id ?? u.userId ?? u.userid, 64);
    if (!id || out.has(id)) continue;
    out.set(id, { id, name: text(u.name ?? u.fullname, 120) ?? "" });
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The exact-match form of a name: lower case, "&" as "and", punctuation dropped, the usual company
 * suffixes written one way ("Pvt. Ltd." = "Private Limited"), spaces collapsed.
 */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bm\/s\.?\s*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bpvt\b/g, "private")
    .replace(/\bltd\b/g, "limited")
    .replace(/\bco\b/g, "company")
    .replace(/\s+/g, " ")
    .trim();
}

/** The few fields Firm OS keeps from a task/list row, or null when the row has no task id. */
export function normaliseTask(raw: unknown): MirrorFields | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Raw;
  const id = text(t.id ?? t.taskid, 64);
  if (!id) return null;
  const clientName = text(t.clientname ?? t.client_name ?? t.clientName, 200) ?? "";
  const identity = text(t.uniqueidentity ?? t.taskuniqueid, 40)?.replace(/^#/, "") ?? null;
  const assignees = people(t.assignee ?? t.assignees ?? t.userlists);
  const reviewers = people(t.reviewer ?? t.reviewers ?? t.reviewerlists ?? t.reviewerlist);
  return {
    id,
    identity,
    taskName: text(t.taskname ?? t.name, 200) ?? (identity ? `Turia task ${identity}` : "Turia task"),
    clientName,
    clientKey: normName(clientName),
    clientCode: firstText(t, CLIENT_CODE_KEYS, 40)?.toUpperCase() ?? null,
    department: firstText(t, DEPARTMENT_KEYS, 120),
    status: text(t.taskstatus ?? t.status, 20),
    statusName: firstText(t, STATUS_NAME_KEYS, 60),
    dueOn: firstDate(t, DUE_KEYS),
    completedOn: firstDate(t, COMPLETED_KEYS),
    turiaCreatedOn: toDate(t.createdon),
    assignees,
    reviewers,
  };
}

/** Turia shows the task completed: status "3", or a completion date. */
export function isCompleted(f: Pick<MirrorFields, "status" | "completedOn">): boolean {
  return f.status === TURIA_COMPLETED_STATUS || !!f.completedOn;
}

/** Turia's status name says the task was cancelled (the status code for it is not known). */
export function isCancelled(f: Pick<MirrorFields, "statusName">): boolean {
  return /cancel/i.test(f.statusName ?? "");
}

/** Stable digest of the kept fields: an unchanged task has the same hash on every run. */
export function mirrorHash(f: MirrorFields): string {
  const stable = [
    f.id, f.identity, f.taskName, f.clientName, f.clientCode, f.department, f.status, f.statusName,
    f.dueOn?.toISOString() ?? null, f.completedOn?.toISOString() ?? null, f.turiaCreatedOn?.toISOString() ?? null,
    f.assignees.map((p) => [p.id, p.name]), f.reviewers.map((p) => [p.id, p.name]),
  ];
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 32);
}

/** The page is sorted newest-change first (only then may a run stop at an unchanged page). */
export function sortedByUpdateDesc(rows: readonly unknown[]): boolean {
  let prev = Infinity;
  for (const r of rows) {
    const d = r && typeof r === "object" ? toDate((r as Raw).updatedon ?? (r as Raw).updatedat) : null;
    if (!d) return false;
    if (d.getTime() > prev) return false;
    prev = d.getTime();
  }
  return rows.length > 0;
}
