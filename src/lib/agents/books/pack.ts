// Month-end pack (XLSX) for Books Close: fixed sheets in a fixed order, always present (empty
// tables when an input was not provided), so the review screen and the accuracy harness can rely
// on the shape. Amounts arrive as integer paise and are written as rupees (paise / 100).
import type { ChecklistResultItem } from "@/lib/agents/core/checklist";
import type { DeliverableDraft, Figures } from "@/lib/agents/core/runner";
import type { SheetSpec } from "@/lib/agents/core/templates";
import { analyzeBooks, type BooksExtract } from "./analysis";
import type { JobContext } from "@/lib/agents/core/runner";
import { BOOKS_THRESHOLDS } from "./config";
import { rupees } from "./table";

export const BOOKS_PACK_TITLE = "Month-end pack";

/** Sheet names and column headers, in order (the fixture `deliverables` shape). */
export const BOOKS_SHEETS = {
  summary: ["Item", "Amount", "Count", "Note"],
  tb: ["Ledger", "Group", "Debit", "Credit"],
  brs: ["Particulars", "Amount", "Note"],
  matching: ["Side", "Line", "Date", "Reference", "Narration", "Amount", "Status", "Matched with", "Note"],
  suggestions: ["Line", "Date", "Narration", "Amount", "Suggested ledger", "Confidence", "Reason", "Status"],
  unreconciled: ["Item", "Source", "Date", "Amount", "Age (days)", "Note"],
  reminders: ["Type", "Item", "Ledger", "Amount", "Note"],
  tds: ["Section", "Month", "Deducted", "Deposited", "Shortfall", "Due date", "Last deposit", "Status"],
  gst: ["Head", "Per books", "Per return", "Difference", "Status"],
  checklist: ["Rule", "Severity", "Status", "Message", "Evidence"],
} as const;

export const BOOKS_SHEET_NAMES = {
  summary: "Summary",
  tb: "Trial balance",
  brs: "Bank reconciliation",
  matching: "Bank matching",
  suggestions: "Expense suggestions",
  unreconciled: "Suspense and unreconciled",
  reminders: "Accrual-prepaid reminders",
  tds: "TDS check",
  gst: "GST tie-out",
  checklist: "Checklist",
} as const;

const cols = (headers: readonly string[], spec: Record<string, { key: string; type?: "text" | "inr" | "integer" | "date" | "percent"; width?: number }>) =>
  headers.map((h) => ({ header: h, ...(spec[h] ?? { key: h.toLowerCase().replace(/[^a-z]+/g, "") }) }));

export function booksPack(ctx: { extracted: BooksExtract; figures: Figures; job: JobContext; results: ChecklistResultItem[] }): DeliverableDraft[] {
  const { extracted: e, figures: f, job, results } = ctx;
  const a = analyzeBooks(e, job);
  const sheets: SheetSpec[] = [];
  const pairBy = new Map<string, { other: string; method: string }>();
  for (const p of a.recon?.pairs ?? []) {
    pairBy.set(p.statementId, { other: p.ledgerId, method: p.method });
    pairBy.set(p.ledgerId, { other: p.statementId, method: p.method });
  }
  const amountOnly = new Map<string, string[]>();
  for (const x of a.recon?.amountOnly ?? []) {
    amountOnly.set(x.statementId, x.ledgerIds);
    for (const l of x.ledgerIds) amountOnly.set(l, [...(amountOnly.get(l) ?? []), x.statementId]);
  }
  const dupIds = new Set((a.recon?.duplicates ?? []).flatMap((d) => d.ids.slice(1)));

  // Summary
  sheets.push({
    name: BOOKS_SHEET_NAMES.summary,
    columns: cols(BOOKS_SHEETS.summary, { Item: { key: "item", width: 44 }, Amount: { key: "amount", type: "inr" }, Count: { key: "count", type: "integer" }, Note: { key: "note", width: 60 } }),
    rows: [
      { item: "Close month", note: a.month },
      { item: "Trial balance — total debits", amount: a.tb ? rupees(a.tb.debitPaise) : null },
      { item: "Trial balance — total credits", amount: a.tb ? rupees(a.tb.creditPaise) : null },
      { item: "Trial balance — difference (debits − credits)", amount: a.tb ? rupees(a.tb.differencePaise) : null, note: a.tb ? (a.tb.differencePaise === 0 ? "Balanced: debits = credits" : "DOES NOT BALANCE") : "Trial balance not readable" },
      { item: "Bank — matched pairs", count: f.bankMatchedCount ?? null },
      { item: "Bank — unreconciled statement lines", count: f.bankUnmatchedStatementCount ?? null },
      { item: "Bank — unreconciled ledger lines", count: f.bankUnmatchedLedgerCount ?? null },
      { item: "TDS — deducted", amount: f.tdsDeductedPaise === undefined ? null : rupees(f.tdsDeductedPaise) },
      { item: "TDS — deposited", amount: f.tdsDepositedPaise === undefined ? null : rupees(f.tdsDepositedPaise) },
      { item: "TDS — shortfall", amount: f.tdsShortfallPaise === undefined ? null : rupees(f.tdsShortfallPaise) },
      { item: "GST — ledger vs return, total absolute difference", amount: f.gstAbsDifferencePaise === undefined ? null : rupees(f.gstAbsDifferencePaise) },
      { item: "Suspense ledgers — total balance", amount: rupees(f.suspensePaise ?? 0) },
      { item: "Inputs not provided", note: a.missingInputs.join("; ") || "None" },
      { item: "Expense classification", note: "Suggestions only — nothing has been posted to the books" },
    ],
  });

  // Trial balance
  sheets.push({
    name: BOOKS_SHEET_NAMES.tb,
    columns: cols(BOOKS_SHEETS.tb, { Ledger: { key: "ledger", width: 40 }, Group: { key: "group", width: 28 }, Debit: { key: "debit", type: "inr" }, Credit: { key: "credit", type: "inr" } }),
    rows: (e.tb?.rows ?? []).map((r) => ({ ledger: r.ledger, group: r.group, debit: rupees(r.debitPaise), credit: rupees(r.creditPaise) })),
    totals: true,
  });

  // Bank reconciliation statement
  const s = a.recon?.summary;
  const opt = (p: number | null | undefined) => (p === null || p === undefined ? null : rupees(p));
  sheets.push({
    name: BOOKS_SHEET_NAMES.brs,
    columns: cols(BOOKS_SHEETS.brs, { Particulars: { key: "item", width: 52 }, Amount: { key: "amount", type: "inr" }, Note: { key: "note", width: 50 } }),
    rows: s
      ? [
          { item: "Balance as per books", amount: opt(s.balancePerBooksPaise), note: s.ledgerOpeningPaise === null ? "Ledger opening balance not given" : "" },
          { item: "Add: cheques issued but not presented", amount: rupees(s.unpresentedPaise) },
          { item: "Less: deposits not yet credited by the bank", amount: rupees(-s.unclearedPaise) },
          { item: "Add: bank credits not in books", amount: rupees(s.bankCreditsNotInBooksPaise) },
          { item: "Less: bank debits not in books", amount: rupees(-s.bankDebitsNotInBooksPaise) },
          { item: "Adjusted balance as per books", amount: opt(s.adjustedBooksPaise) },
          { item: "Balance as per bank statement", amount: opt(s.balancePerBankPaise), note: s.statementOpeningPaise === null ? "Statement opening balance not given" : "" },
          { item: "Difference (bank − adjusted books)", amount: opt(s.differencePaise), note: s.differencePaise === null ? "Not computable" : s.differencePaise === 0 ? "Reconciled" : "UNEXPLAINED DIFFERENCE" },
        ]
      : [{ item: "Bank statement and bank ledger not provided", note: "Reconciliation not prepared" }],
  });

  // Matching detail
  const lines = [
    ...(e.statement?.lines ?? []).map((l) => ({ l, side: "Statement" })),
    ...(e.ledger?.lines ?? []).map((l) => ({ l, side: "Ledger" })),
  ];
  sheets.push({
    name: BOOKS_SHEET_NAMES.matching,
    columns: cols(BOOKS_SHEETS.matching, {
      Side: { key: "side" },
      Line: { key: "line" },
      Date: { key: "date", type: "date" },
      Reference: { key: "ref" },
      Narration: { key: "narration", width: 40 },
      Amount: { key: "amount", type: "inr" },
      Status: { key: "status", width: 26 },
      "Matched with": { key: "with" },
      Note: { key: "note", width: 44 },
    }),
    rows: lines.map(({ l, side }) => {
      const p = pairBy.get(l.id);
      const ao = amountOnly.get(l.id);
      return {
        side,
        line: l.id,
        date: l.date,
        ref: l.ref,
        narration: l.narration,
        amount: rupees(l.amountPaise),
        status: p ? (p.method === "reference" ? "Matched (reference)" : "Matched (amount + date)") : "Unreconciled",
        with: p?.other ?? "",
        note: [dupIds.has(l.id) ? "Possible duplicate entry" : "", ao ? `Same amount as ${ao.join(", ")} but outside the matching window — not matched` : ""].filter(Boolean).join("; "),
      };
    }),
  });

  // Suggestions
  const stmtBy = new Map((e.statement?.lines ?? []).map((l) => [l.id, l]));
  sheets.push({
    name: BOOKS_SHEET_NAMES.suggestions,
    columns: cols(BOOKS_SHEETS.suggestions, {
      Line: { key: "line" },
      Date: { key: "date", type: "date" },
      Narration: { key: "narration", width: 40 },
      Amount: { key: "amount", type: "inr" },
      "Suggested ledger": { key: "ledger", width: 28 },
      Confidence: { key: "confidence", type: "percent" },
      Reason: { key: "reason", width: 40 },
      Status: { key: "status", width: 36 },
    }),
    rows: e.suggestions.map((sg) => {
      const l = stmtBy.get(sg.lineId);
      return {
        line: sg.lineId,
        date: l?.date ?? null,
        narration: l?.narration ?? "",
        amount: l ? rupees(Math.abs(l.amountPaise)) : null,
        ledger: sg.ledger,
        confidence: sg.confidence,
        reason: sg.reason,
        status: `Suggestion — not posted${!sg.inChart ? "; head not in chart" : sg.confidence < BOOKS_THRESHOLDS.lowConfidence ? "; low confidence" : ""}`,
      };
    }),
  });

  // Suspense and unreconciled
  sheets.push({
    name: BOOKS_SHEET_NAMES.unreconciled,
    columns: cols(BOOKS_SHEETS.unreconciled, {
      Item: { key: "item", width: 40 },
      Source: { key: "source", width: 24 },
      Date: { key: "date", type: "date" },
      Amount: { key: "amount", type: "inr" },
      "Age (days)": { key: "age", type: "integer" },
      Note: { key: "note", width: 44 },
    }),
    rows: [
      ...a.suspense.map((r) => ({ item: r.ledger, source: "Trial balance (suspense)", date: null, amount: rupees(r.debitPaise - r.creditPaise), age: null, note: "Clear before close" })),
      ...a.unreconciled.map((l) => ({
        item: l.narration || l.ref || l.id,
        source: l.side === "statement" ? "Bank statement — not in books" : "Bank ledger — not in statement",
        date: l.date,
        amount: rupees(l.amountPaise),
        age: l.ageDays,
        note: l.ageDays > BOOKS_THRESHOLDS.staleDays ? `Older than ${BOOKS_THRESHOLDS.staleDays} days` : "",
      })),
    ],
  });

  // Reminders
  sheets.push({
    name: BOOKS_SHEET_NAMES.reminders,
    columns: cols(BOOKS_SHEETS.reminders, { Type: { key: "type" }, Item: { key: "item", width: 36 }, Ledger: { key: "ledger", width: 28 }, Amount: { key: "amount", type: "inr" }, Note: { key: "note", width: 40 } }),
    rows: a.reminders.map((r) => ({
      type: r.type,
      item: r.item,
      ledger: r.ledger,
      amount: rupees(r.monthlyPaise),
      note: r.type === "accrual" ? `Provide for ${a.month}` : r.type === "prepaid" ? `Amortise for ${a.month}` : `Depreciation for ${a.month}`,
    })),
  });

  // TDS
  sheets.push({
    name: BOOKS_SHEET_NAMES.tds,
    columns: cols(BOOKS_SHEETS.tds, {
      Section: { key: "section" },
      Month: { key: "month" },
      Deducted: { key: "deducted", type: "inr" },
      Deposited: { key: "deposited", type: "inr" },
      Shortfall: { key: "shortfall", type: "inr" },
      "Due date": { key: "due", type: "date" },
      "Last deposit": { key: "last", type: "date" },
      Status: { key: "status", width: 40 },
    }),
    rows: (a.tds ?? []).map((l) => ({
      section: l.section,
      month: l.month,
      deducted: rupees(l.deductedPaise),
      deposited: rupees(l.depositedPaise),
      shortfall: rupees(l.shortfallPaise),
      due: l.dueDate,
      last: l.lastDepositDate,
      status: l.shortfallPaise > 0 ? "Not deposited in full" : l.late.length ? `Deposited late (${Math.max(...l.late.map((x) => x.daysLate))} days)` : "Deposited on time",
    })),
    totals: true,
  });

  // GST
  sheets.push({
    name: BOOKS_SHEET_NAMES.gst,
    columns: cols(BOOKS_SHEETS.gst, { Head: { key: "head", width: 20 }, "Per books": { key: "books", type: "inr" }, "Per return": { key: "ret", type: "inr" }, Difference: { key: "diff", type: "inr" }, Status: { key: "status", width: 30 } }),
    rows: (a.gst ?? []).map((g) => ({
      head: g.head,
      books: opt(g.booksPaise),
      ret: opt(g.returnPaise),
      diff: rupees(g.differencePaise),
      status: g.booksPaise === null ? "Not in books" : g.returnPaise === null ? "Not in return" : Math.abs(g.differencePaise) <= BOOKS_THRESHOLDS.gstTolerancePaise ? "Agrees" : "Differs",
    })),
  });

  // Checklist
  sheets.push({
    name: BOOKS_SHEET_NAMES.checklist,
    columns: cols(BOOKS_SHEETS.checklist, { Rule: { key: "rule", width: 40 }, Severity: { key: "severity" }, Status: { key: "status" }, Message: { key: "message", width: 70 }, Evidence: { key: "evidence", width: 50 } }),
    rows: results.map((r) => ({ rule: r.title, severity: r.severity, status: r.status, message: r.message, evidence: [r.evidence?.quote, r.evidence?.location].filter(Boolean).join(" — ") })),
  });

  return [{ type: "xlsx", title: BOOKS_PACK_TITLE, sheets }];
}
