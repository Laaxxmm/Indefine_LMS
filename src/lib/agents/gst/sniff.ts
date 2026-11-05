// Wrong-department input fails closed (ADR-008 §7). Before any model call, each register file is
// sniffed by its headings: a GST register has GST columns (GSTIN, taxable value, IGST/CGST/SGST,
// HSN). A trial balance, bank statement, Form 26AS/AIS or ROC document stops the run with a
// message naming the agent that handles it. Deterministic; no model involved.
import { headerKey, type Grid } from "./tabular";

const GST_MARKS = ["gstin", "gstin uin", "gst identification number gstin", "vendor gstin", "customer gstin", "taxable value", "item total", "igst", "cgst", "sgst", "sgst utgst", "integrated tax", "central tax", "hsn sac", "hsn", "place of supply"];

type Sign = { what: string; agent: string; marks: string[]; need: number };
const SIGNS: Sign[] = [
  { what: "a Form 26AS / AIS statement", agent: "Tax Prep", marks: ["tan of deductor", "name of deductor", "section", "tds deposited", "amount paid credited", "tax deducted", "information category", "information source"], need: 2 },
  { what: "a bank statement", agent: "Books Close (bank reconciliation)", marks: ["withdrawal", "withdrawals", "deposit", "deposits", "cheque no", "chq no", "value date", "closing balance", "balance", "transaction remarks"], need: 2 },
  { what: "a trial balance or ledger", agent: "Books Close", marks: ["debit", "credit", "opening balance", "closing balance", "dr", "cr", "group", "ledger name"], need: 2 },
  { what: "an MCA / ROC document", agent: "ROC Prep", marks: ["din", "cin", "director name", "designation", "date of appointment", "shareholding", "no of shares", "paid up capital"], need: 2 },
];

/** null when the grid looks like a GST register; else the fail-closed message. */
export function sniffRegister(grid: Grid, file: string, role: "sales" | "purchases" | "payables" | "einvoice"): string | null {
  const keys = new Set(grid.slice(0, 20).flatMap((r) => r.map(headerKey)).filter(Boolean));
  if (role === "einvoice") return keys.has("irn") || keys.has("e invoice irn") ? null : `${file} has no IRN column; it is not an e-invoice register`;
  if (GST_MARKS.some((m) => keys.has(m))) return null;
  const sign = SIGNS.find((s) => s.marks.filter((m) => keys.has(m)).length >= s.need);
  const label = role === "purchases" ? "purchase register" : role === "sales" ? "sales register" : "payables ageing";
  if (sign) return `${file} looks like ${sign.what}, not a GST ${label}. Use the ${sign.agent} agent for it; GST Prep needs the sales and purchase registers with GST columns and the GSTR-2B.`;
  return `${file} has no GST columns (GSTIN, taxable value, IGST/CGST/SGST, HSN); it is not a GST ${label}. GST Prep stops here rather than guess.`;
}

/** Hint for files that were not recognised at all (named like another department's input). */
export function agentHintForName(name: string): string | null {
  const n = name.toLowerCase();
  if (/trial[-_ ]?balance|\btb\b|ledger/.test(n)) return `${name} looks like a trial balance or ledger: that is Books Close's input`;
  if (/bank|statement/.test(n)) return `${name} looks like a bank statement: that is Books Close's input`;
  if (/26as|\bais\b|\btis\b|itr|form16/.test(n)) return `${name} looks like an income-tax document: that is Tax Prep's input`;
  if (/aoc|mgt|dir-?3|roc|mca/.test(n)) return `${name} looks like an ROC document: that is ROC Prep's input`;
  return null;
}
