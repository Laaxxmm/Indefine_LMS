// Working-day arithmetic for the coach, on IST calendar days. Reuses the statutory calendar engine's
// working-day rule (weekend days + holiday hook) so the coach and the planner that set the internal
// due dates agree on what a working day is. Pure: no Prisma, no clock.
import { isWorkingDay, onOrBeforeWorkingDay, type WorkingDayOptions } from "@/lib/agents/core/calendar";
import { addDays, istDayKey, parseDayKey, utcToIstWall } from "@/lib/ist";
import { WORK_WINDOW, type CoachCalendar, type DueTime } from "./config";

/** Iteration bound for day walks (ten years of days). */
const MAX_DAYS = 3660;

export function workingDayOptions(cal: CoachCalendar): WorkingDayOptions {
  const set = new Set(cal.holidays);
  return { weekendDays: cal.weekendDays, isHoliday: (k) => set.has(k) };
}

/** "YYYY-MM-DD" shifted by n IST calendar days. */
export function shiftDayKey(key: string, n: number): string {
  const d = parseDayKey(key);
  if (!d) throw new Error(`invalid day key ${key}`);
  return istDayKey(addDays(d, n));
}

export function isWorkingDayKey(key: string, cal: CoachCalendar): boolean {
  return isWorkingDay(key, workingDayOptions(cal));
}

/** Minutes after IST midnight. */
export function istMinutes(d: Date): number {
  const [h, m] = utcToIstWall(d).slice(11, 16).split(":").map(Number);
  return h * 60 + m;
}

/** A working day (not a weekend day or holiday) and inside the 09:00–19:00 IST window. */
export function isCoachWorkingTime(now: Date, cal: CoachCalendar, window: { startMin: number; endMin: number } = WORK_WINDOW): boolean {
  if (!isWorkingDayKey(istDayKey(now), cal)) return false;
  const m = istMinutes(now);
  return m >= window.startMin && m < window.endMin;
}

/**
 * Signed working days from `fromKey` to `toKey`: the working days in (from, to] when to is later,
 * minus the working days in (to, from] when to is earlier, 0 on the same day. Due on Sunday seen
 * from Friday = 0 (nothing working in between: it is due today); due last Friday seen on Monday = −1.
 */
export function workingDaysBetween(fromKey: string, toKey: string, cal: CoachCalendar): number {
  if (fromKey === toKey) return 0;
  const forward = toKey > fromKey;
  const [lo, hi] = forward ? [fromKey, toKey] : [toKey, fromKey];
  const opts = workingDayOptions(cal);
  let n = 0;
  let k = lo;
  for (let i = 0; i < MAX_DAYS && k < hi; i++) {
    k = shiftDayKey(k, 1);
    if (isWorkingDay(k, opts)) n += 1;
  }
  return forward ? n : -n;
}

/** The due day itself when it is a working day, else the working day before it (the planner's rule). */
export function effectiveDueKey(due: Date, cal: CoachCalendar): string {
  return onOrBeforeWorkingDay(istDayKey(due), workingDayOptions(cal));
}

/** The internal due moment: the effective due day at the configured IST wall time (18:00). */
export function internalDueMoment(internalDueOn: Date, cal: CoachCalendar, time: DueTime): Date {
  const start = parseDayKey(effectiveDueKey(internalDueOn, cal));
  if (!start) throw new Error("invalid internal due date");
  return new Date(start.getTime() + (time.hour * 60 + time.minute) * 60_000);
}
