// Bank statement + bank ledger parsing and the deterministic bank reconciliation.
//
// Sign convention: every line carries a signed amount from the bank account's point of view —
// money in is positive (statement deposit / ledger debit), money out is negative (statement
// withdrawal / ledger credit). A row whose narration reads "opening balance" / "b/f" is the
// opening balance, not a transaction.
//
// Cr / Dr markers follow each side's own wording (IN_MARKER):
//   statement (the bank's books, written from the customer's side): Cr = money in / in credit = +,
//     Dr = money out / overdrawn = −;
//   ledger (the firm's books, the bank account as an asset): Dr = increase = +, Cr = decrease = −.
// A signed cell (an Amount column, a Balance column) takes its direction from the marker; an
// unmarked one is read as written (minus or parentheses = negative); a minus sign that agrees with
// the marker is redundant, one that contradicts it is an issue (signedCell). In a two-column
// layout (Withdrawal / Deposit, Debit / Credit) the column gives the direction: a marker that agrees
// with its column is redundant and never flips the sign a second time; a marker that contradicts
// its column ("Cr" in the ledger's Debit column) is an issue and the row is not read (columnCell).
//
// MATCHING ALGORITHM (documented; deterministic for the same input order):
//   0. Lines are taken in (date, file row) order on both sides. References are normalised:
//      upper case, letters and digits only, leading zeros dropped ("CHQ 000123" → "CHQ123";
//      "000123" → "123"). Empty reference = none.
//   1. Reference pass — for each statement line, candidates are unmatched ledger lines with the
//      SAME signed amount (paise), the SAME normalised reference, and |date gap| ≤ refWindowDays.
//      The candidate with the smallest |date gap| wins; ties go to the earlier ledger line.
//   2. Amount + date pass — for each still-unmatched statement line, candidates are unmatched
//      ledger lines with the same signed amount and |date gap| ≤ windowDays whose references do
//      not conflict (a conflict = both have a reference and they differ). Smallest gap, then
//      earlier ledger line, wins.
//   3. Everything left is a reconciling item. For each unmatched statement line, unmatched ledger
//      lines with the same amount but outside the window (or in a different calendar month) are
//      listed as "amount-only" candidates — never matched automatically; a person decides
//      (wrong-period posting is the usual cause).
//   4. Duplicates: two or more lines on the same side with the same date, amount, reference and
//      narration are reported as possible duplicate entries (the extra copy stays unmatched).
// The reconciliation statement is the classic BRS: balance per books, plus cheques issued but not
// presented, less deposits not yet credited, plus bank credits not in books, less bank debits not
// in books = adjusted balance; difference = balance per bank − adjusted balance. Because matched
// pairs have equal amounts, the difference equals (statement opening − ledger opening): a non-zero
// difference means the two opening balances do not agree (missing brought-forward items).
import { BANK_MATCH } from "./config";
import { cell, daysBetween, locateColumns, parseAmountPaise, parseDay, type AmountParse, type Cells, type ColumnAliases, type ParseIssue } from "./table";

export type BankLine = {
  /** "S3" (statement) / "L7" (ledger): side + 1-based position among parsed lines. */
  id: string;
  row: number;
  date: string;
  narration: string;
  ref: string;
  amountPaise: number;
};
export type BankData = { file: string; lines: BankLine[]; openingPaise: number | null };

export type BankField = "date" | "narration" | "ref" | "out" | "in" | "amount" | "balance";

/** Statement: Withdrawal/Debit = money out; Deposit/Credit = money in. */
export const STATEMENT_ALIASES: ColumnAliases<BankField> = {
  date: ["date", "txn date", "transaction date", "value date", "posting date", "tran date"],
  narration: ["narration", "description", "particulars", "remarks", "transaction details", "details", "transaction remarks"],
  ref: ["ref", "reference", "ref no", "reference no", "chq ref no", "chq no", "cheque no", "cheque number", "utr", "utr no", "instrument no", "transaction id"],
  out: ["withdrawal", "withdrawals", "withdrawal amt", "withdrawal amount", "debit", "debit amount", "dr", "paid out"],
  in: ["deposit", "deposits", "deposit amt", "deposit amount", "credit", "credit amount", "cr", "paid in"],
  amount: ["amount", "txn amount", "transaction amount"],
  balance: ["balance", "closing balance", "running balance", "available balance"],
};

/** Ledger (books): Debit = money in (receipt); Credit = money out (payment). */
export const LEDGER_ALIASES: ColumnAliases<BankField> = {
  date: ["date", "voucher date", "vch date", "txn date"],
  narration: ["particulars", "narration", "description", "account", "remarks", "details"],
  ref: ["ref", "reference", "ref no", "cheque no", "chq no", "instrument no", "utr", "vch no", "voucher no", "voucher number"],
  in: ["debit", "dr", "receipts", "receipt", "debit amount"],
  out: ["credit", "cr", "payments", "payment", "credit amount"],
  amount: ["amount"],
  balance: ["balance", "closing balance", "running balance"],
};

const OPENING = /opening\s+balance|^b\/?f$|brought\s+forward|balance\s+b\/?f/i;
const CLOSING = /closing\s+balance|^c\/?f$|carried\s+forward|^total$|^grand\s+total$/i;

/** The marker that means money in (+) on each side: the statement's Cr, the ledger's Dr. */
export const IN_MARKER = { S: "cr", L: "dr" } as const;

/** A cell read: `conflict` marks a Cr / Dr marker that contradicts its column or the cell's own sign. */
type Conflict = { ok: false; reason: string; conflict: true };
export type CellParse = AmountParse | Conflict;
const isConflict = (p: CellParse): p is Conflict => !p.ok && "conflict" in p;

/** Split a trailing (or leading) Dr / Cr marker off a cell, the way parseAmountPaise detects it. */
function splitMarker(text: string): { marker: "dr" | "cr" | null; rest: string } {
  const s = text.trim();
  const m = /\s*(dr|cr)\.?$/i.exec(s) ?? /^(dr|cr)\.?\s*/i.exec(s);
  return m ? { marker: m[1].toLowerCase() as "dr" | "cr", rest: s.replace(m[0], "").trim() } : { marker: null, rest: s };
}

/**
 * A signed cell — the Amount column, the Balance column, an opening row's Amount — in the side's
 * own wording (IN_MARKER): statement "1,000.00 Cr" = +1,000 (money in / in credit), "1,000.00 Dr" =
 * −1,000 (money out / overdrawn); ledger "Dr" +, "Cr" −. Unmarked: as written. A minus sign (or
 * parentheses) that agrees with the marker is redundant ("-500.00 Cr" in the ledger = −500); one
 * that contradicts it is a conflict.
 */
export function signedCell(side: "S" | "L", text: string): CellParse {
  const { marker, rest } = splitMarker(text);
  const p = parseAmountPaise(rest);
  if (!p.ok || !marker || p.paise === 0) return p;
  const plus = marker === IN_MARKER[side];
  if (plus && p.paise < 0) return { ok: false, conflict: true, reason: `"${text.trim()}": a minus sign with "${marker === "cr" ? "Cr" : "Dr"}" contradicts the marker (${side === "S" ? "statement: Cr = money in" : "books: Dr = increase"})` };
  return { ok: true, paise: plus ? p.paise : -Math.abs(p.paise) };
}

/**
 * A Withdrawal / Deposit (statement) or Debit / Credit (ledger) cell: the column gives the
 * direction, so the value is returned as written (a minus is a reversal within the column). A
 * marker that agrees with the column — Cr in the statement's Deposit column, Dr in its Withdrawal
 * column; Dr in the ledger's Debit column, Cr in its Credit column — is redundant and ignored (it
 * must not flip the sign a second time). A marker that contradicts the column is a conflict.
 */
export function columnCell(side: "S" | "L", column: "in" | "out", text: string, header: string = column): CellParse {
  const { marker, rest } = splitMarker(text);
  const p = parseAmountPaise(rest);
  if (!p.ok || !marker || p.paise === 0) return p;
  if ((marker === IN_MARKER[side]) !== (column === "in"))
    return { ok: false, conflict: true, reason: `"${text.trim()}": a "${marker === "cr" ? "Cr" : "Dr"}" marker in the ${header} column contradicts the column` };
  return p;
}

export function parseBank(
  side: "S" | "L",
  file: string,
  rows: Cells,
  aliases: ColumnAliases<BankField>,
  override: Partial<Record<BankField, string>> = {},
): { data: BankData | null; issues: ParseIssue[] } {
  const loc = locateColumns(rows, aliases, ["date", "out|in|amount"], override);
  if (!loc) return { data: null, issues: [{ file, row: 0, message: "no header row with a Date column and Withdrawal/Deposit (or Amount) columns" }] };
  const c = loc.columns;
  const header = (i: number | undefined, fallback: string) => (i === undefined ? fallback : `"${rows[loc.headerRow][i] ?? fallback}"`);
  const lines: BankLine[] = [];
  const issues: ParseIssue[] = [];
  let openingPaise: number | null = null;
  let firstBalance: { balance: number; amount: number } | null = null;
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((x) => (x ?? "").trim() === "")) continue;
    const narration = cell(row, c.narration).replace(/\s+/g, " ");
    // Every amount cell in the side's own Cr / Dr wording (see the header): two-column cells by
    // their column, the signed Amount and Balance cells by their marker.
    const inn = columnCell(side, "in", cell(row, c.in), header(c.in, "in"));
    const out = columnCell(side, "out", cell(row, c.out), header(c.out, "out"));
    const amt = signedCell(side, cell(row, c.amount));
    const bal = signedCell(side, cell(row, c.balance));
    // A marker that contradicts its column (or its own sign) cannot be read safely: the row's amount
    // is not read and a person checks the export. A contradictory balance only loses the balance.
    if (OPENING.test(narration)) {
      // Opening row: the amount sits in the in/out/amount column, or in the balance column. On a
      // statement every cell of this row is a balance: the signed Amount cell reads like the
      // balance column, a Withdrawal / Deposit cell takes its sign from the column.
      const conflict = [inn, out, amt].find(isConflict);
      if (conflict) {
        issues.push({ file, row: r + 1, message: conflict.reason });
        continue;
      }
      if (isConflict(bal)) issues.push({ file, row: r + 1, message: bal.reason });
      const v = inn.ok && out.ok && amt.ok ? inn.paise - out.paise + amt.paise : 0;
      if (v !== 0 || !isConflict(bal)) openingPaise = v !== 0 ? v : bal.ok ? bal.paise : 0;
      continue;
    }
    if (CLOSING.test(narration)) continue;
    const date = parseDay(cell(row, c.date));
    if (!date) {
      issues.push({ file, row: r + 1, message: `unreadable date "${cell(row, c.date)}"` });
      continue;
    }
    const bad = [inn, out, amt].find((p) => !p.ok);
    if (bad && !bad.ok) {
      issues.push({ file, row: r + 1, message: bad.reason });
      continue;
    }
    if (isConflict(bal)) issues.push({ file, row: r + 1, message: bal.reason });
    const amountPaise = (inn as { paise: number }).paise - (out as { paise: number }).paise + (amt as { paise: number }).paise;
    if (amountPaise === 0) {
      issues.push({ file, row: r + 1, message: "no amount on the line" });
      continue;
    }
    if (!firstBalance && c.balance !== undefined && cell(row, c.balance) && bal.ok) firstBalance = { balance: bal.paise, amount: amountPaise };
    lines.push({ id: `${side}${lines.length + 1}`, row: r + 1, date, narration, ref: cell(row, c.ref), amountPaise });
  }
  if (openingPaise === null && firstBalance && side === "S") openingPaise = firstBalance.balance - firstBalance.amount;
  return { data: { file, lines, openingPaise }, issues };
}

// ------------------------------------------------------------------ matching

export const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "").replace(/(?<=[A-Z])0+(?=\d)/g, "");

export type MatchPair = { statementId: string; ledgerId: string; method: "reference" | "amount-date"; gapDays: number };
export type AmountOnly = { statementId: string; ledgerIds: string[] };
export type DuplicateGroup = { side: "statement" | "ledger"; ids: string[] };

export type Reconciliation = {
  pairs: MatchPair[];
  unmatchedStatement: BankLine[];
  unmatchedLedger: BankLine[];
  amountOnly: AmountOnly[];
  duplicates: DuplicateGroup[];
  summary: {
    statementOpeningPaise: number | null;
    ledgerOpeningPaise: number | null;
    balancePerBankPaise: number | null;
    balancePerBooksPaise: number | null;
    /** Ledger payments not in the statement (cheques issued, not presented). */
    unpresentedPaise: number;
    /** Ledger receipts not in the statement (deposits not yet credited). */
    unclearedPaise: number;
    /** Statement credits not in the ledger. */
    bankCreditsNotInBooksPaise: number;
    /** Statement debits not in the ledger (positive figure). */
    bankDebitsNotInBooksPaise: number;
    adjustedBooksPaise: number | null;
    differencePaise: number | null;
  };
};

const byDate = (a: BankLine, b: BankLine) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.row - b.row);

export function reconcile(statement: BankData, ledger: BankData, opts: { windowDays?: number; refWindowDays?: number } = {}): Reconciliation {
  const windowDays = opts.windowDays ?? BANK_MATCH.windowDays;
  const refWindowDays = opts.refWindowDays ?? BANK_MATCH.refWindowDays;
  const S = [...statement.lines].sort(byDate);
  const L = [...ledger.lines].sort(byDate);
  const usedL = new Set<string>();
  const matchedS = new Map<string, MatchPair>();

  const pick = (s: BankLine, ok: (l: BankLine, gap: number) => boolean): { l: BankLine; gap: number } | null => {
    let best: { l: BankLine; gap: number } | null = null;
    for (const l of L) {
      if (usedL.has(l.id) || l.amountPaise !== s.amountPaise) continue;
      const gap = Math.abs(daysBetween(l.date, s.date));
      if (!ok(l, gap)) continue;
      if (!best || gap < best.gap) best = { l, gap }; // L is in order, so the first of equal gaps stays
    }
    return best;
  };

  for (const s of S) {
    const r = normRef(s.ref);
    if (!r) continue;
    const hit = pick(s, (l, gap) => normRef(l.ref) === r && gap <= refWindowDays);
    if (hit) {
      usedL.add(hit.l.id);
      matchedS.set(s.id, { statementId: s.id, ledgerId: hit.l.id, method: "reference", gapDays: hit.gap });
    }
  }
  for (const s of S) {
    if (matchedS.has(s.id)) continue;
    const r = normRef(s.ref);
    const hit = pick(s, (l, gap) => {
      const lr = normRef(l.ref);
      return gap <= windowDays && !(r && lr && r !== lr);
    });
    if (hit) {
      usedL.add(hit.l.id);
      matchedS.set(s.id, { statementId: s.id, ledgerId: hit.l.id, method: "amount-date", gapDays: hit.gap });
    }
  }

  const unmatchedStatement = S.filter((s) => !matchedS.has(s.id));
  const unmatchedLedger = L.filter((l) => !usedL.has(l.id));
  const amountOnly: AmountOnly[] = [];
  for (const s of unmatchedStatement) {
    const ids = unmatchedLedger.filter((l) => l.amountPaise === s.amountPaise).map((l) => l.id);
    if (ids.length) amountOnly.push({ statementId: s.id, ledgerIds: ids });
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [side, lines] of [["statement", S], ["ledger", L]] as const) {
    const groups = new Map<string, string[]>();
    for (const x of lines) {
      const k = [x.date, x.amountPaise, normRef(x.ref), x.narration.toLowerCase()].join("\u0000");
      groups.set(k, [...(groups.get(k) ?? []), x.id]);
    }
    for (const ids of groups.values()) if (ids.length > 1) duplicates.push({ side, ids });
  }

  const sum = (xs: BankLine[], f: (x: BankLine) => boolean) => xs.filter(f).reduce((a, x) => a + Math.abs(x.amountPaise), 0);
  const total = (xs: BankLine[]) => xs.reduce((a, x) => a + x.amountPaise, 0);
  const unpresentedPaise = sum(unmatchedLedger, (l) => l.amountPaise < 0);
  const unclearedPaise = sum(unmatchedLedger, (l) => l.amountPaise > 0);
  const bankCreditsNotInBooksPaise = sum(unmatchedStatement, (s) => s.amountPaise > 0);
  const bankDebitsNotInBooksPaise = sum(unmatchedStatement, (s) => s.amountPaise < 0);
  const balancePerBankPaise = statement.openingPaise === null ? null : statement.openingPaise + total(statement.lines);
  const balancePerBooksPaise = ledger.openingPaise === null ? null : ledger.openingPaise + total(ledger.lines);
  const adjustedBooksPaise =
    balancePerBooksPaise === null ? null : balancePerBooksPaise + unpresentedPaise - unclearedPaise + bankCreditsNotInBooksPaise - bankDebitsNotInBooksPaise;
  const differencePaise = balancePerBankPaise === null || adjustedBooksPaise === null ? null : balancePerBankPaise - adjustedBooksPaise;

  return {
    pairs: S.filter((s) => matchedS.has(s.id)).map((s) => matchedS.get(s.id)!),
    unmatchedStatement,
    unmatchedLedger,
    amountOnly,
    duplicates,
    summary: {
      statementOpeningPaise: statement.openingPaise,
      ledgerOpeningPaise: ledger.openingPaise,
      balancePerBankPaise,
      balancePerBooksPaise,
      unpresentedPaise,
      unclearedPaise,
      bankCreditsNotInBooksPaise,
      bankDebitsNotInBooksPaise,
      adjustedBooksPaise,
      differencePaise,
    },
  };
}
