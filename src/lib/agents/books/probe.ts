// Input-sensitivity probe for the accuracy harness (AgentDefinition.probeMutation): returns a COPY
// of the files with one material amount raised by ₹1 — the first non-zero amount of the first
// eligible CSV file, found with the same header aliases (and column-map.json overrides) the
// parsers use. The harness re-runs the agent on the copy and requires a figure or flag to change.
// Synchronous by contract, so XLSX files are skipped (the next eligible CSV is used instead).
import type { InputFile } from "@/lib/agents/core/runner";
import { LEDGER_ALIASES, STATEMENT_ALIASES } from "./bank";
import { GST_ALIASES, TDS_DEDUCTED_ALIASES } from "./statutory";
import { locateColumns, parseAmountPaise, parseCsv, type ColumnAliases } from "./table";
import { TB_ALIASES } from "./tb";

export type ProbeTarget = { matches: (name: string) => boolean; mapKey: string; aliases: ColumnAliases<string>; required: string[]; amountFields: string[] };

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const paiseText = (p: number) => `${p < 0 ? "-" : ""}${Math.floor(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, "0")}`;

function columnMap(files: InputFile[]): Record<string, Record<string, string>> {
  const f = files.find((x) => /^column[-_ ]?map\.json$/i.test(x.name));
  if (!f) return {};
  try {
    const j = JSON.parse(f.bytes.toString("utf8")) as unknown;
    return j && typeof j === "object" ? (j as Record<string, Record<string, string>>) : {};
  } catch {
    return {};
  }
}

/** Raise the first non-zero amount of the first matching CSV by `deltaPaise`; files unchanged when nothing qualifies. */
export function probeCsvAmount(files: InputFile[], targets: ProbeTarget[], deltaPaise = 100): InputFile[] {
  const maps = columnMap(files);
  for (const t of targets) {
    for (const f of files) {
      if (!/\.csv$/i.test(f.name) || !t.matches(f.name)) continue;
      const rows = parseCsv(f.bytes.toString("utf8"));
      const loc = locateColumns(rows, t.aliases, t.required, maps[t.mapKey] ?? {});
      if (!loc) continue;
      for (let r = loc.headerRow + 1; r < rows.length; r++) {
        for (const field of t.amountFields) {
          const c = loc.columns[field];
          if (c === undefined) continue;
          const p = parseAmountPaise(rows[r][c] ?? "");
          if (!p.ok || p.paise === 0 || /total|opening|closing/i.test(rows[r].join(" "))) continue;
          const next = rows.map((row) => [...row]);
          next[r][c] = paiseText(p.paise + (p.paise > 0 ? deltaPaise : -deltaPaise));
          const bytes = Buffer.from(next.map((row) => row.map(csvCell).join(",")).join("\n") + "\n", "utf8");
          return files.map((x) => (x === f ? { ...x, bytes } : x));
        }
      }
    }
  }
  return files;
}

const named = (re: RegExp, not?: RegExp) => (name: string) => re.test(name.toLowerCase()) && !(not && not.test(name.toLowerCase()));
const TB_NAME = /trial[-_ ]?balance|(^|[^a-z])tb([^a-z]|$)/;
const PRIOR = /prior|previous|prev|last[-_ ]?(month|year)|(^|[^a-z])py([^a-z]|$)/;

export const TB_PROBE: ProbeTarget = { matches: named(TB_NAME, PRIOR), mapKey: "tb", aliases: TB_ALIASES, required: ["ledger", "debit|balance"], amountFields: ["debit", "credit", "balance"] };

export const BOOKS_PROBE_TARGETS: ProbeTarget[] = [
  TB_PROBE,
  { matches: named(/statement|stmt/), mapKey: "bank-statement", aliases: STATEMENT_ALIASES, required: ["date", "out|in|amount"], amountFields: ["out", "in", "amount"] },
  { matches: named(/bank[-_ ]?(ledger|book)|bankbook/), mapKey: "bank-ledger", aliases: LEDGER_ALIASES, required: ["date", "in|out|amount"], amountFields: ["in", "out", "amount"] },
  { matches: named(/tds/, /challan|deposit|paid/), mapKey: "tds-deducted", aliases: TDS_DEDUCTED_ALIASES, required: ["section", "date|month", "amount"], amountFields: ["amount"] },
  { matches: named(/gst/), mapKey: "gst-ledger", aliases: GST_ALIASES, required: ["head", "amount"], amountFields: ["amount"] },
];
