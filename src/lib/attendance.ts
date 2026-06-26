// Attendance → KRA points. Flat, deadline-style: a month of good attendance is
// worth a fixed number of points, scaled down as attendance drops. Pure functions
// only (no prisma) so both the client importer and server actions can use them.

export const ATTENDANCE_FULL_POINTS = 10;

// How strict the award is. Tweak the thresholds to change the curve.
export function attendancePoints(pct: number, full = ATTENDANCE_FULL_POINTS): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  if (pct >= 95) return full;
  if (pct >= 90) return Math.round(full * 0.7);
  if (pct >= 80) return Math.round(full * 0.4);
  return 0;
}

export function attendancePct(presentDays: number, workingDays: number): number {
  if (!workingDays || workingDays <= 0) return 0;
  const pct = (presentDays / workingDays) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

// "2026-06" → first day of that month at UTC midnight. Returns null if malformed.
export function periodMonthFromString(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const d = new Date(Date.UTC(year, month - 1, 1));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatPeriodMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
