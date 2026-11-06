// TDS deducted vs deposited, GST ledger vs filed return, and accrual / prepaid / fixed-asset
// schedules. Parsing is tolerant (header aliases); comparisons are integer paise.
import { TDS_DUE } from "./config";
import { addMonths, cell, daysBetween, locateColumns, parseAmountPaise, parseDay, parseMonth, type Cells, type ColumnAliases, type ParseIssue } from "./table";

// ------------------------------------------------------------------ TDS

export type TdsDeduction = { row: number; section: string; party: string; date: string; month: string; amountPaise: number };
export type TdsChallan = { row: number; challan: string; section: string; depositDate: string; month: string; amountPaise: number; monthInferred: boolean };

type TdsField = "section" | "party" | "date" | "month" | "amount" | "challan";

export const TDS_DEDUCTED_ALIASES: ColumnAliases<TdsField> = {
  section: ["section", "tds section", "nature", "nature of payment", "sec"],
  party: ["deductee", "party", "party name", "name", "vendor"],
  date: ["date", "deduction date", "date of deduction", "voucher date", "credit date"],
  month: ["month", "period", "for month"],
  amount: ["tds", "tds amount", "tax deducted", "amount", "tds deducted"],
  challan: ["challan", "challan no"],
};
export const TDS_CHALLAN_ALIASES: ColumnAliases<TdsField> = {
  section: ["section", "tds section", "nature", "sec"],
  party: ["remarks"],
  date: ["deposit date", "date of deposit", "challan date", "date", "paid on", "payment date"],
  month: ["month", "for month", "period", "relates to", "deduction month"],
  amount: ["amount", "tds", "tax deposited", "amount deposited", "total"],
  challan: ["challan", "challan no", "challan number", "cin", "bsr", "challan serial no", "reference"],
};

const normSection = (s: string) => s.toUpperCase().replace(/^SEC(TION)?\.?\s*/, "").replace(/\s+/g, "");

export function parseTdsDeducted(file: string, rows: Cells, override: Partial<Record<TdsField, string>> = {}): { data: TdsDeduction[] | null; issues: ParseIssue[] } {
  const loc = locateColumns(rows, TDS_DEDUCTED_ALIASES, ["section", "date|month", "amount"], override);
  if (!loc) return { data: null, issues: [{ file, row: 0, message: "no header row with Section, Date and TDS amount columns" }] };
  const c = loc.columns;
  const out: TdsDeduction[] = [];
  const issues: ParseIssue[] = [];
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const section = normSection(cell(row, c.section));
    if (!section || /^TOTAL$/.test(section)) continue;
    const amt = parseAmountPaise(cell(row, c.amount));
    const date = parseDay(cell(row, c.date));
    const month = parseMonth(cell(row, c.month)) ?? date?.slice(0, 7) ?? null;
    if (!amt.ok || !month) {
      issues.push({ file, row: r + 1, message: !amt.ok ? amt.reason : "no deduction date or month" });
      continue;
    }
    out.push({ row: r + 1, section, party: cell(row, c.party), date: date ?? `${month}-01`, month, amountPaise: amt.paise });
  }
  return { data: out, issues };
}

/** A challan without a "for month" column is taken to relate to the month before its deposit date. */
export function parseTdsChallans(file: string, rows: Cells, override: Partial<Record<TdsField, string>> = {}): { data: TdsChallan[] | null; issues: ParseIssue[] } {
  const loc = locateColumns(rows, TDS_CHALLAN_ALIASES, ["date", "amount"], override);
  if (!loc) return { data: null, issues: [{ file, row: 0, message: "no header row with Deposit date and Amount columns" }] };
  const c = loc.columns;
  const out: TdsChallan[] = [];
  const issues: ParseIssue[] = [];
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((x) => (x ?? "").trim() === "") || /^total$/i.test(cell(row, c.challan) || cell(row, c.section))) continue;
    const depositDate = parseDay(cell(row, c.date));
    const amt = parseAmountPaise(cell(row, c.amount));
    if (!depositDate || !amt.ok) {
      issues.push({ file, row: r + 1, message: !amt.ok ? amt.reason : `unreadable deposit date "${cell(row, c.date)}"` });
      continue;
    }
    const given = parseMonth(cell(row, c.month));
    out.push({
      row: r + 1,
      challan: cell(row, c.challan),
      section: normSection(cell(row, c.section)),
      depositDate,
      month: given ?? addMonths(depositDate.slice(0, 7), -1),
      amountPaise: amt.paise,
      monthInferred: !given,
    });
  }
  return { data: out, issues };
}

/** Due date for depositing TDS deducted in `month` (YYYY-MM): 7th of next month; March → 30 April. */
export function tdsDueDate(month: string, due: { dayOfNextMonth: number; march: { month: number; day: number } } = TDS_DUE): string {
  const [y, m] = month.split("-").map(Number);
  if (m === 3) return `${y}-${String(due.march.month).padStart(2, "0")}-${String(due.march.day).padStart(2, "0")}`;
  return `${addMonths(month, 1)}-${String(due.dayOfNextMonth).padStart(2, "0")}`;
}

export type TdsLine = {
  section: string;
  month: string;
  deductedPaise: number;
  depositedPaise: number;
  shortfallPaise: number;
  dueDate: string;
  lastDepositDate: string | null;
  /** Challans for this section/month dated after the due date. */
  late: { challan: string; depositDate: string; daysLate: number; amountPaise: number; row: number }[];
  /** First deduction row (evidence). */
  row: number;
};

/**
 * Deducted vs deposited by (section, month). A challan without a section counts against the
 * section that is short for that month, in section order (common for single-section deductors).
 */
export function tdsCheck(deducted: TdsDeduction[], challans: TdsChallan[]): TdsLine[] {
  const keyOf = (section: string, month: string) => `${month}\u0000${section}`;
  const lines = new Map<string, TdsLine>();
  for (const d of deducted) {
    const k = keyOf(d.section, d.month);
    const l = lines.get(k) ?? { section: d.section, month: d.month, deductedPaise: 0, depositedPaise: 0, shortfallPaise: 0, dueDate: tdsDueDate(d.month), lastDepositDate: null, late: [], row: d.row };
    l.deductedPaise += d.amountPaise;
    lines.set(k, l);
  }
  const sorted = [...challans].sort((a, b) => (a.depositDate < b.depositDate ? -1 : a.depositDate > b.depositDate ? 1 : a.row - b.row));
  const apply = (l: TdsLine, ch: TdsChallan, amount: number) => {
    l.depositedPaise += amount;
    if (!l.lastDepositDate || ch.depositDate > l.lastDepositDate) l.lastDepositDate = ch.depositDate;
    const daysLate = daysBetween(l.dueDate, ch.depositDate);
    if (daysLate > 0) l.late.push({ challan: ch.challan, depositDate: ch.depositDate, daysLate, amountPaise: amount, row: ch.row });
  };
  for (const ch of sorted.filter((x) => x.section)) {
    const k = keyOf(ch.section, ch.month);
    const l = lines.get(k) ?? { section: ch.section, month: ch.month, deductedPaise: 0, depositedPaise: 0, shortfallPaise: 0, dueDate: tdsDueDate(ch.month), lastDepositDate: null, late: [], row: ch.row };
    apply(l, ch, ch.amountPaise);
    lines.set(k, l);
  }
  for (const ch of sorted.filter((x) => !x.section)) {
    let left = ch.amountPaise;
    const forMonth = [...lines.values()].filter((l) => l.month === ch.month).sort((a, b) => (a.section < b.section ? -1 : 1));
    for (const l of forMonth) {
      const short = l.deductedPaise - l.depositedPaise;
      if (short <= 0 || left <= 0) continue;
      const take = Math.min(short, left);
      apply(l, ch, take);
      left -= take;
    }
    if (left > 0) {
      const target = forMonth[0];
      if (target) apply(target, ch, left);
      else {
        const l: TdsLine = { section: "(none)", month: ch.month, deductedPaise: 0, depositedPaise: 0, shortfallPaise: 0, dueDate: tdsDueDate(ch.month), lastDepositDate: null, late: [], row: ch.row };
        apply(l, ch, left);
        lines.set(keyOf(l.section, l.month), l);
      }
    }
  }
  const out = [...lines.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.section < b.section ? -1 : 1));
  for (const l of out) l.shortfallPaise = Math.max(l.deductedPaise - l.depositedPaise, 0);
  return out;
}

// ------------------------------------------------------------------ GST

export type GstHeadKey = "output-igst" | "output-cgst" | "output-sgst" | "output-cess" | "itc-igst" | "itc-cgst" | "itc-sgst" | "itc-cess";
export type GstHead = { row: number; label: string; head: GstHeadKey; amountPaise: number };

type GstField = "head" | "amount";
export const GST_ALIASES: ColumnAliases<GstField> = {
  head: ["head", "ledger", "particulars", "description", "tax head", "account", "nature"],
  amount: ["amount", "balance", "closing balance", "tax", "tax amount", "value"],
};

/** Ledger / return line label → canonical head, or null ("Output CGST 9%" → output-cgst; "ITC IGST" → itc-igst). */
export function gstHeadOf(label: string): GstHeadKey | null {
  const s = label.toLowerCase();
  const tax = /\bigst\b|integrated/.test(s) ? "igst" : /\bcgst\b|central/.test(s) ? "cgst" : /\b(sgst|utgst)\b|state|union territory/.test(s) ? "sgst" : /\bcess\b/.test(s) ? "cess" : null;
  if (!tax) return null;
  const itc = /\b(itc|input|credit|eligible)\b|\b4\s*\(?a\b/.test(s);
  const output = /\b(output|outward|payable|liability)\b|\b3\.1\b/.test(s);
  if (itc === output) return null;
  return `${itc ? "itc" : "output"}-${tax}` as GstHeadKey;
}

export function parseGstSummary(file: string, rows: Cells, override: Partial<Record<GstField, string>> = {}): { data: GstHead[] | null; issues: ParseIssue[] } {
  const loc = locateColumns(rows, GST_ALIASES, ["head", "amount"], override);
  if (!loc) return { data: null, issues: [{ file, row: 0, message: "no header row with Head and Amount columns" }] };
  const out: GstHead[] = [];
  const issues: ParseIssue[] = [];
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const label = cell(rows[r], loc.columns.head);
    if (!label || /^total/i.test(label)) continue;
    const head = gstHeadOf(label);
    const amt = parseAmountPaise(cell(rows[r], loc.columns.amount));
    if (!head || !amt.ok) {
      issues.push({ file, row: r + 1, message: !amt.ok ? amt.reason : `not a GST tax head: "${label}"` });
      continue;
    }
    // Ledger balances may carry Cr signs; the comparison is on magnitude.
    out.push({ row: r + 1, label, head, amountPaise: Math.abs(amt.paise) });
  }
  return { data: out, issues };
}

export type GstTie = { head: GstHeadKey; booksPaise: number | null; returnPaise: number | null; differencePaise: number; booksRow: number | null; returnRow: number | null };

export const GST_HEAD_ORDER: GstHeadKey[] = ["output-igst", "output-cgst", "output-sgst", "output-cess", "itc-igst", "itc-cgst", "itc-sgst", "itc-cess"];

export function gstTieOut(ledger: GstHead[], filed: GstHead[]): GstTie[] {
  const sum = (xs: GstHead[], h: GstHeadKey) => {
    const hit = xs.filter((x) => x.head === h);
    return hit.length ? { paise: hit.reduce((a, x) => a + x.amountPaise, 0), row: hit[0].row } : null;
  };
  const out: GstTie[] = [];
  for (const head of GST_HEAD_ORDER) {
    const b = sum(ledger, head);
    const f = sum(filed, head);
    if (!b && !f) continue;
    out.push({ head, booksPaise: b?.paise ?? null, returnPaise: f?.paise ?? null, differencePaise: (b?.paise ?? 0) - (f?.paise ?? 0), booksRow: b?.row ?? null, returnRow: f?.row ?? null });
  }
  return out;
}

// ------------------------------------------------------------------ schedules

export type ScheduleType = "accrual" | "prepaid" | "fixed-asset";
export type ScheduleItem = { row: number; type: ScheduleType; item: string; ledger: string; monthlyPaise: number; from: string; to: string };

type ScheduleField = "type" | "item" | "ledger" | "amount" | "from" | "to";
export const SCHEDULE_ALIASES: ColumnAliases<ScheduleField> = {
  type: ["type", "schedule", "category", "kind"],
  item: ["item", "description", "particulars", "asset", "name"],
  ledger: ["ledger", "account", "expense ledger", "ledger name"],
  amount: ["monthly amount", "monthly", "amount per month", "monthly charge", "amount", "depreciation per month"],
  from: ["from", "start", "start month", "from month"],
  to: ["to", "end", "end month", "to month", "till"],
};

const scheduleType = (s: string): ScheduleType | null => {
  const t = s.toLowerCase();
  if (/accru|provision|outstanding/.test(t)) return "accrual";
  if (/prepaid|advance|amorti/.test(t)) return "prepaid";
  if (/fixed|asset|deprec/.test(t)) return "fixed-asset";
  return null;
};

export function parseSchedules(file: string, rows: Cells, override: Partial<Record<ScheduleField, string>> = {}): { data: ScheduleItem[] | null; issues: ParseIssue[] } {
  const loc = locateColumns(rows, SCHEDULE_ALIASES, ["type", "item", "amount"], override);
  if (!loc) return { data: null, issues: [{ file, row: 0, message: "no header row with Type, Item and Monthly amount columns" }] };
  const c = loc.columns;
  const out: ScheduleItem[] = [];
  const issues: ParseIssue[] = [];
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((x) => (x ?? "").trim() === "")) continue;
    const type = scheduleType(cell(row, c.type));
    const amt = parseAmountPaise(cell(row, c.amount));
    const from = parseMonth(cell(row, c.from)) ?? "0000-01";
    const to = parseMonth(cell(row, c.to)) ?? "9999-12";
    if (!type || !amt.ok) {
      issues.push({ file, row: r + 1, message: !amt.ok ? amt.reason : `unknown schedule type "${cell(row, c.type)}"` });
      continue;
    }
    out.push({ row: r + 1, type, item: cell(row, c.item), ledger: cell(row, c.ledger), monthlyPaise: amt.paise, from, to });
  }
  return { data: out, issues };
}

/** Schedule items to book in `month` (from ≤ month ≤ to). */
export const remindersFor = (items: ScheduleItem[], month: string) => items.filter((i) => i.from <= month && month <= i.to);
