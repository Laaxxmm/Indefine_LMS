// Reminder and escalation rules (Phase 9 task 2). Pure: no Prisma, no clock.
//
//   due moment   the internal due date (rolled back to a working day) at 18:00 IST
//   reminders    T−2h and T−30m before it, to whoever holds the next step, while the job is still
//                before filing. A run sends the latest slot that has started and not yet passed, so
//                a late or missed run never sends two at once.
//   escalation   once the due moment has passed: to the job's reviewer (else the engagement's),
//                or, when the reviewer is the one holding the step, to that person's manager;
//                at most one per job per IST day.
//
// The close-loop reconciler owns everything after filing (FILED_BY_HUMAN, CLOSING); the coach acts
// only on PRE_FILING_STATES, so the two never nudge for the same reason.
import { formatDate } from "@/lib/agents/core/format";
import { DEFAULT_CALENDAR, INTERNAL_DUE_TIME, REMINDER_OFFSETS_MIN, type CoachCalendar, type DueTime } from "./config";
import { effectiveDueKey, internalDueMoment } from "./workdays";

export type ReminderOptions = { calendar: CoachCalendar; dueTime: DueTime; offsetsMin: readonly number[] };

export const DEFAULT_REMINDER_OPTIONS: ReminderOptions = { calendar: DEFAULT_CALENDAR, dueTime: INTERNAL_DUE_TIME, offsetsMin: REMINDER_OFFSETS_MIN };

const ro = (o?: Partial<ReminderOptions>): ReminderOptions => ({ ...DEFAULT_REMINDER_OPTIONS, ...o });

export type ReminderSlot = {
  /** Stable per due date and offset, e.g. "2026-11-04@t-120" (part of the dedupeKey). */
  key: string;
  /** "T−2h", "T−30m". */
  label: string;
  offsetMin: number;
  at: Date;
  dueAt: Date;
};

/** "T−2h", "T−90m", "T−30m". */
export function slotLabel(offsetMin: number): string {
  return offsetMin % 60 === 0 ? `T−${offsetMin / 60}h` : `T−${offsetMin}m`;
}

/** Every slot for a due date, earliest first. */
export function reminderSlots(internalDueOn: Date, o?: Partial<ReminderOptions>): ReminderSlot[] {
  const p = ro(o);
  const dueAt = internalDueMoment(internalDueOn, p.calendar, p.dueTime);
  const dueKey = effectiveDueKey(internalDueOn, p.calendar);
  return [...new Set(p.offsetsMin)]
    .filter((m) => m > 0)
    .sort((a, b) => b - a)
    .map((offsetMin) => ({ key: `${dueKey}@t-${offsetMin}`, label: slotLabel(offsetMin), offsetMin, at: new Date(dueAt.getTime() - offsetMin * 60_000), dueAt }));
}

/** The slot to send now: the latest one that has started, while the due moment is still ahead. */
export function dueReminderSlot(internalDueOn: Date, now: Date, o?: Partial<ReminderOptions>): ReminderSlot | null {
  const slots = reminderSlots(internalDueOn, o);
  const t = now.getTime();
  if (slots.length === 0 || t >= slots[0].dueAt.getTime()) return null;
  return slots.filter((s) => s.at.getTime() <= t).at(-1) ?? null;
}

export function isInternalOverdue(internalDueOn: Date, now: Date, o?: Partial<ReminderOptions>): boolean {
  const p = ro(o);
  return now.getTime() >= internalDueMoment(internalDueOn, p.calendar, p.dueTime).getTime();
}

/**
 * Who hears about an overdue job: the reviewer (job, else engagement) unless they hold the step
 * themselves, then the holder's manager. Only active people; never the holder; null when nobody.
 */
export function escalationTarget(
  job: { reviewerId: string | null; engagement?: { reviewerId: string | null } | null },
  holderId: string | null,
  managerOf: (userId: string) => string | null,
  isActive: (userId: string) => boolean = () => true,
): string | null {
  const ok = (id: string | null | undefined): id is string => !!id && id !== holderId && isActive(id);
  const reviewer = [job.reviewerId, job.engagement?.reviewerId].find(ok);
  if (reviewer) return reviewer;
  const manager = holderId ? managerOf(holderId) : null;
  return ok(manager) ? manager : null;
}

const inWords = (min: number) => (min % 60 === 0 ? `${min / 60} hour${min === 60 ? "" : "s"}` : `${min} minutes`);
const hhmm = (t: DueTime) => `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;

export function reminderMessage(label: string, slot: ReminderSlot, dueTime: DueTime = INTERNAL_DUE_TIME): string {
  return `${label} is due internally today at ${hhmm(dueTime)} IST, in about ${inWords(slot.offsetMin)}.`;
}

export function escalationMessage(label: string, internalDueOn: Date, state: string, holderName: string | null): string {
  const who = holderName ? ` with ${holderName}` : "";
  return `${label} passed its internal due date (${formatDate(internalDueOn)}) and is still ${state}${who}.`;
}
