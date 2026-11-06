// Display formats for Firm OS deliverables and screens (orchestrator DESIGN): amounts in Indian
// grouping (1,23,456.00), dates DD MMM YYYY, times IST. Day math goes through src/lib/ist.ts.
import { SHORT_MONTHS as MONTHS, istDayKey, utcToIstWall } from "@/lib/ist";
const MAX_PAISE = Number.MAX_SAFE_INTEGER;

/** Group an unsigned digit string the Indian way: last three, then pairs (12,34,56,789). */
export function groupIndian(digits: string): string {
  if (!/^\d+$/.test(digits)) throw new Error(`not a digit string: ${digits}`);
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+$)/g, ",")},${tail}`;
}

/** Round to paise exactly (1.005 → 1.01), avoiding binary float drift. */
export function toPaise(n: number): number {
  const s = String(Math.abs(n));
  const abs = s.includes("e") ? Math.round(Math.abs(n) * 100) : Math.round(Number(`${s}e2`));
  return n < 0 ? -abs : abs;
}

/** 123456 → "1,23,456.00"; -1234.5 → "-1,234.50"; { symbol: true } → "₹1,23,456.00". */
export function formatInr(n: number, opts: { symbol?: boolean } = {}): string {
  if (typeof n !== "number" || !Number.isFinite(n)) throw new RangeError(`formatInr: not a finite number (${String(n)})`);
  const paise = toPaise(n);
  if (Math.abs(paise) > MAX_PAISE) throw new RangeError(`formatInr: amount too large (${n})`);
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const sign = paise < 0 ? "-" : "";
  return `${sign}${opts.symbol ? "₹" : ""}${groupIndian(String(rupees))}.${frac}`;
}

/**
 * Excel/LibreOffice number format that shows Indian grouping for amounts below ₹100 crore.
 * Number formats allow two conditions, so: ≥ 1 crore, ≥ 1 lakh, else western (identical below 1 lakh).
 * Limits (documented in the design note): negatives beyond -1,00,000 and amounts ≥ 100 crore fall
 * back to partial grouping in the spreadsheet; formatInr() is exact for every amount.
 */
export const INR_NUMFMT = "[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00";
export const DATE_NUMFMT = "dd mmm yyyy";

/** "YYYY-MM-DD" → "05 Nov 2026". */
export function formatDayKey(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`not a day key: ${key}`);
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** A Date (as its IST calendar day) or a "YYYY-MM-DD" key → "DD MMM YYYY". */
export function formatDate(d: Date | string): string {
  if (typeof d === "string") return formatDayKey(d);
  if (Number.isNaN(d.getTime())) throw new RangeError("formatDate: invalid date");
  return formatDayKey(istDayKey(d));
}

/** IST wall clock "DD MMM YYYY HH:mm". */
export function formatDateTimeIst(d: Date): string {
  if (Number.isNaN(d.getTime())) throw new RangeError("formatDateTimeIst: invalid date");
  const wall = utcToIstWall(d); // YYYY-MM-DDTHH:mm:ss
  return `${formatDayKey(wall.slice(0, 10))} ${wall.slice(11, 16)}`;
}
