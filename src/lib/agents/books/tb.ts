// Trial balance parsing (Tally / Zoho exports, CSV or XLSX) — shared by Books Close and Audit
// Assist. Accepted layouts, found by header aliases (or column-map.json):
//   Ledger | Group | Debit | Credit                (Tally "Closing Balance" Dr/Cr columns, Zoho Net Debit/Net Credit)
//   Ledger | Group | Closing Balance               (signed, or "1,000.00 Dr" / "500.00 Cr")
// Rows without a ledger name, without any amount (group headings), or named Total / Grand Total
// are skipped; rows whose amounts cannot be read are skipped and reported as issues.
import { cell, locateColumns, nameKey, parseAmountPaise, type Cells, type ColumnAliases, type ParseIssue } from "./table";

export type TbRow = {
  /** 1-based row number in the source file. */
  row: number;
  ledger: string;
  group: string;
  debitPaise: number;
  creditPaise: number;
};
export type TbData = { file: string; rows: TbRow[] };

export type TbField = "ledger" | "group" | "debit" | "credit" | "balance";

export const TB_ALIASES: ColumnAliases<TbField> = {
  ledger: ["ledger", "ledger name", "account", "account name", "particulars", "name", "account head", "head"],
  group: ["group", "under", "parent", "primary group", "account group", "group name", "account type", "type"],
  debit: ["debit", "dr", "closing debit", "net debit", "debit balance", "debit amount", "closing balance dr", "dr amount"],
  credit: ["credit", "cr", "closing credit", "net credit", "credit balance", "credit amount", "closing balance cr", "cr amount"],
  balance: ["closing balance", "balance", "net balance", "closing", "amount"],
};

const SKIP_LEDGER = /^(grand\s+)?totals?$|^total\s+(debit|credit)s?$/i;

export function parseTb(file: string, rows: Cells, override: Partial<Record<TbField, string>> = {}): { tb: TbData | null; issues: ParseIssue[] } {
  const loc = locateColumns(rows, TB_ALIASES, ["ledger", "debit|balance"], override);
  if (!loc) return { tb: null, issues: [{ file, row: 0, message: "no header row with a ledger column and Debit/Credit or Closing Balance columns" }] };
  const c = loc.columns;
  const out: TbRow[] = [];
  const issues: ParseIssue[] = [];
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const ledger = cell(row, c.ledger).replace(/\s+/g, " ");
    if (!ledger || SKIP_LEDGER.test(ledger)) continue;
    const rawDr = cell(row, c.debit);
    const rawCr = cell(row, c.credit);
    const rawBal = cell(row, c.balance);
    if (!rawDr && !rawCr && !rawBal) continue; // group heading
    let debitPaise = 0;
    let creditPaise = 0;
    let bad: string | null = null;
    if (c.debit !== undefined || c.credit !== undefined) {
      const dr = parseAmountPaise(rawDr);
      const cr = parseAmountPaise(rawCr);
      if (!dr.ok) bad = dr.reason;
      else if (!cr.ok) bad = cr.reason;
      else {
        // A negative in the Debit column is a credit (and vice versa).
        debitPaise = Math.max(dr.paise, 0) + Math.max(-cr.paise, 0);
        creditPaise = Math.max(cr.paise, 0) + Math.max(-dr.paise, 0);
      }
    } else {
      const bal = parseAmountPaise(rawBal);
      if (!bal.ok) bad = bal.reason;
      else {
        debitPaise = Math.max(bal.paise, 0);
        creditPaise = Math.max(-bal.paise, 0);
      }
    }
    if (bad) {
      issues.push({ file, row: r + 1, message: `ledger "${ledger}": ${bad}` });
      continue;
    }
    out.push({ row: r + 1, ledger, group: cell(row, c.group).replace(/\s+/g, " "), debitPaise, creditPaise });
  }
  return { tb: { file, rows: out }, issues };
}

export type TbTotals = { debitPaise: number; creditPaise: number; differencePaise: number };

export function tbTotals(tb: TbData): TbTotals {
  let debitPaise = 0;
  let creditPaise = 0;
  for (const r of tb.rows) {
    debitPaise += r.debitPaise;
    creditPaise += r.creditPaise;
  }
  return { debitPaise, creditPaise, differencePaise: debitPaise - creditPaise };
}

/** Net debit (positive) or credit (negative) of a row. */
export const netPaise = (r: Pick<TbRow, "debitPaise" | "creditPaise">) => r.debitPaise - r.creditPaise;

/** Ledger name → net paise (case-insensitive name key; repeated names add up). */
export function netByLedger(tb: TbData): Map<string, { ledger: string; group: string; netPaise: number; row: number }> {
  const m = new Map<string, { ledger: string; group: string; netPaise: number; row: number }>();
  for (const r of tb.rows) {
    const k = nameKey(r.ledger);
    const prev = m.get(k);
    if (prev) prev.netPaise += netPaise(r);
    else m.set(k, { ledger: r.ledger, group: r.group, netPaise: netPaise(r), row: r.row });
  }
  return m;
}

/** Rows whose ledger name or group matches any pattern (case-insensitive regex sources). */
export function matchRows(tb: TbData, patterns: { ledger?: string[]; group?: string[] }): TbRow[] {
  const lr = (patterns.ledger ?? []).map((p) => new RegExp(p, "i"));
  const gr = (patterns.group ?? []).map((p) => new RegExp(p, "i"));
  return tb.rows.filter((r) => lr.some((re) => re.test(r.ledger)) || gr.some((re) => re.test(r.group)));
}
