// Deterministic month-end analysis over the parsed books data. Pure: the same extract and period
// always give the same result. Rules, figures and the month-end pack all read from here.
import type { JobContext } from "@/lib/agents/core/runner";
import { reconcile, type BankData, type BankLine, type Reconciliation } from "./bank";
import { BANK_MATCH, BOOKS_NAMES } from "./config";
import type { ParsedBooks } from "./inputs";
import { gstTieOut, remindersFor, tdsCheck, type GstTie, type ScheduleItem, type TdsLine } from "./statutory";
import { daysBetween, monthEnd, type ParseIssue } from "./table";
import { matchRows, netPaise, tbTotals, type TbData, type TbRow, type TbTotals } from "./tb";

export type Suggestion = { lineId: string; ledger: string; confidence: number; reason: string; inChart: boolean };

export type BooksExtract = ParsedBooks & {
  /** Expense-classification suggestions for bank debits not in the books (model, validated). Never posted. */
  suggestions: Suggestion[];
  /** Heads offered to the classifier. */
  chartHeads: string[];
};

/** Fills missing parts (a replayed MistakeLog example may carry only what its rule reads). */
export function normalizeExtract(e: Partial<BooksExtract> | null | undefined): BooksExtract {
  return {
    files: e?.files ?? [],
    tb: e?.tb ?? null,
    priorTb: e?.priorTb ?? null,
    statement: e?.statement ?? null,
    ledger: e?.ledger ?? null,
    tdsDeducted: e?.tdsDeducted ?? null,
    tdsChallans: e?.tdsChallans ?? null,
    gstLedger: e?.gstLedger ?? null,
    gstReturn: e?.gstReturn ?? null,
    schedules: e?.schedules ?? null,
    issues: e?.issues ?? [],
    suggestions: e?.suggestions ?? [],
    chartHeads: e?.chartHeads ?? [],
  };
}

const normalized = new WeakMap<object, BooksExtract>();

/** normalizeExtract with a stable identity per source object (so analyzeBooks' memo is reused). */
export function ensureExtract(e: Partial<BooksExtract> | null | undefined): BooksExtract {
  if (!e || typeof e !== "object") return normalizeExtract(e);
  const hit = normalized.get(e);
  if (hit) return hit;
  const n = normalizeExtract(e);
  normalized.set(e, n);
  return n;
}

/** The close month: the job period when it is YYYY-MM, else the last month of the FY (2026-27 → 2027-03). */
export function closeMonth(job: Pick<JobContext, "period" | "fy">): string {
  if (/^\d{4}-\d{2}$/.test(job.period)) return job.period;
  const m = /^(\d{4})-\d{2}$/.exec(job.fy);
  return m ? `${Number(m[1]) + 1}-03` : "2027-03";
}

export type AgedLine = BankLine & { side: "statement" | "ledger"; ageDays: number };

export type BooksAnalysis = {
  month: string;
  periodEnd: string;
  tb: TbTotals | null;
  priorTb: TbTotals | null;
  recon: Reconciliation | null;
  unreconciled: AgedLine[];
  tds: TdsLine[] | null;
  gst: GstTie[] | null;
  suspense: TbRow[];
  cash: TbRow[];
  reminders: ScheduleItem[];
  issues: ParseIssue[];
  missingInputs: string[];
};

const cache = new WeakMap<object, Map<string, BooksAnalysis>>();

export function analyzeBooks(extract: BooksExtract, job: Pick<JobContext, "period" | "fy">): BooksAnalysis {
  const month = closeMonth(job);
  const memo = cache.get(extract) ?? new Map<string, BooksAnalysis>();
  cache.set(extract, memo);
  const hit = memo.get(month);
  if (hit) return hit;

  const periodEnd = monthEnd(month);
  const recon = extract.statement && extract.ledger ? reconcile(extract.statement, extract.ledger, BANK_MATCH) : null;
  const unreconciled: AgedLine[] = recon
    ? [
        ...recon.unmatchedStatement.map((l) => ({ ...l, side: "statement" as const, ageDays: daysBetween(l.date, periodEnd) })),
        ...recon.unmatchedLedger.map((l) => ({ ...l, side: "ledger" as const, ageDays: daysBetween(l.date, periodEnd) })),
      ]
    : [];
  const missingInputs: string[] = [];
  if (!extract.priorTb) missingInputs.push("Prior-month trial balance (expense spike check)");
  if (!extract.statement || !extract.ledger) missingInputs.push("Bank statement and bank ledger (bank reconciliation)");
  if (!extract.tdsDeducted || !extract.tdsChallans) missingInputs.push("TDS deducted ledger and TDS challan list");
  if (!extract.gstLedger || !extract.gstReturn) missingInputs.push("GST ledger balances and filed return summary");
  if (!extract.schedules) missingInputs.push("Accrual / prepaid / fixed-asset schedules");

  const a: BooksAnalysis = {
    month,
    periodEnd,
    tb: extract.tb ? tbTotals(extract.tb) : null,
    priorTb: extract.priorTb ? tbTotals(extract.priorTb) : null,
    recon,
    unreconciled,
    tds: extract.tdsDeducted && extract.tdsChallans ? tdsCheck(extract.tdsDeducted, extract.tdsChallans) : null,
    gst: extract.gstLedger && extract.gstReturn ? gstTieOut(extract.gstLedger, extract.gstReturn) : null,
    suspense: extract.tb ? suspenseRows(extract.tb) : [],
    cash: extract.tb ? cashRows(extract.tb) : [],
    reminders: extract.schedules ? remindersFor(extract.schedules, month) : [],
    issues: extract.issues,
    missingInputs,
  };
  memo.set(month, a);
  return a;
}

export const suspenseRows = (tb: TbData, patterns: readonly string[] = BOOKS_NAMES.suspense) => matchRows(tb, { ledger: [...patterns] }).filter((r) => netPaise(r) !== 0);
export const cashRows = (tb: TbData) => matchRows(tb, { ledger: [...BOOKS_NAMES.cash.ledger], group: [...BOOKS_NAMES.cash.group] });
export const expenseRows = (tb: TbData) => matchRows(tb, { group: [...BOOKS_NAMES.expense.group] });

export type Spike = { ledger: string; row: number; currentPaise: number; priorPaise: number; increasePaise: number };

/** Expense ledgers up by more than `percent`% AND by at least `minIncreasePaise` against the prior TB. */
export function expenseSpikes(current: TbData, prior: TbData, percent: number, minIncreasePaise: number): Spike[] {
  const priorBy = new Map<string, number>();
  for (const r of prior.rows) {
    const k = r.ledger.toLowerCase().replace(/\s+/g, " ").trim();
    priorBy.set(k, (priorBy.get(k) ?? 0) + netPaise(r));
  }
  const out: Spike[] = [];
  for (const r of expenseRows(current)) {
    const cur = netPaise(r);
    const prev = priorBy.get(r.ledger.toLowerCase().replace(/\s+/g, " ").trim()) ?? 0;
    const inc = cur - prev;
    // cur > prev × (1 + percent/100), in integers: 100·cur > (100 + percent)·prev
    if (inc >= minIncreasePaise && 100 * cur > (100 + percent) * prev) out.push({ ledger: r.ledger, row: r.row, currentPaise: cur, priorPaise: prev, increasePaise: inc });
  }
  return out;
}

/** Statement debits (money out) the books do not have yet: the classifier's candidates. */
export function classificationCandidates(statement: BankData | null, ledger: BankData | null): BankLine[] {
  if (!statement || !ledger) return [];
  return reconcile(statement, ledger, BANK_MATCH).unmatchedStatement.filter((l) => l.amountPaise < 0);
}
