// Books Close checklist: deterministic rule bodies (registry) and the default SOP pack v1.0.0.
// Thresholds come from rule params (data in the SOP pack) with the config.ts defaults as fallback;
// every param block carries a `verify` note for the partner.
//
// TDS severity — PARTNER TO CONFIRM SOP: TDS deducted with no (or a short) challan is a WARN
// reminder (books.tds-due-soon, with the due date) while the pack is prepared BEFORE the due date
// (7th of the next month; 30 April for March deductions — config.ts TDS_DUE), and a BLOCK
// (books.tds-not-deposited) when it is prepared ON or after the due date. A pack prepared on the
// due date itself blocks so it is not approved until the challan is in, although a deposit made
// that day is still in time. The preparation date is the run's clock (CheckInput.preparedAt, IST
// day); when it is unknown (e.g. a replayed mistake) an undeposited deduction is treated as overdue.
//
// Trial balances (owner-approved 2026-11-05): the month-end TB must balance to the paisa or the pack
// BLOCKS (books.tb-balanced). When a prior-month (opening) TB is supplied it must balance too, but
// that is a WARN (books.prior-tb-balanced): the comparison base and the opening balances it hands on
// carry a difference to explain; it fails as well when the file cannot be read, and is na without one.
import { createRuleRegistry, type ChecklistPack, type CheckOutcome, type DeterministicCheck, type RuleDefinition } from "@/lib/agents/core/checklist";
import { formatDayKey, formatInr } from "@/lib/agents/core/format";
import type { CheckInput } from "@/lib/agents/core/runner";
import { istDayKey } from "@/lib/ist";
import { analyzeBooks, ensureExtract, expenseSpikes, suspenseRows, type BooksExtract } from "./analysis";
import { BANK_MATCH, BOOKS_NAMES, BOOKS_THRESHOLDS, TDS_DUE } from "./config";
import type { BooksInput } from "./inputs";
import { daysBetween } from "./table";
import { matchRows, netPaise } from "./tb";

export const BOOKS_KEY = "books";
export type BooksCheckInput = CheckInput<BooksInput, BooksExtract>;

const inr = (paise: number) => `₹${formatInr(paise / 100)}`;
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const strings = (v: unknown, fallback: readonly string[]): string[] => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : [...fallback]);
const pass = (): CheckOutcome => ({ status: "pass" });
const na = (message: string): CheckOutcome => ({ status: "na", message });
const at = (file: string, row: number) => `${file} row ${row}`;

const analysis = (ci: BooksCheckInput) => analyzeBooks(ci.extracted, ci.job);
/** IST day the pack is prepared on, or null when the run carries no clock. */
const preparedOn = (ci: BooksCheckInput): string | null => (ci.preparedAt instanceof Date && !Number.isNaN(ci.preparedAt.getTime()) ? istDayKey(ci.preparedAt) : null);

const TDS_SEVERITY_VERIFY =
  "Severity (partner to confirm SOP): no challan and prepared before the due date → warn reminder (books.tds-due-soon); prepared on or after the due date → block (books.tds-not-deposited). The due date itself blocks.";

/** Every body sees a complete extract (a replayed MistakeLog example may carry only part of it). */
const withFullExtract = (entries: Record<string, DeterministicCheck<BooksCheckInput>>) =>
  Object.fromEntries(Object.entries(entries).map(([k, fn]) => [k, (ci: BooksCheckInput, r: RuleDefinition) => fn({ ...ci, extracted: ensureExtract(ci.extracted) }, r)]));

export const booksRegistry = createRuleRegistry<BooksCheckInput>(withFullExtract({
  "books.tb-balanced": (ci) => {
    const { tb } = ci.extracted;
    const a = analysis(ci);
    if (!tb || !a.tb) return { status: "fail", message: "The trial balance could not be read, so debits = credits cannot be proved", evidence: { location: ci.extracted.files.find((f) => f.kind === "tb")?.name ?? "trial balance" } };
    if (a.tb.differencePaise === 0) return pass();
    return {
      status: "fail",
      message: `Trial balance does not balance: debits ${inr(a.tb.debitPaise)}, credits ${inr(a.tb.creditPaise)}, difference ${inr(Math.abs(a.tb.differencePaise))}`,
      evidence: { quote: `Total debits ${(a.tb.debitPaise / 100).toFixed(2)} / total credits ${(a.tb.creditPaise / 100).toFixed(2)}`, location: `${tb.file} (${tb.rows.length} ledgers)` },
    };
  },

  // Prior-month (opening) TB balances (owner-approved 2026-11-05): warn only. Only the current
  // month's TB imbalance blocks (books.tb-balanced); this one tells the reviewer the comparison
  // base — and the opening balances it hands on — carries a difference.
  "books.prior-tb-balanced": (ci, rule) => {
    const { priorTb } = ci.extracted;
    if (!priorTb) {
      const file = ci.extracted.files.find((f) => f.kind === "tb-prior");
      if (!file) return na("Prior-month trial balance not provided");
      return { status: "fail", message: "The prior-month (opening) trial balance could not be read, so its debits = credits cannot be proved", evidence: { location: file.name } };
    }
    const t = analysis(ci).priorTb!;
    if (Math.abs(t.differencePaise) <= num(rule.params?.tolerancePaise, 0)) return pass();
    return {
      status: "fail",
      message: `Prior-month (opening) trial balance does not balance: debits ${inr(t.debitPaise)}, credits ${inr(t.creditPaise)}, difference ${inr(Math.abs(t.differencePaise))}. The opening balances may carry the difference into this month; correct or explain it before relying on the month-on-month comparison.`,
      evidence: { quote: `Total debits ${(t.debitPaise / 100).toFixed(2)} / total credits ${(t.creditPaise / 100).toFixed(2)}`, location: `${priorTb.file} (${priorTb.rows.length} ledgers)` },
    };
  },

  "books.parse-issues": (ci) => {
    const issues = ci.extracted.issues;
    if (!issues.length) return pass();
    const i = issues[0];
    return { status: "fail", message: `${issues.length} row(s) or file(s) could not be read; figures may be incomplete. First: ${i.message}`, evidence: { quote: i.message, location: i.row ? at(i.file, i.row) : i.file } };
  },

  "books.bank-recon-difference": (ci) => {
    const r = analysis(ci).recon;
    if (!r) return na("Bank statement or bank ledger not provided");
    const d = r.summary.differencePaise;
    if (d === null) return na("Opening balances not given on both the statement and the ledger");
    if (d === 0) return pass();
    return {
      status: "fail",
      message: `Bank reconciliation does not tie: unexplained difference ${inr(Math.abs(d))} (statement opening ${inr(r.summary.statementOpeningPaise!)} vs ledger opening ${inr(r.summary.ledgerOpeningPaise!)}). Brought-forward items may be missing.`,
      evidence: { quote: `Balance per bank ${((r.summary.balancePerBankPaise ?? 0) / 100).toFixed(2)}; adjusted balance per books ${((r.summary.adjustedBooksPaise ?? 0) / 100).toFixed(2)}`, location: "Bank reconciliation sheet" },
    };
  },

  "books.bank-stale-items": (ci, rule) => {
    const a = analysis(ci);
    if (!a.recon) return na("Bank statement or bank ledger not provided");
    const days = num(rule.params?.staleDays, BOOKS_THRESHOLDS.staleDays);
    const stale = a.unreconciled.filter((l) => l.ageDays > days);
    if (!stale.length) return pass();
    const s = stale[0];
    const file = s.side === "statement" ? ci.extracted.statement!.file : ci.extracted.ledger!.file;
    return {
      status: "fail",
      message: `${stale.length} unreconciled bank item(s) older than ${days} days at ${formatDayKey(a.periodEnd)}; oldest shown: ${s.narration || s.ref} ${inr(Math.abs(s.amountPaise))} (${s.ageDays} days)`,
      evidence: { quote: `${s.date} ${s.narration} ${(s.amountPaise / 100).toFixed(2)}`, location: at(file, s.row) },
    };
  },

  "books.bank-amount-only": (ci) => {
    const { recon } = analysis(ci);
    if (!recon) return na("Bank statement or bank ledger not provided");
    if (!recon.amountOnly.length) return pass();
    const st = ci.extracted.statement!;
    const lg = ci.extracted.ledger!;
    const first = recon.amountOnly[0];
    const s = st.lines.find((l) => l.id === first.statementId)!;
    const l = lg.lines.find((x) => x.id === first.ledgerIds[0])!;
    const cross = s.date.slice(0, 7) !== l.date.slice(0, 7);
    return {
      status: "fail",
      message: `${recon.amountOnly.length} bank item(s) agree with a ledger entry by amount only (dates ${s.date} vs ${l.date}${cross ? ", different months" : ", outside the matching window"}); not matched — check for a wrong-period posting`,
      evidence: { quote: `${s.narration} ${(s.amountPaise / 100).toFixed(2)} / ${l.narration} ${(l.amountPaise / 100).toFixed(2)}`, location: `${at(st.file, s.row)} and ${at(lg.file, l.row)}` },
    };
  },

  "books.bank-duplicates": (ci) => {
    const { recon } = analysis(ci);
    if (!recon) return na("Bank statement or bank ledger not provided");
    if (!recon.duplicates.length) return pass();
    const g = recon.duplicates[0];
    const data = g.side === "statement" ? ci.extracted.statement! : ci.extracted.ledger!;
    const lines = g.ids.map((id) => data.lines.find((l) => l.id === id)!);
    return {
      status: "fail",
      message: `${recon.duplicates.length} possible duplicate ${g.side} entr${recon.duplicates.length === 1 ? "y" : "ies"}: ${lines[0].narration} ${inr(Math.abs(lines[0].amountPaise))} on ${lines[0].date} appears ${lines.length} times`,
      evidence: { quote: `${lines[0].date} ${lines[0].narration} ${(lines[0].amountPaise / 100).toFixed(2)}`, location: `${data.file} rows ${lines.map((l) => l.row).join(", ")}` },
    };
  },

  "books.suspense-nonzero": (ci, rule) => {
    const { tb } = ci.extracted;
    if (!tb) return na("Trial balance not readable");
    const rows = suspenseRows(tb, strings(rule.params?.patterns, BOOKS_NAMES.suspense));
    if (!rows.length) return pass();
    const r = rows[0];
    const total = rows.reduce((s, x) => s + Math.abs(netPaise(x)), 0);
    return { status: "fail", message: `${rows.length} suspense ledger(s) carry a balance (${inr(total)} in all); clear before close`, evidence: { quote: `${r.ledger} ${(netPaise(r) / 100).toFixed(2)}`, location: at(tb.file, r.row) } };
  },

  "books.tds-not-deposited": (ci) => {
    const { tds } = analysis(ci);
    if (!tds) return na("TDS deducted ledger or challan list not provided");
    const prep = preparedOn(ci);
    // Overdue: the pack is prepared on or after the due date (or the preparation date is unknown).
    const overdue = tds.filter((l) => l.shortfallPaise > 0 && (prep === null || prep >= l.dueDate));
    if (!overdue.length) return pass();
    const l = overdue[0];
    const when = prep === null ? "preparation date unknown — treated as overdue" : prep === l.dueDate ? `prepared ${formatDayKey(prep)}, the due date itself` : `prepared ${formatDayKey(prep)}, ${daysBetween(l.dueDate, prep)} day(s) after the due date`;
    return {
      status: "fail",
      message: `TDS deducted but not deposited by the due date: ${overdue.length} section/month line(s), ${inr(overdue.reduce((s, x) => s + x.shortfallPaise, 0))} in all; first: section ${l.section} for ${l.month} short by ${inr(l.shortfallPaise)} (due ${formatDayKey(l.dueDate)}; ${when}). Deposit now; interest u/s 201(1A) to be computed.`,
      evidence: { quote: `${l.section} ${l.month} deducted ${(l.deductedPaise / 100).toFixed(2)} deposited ${(l.depositedPaise / 100).toFixed(2)}`, location: at(ci.extracted.files.find((f) => f.kind === "tds-deducted")?.name ?? "TDS deducted", l.row) },
    };
  },

  "books.tds-due-soon": (ci) => {
    const { tds } = analysis(ci);
    if (!tds) return na("TDS deducted ledger or challan list not provided");
    const prep = preparedOn(ci);
    if (prep === null) return na("Preparation date unknown: an undeposited deduction is treated as overdue (books.tds-not-deposited)");
    const due = tds.filter((l) => l.shortfallPaise > 0 && prep < l.dueDate);
    if (!due.length) return pass();
    const l = due[0];
    return {
      status: "fail",
      message: `Reminder — TDS deducted, not yet deposited, due date not reached (prepared ${formatDayKey(prep)}): ${due.length} section/month line(s), ${inr(due.reduce((s, x) => s + x.shortfallPaise, 0))} in all; first: section ${l.section} for ${l.month}, ${inr(l.shortfallPaise)} to deposit by ${formatDayKey(l.dueDate)} (${daysBetween(prep, l.dueDate)} day(s) left).`,
      evidence: { quote: `${l.section} ${l.month} deducted ${(l.deductedPaise / 100).toFixed(2)} deposited ${(l.depositedPaise / 100).toFixed(2)}`, location: at(ci.extracted.files.find((f) => f.kind === "tds-deducted")?.name ?? "TDS deducted", l.row) },
    };
  },

  "books.tds-late": (ci) => {
    const { tds } = analysis(ci);
    if (!tds) return na("TDS deducted ledger or challan list not provided");
    const late = tds.flatMap((l) => l.late.map((x) => ({ ...x, line: l })));
    if (!late.length) return pass();
    const x = late[0];
    return {
      status: "fail",
      message: `${late.length} TDS deposit(s) made after the due date; first: section ${x.line.section} for ${x.line.month} deposited ${formatDayKey(x.depositDate)}, due ${formatDayKey(x.line.dueDate)} (${x.daysLate} days late — interest u/s 201(1A) to be computed)`,
      evidence: { quote: `${x.challan || "challan"} ${x.depositDate} ${(x.amountPaise / 100).toFixed(2)}`, location: at(ci.extracted.files.find((f) => f.kind === "tds-challans")?.name ?? "TDS challans", x.row) },
    };
  },

  "books.gst-mismatch": (ci, rule) => {
    const { gst } = analysis(ci);
    if (!gst) return na("GST ledger or filed return summary not provided");
    const tol = num(rule.params?.tolerancePaise, BOOKS_THRESHOLDS.gstTolerancePaise);
    const off = gst.filter((g) => Math.abs(g.differencePaise) > tol || g.booksPaise === null || g.returnPaise === null);
    if (!off.length) return pass();
    const g = off[0];
    const files = ci.extracted.files;
    return {
      status: "fail",
      message: `GST ledger does not agree with the filed return for ${off.length} head(s); first: ${g.head} books ${g.booksPaise === null ? "—" : inr(g.booksPaise)} vs return ${g.returnPaise === null ? "—" : inr(g.returnPaise)}`,
      evidence: {
        quote: `${g.head}: ${((g.booksPaise ?? 0) / 100).toFixed(2)} vs ${((g.returnPaise ?? 0) / 100).toFixed(2)}`,
        location: g.booksRow !== null ? at(files.find((f) => f.kind === "gst-ledger")?.name ?? "GST ledger", g.booksRow) : at(files.find((f) => f.kind === "gst-return")?.name ?? "GST return", g.returnRow ?? 0),
      },
    };
  },

  "books.negative-cash": (ci) => {
    const { tb } = ci.extracted;
    if (!tb) return na("Trial balance not readable");
    const neg = analysis(ci).cash.filter((r) => netPaise(r) < 0);
    if (!neg.length) return pass();
    const r = neg[0];
    return { status: "fail", message: `Cash ledger ${r.ledger} has a credit (negative) balance of ${inr(-netPaise(r))}: receipts may be unrecorded or payments posted twice`, evidence: { quote: `${r.ledger} Cr ${(r.creditPaise / 100).toFixed(2)}`, location: at(tb.file, r.row) } };
  },

  "books.expense-spike": (ci, rule) => {
    const { tb, priorTb } = ci.extracted;
    if (!tb || !priorTb) return na("Prior-month trial balance not provided");
    const spikes = expenseSpikes(tb, priorTb, num(rule.params?.percent, BOOKS_THRESHOLDS.spikePercent), num(rule.params?.minIncreasePaise, BOOKS_THRESHOLDS.spikeMinIncreasePaise));
    if (!spikes.length) return pass();
    const s = spikes[0];
    return {
      status: "fail",
      message: `${spikes.length} expense ledger(s) up sharply on the prior month; first: ${s.ledger} ${inr(s.currentPaise)} vs ${inr(s.priorPaise)} (+${inr(s.increasePaise)})`,
      evidence: { quote: `${s.ledger} ${(s.currentPaise / 100).toFixed(2)}`, location: at(tb.file, s.row) },
    };
  },

  "books.inputs-missing": (ci) => {
    const m = analysis(ci).missingInputs;
    if (!m.length) return pass();
    return { status: "fail", message: `Not provided (checks skipped): ${m.join("; ")}`, evidence: { location: "inputs" } };
  },

  "books.schedule-reminders": (ci) => {
    const a = analysis(ci);
    if (!ci.extracted.schedules) return na("No schedules provided");
    if (!a.reminders.length) return pass();
    const r = a.reminders[0];
    return {
      status: "fail",
      message: `${a.reminders.length} accrual / prepaid / depreciation entr${a.reminders.length === 1 ? "y" : "ies"} to book for ${a.month}; first: ${r.type} ${r.item} ${inr(r.monthlyPaise)} to ${r.ledger || "the ledger"}`,
      evidence: { quote: `${r.type},${r.item},${(r.monthlyPaise / 100).toFixed(2)}`, location: at(ci.extracted.files.find((f) => f.kind === "schedules")?.name ?? "schedules", r.row) },
    };
  },

  "books.suggestions-low-confidence": (ci, rule) => {
    const min = num(rule.params?.minConfidence, BOOKS_THRESHOLDS.lowConfidence);
    const low = ci.extracted.suggestions.filter((s) => s.status === "suggested" && s.confidence < min);
    if (!low.length) return pass();
    const s = low[0];
    return {
      status: "fail",
      message: `${low.length} classification suggestion(s) below ${Math.round(min * 100)}% confidence; first: ${s.lineId} → ${s.ledger} (${Math.round(s.confidence * 100)}%)`,
      evidence: { quote: s.evidence?.quote ?? s.ledger, location: s.evidence?.location ?? `Expense suggestions ${s.lineId}` },
    };
  },

  "books.classification-questions": (ci) => {
    const qs = ci.extracted.suggestions.filter((s) => s.status !== "suggested");
    if (!qs.length) return pass();
    const s = qs[0];
    const st = ci.extracted.statement;
    const line = st?.lines.find((l) => l.id === s.lineId);
    return {
      status: "fail",
      message: `${qs.length} bank debit(s) need the reviewer to say what they were for (the documents were insufficient or the answer was not grounded); first: ${s.lineId}${line ? ` ${line.narration}` : ""}`,
      evidence: { quote: line ? line.narration || line.ref || line.id : s.lineId, location: line && st ? at(st.file, line.row) : `Expense suggestions ${s.lineId}` },
    };
  },

  // ---------------------------------------------------------------- parameterised checks (promoted mistakes)

  "books.ledger-over-limit": (ci, rule) => {
    const { tb } = ci.extracted;
    if (!tb) return na("Trial balance not readable");
    const limit = num(rule.params?.limitPaise, Number.MAX_SAFE_INTEGER);
    const rows = matchRows(tb, { ledger: strings(rule.params?.ledgerPatterns, []), group: strings(rule.params?.groupPatterns, []) }).filter((r) => Math.abs(netPaise(r)) > limit);
    if (!rows.length) return pass();
    const r = rows[0];
    return { status: "fail", message: `${r.ledger} balance ${inr(Math.abs(netPaise(r)))} is above ${inr(limit)}`, evidence: { quote: `${r.ledger} ${(netPaise(r) / 100).toFixed(2)}`, location: at(tb.file, r.row) } };
  },

  "books.round-withdrawals": (ci, rule) => {
    const st = ci.extracted.statement;
    if (!st) return na("Bank statement not provided");
    const min = num(rule.params?.minPaise, 1_00_000_00);
    const mult = num(rule.params?.multiplePaise, 10_000_00);
    const hits = st.lines.filter((l) => l.amountPaise < 0 && -l.amountPaise >= min && (-l.amountPaise) % mult === 0);
    if (!hits.length) return pass();
    const l = hits[0];
    return { status: "fail", message: `${hits.length} large round-sum withdrawal(s); first ${inr(-l.amountPaise)} on ${l.date}`, evidence: { quote: `${l.date} ${l.narration} ${(l.amountPaise / 100).toFixed(2)}`, location: at(st.file, l.row) } };
  },

  "books.narration-watch": (ci, rule) => {
    const st = ci.extracted.statement;
    if (!st) return na("Bank statement not provided");
    const words = strings(rule.params?.words, []).map((w) => w.toLowerCase());
    const l = st.lines.find((x) => words.some((w) => w && x.narration.toLowerCase().includes(w)));
    if (!l) return pass();
    return { status: "fail", message: `Bank narration matches the watch list: ${l.narration}`, evidence: { quote: l.narration, location: at(st.file, l.row) } };
  },
}));

const rule = (r: RuleDefinition) => r;

export const BOOKS_CHECKLIST: ChecklistPack = {
  schemaVersion: 1,
  key: BOOKS_KEY,
  version: "1.0.0",
  rules: [
    rule({ id: "books.tb-balanced", title: "Trial balance: debits = credits", severity: "block", kind: "deterministic", check: "books.tb-balanced", evidence: "total debits, total credits and the TB file", params: { tolerancePaise: 0, verify: "Exact to the paisa; no tolerance." } }),
    rule({
      id: "books.prior-tb-balanced",
      title: "Prior-month (opening) trial balance: debits = credits",
      severity: "warn",
      kind: "deterministic",
      check: "books.prior-tb-balanced",
      evidence: "total debits, total credits and the prior-month TB file",
      params: { tolerancePaise: 0, verify: "Exact to the paisa; warn only (owner-approved 2026-11-05). Only the current month's TB imbalance blocks (books.tb-balanced)." },
    }),
    rule({ id: "books.parse-issues", title: "Every input row could be read", severity: "warn", kind: "deterministic", check: "books.parse-issues", evidence: "file and row that could not be read" }),
    rule({ id: "books.bank-recon-difference", title: "Bank reconciliation ties (no unexplained difference)", severity: "block", kind: "deterministic", check: "books.bank-recon-difference", evidence: "balance per bank and adjusted balance per books" }),
    rule({
      id: "books.bank-stale-items",
      title: "No unreconciled bank items older than N days",
      severity: "warn",
      kind: "deterministic",
      check: "books.bank-stale-items",
      evidence: "the oldest unreconciled item, its date and row",
      params: { staleDays: BOOKS_THRESHOLDS.staleDays, verify: BOOKS_THRESHOLDS.staleVerify },
    }),
    rule({
      id: "books.bank-amount-only",
      title: "No bank item agrees with the books by amount only",
      severity: "warn",
      kind: "deterministic",
      check: "books.bank-amount-only",
      evidence: "statement line and ledger line with the same amount",
      params: { verify: `${BANK_MATCH.verify} (Matcher constants: BANK_MATCH in src/lib/agents/books/config.ts — windowDays ${BANK_MATCH.windowDays}, refWindowDays ${BANK_MATCH.refWindowDays}.)` },
    }),
    rule({ id: "books.bank-duplicates", title: "No duplicate bank entries", severity: "warn", kind: "deterministic", check: "books.bank-duplicates", evidence: "the repeated entry and its rows" }),
    rule({
      id: "books.suspense-nonzero",
      title: "Suspense ledgers are nil",
      severity: "warn",
      kind: "deterministic",
      check: "books.suspense-nonzero",
      evidence: "suspense ledger, balance and TB row",
      params: { patterns: [...BOOKS_NAMES.suspense], verify: BOOKS_NAMES.verify },
    }),
    rule({
      id: "books.tds-not-deposited",
      title: "TDS deducted has been deposited by the due date",
      severity: "block",
      kind: "deterministic",
      check: "books.tds-not-deposited",
      evidence: "section, month, deducted and deposited amounts, due date",
      params: { dayOfNextMonth: TDS_DUE.dayOfNextMonth, marchDue: "30 April", verify: `${TDS_DUE.verify} ${TDS_SEVERITY_VERIFY}` },
    }),
    rule({
      id: "books.tds-due-soon",
      title: "TDS deducted, deposit due after the preparation date (reminder)",
      severity: "warn",
      kind: "deterministic",
      check: "books.tds-due-soon",
      evidence: "section, month, amount to deposit and due date",
      params: { dayOfNextMonth: TDS_DUE.dayOfNextMonth, marchDue: "30 April", verify: `${TDS_DUE.verify} ${TDS_SEVERITY_VERIFY}` },
    }),
    rule({
      id: "books.tds-late",
      title: "TDS deposited by the due date",
      severity: "warn",
      kind: "deterministic",
      check: "books.tds-late",
      evidence: "challan, deposit date and due date",
      params: { dayOfNextMonth: TDS_DUE.dayOfNextMonth, marchDue: "30 April", verify: TDS_DUE.verify },
    }),
    rule({
      id: "books.gst-mismatch",
      title: "GST ledger agrees with the filed return",
      severity: "warn",
      kind: "deterministic",
      check: "books.gst-mismatch",
      evidence: "tax head, books amount and return amount",
      params: { tolerancePaise: BOOKS_THRESHOLDS.gstTolerancePaise, verify: BOOKS_THRESHOLDS.gstVerify },
    }),
    rule({ id: "books.negative-cash", title: "Cash in hand is not negative", severity: "warn", kind: "deterministic", check: "books.negative-cash", evidence: "cash ledger, credit balance and TB row", params: { verify: BOOKS_NAMES.verify } }),
    rule({
      id: "books.expense-spike",
      title: "Expense ledgers in line with the prior month",
      severity: "warn",
      kind: "deterministic",
      check: "books.expense-spike",
      evidence: "ledger, current and prior amounts",
      params: { percent: BOOKS_THRESHOLDS.spikePercent, minIncreasePaise: BOOKS_THRESHOLDS.spikeMinIncreasePaise, verify: BOOKS_THRESHOLDS.spikeVerify },
    }),
    rule({ id: "books.inputs-missing", title: "All month-end inputs provided", severity: "info", kind: "deterministic", check: "books.inputs-missing", evidence: "the inputs not provided" }),
    rule({ id: "books.schedule-reminders", title: "Accrual / prepaid / depreciation entries for the month", severity: "info", kind: "deterministic", check: "books.schedule-reminders", evidence: "schedule item and row" }),
    rule({
      id: "books.suggestions-low-confidence",
      title: "Classification suggestions are confident",
      severity: "info",
      kind: "deterministic",
      check: "books.suggestions-low-confidence",
      evidence: "statement line and suggested head",
      params: { minConfidence: BOOKS_THRESHOLDS.lowConfidence, verify: BOOKS_THRESHOLDS.lowConfidenceVerify },
    }),
    rule({
      id: "books.classification-questions",
      title: "Bank debits the agent could not classify (reviewer questions)",
      severity: "info",
      kind: "deterministic",
      check: "books.classification-questions",
      evidence: "bank line the documents do not explain",
    }),
  ],
};
