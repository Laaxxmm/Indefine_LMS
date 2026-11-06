// Books Close inputs: which gathered file is which (by file name, as data), the optional
// column-map.json override, and the deterministic parse of every file into BooksExtract data.
// The model is used only for expense-classification suggestions (extract.ts).
import { z } from "zod";
import type { InputFile } from "@/lib/agents/core/runner";
import { LEDGER_ALIASES, STATEMENT_ALIASES, parseBank, type BankData, type BankField } from "./bank";
import { WrongDepartmentError, sniffCsv, sniffRows, wrongDepartmentMessage } from "./department";
import { parseGstSummary, parseSchedules, parseTdsChallans, parseTdsDeducted, type GstHead, type ScheduleItem, type TdsChallan, type TdsDeduction } from "./statutory";
import { readTable, type ParseIssue } from "./table";
import { parseTb, type TbData, type TbField } from "./tb";

export type BooksFileKind =
  | "column-map"
  | "tb-prior"
  | "tb"
  | "bank-statement"
  | "bank-ledger"
  | "tds-challans"
  | "tds-deducted"
  | "gst-return"
  | "gst-ledger"
  | "schedules";

/** First match wins (more specific patterns first). Matched against the lower-case file name. */
export const BOOKS_FILE_PATTERNS: [BooksFileKind, RegExp][] = [
  ["column-map", /^column[-_ ]?map\.json$/],
  ["tb-prior", /(prior|previous|prev|last[-_ ]?month).*(tb|trial)|(tb|trial).*(prior|previous|prev|last[-_ ]?month)/],
  ["tb", /trial[-_ ]?balance|(^|[^a-z])tb([^a-z]|$)/],
  ["bank-statement", /statement|stmt/],
  ["bank-ledger", /bank[-_ ]?(ledger|book)|bankbook|ledger[-_ ]?bank/],
  ["tds-challans", /challan|tds.*(deposit|paid|payment)/],
  ["tds-deducted", /tds/],
  ["gst-return", /gstr|gst.*(return|filed)/],
  ["gst-ledger", /gst/],
  ["schedules", /schedule|accrual|prepaid|fixed[-_ ]?asset/],
];

export const OPTIONAL_INPUTS: { kinds: BooksFileKind[]; label: string }[] = [
  { kinds: ["tb-prior"], label: "Prior-month trial balance (expense spike and opening-balance checks)" },
  { kinds: ["bank-statement", "bank-ledger"], label: "Bank statement and bank ledger (bank reconciliation)" },
  { kinds: ["tds-deducted", "tds-challans"], label: "TDS deducted ledger and TDS challan list" },
  { kinds: ["gst-ledger", "gst-return"], label: "GST ledger balances and filed return summary" },
  { kinds: ["schedules"], label: "Accrual / prepaid / fixed-asset schedules" },
];

export const classifyBooksFile = (name: string): BooksFileKind | null => {
  const n = name.toLowerCase();
  if (!/\.(csv|xlsx|txt|json)$/.test(n)) return null;
  for (const [kind, re] of BOOKS_FILE_PATTERNS) if (re.test(n)) return kind;
  return null;
};

export type BooksInputFile = { name: string; kind: BooksFileKind | null; bytes: Buffer };
export type BooksInput = { files: BooksInputFile[] };

const InputFileZ = z.object({ name: z.string(), source: z.string(), bytes: z.instanceof(Buffer) }).passthrough();

export const booksInputSchema = z.array(InputFileZ).transform((files, ctx): BooksInput => {
  const out = files.map((f) => ({ name: f.name, kind: classifyBooksFile(f.name), bytes: f.bytes }));
  if (!out.some((f) => f.kind === "tb")) {
    // Wrong department? Say which agent the documents belong to (ADR-008 §7), before any model call.
    for (const f of out) {
      const d = sniffCsv(f.name, f.bytes);
      if (d) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: wrongDepartmentMessage(f.name, d, "Books Close") });
        return { files: out };
      }
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A month-end trial balance export (file name containing 'trial-balance' or 'tb', CSV or XLSX) is required" });
  }
  return { files: out };
}) as unknown as z.ZodType<BooksInput, z.ZodTypeDef, InputFile[]>;

/** column-map.json: { "tb": { "ledger": "Account Head", ... }, "bank-statement": {...}, ... } */
export const ColumnMapSchema = z.record(z.record(z.string()));
export type ColumnMapFile = z.infer<typeof ColumnMapSchema>;

export type ParsedBooks = {
  files: { name: string; kind: BooksFileKind | null }[];
  tb: TbData | null;
  priorTb: TbData | null;
  statement: BankData | null;
  ledger: BankData | null;
  tdsDeducted: TdsDeduction[] | null;
  tdsChallans: TdsChallan[] | null;
  gstLedger: GstHead[] | null;
  gstReturn: GstHead[] | null;
  schedules: ScheduleItem[] | null;
  issues: ParseIssue[];
};

export async function parseBooksFiles(input: BooksInput): Promise<ParsedBooks> {
  const issues: ParseIssue[] = [];
  let map: ColumnMapFile = {};
  const mapFile = input.files.find((f) => f.kind === "column-map");
  if (mapFile) {
    try {
      const parsed = ColumnMapSchema.safeParse(JSON.parse(mapFile.bytes.toString("utf8")));
      if (parsed.success) map = parsed.data;
      else issues.push({ file: mapFile.name, row: 0, message: "column-map.json is not { kind: { field: header } }; ignored" });
    } catch {
      issues.push({ file: mapFile.name, row: 0, message: "column-map.json is not a valid .json file; ignored" });
    }
  }
  const out: ParsedBooks = {
    files: input.files.map((f) => ({ name: f.name, kind: f.kind })),
    tb: null,
    priorTb: null,
    statement: null,
    ledger: null,
    tdsDeducted: null,
    tdsChallans: null,
    gstLedger: null,
    gstReturn: null,
    schedules: null,
    issues,
  };
  // One file per kind: the first in name order (the runner gathers files in name order).
  const seen = new Set<BooksFileKind>();
  for (const f of input.files) {
    if (!f.kind || f.kind === "column-map") continue;
    if (seen.has(f.kind)) {
      issues.push({ file: f.name, row: 0, message: `a second ${f.kind} file; only the first is used` });
      continue;
    }
    seen.add(f.kind);
    const { table, issues: readIssues } = await readTable(f);
    issues.push(...readIssues);
    const o = map[f.kind] ?? {};
    const take = <T>(r: { issues: ParseIssue[] } & T) => {
      issues.push(...r.issues);
      return r;
    };
    switch (f.kind) {
      case "tb":
        out.tb = take(parseTb(f.name, table.rows, o as Partial<Record<TbField, string>>)).tb;
        if (!out.tb) {
          const d = sniffRows(table.rows);
          if (d) throw new WrongDepartmentError(f.name, d, "Books Close");
        }
        break;
      case "tb-prior":
        out.priorTb = take(parseTb(f.name, table.rows, o as Partial<Record<TbField, string>>)).tb;
        break;
      case "bank-statement":
        out.statement = take(parseBank("S", f.name, table.rows, STATEMENT_ALIASES, o as Partial<Record<BankField, string>>)).data;
        break;
      case "bank-ledger":
        out.ledger = take(parseBank("L", f.name, table.rows, LEDGER_ALIASES, o as Partial<Record<BankField, string>>)).data;
        break;
      case "tds-deducted":
        out.tdsDeducted = take(parseTdsDeducted(f.name, table.rows, o)).data;
        break;
      case "tds-challans":
        out.tdsChallans = take(parseTdsChallans(f.name, table.rows, o)).data;
        break;
      case "gst-ledger":
        out.gstLedger = take(parseGstSummary(f.name, table.rows, o)).data;
        break;
      case "gst-return":
        out.gstReturn = take(parseGstSummary(f.name, table.rows, o)).data;
        break;
      case "schedules":
        out.schedules = take(parseSchedules(f.name, table.rows, o)).data;
        break;
    }
  }
  return out;
}
