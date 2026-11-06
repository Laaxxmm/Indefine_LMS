// ROC input parsing (deterministic; no model). Staff drop these files in the job's ClientDocs:
//
//   company.json        company master + AGM + deposits + expected filing date   (required)
//   directors.csv       din,name,designation,din_status,kyc_completed_on,resident_in_india  (required)
//   shareholding.csv    folio,holder,share_class,shares,face_value[,paid_up_per_share]      (required)
//   auditor.json        statutory auditor and term                                          (required)
//   financials.json     { current, previous } summary heads, or { trialBalance, previous }  (one of
//   financials.xlsx     sheet "Financials": Item | Current | Previous (item = head key)       these two)
//   msme.csv            vendor,half_year,amount,days_outstanding                            (optional)
//   notes.txt           notes to accounts text, read by the LLM related-party rule         (optional)
//
// Amounts are rupees as written (Indian grouping allowed) and become integer paise here.
import ExcelJS from "exceljs";
import { z } from "zod";
import type { InputFile } from "@/lib/agents/core/runner";
import { wrongDepartment } from "@/lib/agents/core/guardrails/shared";
import { NO_CSV_AHEAD, csvRecords, isDayKey, optPaise, readCsvAhead, rupeesToPaise, yes, type CsvAhead } from "@/lib/agents/core/util";
import { causeSentence } from "@/lib/errors";

// ------------------------------------------------------------------ financial heads

export const BS_EQUITY = ["shareCapital", "reservesSurplus"] as const;
export const BS_LIABILITIES = ["longTermBorrowings", "shortTermBorrowings", "tradePayables", "otherLiabilities"] as const;
export const BS_ASSETS = ["fixedAssets", "investments", "inventories", "tradeReceivables", "cashAndBank", "otherAssets"] as const;
export const PL_HEADS = ["revenueFromOperations", "otherIncome", "totalExpenses", "taxExpense"] as const;
export const FIN_HEADS = [...BS_EQUITY, ...BS_LIABILITIES, ...BS_ASSETS, ...PL_HEADS] as const;
export type FinHead = (typeof FIN_HEADS)[number];
export type FinColumn = Record<FinHead, number>;

export const HEAD_LABELS: Record<FinHead, string> = {
  shareCapital: "Share capital",
  reservesSurplus: "Reserves and surplus",
  longTermBorrowings: "Long-term borrowings",
  shortTermBorrowings: "Short-term borrowings",
  tradePayables: "Trade payables",
  otherLiabilities: "Other liabilities and provisions",
  fixedAssets: "Property, plant and equipment / intangibles",
  investments: "Investments",
  inventories: "Inventories",
  tradeReceivables: "Trade receivables",
  cashAndBank: "Cash and bank balances",
  otherAssets: "Other assets",
  revenueFromOperations: "Revenue from operations",
  otherIncome: "Other income",
  totalExpenses: "Total expenses",
  taxExpense: "Tax expense",
};

/** Heads whose TB balance is debit-positive (assets, expenses). */
export const DEBIT_HEADS: ReadonlySet<FinHead> = new Set<FinHead>([...BS_ASSETS, "totalExpenses", "taxExpense"]);

// ------------------------------------------------------------------ schemas

const Day = z.string().refine(isDayKey, "date must be YYYY-MM-DD");
const Amount = z.union([z.string(), z.number()]);

export const CompanySchema = z
  .object({
    name: z.string().trim().min(1),
    cin: z.string().trim().min(1),
    companyClass: z.enum(["private", "public", "opc"]),
    listed: z.boolean().default(false),
    section8: z.boolean().default(false),
    holdingOrSubsidiary: z.boolean().default(false),
    specialAct: z.boolean().default(false),
    governmentCompany: z.boolean().default(false),
    firstFinancialYear: z.boolean().default(false),
    authorisedCapital: Amount,
    paidUpCapital: Amount,
    agmDate: Day.nullable().default(null),
    previousAgmDate: Day.nullable().default(null),
    agmExtendedTo: Day.nullable().default(null),
    declaredAnnualReturnForm: z.enum(["MGT-7", "MGT-7A"]).nullable().default(null),
    csrNetProfitHistory: z.array(Amount).max(3).default([]),
    deposits: z
      .object({ depositsOutstanding: Amount.default(0), loansNotDeposits: Amount.default(0), dpt3FiledOn: Day.nullable().default(null) })
      .default({}),
    estimateFilingOn: Day.nullable().default(null),
  })
  .strict();

export const AuditorSchema = z
  .object({
    name: z.string().trim().min(1),
    frn: z.string().trim().default(""),
    type: z.enum(["individual", "firm"]),
    termStartFy: z.string().regex(/^\d{4}-\d{2}$/),
    termYears: z.number().int().min(1).max(5).default(5),
    consecutiveYearsBeforeTerm: z.number().int().min(0).default(0),
    reappointedAtThisAgm: z.boolean().default(false),
    newAuditorAtThisAgm: z.boolean().default(false),
    casualVacancy: z.boolean().default(false),
  })
  .strict();

const FinColumnInput = z.record(Amount);
const FinancialsJsonSchema = z.union([
  z.object({ current: FinColumnInput, previous: FinColumnInput }).strict(),
  z
    .object({
      trialBalance: z.array(z.object({ ledger: z.string().trim().min(1), debit: Amount.default(0), credit: Amount.default(0) })).min(1),
      previous: FinColumnInput,
    })
    .strict(),
]);

export type Company = Omit<z.infer<typeof CompanySchema>, "authorisedCapital" | "paidUpCapital" | "csrNetProfitHistory" | "deposits"> & {
  authorisedCapitalPaise: number;
  paidUpCapitalPaise: number;
  csrNetProfitHistoryPaise: number[];
  deposits: { depositsOutstandingPaise: number; loansNotDepositsPaise: number; dpt3FiledOn: string | null };
};
export type Auditor = z.infer<typeof AuditorSchema>;
export type Director = { din: string; name: string; designation: string; dinStatus: "active" | "deactivated" | "disqualified"; kycCompletedOn: string | null; residentInIndia: boolean };
export type Holding = { folio: string; holder: string; shareClass: string; shares: number; faceValuePaise: number; paidUpPerSharePaise: number };
export type MsmeDue = { vendor: string; halfYear: "H1" | "H2"; amountPaise: number; daysOutstanding: number };
export type TbLine = { ledger: string; debitPaise: number; creditPaise: number };

export type FinancialsSource =
  | { kind: "summary"; current: FinColumn; previous: FinColumn }
  | { kind: "tb"; trialBalance: TbLine[]; previous: FinColumn }
  | { kind: "xlsx"; fileName: string; bytes: Buffer };

export type RocInput = {
  company: Company;
  directors: Director[];
  shareholding: Holding[];
  auditor: Auditor;
  financials: FinancialsSource;
  msme: MsmeDue[];
  notes: string | null;
  files: string[];
};

// ------------------------------------------------------------------ parsers

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

function json(file: InputFile): unknown {
  try {
    return JSON.parse(file.bytes.toString("utf8"));
  } catch {
    throw new Error(`${file.name} is not a valid .json file. Export it again and upload it.`);
  }
}

export function parseCompany(file: InputFile): Company {
  const p = CompanySchema.safeParse(json(file));
  if (!p.success) throw new Error(`${file.name}: ${issues(p.error)}`);
  const { authorisedCapital, paidUpCapital, csrNetProfitHistory, deposits, ...rest } = p.data;
  return {
    ...rest,
    authorisedCapitalPaise: rupeesToPaise(authorisedCapital, "authorisedCapital"),
    paidUpCapitalPaise: rupeesToPaise(paidUpCapital, "paidUpCapital"),
    csrNetProfitHistoryPaise: csrNetProfitHistory.map((v, i) => rupeesToPaise(v, `csrNetProfitHistory[${i}]`)),
    deposits: {
      depositsOutstandingPaise: optPaise(deposits.depositsOutstanding, "deposits.depositsOutstanding"),
      loansNotDepositsPaise: optPaise(deposits.loansNotDeposits, "deposits.loansNotDeposits"),
      dpt3FiledOn: deposits.dpt3FiledOn,
    },
  };
}

export function parseAuditor(file: InputFile): Auditor {
  const p = AuditorSchema.safeParse(json(file));
  if (!p.success) throw new Error(`${file.name}: ${issues(p.error)}`);
  return p.data;
}

const DIN_STATUS = new Set(["active", "deactivated", "disqualified"]);

export function parseDirectors(file: InputFile, ahead: CsvAhead = NO_CSV_AHEAD): Director[] {
  const rows = csvRecords(file, ahead);
  if (!rows.length) throw new Error(`${file.name} has no directors`);
  return rows.map((r, i) => {
    const at = `${file.name} row ${i + 2}`;
    if (!/^\d{8}$/.test(r.din ?? "")) throw new Error(`${at}: DIN must be 8 digits`);
    const status = (r.din_status ?? "").toLowerCase();
    if (!DIN_STATUS.has(status)) throw new Error(`${at}: din_status must be active, deactivated or disqualified`);
    const kyc = r.kyc_completed_on ?? "";
    if (kyc && !isDayKey(kyc)) throw new Error(`${at}: kyc_completed_on must be YYYY-MM-DD or blank`);
    return {
      din: r.din,
      name: r.name ?? "",
      designation: r.designation || "Director",
      dinStatus: status as Director["dinStatus"],
      kycCompletedOn: kyc || null,
      residentInIndia: yes(r.resident_in_india),
    };
  });
}

export function parseShareholding(file: InputFile, ahead: CsvAhead = NO_CSV_AHEAD): Holding[] {
  const rows = csvRecords(file, ahead);
  if (!rows.length) throw new Error(`${file.name} has no shareholders`);
  return rows.map((r, i) => {
    const at = `${file.name} row ${i + 2}`;
    if (!/^\d+$/.test(r.shares ?? "")) throw new Error(`${at}: shares must be a whole number`);
    const face = rupeesToPaise(r.face_value, `${at} face_value`);
    return {
      folio: r.folio ?? "",
      holder: r.holder ?? "",
      shareClass: r.share_class || "Equity",
      shares: Number(r.shares),
      faceValuePaise: face,
      paidUpPerSharePaise: r.paid_up_per_share ? rupeesToPaise(r.paid_up_per_share, `${at} paid_up_per_share`) : face,
    };
  });
}

export function parseMsme(file: InputFile, ahead: CsvAhead = NO_CSV_AHEAD): MsmeDue[] {
  return csvRecords(file, ahead).map((r, i) => {
    const at = `${file.name} row ${i + 2}`;
    const hy = (r.half_year ?? "").toUpperCase();
    if (hy !== "H1" && hy !== "H2") throw new Error(`${at}: half_year must be H1 or H2`);
    if (!/^\d+$/.test(r.days_outstanding ?? "")) throw new Error(`${at}: days_outstanding must be a whole number`);
    return { vendor: r.vendor ?? "", halfYear: hy, amountPaise: rupeesToPaise(r.amount, `${at} amount`), daysOutstanding: Number(r.days_outstanding) };
  });
}

/** A column of heads from JSON / XLSX: every head required, unknown keys rejected. */
export function finColumn(raw: Record<string, unknown>, where: string): FinColumn {
  const unknown = Object.keys(raw).filter((k) => !(FIN_HEADS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(`${where}: unknown head(s) ${unknown.join(", ")}`);
  const out = {} as FinColumn;
  for (const h of FIN_HEADS) {
    if (!(h in raw)) throw new Error(`${where}: head "${h}" is missing`);
    out[h] = rupeesToPaise(raw[h], `${where}.${h}`);
  }
  return out;
}

export function parseFinancialsJson(file: InputFile): FinancialsSource {
  const p = FinancialsJsonSchema.safeParse(json(file));
  if (!p.success) throw new Error(`${file.name}: ${issues(p.error)}`);
  if ("current" in p.data) return { kind: "summary", current: finColumn(p.data.current, `${file.name} current`), previous: finColumn(p.data.previous, `${file.name} previous`) };
  return {
    kind: "tb",
    trialBalance: p.data.trialBalance.map((l, i) => ({
      ledger: l.ledger,
      debitPaise: optPaise(l.debit, `${file.name} trialBalance[${i}].debit`),
      creditPaise: optPaise(l.credit, `${file.name} trialBalance[${i}].credit`),
    })),
    previous: finColumn(p.data.previous, `${file.name} previous`),
  };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return cellText(v.result as ExcelJS.CellValue);
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  return String(v);
}

/** financials.xlsx, sheet "Financials" (or the first sheet): header row Item | Current | Previous. */
export async function parseFinancialsXlsx(fileName: string, bytes: Buffer): Promise<{ current: FinColumn; previous: FinColumn }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new Error(`${fileName} is not a readable XLSX workbook`);
  }
  const ws = wb.getWorksheet("Financials") ?? wb.worksheets[0];
  if (!ws) throw new Error(`${fileName} has no sheets`);
  const header = [1, 2, 3].map((c) => cellText(ws.getRow(1).getCell(c).value).trim().toLowerCase());
  if (header.join("|") !== "item|current|previous") throw new Error(`${fileName}: row 1 must be Item | Current | Previous`);
  const cur: Record<string, unknown> = {};
  const prev: Record<string, unknown> = {};
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const item = cellText(row.getCell(1).value).trim();
    if (!item) continue;
    cur[item] = cellText(row.getCell(2).value);
    prev[item] = cellText(row.getCell(3).value);
  }
  return { current: finColumn(cur, `${fileName} Current`), previous: finColumn(prev, `${fileName} Previous`) };
}

// ------------------------------------------------------------------ whole input

const byName = (files: InputFile[], name: string) => files.find((f) => f.name.toLowerCase() === name);

/** The CSV inputs, read ahead in a worker thread when large (readCsvAhead). */
export const ROC_CSV_FILES = ["directors.csv", "shareholding.csv", "msme.csv"] as const;

/** Gathered files → RocInput. Throws one message listing what is missing or unreadable. `ahead`: large CSVs already read (readCsvAhead). */
export function parseRocFiles(files: InputFile[], ahead: CsvAhead = NO_CSV_AHEAD): RocInput {
  // Wrong-department input fails closed before any model call (ADR-008).
  const elsewhere = wrongDepartment(files, "roc");
  if (elsewhere) throw new Error(elsewhere);
  const problems: string[] = [];
  const need = (name: string) => {
    const f = byName(files, name);
    if (!f) problems.push(`${name} is missing from the client documents`);
    return f;
  };
  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      problems.push((e as Error).message);
      return undefined;
    }
  };
  const companyF = need("company.json");
  const directorsF = need("directors.csv");
  const holdingF = need("shareholding.csv");
  const auditorF = need("auditor.json");
  const finJson = byName(files, "financials.json");
  const finXlsx = byName(files, "financials.xlsx");
  if (!finJson && !finXlsx) problems.push("financials.json or financials.xlsx is missing from the client documents");
  const msmeF = byName(files, "msme.csv");
  const notesF = byName(files, "notes.txt");

  const company = companyF && attempt(() => parseCompany(companyF));
  const directors = directorsF && attempt(() => parseDirectors(directorsF, ahead));
  const shareholding = holdingF && attempt(() => parseShareholding(holdingF, ahead));
  const auditor = auditorF && attempt(() => parseAuditor(auditorF));
  const financials: FinancialsSource | undefined = finJson
    ? attempt(() => parseFinancialsJson(finJson))
    : finXlsx
      ? { kind: "xlsx", fileName: finXlsx.name, bytes: finXlsx.bytes }
      : undefined;
  const msme = msmeF ? attempt(() => parseMsme(msmeF, ahead)) : [];
  if (problems.length || !company || !directors || !shareholding || !auditor || !financials || !msme) throw new Error(problems.join("; "));
  return {
    company,
    directors,
    shareholding,
    auditor,
    financials,
    msme,
    notes: notesF ? notesF.bytes.toString("utf8").trim() || null : null,
    files: files.map((f) => f.name).sort(),
  };
}

const InputFileZ = z.object({ name: z.string(), source: z.string(), bytes: z.instanceof(Buffer) }).passthrough();

// Async: a large CSV is read in a worker thread first (the runner parses inputs with safeParseAsync).
export const rocInputSchema = z.array(InputFileZ).transform(async (files, ctx): Promise<RocInput> => {
  try {
    return parseRocFiles(files as InputFile[], await readCsvAhead(files, ROC_CSV_FILES));
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: causeSentence(e) ?? "The ROC documents could not be read. Check the files and upload them again." });
    return z.NEVER;
  }
}) as unknown as z.ZodType<RocInput, z.ZodTypeDef, InputFile[]>;
