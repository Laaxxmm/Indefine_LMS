// Pure rules for the tech work tracker. No Prisma, no fetch — everything here is
// exercised by scripts/verify-work.ts. db.ts applies these against the database.
import { z } from "zod";
import type { DayPickOutcome, WorkEventKind, WorkStatus, WorkTaskStatus } from "@prisma/client";

export const WIP_CAP = 3;
export const PLAN_CAP = 3;
export const PICK_CAP = 3;
export const STALE_DAYS = 14;
export const AUTO_PAUSE_DAYS = 28;

export const WORK_STATUS_ORDER: WorkStatus[] = ["INBOX", "ACTIVE", "PARKED", "DONE", "OBSOLETE"];
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  INBOX: "Ideas",
  ACTIVE: "Working",
  PARKED: "Paused",
  DONE: "Done",
  OBSOLETE: "Obsolete",
};

export type Actor = { id: string; email: string; name: string; isLead: boolean };
export type Result<T = Record<string, never>> = { ok: true; data: T } | { ok: false; error: string };

// ---------------- access ----------------

/** Emails allowed into /work, lowercased, in env order. The first one is the lead. */
export function trackerEmails(env: string | undefined = process.env.WORK_TRACKER_EMAILS): string[] {
  return (env ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export function canUseWork(email: string | null | undefined, emails: string[] = trackerEmails()): boolean {
  return !!email && emails.includes(email.toLowerCase());
}
export function isWorkLead(email: string | null | undefined, emails: string[] = trackerEmails()): boolean {
  return !!email && emails.length > 0 && emails[0] === email.toLowerCase();
}

// ---------------- IST clock (India has no DST, so a fixed offset is exact) ----------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const shifted = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

/** "YYYY-MM-DD" of the IST calendar day. */
export function istDayKey(d: Date): string {
  return shifted(d).toISOString().slice(0, 10);
}
/** 00:00 IST of the IST calendar day, as a UTC instant. */
export function istDayStart(d: Date): Date {
  const s = shifted(d);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - IST_OFFSET_MS);
}
/** 0 = Sunday … 6 = Saturday, in IST. */
export function istWeekday(d: Date): number {
  return shifted(d).getUTCDay();
}
export function isWeekend(d: Date): boolean {
  const w = istWeekday(d);
  return w === 0 || w === 6;
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
/** Monday 00:00 IST of the IST week containing d. */
export function istWeekStart(d: Date): Date {
  return addDays(istDayStart(d), -((istWeekday(d) + 6) % 7));
}
/** The 1st, 00:00 IST, of the IST month containing d. */
export function istMonthStart(d: Date): Date {
  const s = shifted(d);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1) - IST_OFFSET_MS);
}
/** "YYYY-MM-DD" → 00:00 IST of that day, or null when malformed. */
export function parseDayKey(key: string | undefined): Date | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const t = Date.parse(`${key}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : new Date(t - IST_OFFSET_MS);
}

// ---------------- stale ----------------

export function daysUntouched(lastTouchedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - lastTouchedAt.getTime()) / DAY_MS));
}
export function isStale(status: WorkStatus, lastTouchedAt: Date, now: Date): boolean {
  return status === "ACTIVE" && daysUntouched(lastTouchedAt, now) >= STALE_DAYS;
}
export function shouldAutoPause(status: WorkStatus, lastTouchedAt: Date, now: Date): boolean {
  return status === "ACTIVE" && daysUntouched(lastTouchedAt, now) >= AUTO_PAUSE_DAYS;
}

// ---------------- work status transitions ----------------

export const WORK_ACTIONS = ["activate", "pause", "finish", "obsolete", "reopen"] as const;
export type WorkAction = (typeof WORK_ACTIONS)[number];

/** Where an action takes a work from its current status, or null when not allowed. */
export function nextStatus(action: WorkAction, from: WorkStatus): WorkStatus | null {
  switch (action) {
    case "activate":
      return from === "INBOX" || from === "PARKED" ? "ACTIVE" : null;
    case "pause":
      return from === "ACTIVE" ? "PARKED" : null;
    case "finish":
      return from === "ACTIVE" ? "DONE" : null;
    case "obsolete":
      return from === "OBSOLETE" ? null : "OBSOLETE";
    case "reopen":
      return from === "DONE" ? "ACTIVE" : from === "OBSOLETE" ? "INBOX" : null;
  }
}
/** Which action a drag from one board column to another means, or null if that move is not allowed. */
export function actionForMove(from: WorkStatus, to: WorkStatus): WorkAction | null {
  if (from === to) return null;
  for (const a of WORK_ACTIONS) if (nextStatus(a, from) === to) return a;
  return null;
}
/** Buttons to show on a card in this status: [action, label]. */
export function actionsFor(status: WorkStatus): Array<[WorkAction, string]> {
  const labels: Record<WorkAction, string> = {
    activate: status === "PARKED" ? "Resume" : "Start",
    pause: "Pause",
    finish: "Finish",
    obsolete: "Obsolete",
    reopen: "Reopen",
  };
  return WORK_ACTIONS.filter((a) => nextStatus(a, status) !== null).map((a) => [a, labels[a]]);
}
export function wipAllows(activeCount: number): boolean {
  return activeCount < WIP_CAP;
}
/** Can `toActivate` more works be started when `activeCount` are already active? */
export function wipAllowsMany(activeCount: number, toActivate: number): boolean {
  return activeCount + toActivate <= WIP_CAP;
}

// ---------------- tasks ----------------

export const TASK_ACTIONS = ["done", "drop", "reopen", "review"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];
export type TaskLane = "TODO" | "TODAY" | "DONE";

export function taskLane(status: WorkTaskStatus, pickedToday: boolean): TaskLane {
  if (status !== "TODO") return "DONE";
  return pickedToday ? "TODAY" : "TODO";
}
/** A finished task waits for the lead's tick. The lead's own tasks are reviewed on completion. */
export function awaitsReview(t: { status: WorkTaskStatus; reviewedAt: Date | null }): boolean {
  return t.status === "DONE" && t.reviewedAt === null;
}
/** A work finishes itself when nothing is open, nothing awaits review, and something was actually done. */
export function autoDone(tasks: Array<{ status: WorkTaskStatus; reviewedAt: Date | null }>): boolean {
  return (
    tasks.length > 0 &&
    tasks.every((t) => t.status !== "TODO") &&
    !tasks.some(awaitsReview) &&
    tasks.some((t) => t.status === "DONE")
  );
}

// ---------------- picks, score, gate ----------------

/** Percent of closed picks that were kept; null until at least one pick has closed. */
export function keptPromise(picks: Array<{ outcome: DayPickOutcome | null }>): number | null {
  const closed = picks.filter((p) => p.outcome !== null);
  if (closed.length === 0) return null;
  return Math.round((100 * closed.filter((p) => p.outcome === "DONE").length) / closed.length);
}
/** Tasks to pre-check next morning: carried on the most recent pick day and still open. */
export function precheckTaskIds(
  lastDayPicks: Array<{ taskId: string; outcome: DayPickOutcome | null; taskStatus: WorkTaskStatus }>,
): string[] {
  return lastDayPicks.filter((p) => p.outcome === "CARRIED" && p.taskStatus === "TODO").map((p) => p.taskId);
}
export type PickGroup = { workId: string; workTitle: string; tasks: { id: string; title: string }[] };
export type GateStep = "plan" | "pick" | "today";
/** hasCandidates = open tasks of mine inside this week's planned Working items, not yet picked today.
 *  Without it the pick step could be a dead end (plan set, but no task to promise). */
export function gateStep(i: { weekend: boolean; hasOpenTasks: boolean; planned: boolean; picked: boolean; hasCandidates: boolean }): GateStep {
  if (i.weekend || !i.hasOpenTasks) return "today";
  if (!i.planned) return "plan";
  if (!i.picked && i.hasCandidates) return "pick";
  return "today";
}

// ---------------- timeline ----------------

export function eventLine(e: { kind: WorkEventKind; detail: string | null; actor: string | null }): string {
  const who = e.actor ?? "System";
  const d = e.detail ?? "";
  switch (e.kind) {
    case "WORK_CREATED":
      return `${who} captured "${d}"`;
    case "WORK_STATUS":
      return `${who} moved it ${d}`;
    case "WORK_REOPENED":
      return `${who} reopened it`;
    case "TASK_CREATED":
      return `${who} added "${d}"`;
    case "TASK_DONE":
      return `${who} finished "${d}"`;
    case "TASK_DROPPED":
      return `${who} dropped "${d}"`;
    case "TASK_REVIEWED":
      return `${who} reviewed "${d}"`;
    case "TASK_REOPENED":
      return `${who} reopened "${d}"`;
    case "PICKED":
      return `${who} picked "${d}" for the day`;
    case "CARRIED":
      return `"${d}" carried over`;
    case "AUTO_PAUSED":
      return `Paused automatically, ${d.toLowerCase()}`;
    case "WEEK_PLANNED":
      return `${who} planned it for the week of ${d}`;
    case "WEEK_REVIEWED":
      return `${who} reviewed the week of ${d}`;
  }
}

// ---------------- request bodies ----------------

export const createWorkZ = z.object({
  title: z.string().trim().min(1, "Give it a title").max(120, "Title is too long"),
  why: z.string().trim().max(200, "Keep 'why' to one line").optional(),
});
export const workActionZ = z.object({
  action: z.enum(WORK_ACTIONS),
  reason: z.string().trim().max(200, "Keep the reason to one line").optional(),
});
export const createTaskZ = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(160, "Task title is too long"),
  assigneeId: z.string().min(1),
});
export const taskActionZ = z.object({ action: z.enum(TASK_ACTIONS) });
export const planZ = z.object({
  workIds: z.array(z.string().min(1)).max(PLAN_CAP, `Pick at most ${PLAN_CAP} works for the week`),
});
export const picksZ = z.object({
  taskIds: z.array(z.string().min(1)).min(1, "Pick at least one task").max(PICK_CAP, `Only ${PICK_CAP} picks a day`),
});
