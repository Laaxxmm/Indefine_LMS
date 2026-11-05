// Books Close agent (Phase 7): month-end pack from a trial balance export, bank statement + bank
// ledger, TDS deducted vs deposited, GST ledger vs filed return and optional schedules.
//
//   inputs   gathered files → classified by name (inputs.ts); a trial balance is required
//   extract  deterministic parse (CSV/XLSX, tolerant headers) + ONE model call: expense-head
//            suggestions for bank debits not in the books (router fast tier, anonymised)
//   compute  integer-paise figures (TB totals, matching counts, TDS, GST, suspense, cash)
//   rules    rules.ts (block / warn / info), thresholds as SOP-pack data with verify notes
//   pack     pack.ts → "Month-end pack" XLSX
// The agent never posts entries, never files anything and never computes with the model.
import type { AgentScope } from "@/lib/agents/core/guardrails/scope";
import { bumpCellAmount, mutateXlsxColumn } from "@/lib/agents/core/probes";
import type { AgentDefinition, InputFile, InputProbe } from "@/lib/agents/core/runner";
import { cashRows, classificationCandidates, normalizeExtract, suspenseRows, type BooksExtract } from "./analysis";
import { reconcile } from "./bank";
import { suggestClassifications } from "./classify";
import { BANK_MATCH } from "./config";
import { sniffDepartment } from "./department";
import { booksInputSchema, classifyBooksFile, parseBooksFiles, type BooksInput } from "./inputs";
import { booksPack } from "./pack";
import { BOOKS_PROBE_TARGETS, TB_PROBE, probeCsvAmount } from "./probe";
import { BOOKS_CHECKLIST, BOOKS_KEY, booksRegistry } from "./rules";
import { gstTieOut, tdsCheck } from "./statutory";
import { BOOKS_MODEL_TASKS } from "./tasks";
import { TB_ALIASES, netPaise, tbTotals } from "./tb";

/** Year-/month-end TB workbook (not the prior-period TB), for the XLSX branch of the TB probe. */
const TB_XLSX = /^(?!.*(prior|previous|prev|last[-_ ]?(month|year))).*(trial[-_ ]?balance|(^|[^a-z])tb([^a-z]|$)).*\.xlsx$/i;

/** +₹1 on the first TB amount: CSV with the parser's aliases, else the TB workbook's first Debit / Credit / Balance cell. */
export async function probeTbAmount(files: InputFile[]): Promise<InputFile[]> {
  const csv = probeCsvAmount(files, [TB_PROBE]);
  if (csv !== files) return csv;
  return mutateXlsxColumn(files, TB_XLSX, [...TB_ALIASES.debit, ...TB_ALIASES.credit, ...TB_ALIASES.balance], (v) => bumpCellAmount(v, 1));
}

/**
 * Per-input probes (second audit, M2): +₹1 on the first amount of each input — trial balance
 * (required; CSV or XLSX), bank statement, TDS deducted ledger, GST ledger.
 */
export const BOOKS_INPUT_PROBES: readonly InputProbe[] = Object.freeze([
  { input: "trial balance", mutate: probeTbAmount },
  { input: "bank statement", mutate: (files: InputFile[]) => probeCsvAmount(files, [BOOKS_PROBE_TARGETS[1]]) },
  { input: "TDS deducted", mutate: (files: InputFile[]) => probeCsvAmount(files, [BOOKS_PROBE_TARGETS[3]]) },
  { input: "GST ledger", mutate: (files: InputFile[]) => probeCsvAmount(files, [BOOKS_PROBE_TARGETS[4]]) },
]);

/** Books Close's ADR-008 scope: its task registry, every checklist rule, the shared department sniff. */
export const BOOKS_SCOPE: AgentScope = {
  department: "Books",
  tasks: [...BOOKS_MODEL_TASKS],
  ruleIds: BOOKS_CHECKLIST.rules.map((r) => r.id),
  inputSniff: (files) => sniffDepartment(files, "Books Close", (name) => classifyBooksFile(name) === "tb"),
};

export { BOOKS_CHECKLIST, BOOKS_KEY, booksRegistry } from "./rules";
export { BOOKS_CLASSIFY_TASK } from "./classify";
export { BOOKS_MODEL_TASKS } from "./tasks";
export type { BooksExtract } from "./analysis";
export type { BooksInput } from "./inputs";

/** Integer figures (paise for amounts). Keys are present only when their input was provided. */
export function computeBooksFigures(raw: Partial<BooksExtract>): Record<string, number> {
  const e = normalizeExtract(raw);
  const f: Record<string, number> = {
    parseIssueCount: e.issues.length,
    suggestionCount: e.suggestions.filter((s) => s.status === "suggested").length,
    classificationQuestionCount: e.suggestions.filter((s) => s.status !== "suggested").length,
  };
  if (e.tb) {
    const t = tbTotals(e.tb);
    f.tbDebitPaise = t.debitPaise;
    f.tbCreditPaise = t.creditPaise;
    f.tbDifferencePaise = t.differencePaise;
    f.tbLedgerCount = e.tb.rows.length;
    f.suspensePaise = suspenseRows(e.tb).reduce((s, r) => s + Math.abs(netPaise(r)), 0);
    f.cashBalancePaise = cashRows(e.tb).reduce((s, r) => s + netPaise(r), 0);
  }
  if (e.statement && e.ledger) {
    const r = reconcile(e.statement, e.ledger, BANK_MATCH);
    f.bankMatchedCount = r.pairs.length;
    f.bankUnmatchedStatementCount = r.unmatchedStatement.length;
    f.bankUnmatchedLedgerCount = r.unmatchedLedger.length;
    f.bankAmountOnlyCount = r.amountOnly.length;
    if (r.summary.balancePerBankPaise !== null) f.balancePerBankPaise = r.summary.balancePerBankPaise;
    if (r.summary.balancePerBooksPaise !== null) f.balancePerBooksPaise = r.summary.balancePerBooksPaise;
    if (r.summary.differencePaise !== null) f.bankReconDifferencePaise = r.summary.differencePaise;
  }
  if (e.tdsDeducted && e.tdsChallans) {
    const lines = tdsCheck(e.tdsDeducted, e.tdsChallans);
    f.tdsDeductedPaise = lines.reduce((s, l) => s + l.deductedPaise, 0);
    f.tdsDepositedPaise = lines.reduce((s, l) => s + l.depositedPaise, 0);
    f.tdsShortfallPaise = lines.reduce((s, l) => s + l.shortfallPaise, 0);
  }
  if (e.gstLedger && e.gstReturn) f.gstAbsDifferencePaise = gstTieOut(e.gstLedger, e.gstReturn).reduce((s, g) => s + Math.abs(g.differencePaise), 0);
  return f;
}

export const booksAgent: AgentDefinition<BooksInput, BooksExtract> = {
  key: BOOKS_KEY,
  title: "Books Close",
  service: "Books",
  sopPackKey: BOOKS_KEY,
  modelAgent: "books",
  inputSchema: booksInputSchema,
  defaultChecklist: BOOKS_CHECKLIST,
  checklistRegistry: booksRegistry,
  /** Accuracy-harness probe: +₹1 on the first TB amount (else bank / TDS / GST CSV). */
  probeMutation: (files) => probeCsvAmount(files, BOOKS_PROBE_TARGETS),
  inputProbes: BOOKS_INPUT_PROBES,
  requiredInputs: ["trial balance"],
  scope: BOOKS_SCOPE,

  async extract({ input, notes, model }) {
    const parsed = await parseBooksFiles(input);
    const candidates = classificationCandidates(parsed.statement, parsed.ledger);
    const { suggestions, heads } = await suggestClassifications(model, candidates, parsed.tb, notes);
    return { ...parsed, suggestions, chartHeads: heads };
  },

  compute(extracted) {
    return computeBooksFigures(extracted);
  },

  deliverables({ extracted, figures, job, results }) {
    return booksPack({ extracted, figures, job, results });
  },
};
