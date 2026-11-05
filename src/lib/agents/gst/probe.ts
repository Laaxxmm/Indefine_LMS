// Accuracy-harness input-sensitivity probe (AgentDefinition.probeMutation). Returns a COPY of the
// gathered files with one material value changed, so the harness can prove figures follow input:
//
//   1. sales register is CSV  → + ₹1 on the taxable value of the first line with an amount
//                                (3.1(a) / 3.1(c) taxable value changes);
//   2. otherwise              → profile.json expectedFilingDate one day later (or set to 31 Dec 2099
//                                when absent): days late / interest / late fee change.
// The XLSX branch is the fallback because the framework calls this synchronously and the XLSX
// reader is asynchronous. Never touches `files` in place.
import type { InputFile } from "@/lib/agents/core/runner";
import { REGISTER_FIELDS, mapColumns } from "./columns";
import { addDays, parseAmount, parseDay, plainRupees } from "./money";
import { registerTable } from "./registers";
import { parseCsv, type Cell } from "./tabular";

const cellText = (c: Cell) => (c === null ? "" : String(c));
const csvCell = (c: Cell) => {
  const s = cellText(c);
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function bumpSalesCsv(f: InputFile): InputFile | null {
  try {
    const grid = parseCsv(f.bytes.toString("utf8"));
    const t = registerTable(grid, f.name);
    const col = mapColumns(t.headers, REGISTER_FIELDS).taxable;
    if (col === undefined) return null;
    for (let i = 0; i < t.rows.length; i++) {
      const paise = parseAmount(t.rows[i][col]);
      if (paise === null) continue;
      const out = grid.map((r) => [...r]);
      out[t.rowNumbers[i] - 1][col] = plainRupees(paise + 100);
      return { ...f, bytes: Buffer.from(out.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8") };
    }
  } catch {
    return null;
  }
  return null;
}

function shiftFilingDate(f: InputFile): InputFile | null {
  try {
    const json = JSON.parse(f.bytes.toString("utf8")) as Record<string, unknown>;
    const current = typeof json.expectedFilingDate === "string" ? parseDay(json.expectedFilingDate) : null;
    json.expectedFilingDate = current ? addDays(current, 1) : "2099-12-31";
    return { ...f, bytes: Buffer.from(JSON.stringify(json, null, 2), "utf8") };
  } catch {
    return null;
  }
}

export function gstProbeMutation(files: InputFile[]): InputFile[] {
  const copy = files.map((f) => ({ ...f, bytes: Buffer.from(f.bytes) }));
  const sales = copy.find((f) => /sales|outward/i.test(f.name) && /\.csv$/i.test(f.name));
  const bumped = sales ? bumpSalesCsv(sales) : null;
  if (sales && bumped) return copy.map((f) => (f === sales ? bumped : f));
  const profile = copy.find((f) => /^(gst[-_ ]?)?profile\.json$/i.test(f.name));
  const shifted = profile ? shiftFilingDate(profile) : null;
  if (profile && shifted) return copy.map((f) => (f === profile ? shifted : f));
  return copy;
}
