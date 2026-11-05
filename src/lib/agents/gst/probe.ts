// Accuracy-harness input-sensitivity probe (AgentDefinition.probeMutation). Returns a COPY of the
// gathered files with one material value changed, so the harness can prove figures follow input:
//
//   1. sales register is CSV  → + ₹1 on the taxable value of the first line with an amount
//                                (3.1(a) / 3.1(c) taxable value changes);
//   2. otherwise              → profile.json expectedFilingDate one day later (or set to 31 Dec 2099
//                                when absent): days late / interest / late fee change.
// The XLSX branch is the fallback because the framework calls this synchronously and the XLSX
// reader is asynchronous. Never touches `files` in place.
import { bumpAmountText, bumpCellAmount, mutateCsvCell, mutateJsonInput, mutateXlsxColumn } from "@/lib/agents/core/probes";
import type { InputFile, InputProbe } from "@/lib/agents/core/runner";
import { GSTR2B_FIELDS, REGISTER_FIELDS, mapColumns } from "./columns";
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

// ------------------------------------------------------------------ per-input probes (audit M2)

const nonZero = (delta: number) => (v: string) => (v.trim() && !/^[-0.,\s₹]+$/.test(v) ? bumpAmountText(v, delta) : null);
const TAX_COLUMNS = [...REGISTER_FIELDS.igst, ...REGISTER_FIELDS.cgst];


/** A register (CSV or XLSX, matched by name) with one amount in one of `columns` changed by `delta` rupees. */
async function bumpRegister(files: InputFile[], role: RegExp, columns: readonly string[], delta: number): Promise<InputFile[]> {
  const csv = mutateCsvCell(files, new RegExp(`(?:${role.source}).*\\.csv$`, "i"), [...columns], nonZero(delta));
  if (csv !== files) return csv;
  return mutateXlsxColumn(files, new RegExp(`(?:${role.source}).*\\.xlsx$`, "i"), columns, (v) => bumpCellAmount(v, delta));
}

const flipAvailability = (v: unknown): string | undefined => {
  const s = String(v ?? "").trim();
  if (/^(y|yes)$/i.test(s)) return /^yes$/i.test(s) ? "No" : "N";
  if (/^(n|no)$/i.test(s)) return /^no$/i.test(s) ? "Yes" : "Y";
  return undefined;
};

/** 2B: the first document's ITC availability flipped (JSON `itcavl`, Excel "ITC Availability"). */
async function flip2bAvailability(files: InputFile[]): Promise<InputFile[]> {
  const viaJson = mutateJsonInput(files, /2b.*\.json$/i, (doc) => {
    const b2b = ((doc.data as { docdata?: { b2b?: { inv?: Record<string, unknown>[] }[] } } | undefined)?.docdata?.b2b ?? []) as { inv?: Record<string, unknown>[] }[];
    for (const s of b2b)
      for (const inv of s.inv ?? []) {
        const next = flipAvailability(inv.itcavl);
        if (next !== undefined) {
          inv.itcavl = next;
          return true;
        }
      }
    return false;
  });
  if (viaJson !== files) return viaJson;
  return mutateXlsxColumn(files, /2b.*\.xlsx$/i, GSTR2B_FIELDS.itcAvailable, flipAvailability);
}

/**
 * One probe per GST input file kind: each changes ONE material value in that file and the
 * harness requires a figure or flag to move. profile.json: the expected filing date moved to 31
 * Dec 2099 (late fee / interest). Sales register: the first taxable value + ₹1 (outward tax base).
 * Purchase register: the first IGST / CGST amount + ₹10 (ITC; beyond the ₹1 2B tolerance).
 * GSTR-2B: the first document's ITC availability flipped. Payables ageing (optional): the first
 * IGST / CGST + ₹10 (rule 37 reversal).
 */
export const GST_INPUT_PROBES: readonly InputProbe[] = Object.freeze([
  {
    input: "profile.json",
    mutate: (files: InputFile[]) =>
      mutateJsonInput(files, /^(gst[-_ ]?)?profile\.json$/i, (p) => {
        p.expectedFilingDate = p.expectedFilingDate === "2099-12-31" ? "2099-12-30" : "2099-12-31";
        return true;
      }),
  },
  { input: "sales register", mutate: (files: InputFile[]) => bumpRegister(files, /sales|outward/, REGISTER_FIELDS.taxable, 1) },
  { input: "purchase register", mutate: (files: InputFile[]) => bumpRegister(files, /purchase|inward/, TAX_COLUMNS, 10) },
  { input: "GSTR-2B", mutate: flip2bAvailability },
  { input: "payables ageing", mutate: (files: InputFile[]) => bumpRegister(files, /payable/, TAX_COLUMNS, 10) },
]);

/** Inputs GST Prep's input schema requires (names as in GST_INPUT_PROBES). */
export const GST_REQUIRED_INPUTS = ["profile.json", "sales register", "purchase register", "GSTR-2B"] as const;
