// Pure time-formatting helpers for live sessions — no DB / Graph imports, so
// UI (dashboard, admin) can import these without pulling in the heavy
// orchestration (sync, Gemini) that lib/live.ts depends on.
//
// The firm operates in India; all session times are entered/shown in IST,
// which is a fixed UTC+05:30 (no DST), so a constant offset is always correct.

/** Time-zone name Microsoft Graph recognises for event payloads. */
export const FIRM_TZ_GRAPH = "India Standard Time";
const IST_OFFSET_MIN = 5 * 60 + 30;

/** Parse a datetime-local wall-clock string ("YYYY-MM-DDTHH:mm") as IST → UTC Date. */
export function istLocalToUtc(local: string): Date {
  return new Date(`${local}:00+05:30`);
}

/** Format a UTC Date as an IST wall-clock string "YYYY-MM-DDTHH:mm:ss" (Graph payload). */
export function utcToIstWall(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 19);
}

/** datetime-local default value ("YYYY-MM-DDTHH:mm") for a UTC instant, in IST. */
export function istLocalInputValue(d: Date): string {
  return utcToIstWall(d).slice(0, 16);
}

/** Human display, e.g. "Tue, 15 Jul 2026, 3:00 pm IST". */
export function formatIst(d: Date): string {
  const s = d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
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
