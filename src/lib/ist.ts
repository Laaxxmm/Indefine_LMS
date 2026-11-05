// The firm's clock. India Standard Time is a fixed UTC+05:30 with no DST, so offset
// arithmetic is exact. Every "today", "this week" and every date shown to a user goes
// through here; nothing else in src should mention "Asia/Kolkata". Pure: no DB, no fetch.
// Asserted by scripts/verify-work.ts (arithmetic) and scripts/verify-clients.ts (istDate).

export const IST = "Asia/Kolkata";
/** Time-zone name Microsoft Graph recognises for event payloads. */
export const FIRM_TZ_GRAPH = "India Standard Time";
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
const shifted = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

// ---------------- calendar arithmetic ----------------

/** "YYYY-MM-DD" of the IST calendar day. */
export function istDayKey(d: Date): string {
  return shifted(d).toISOString().slice(0, 10);
}
/** Same as istDayKey; the name the clients workbook and reports use. */
export const istDate = istDayKey;
/** "YYYY-MM" of the IST calendar month. */
export function istMonth(d: Date): string {
  return istDayKey(d).slice(0, 7);
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

// ---------------- form values and Graph payloads (live sessions) ----------------

/** Parse a datetime-local wall-clock string ("YYYY-MM-DDTHH:mm") as IST → UTC Date. */
export function istLocalToUtc(local: string): Date {
  return new Date(`${local}:00+05:30`);
}
/** Format a UTC Date as an IST wall-clock string "YYYY-MM-DDTHH:mm:ss" (Graph payload). */
export function utcToIstWall(d: Date): string {
  return shifted(d).toISOString().slice(0, 19);
}
/** datetime-local default value ("YYYY-MM-DDTHH:mm") for a UTC instant, in IST. */
export function istLocalInputValue(d: Date): string {
  return utcToIstWall(d).slice(0, 16);
}

// ---------------- display ----------------

/**
 * Short month names, fixed. The en-IN locale data in current ICU writes September as "Sept"; every
 * other short month is three letters, and the firm's format (DD MMM YYYY) wants "Sep".
 */
export const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** en-IN in IST, with a short month always taken from SHORT_MONTHS (the IST calendar month of d). */
function istFormat(d: Date, opts: Intl.DateTimeFormatOptions): string {
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...opts }).formatToParts(d);
  if (opts.month !== "short") return parts.map((p) => p.value).join("");
  const month = SHORT_MONTHS[shifted(d).getUTCMonth()];
  // en-IN also puts a comma between a short month and the year ("05 Sept, 2026"): DD MMM YYYY has none.
  return parts
    .map((p, i) => (p.type === "month" ? month : p.type === "literal" && parts[i - 1]?.type === "month" && parts[i + 1]?.type === "year" ? " " : p.value))
    .join("");
}

/** A date in IST with the given Intl options, en-IN locale. e.g. istLabel(d, { day: "numeric", month: "short" }) → "5 Sep". */
export function istLabel(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return istFormat(d, opts);
}
/** Human date-time, e.g. "Tue, 15 Jul 2026, 3:00 pm IST". */
export function formatIst(d: Date): string {
  const s = istFormat(d, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${s} IST`;
}
