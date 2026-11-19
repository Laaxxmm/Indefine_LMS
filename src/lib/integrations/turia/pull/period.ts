// Turia task -> Firm OS financial year and period (folder-contract periods: "2026-10", "Q2", "Annual").
// The task name is read first (month, quarter, FY or AY written in it); the due date is the fallback.
// Pure: no clock. Dates are read as IST calendar days.
import { IST_OFFSET_MS } from "@/lib/ist";

export type Frequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";
export const FREQUENCIES: readonly Frequency[] = ["MONTHLY", "QUARTERLY", "ANNUAL"];

export type PeriodResult = { fy: string; period: string; from: "name" | "due date" | "date" };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_WORD = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const QUARTER_RANGES: Record<string, number> = { "apr-jun": 1, "jul-sep": 2, "oct-dec": 3, "jan-mar": 4 };

/** "2026-27" for a calendar month of FY 2026-27 (April 2026 to March 2027). */
export function fyOfMonth(year: number, month: number): string {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function ist(d: Date): { y: number; m: number; day: number } {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, day: s.getUTCDate() };
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
const quarterOfMonth = (m: number) => Math.floor(((m + 8) % 12) / 3) + 1;
const periodKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/** FY written in the name: "FY 2025-26", "FY25-26", "2025-26", "2025-2026", or "AY 2026-27" (= FY 2025-26). */
export function fyFromName(name: string): string | null {
  const s = name.toLowerCase();
  const ay = s.match(/\ba\.?\s?y\.?\s*'?(\d{2}|\d{4})\s*[-/–]\s*(\d{2}|\d{4})\b/);
  if (ay) {
    const start = fullYear(ay[1]) - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  }
  // Not part of a date: "10-11-2026" is a day and a month, not FY 2010-11.
  const fy = s.match(/(?<![-/\d])\b(?:f\.?\s?y\.?\s*'?)?(20\d{2}|\d{2})\s*[-/–]\s*(20\d{2}|\d{2})\b(?!\s*[-/]\s*\d)/);
  if (fy) {
    const a = fullYear(fy[1]);
    const b = fullYear(fy[2]);
    if (b === a + 1 && a >= 2000 && a < 2100) return `${a}-${String(b % 100).padStart(2, "0")}`;
  }
  return null;
}

/** A month and year written in the name: "Oct 2026", "October-26", "Oct'26", "10/2026", "2026-10". */
export function monthFromName(name: string): { y: number; m: number } | null {
  const s = name.toLowerCase();
  const word = s.match(new RegExp(`\\b(${MONTH_WORD})\\b[\\s.,'’/-]*(20\\d{2}|\\d{2})?(?!\\d)`));
  if (word) {
    const m = MONTHS[word[1]];
    if (word[2]) return { y: fullYear(word[2]), m };
    const fy = fyFromName(s.replace(word[0], " "));
    if (fy) {
      const start = Number(fy.slice(0, 4));
      return { y: m >= 4 ? start : start + 1, m };
    }
    return null;
  }
  const num = s.match(/\b(0?[1-9]|1[0-2])\s*[/-]\s*(20\d{2})\b/) ?? null;
  if (num) return { y: Number(num[2]), m: Number(num[1]) };
  const iso = s.match(/\b(20\d{2})\s*[/-]\s*(0[1-9]|1[0-2])\b(?!\s*[/-]\s*\d)/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]) };
  return null;
}

/** A quarter written in the name: "Q2", "Quarter 2", "Jul-Sep". */
export function quarterFromName(name: string): number | null {
  const s = name.toLowerCase();
  const q = s.match(/\bq\s?([1-4])\b/) ?? s.match(/\bquarter\s?([1-4])\b/);
  if (q) return Number(q[1]);
  const r = s.match(/\b(apr|jul|oct|jan)[a-z]*\s*(?:-|–|to)\s*(jun|sep|dec|mar)[a-z]*\b/);
  if (r) return QUARTER_RANGES[`${r[1]}-${r[2]}`] ?? null;
  return null;
}

/** End of quarter q of the FY starting in April of `start`: [year, month]. */
function quarterEnd(q: number, start: number): [number, number] {
  return q === 4 ? [start + 1, 3] : [start, q * 3 + 3];
}

/** The latest FY whose quarter q ends on or before the due date. */
function fyForQuarterBefore(q: number, due: { y: number; m: number }): string {
  for (const start of [due.y, due.y - 1, due.y - 2]) {
    const [y, m] = quarterEnd(q, start);
    if (y < due.y || (y === due.y && m < due.m)) return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  }
  return fyOfMonth(due.y - 1, due.m);
}

/**
 * Financial year and period of a Turia task for a job of `frequency`, or null when neither the name
 * nor the due date says. Due-date fallbacks: a monthly return is for the month before its due date;
 * a quarterly one for the last quarter that ended before it; an annual one for the FY that ended
 * before it.
 */
export function parsePeriod(name: string, frequency: Frequency, dueOn: Date | null): PeriodResult | null {
  const due = dueOn ? ist(dueOn) : null;
  if (frequency === "MONTHLY") {
    const m = monthFromName(name);
    if (m) return { fy: fyOfMonth(m.y, m.m), period: periodKey(m.y, m.m), from: "name" };
    if (!due) return null;
    const y = due.m === 1 ? due.y - 1 : due.y;
    const mm = due.m === 1 ? 12 : due.m - 1;
    return { fy: fyOfMonth(y, mm), period: periodKey(y, mm), from: "due date" };
  }
  if (frequency === "QUARTERLY") {
    const fyName = fyFromName(name);
    const q = quarterFromName(name);
    if (q && fyName) return { fy: fyName, period: `Q${q}`, from: "name" };
    if (q && due) return { fy: fyForQuarterBefore(q, due), period: `Q${q}`, from: "name" };
    const m = monthFromName(name);
    if (m) return { fy: fyOfMonth(m.y, m.m), period: `Q${quarterOfMonth(m.m)}`, from: "name" };
    if (!due) return null;
    // The last quarter end strictly before the due month.
    const prevMonthY = due.m === 1 ? due.y - 1 : due.y;
    const prevMonth = due.m === 1 ? 12 : due.m - 1;
    const endMonth = [3, 6, 9, 12].filter((x) => x <= prevMonth).pop() ?? 12;
    const endYear = endMonth > prevMonth ? prevMonthY - 1 : prevMonthY;
    return { fy: fyOfMonth(endYear, endMonth), period: `Q${quarterOfMonth(endMonth)}`, from: "due date" };
  }
  const fyName = fyFromName(name);
  if (fyName) return { fy: fyName, period: "Annual", from: "name" };
  if (!due) return null;
  // The FY that ended (31 March) before the due date.
  const start = due.m >= 4 ? due.y - 1 : due.y - 2;
  return { fy: `${start}-${String((start + 1) % 100).padStart(2, "0")}`, period: "Annual", from: "due date" };
}

/** Month period ("2026-10") and FY of a date, for jobs no rule maps (they keep Turia's own dates). */
export function monthPeriodOf(d: Date): PeriodResult {
  const { y, m } = ist(d);
  return { fy: fyOfMonth(y, m), period: periodKey(y, m), from: "date" };
}
