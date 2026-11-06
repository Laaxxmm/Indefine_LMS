// Integer-paise money and calendar-day helpers for GST Prep. All arithmetic on amounts is
// integer paise; products that could pass 2^53 go through BigInt. Dates are "YYYY-MM-DD" keys
// (Indian day-first input; never month-first). Pure: no clock.

export class GstParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GstParseError";
  }
}

// ------------------------------------------------------------------ money

export type TaxSplit = { igst: number; cgst: number; sgst: number; cess: number };
export const HEADS = ["igst", "cgst", "sgst", "cess"] as const;
export type Head = (typeof HEADS)[number];

export const zeroTax = (): TaxSplit => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
export const addTax = (a: TaxSplit, b: TaxSplit): TaxSplit => ({ igst: a.igst + b.igst, cgst: a.cgst + b.cgst, sgst: a.sgst + b.sgst, cess: a.cess + b.cess });
export const subTax = (a: TaxSplit, b: TaxSplit): TaxSplit => ({ igst: a.igst - b.igst, cgst: a.cgst - b.cgst, sgst: a.sgst - b.sgst, cess: a.cess - b.cess });
export const scaleTax = (a: TaxSplit, k: number): TaxSplit => ({ igst: a.igst * k, cgst: a.cgst * k, sgst: a.sgst * k, cess: a.cess * k });
export const taxTotal = (t: TaxSplit): number => t.igst + t.cgst + t.sgst + t.cess;
export const minTax = (a: TaxSplit, b: TaxSplit): TaxSplit => ({ igst: Math.min(a.igst, b.igst), cgst: Math.min(a.cgst, b.cgst), sgst: Math.min(a.sgst, b.sgst), cess: Math.min(a.cess, b.cess) });
export const sumTax = (xs: TaxSplit[]): TaxSplit => xs.reduce(addTax, zeroTax());

const MONEY = /^(\d+)(?:\.(\d+))?$/;

/**
 * "1,23,456.78", "₹ 1,234", "(500.00)", "-12.5", "1,234.00 Cr", 1234.5 → paise. Blank or "-" → null.
 * More than two decimals round half up on the third. Anything else throws GstParseError.
 */
export function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new GstParseError(`not an amount: ${raw}`);
    return parseAmount(raw.toFixed(6));
  }
  let s = String(raw).trim();
  if (!s || s === "-" || s === "—") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|rs\.?|inr/gi, "").replace(/\s*(dr|cr)\.?$/i, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  const m = MONEY.exec(s);
  if (!m) throw new GstParseError(`not an amount: "${String(raw)}"`);
  const frac = (m[2] ?? "").padEnd(3, "0");
  let paise = Number(m[1]) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) paise += 1;
  if (!Number.isSafeInteger(paise)) throw new GstParseError(`amount too large: "${String(raw)}"`);
  return negative ? -paise : paise;
}

/** Rupees as a JSON number or string (2B JSON values) → paise. */
export function rupeesToPaise(raw: unknown): number {
  return parseAmount(raw) ?? 0;
}

/** round(a × b / c), half away from zero, exact for any safe integers (BigInt inside). */
export function mulDivRound(a: number, b: number, c: number): number {
  if (c === 0) throw new RangeError("mulDivRound: division by zero");
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const neg = n < BigInt(0) !== d < BigInt(0);
  const an = n < BigInt(0) ? -n : n;
  const ad = d < BigInt(0) ? -d : d;
  const q = (an * BigInt(2) + ad) / (ad * BigInt(2));
  const r = Number(q);
  return neg ? -r : r;
}

/** Tax on a taxable value at a rate in basis points, split intra (CGST = SGST, each rounded) or inter (IGST). */
export function taxAt(taxablePaise: number, rateBps: number, interState: boolean): TaxSplit {
  if (interState) return { igst: mulDivRound(taxablePaise, rateBps, 10_000), cgst: 0, sgst: 0, cess: 0 };
  const half = mulDivRound(taxablePaise, rateBps, 20_000);
  return { igst: 0, cgst: half, sgst: half, cess: 0 };
}

/** Paise → rupees for spreadsheet cells (exact for 2-decimal values). */
export const rupees = (paise: number): number => paise / 100;

/** Paise → "1234.50" (plain, for evidence quotes). */
export const plainRupees = (paise: number): string => `${paise < 0 ? "-" : ""}${Math.floor(Math.abs(paise) / 100)}.${String(Math.abs(paise) % 100).padStart(2, "0")}`;

/** "18", "18%", "18.00", 18, "0.25" → basis points (1800, 25). The value is always a percentage. */
export function parseRateBps(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = (typeof raw === "number" ? raw.toFixed(4) : String(raw)).replace(/%/g, "").trim();
  if (!s) return null;
  return parseAmount(s); // percent with 2 decimals = basis points ("18.00" → 1800)
}

// ------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

function validDay(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const year4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * "2026-10-05", "05-10-2026", "05/10/2026", "5.10.26", "05-Oct-2026", "5 Oct 2026", an Excel
 * serial number or a Date (UTC day) → "YYYY-MM-DD". Blank → null. Unreadable → GstParseError.
 */
export function parseDay(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) throw new GstParseError("invalid date");
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 1) throw new GstParseError(`not a date: ${raw}`);
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * DAY_MS).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  let out: string | null = null;
  if (m) out = validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) out = validDay(year4(m[3]), Number(m[2]), Number(m[1]));
  else if ((m = /^(\d{1,2})[-\s/]([A-Za-z]{3,4})[A-Za-z]*[-\s/,]+(\d{2}|\d{4})$/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase()];
    out = mon ? validDay(year4(m[3]), mon, Number(m[1])) : null;
  }
  if (!out) throw new GstParseError(`not a date: "${s}"`);
  return out;
}

const utc = (key: string) => Date.parse(`${key}T00:00:00.000Z`);

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

export function addDays(key: string, n: number): string {
  return new Date(utc(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** FY of a day: 2026-10-05 → "2026-27". */
export function fyOfDay(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}

/** "2026-27" + "11-30" → "2027-11-30" (that day in the year after the FY ends). */
export function dayAfterFyEnd(fy: string, monthDay: string): string {
  const start = Number(fy.slice(0, 4));
  return `${start + 1}-${monthDay}`;
}

export type PeriodInfo = { period: string; kind: "monthly" | "quarterly"; start: string; end: string; fy: string };

/** "2026-10" (monthly) or "Q1".."Q4" of the FY (QRMP) → first and last day. */
export function periodInfo(period: string, fy: string): PeriodInfo {
  const mm = /^(\d{4})-(\d{2})$/.exec(period);
  if (mm) {
    const y = Number(mm[1]);
    const m = Number(mm[2]);
    if (m < 1 || m > 12) throw new GstParseError(`bad period ${period}`);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { period, kind: "monthly", start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}`, fy };
  }
  const q = /^Q([1-4])$/.exec(period);
  const f = /^(\d{4})-\d{2}$/.exec(fy);
  if (q && f) {
    const startMonth = [4, 7, 10, 1][Number(q[1]) - 1];
    const y = Number(f[1]) + (startMonth === 1 ? 1 : 0);
    const endMonth = startMonth + 2;
    const last = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
    return { period, kind: "quarterly", start: `${y}-${pad(startMonth)}-01`, end: `${y}-${pad(endMonth)}-${pad(last)}`, fy };
  }
  throw new GstParseError(`The job's period "${period}" is not a month (like 2026-10) or a quarter (Q1 to Q4). Correct the period on the job, then run the agent again.`);
}

/** The given day of the month after `end` ("2026-10-31", 20 → "2026-11-20"). */
export function dayOfNextMonth(end: string, day: number): string {
  const y = Number(end.slice(0, 4));
  const m = Number(end.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(day, last))}`;
}
