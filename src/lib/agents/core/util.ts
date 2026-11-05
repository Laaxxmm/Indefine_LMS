// Small deterministic helpers for the ROC agent: exact rupee → paise parsing (no float drift),
// "YYYY-MM-DD" day arithmetic in UTC (calendar days, no clock), a CSV reader, and integer
// rounding. Nothing here reads the wall clock or the network.

const AMOUNT_RE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Rupees as written by staff → integer paise. Accepts numbers (at most two decimals) and strings
 * with Indian or western grouping, an optional ₹ sign, and (1,234.00) or -1,234.00 for negatives.
 * Throws on anything else: a figure that cannot be read exactly must stop the run, not be guessed.
 */
export function rupeesToPaise(v: unknown, field = "amount"): number {
  let s: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`${field}: not a finite number`);
    s = String(v);
    if (s.includes("e")) throw new Error(`${field}: ${v} is out of range`);
  } else if (typeof v === "string") {
    s = v.trim();
  } else {
    throw new Error(`${field}: expected an amount in rupees`);
  }
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[₹,\s]/g, "").replace(/^Rs\.?/i, "");
  if (s === "") throw new Error(`${field}: empty amount`);
  const m = AMOUNT_RE.exec(s);
  if (!m) throw new Error(`${field}: "${String(v)}" is not an amount in rupees (two decimals at most)`);
  const paise = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(paise)) throw new Error(`${field}: amount too large`);
  return (neg || m[1] ? -1 : 1) * paise || 0;
}

/** Integer paise → a plain rupee string the parsers accept ("123456.78", "-5.00"). */
export function paiseToRupeeString(paise: number): string {
  const abs = Math.abs(paise);
  return `${paise < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Optional amount: blank / null / undefined → 0. */
export function optPaise(v: unknown, field = "amount"): number {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return 0;
  return rupeesToPaise(v, field);
}

// ------------------------------------------------------------------ days

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isDayKey(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

function toUtc(key: string): number {
  if (!isDayKey(key)) throw new Error(`not a date (YYYY-MM-DD): ${key}`);
  return Date.parse(`${key}T00:00:00Z`);
}

export function addDays(key: string, n: number): string {
  return new Date(toUtc(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** b − a in calendar days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Same day-of-month n months later, clamped to the month's last day (31 Mar + 6 → 30 Sep). */
export function addMonthsClamped(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function addYears(key: string, n: number): string {
  return addMonthsClamped(key, n * 12);
}

/** "2026-09-30" → 20260930 (dates as integer figures). */
export function dayNumber(key: string | null): number {
  return key ? Number(key.replace(/-/g, "")) : 0;
}

/** "2025-26" → start year 2025; throws on a malformed FY. */
export function fyStart(fy: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) throw new Error(`FY must look like 2025-26, got "${fy}"`);
  return Number(m[1]);
}

export const fyEndKey = (fy: string) => `${fyStart(fy) + 1}-03-31`;
export const fyStartKey = (fy: string) => `${fyStart(fy)}-04-01`;

// ------------------------------------------------------------------ integers

/** a / b rounded half up, for non-negative integers (exact; no floats). */
export function divRoundHalfUp(a: number, b: number): number {
  if (b <= 0) throw new Error("divisor must be positive");
  const sign = a < 0 ? -1 : 1;
  const q = Math.floor(Math.abs(a) / b);
  const r = Math.abs(a) - q * b;
  return sign * (r * 2 >= b ? q + 1 : q);
}

/** Paise rounded to the nearest whole rupee (half up). */
export const roundToRupee = (paise: number) => divRoundHalfUp(paise, 100) * 100;

// ------------------------------------------------------------------ CSV

/** RFC-4180-ish CSV: quoted fields, doubled quotes, CRLF. First row = headers (trimmed, lower-cased). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r, i) => {
    // An amount like 1,20,000 written without quotes splits into extra fields: refuse, never guess.
    if (r.length > headers.length) throw new Error(`CSV row ${i + 2} has ${r.length} fields but the header has ${headers.length}; quote amounts that contain commas`);
    return Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? "").trim()]));
  });
}

export const yes = (v: unknown) => v === true || (typeof v === "string" && /^(y|yes|true|1)$/i.test(v.trim()));
