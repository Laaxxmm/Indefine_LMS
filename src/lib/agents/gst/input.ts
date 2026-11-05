// GST Prep inputs. The runner's input schema is synchronous, so it only sorts the gathered files
// into roles (by file name) and checks the required ones are there; parsing — including the
// asynchronous XLSX reader — happens in extract via loadGstData().
//
// File-name contract for the job's ClientDocs folder (case-insensitive, first match wins):
//   profile.json / gst-profile.json   client GSTIN, AATO, filing frequency, expected filing date  (required)
//   *prev*.json / *previous*.json      previous period return figures                             (optional)
//   *payable*.csv|xlsx                 open payables ageing as at period end (rule 37)             (optional)
//   *einvoice* / *e-invoice* / *irn*   e-invoice register (doc no → IRN), csv|xlsx|json            (optional)
//   *eway* / *e-way*                   e-way bill data: received, not used by v1.0.0               (optional)
//   *2b*.json|xlsx                     GSTR-2B as downloaded by staff                              (required)
//   *sales* / *outward*  .csv|xlsx     sales register (Tally or Zoho export)                       (required)
//   *purchase* / *inward* .csv|xlsx    purchase register (Tally or Zoho export)                    (required)
import { z } from "zod";
import type { InputFile, JobContext } from "@/lib/agents/core/runner";
import { parse2bJson, parse2bSheets } from "./gstr2b";
import { GstParseError, parseAmount, parseDay, rupeesToPaise, zeroTax, type TaxSplit } from "./money";
import { matchKey, parseEinvoiceJson, parseEinvoiceTable, parsePayablesTable, parsePurchaseTable, parseSalesTable, registerTable } from "./registers";
import { agentHintForName, sniffRegister } from "./sniff";
import { parseCsv, readXlsx, type Grid } from "./tabular";
import type { FileRole, GstExtract, GstInput, PrevReturn, Profile, RoleFile } from "./types";

const ROLE_RULES: { role: FileRole; test: RegExp; kinds: RoleFile["kind"][] }[] = [
  { role: "profile", test: /^(gst[-_ ]?)?profile\.json$/i, kinds: ["json"] },
  { role: "prev", test: /prev/i, kinds: ["json"] },
  { role: "payables", test: /payable/i, kinds: ["csv", "xlsx"] },
  { role: "einvoice", test: /e[-_ ]?invoice|\birn\b/i, kinds: ["csv", "xlsx", "json"] },
  { role: "eway", test: /e[-_ ]?way/i, kinds: ["csv", "xlsx", "json"] },
  { role: "gstr2b", test: /2b/i, kinds: ["json", "xlsx"] },
  { role: "sales", test: /sales|outward/i, kinds: ["csv", "xlsx"] },
  { role: "purchases", test: /purchase|inward/i, kinds: ["csv", "xlsx"] },
];
const REQUIRED: FileRole[] = ["profile", "sales", "purchases", "gstr2b"];
const LABEL: Record<FileRole, string> = {
  profile: "profile.json (client GSTIN, AATO, filing frequency)",
  sales: "the sales register (CSV/XLSX)",
  purchases: "the purchase register (CSV/XLSX)",
  gstr2b: "the GSTR-2B (JSON or Excel)",
  prev: "previous return",
  payables: "payables ageing",
  einvoice: "e-invoice register",
  eway: "e-way bill data",
};

const kindOf = (name: string): RoleFile["kind"] | null => {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "csv" || ext === "xlsx" || ext === "json" ? ext : null;
};

/** Sort files into roles. Pure and synchronous (runs inside the runner's Zod schema). */
export function classifyFiles(files: { name: string; bytes: Buffer }[]): { input: GstInput; issues: string[] } {
  const out: RoleFile[] = [];
  const ignored: string[] = [];
  const issues: string[] = [];
  for (const f of files) {
    const kind = kindOf(f.name);
    const rule = kind ? ROLE_RULES.find((r) => r.test.test(f.name) && r.kinds.includes(kind)) : undefined;
    if (!kind || !rule) {
      ignored.push(f.name);
      continue;
    }
    if (out.some((o) => o.role === rule.role)) {
      issues.push(`Two files look like ${LABEL[rule.role]}: ${out.find((o) => o.role === rule.role)!.name} and ${f.name}; keep one in ClientDocs`);
      continue;
    }
    if (!f.bytes.length) {
      issues.push(`${f.name} is empty`);
      continue;
    }
    out.push(kind === "xlsx" ? { role: rule.role, name: f.name, kind, base64: f.bytes.toString("base64") } : { role: rule.role, name: f.name, kind, text: f.bytes.toString("utf8") });
  }
  for (const r of REQUIRED) if (!out.some((o) => o.role === r)) issues.push(`${LABEL[r]} is missing from the client documents`);
  if (issues.length) {
    for (const name of ignored) {
      const hint = agentHintForName(name);
      if (hint) issues.push(hint);
    }
  }
  return { input: { files: out, ignored }, issues };
}

const InputFileZ = z.object({ name: z.string(), source: z.string(), bytes: z.instanceof(Buffer) }).passthrough();

export const gstInputSchema = z.array(InputFileZ).transform((files, ctx): GstInput => {
  const { input, issues } = classifyFiles(files);
  for (const message of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  return input;
}) as unknown as z.ZodType<GstInput, z.ZodTypeDef, InputFile[]>;

// ------------------------------------------------------------------ profile + previous return

const DayZ = z.string().transform((v, ctx) => {
  try {
    const d = parseDay(v);
    if (d) return d;
  } catch {
    /* below */
  }
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: `not a date: ${v}` });
  return z.NEVER;
});
const MoneyZ = z.union([z.number(), z.string()]).transform((v, ctx) => {
  try {
    return parseAmount(v) ?? 0;
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: e instanceof GstParseError ? e.message : "not a readable amount" });
    return z.NEVER;
  }
});
const SplitZ = z
  .object({ igst: z.union([z.number(), z.string()]).optional(), cgst: z.union([z.number(), z.string()]).optional(), sgst: z.union([z.number(), z.string()]).optional(), cess: z.union([z.number(), z.string()]).optional() })
  .transform((v): TaxSplit => ({ igst: rupeesToPaise(v.igst ?? 0), cgst: rupeesToPaise(v.cgst ?? 0), sgst: rupeesToPaise(v.sgst ?? 0), cess: rupeesToPaise(v.cess ?? 0) }));

export const ProfileZ = z
  .object({
    gstin: z.string().trim().min(1, "profile.json: gstin is required").transform((s) => s.toUpperCase().replace(/\s+/g, "")),
    legalName: z.string().trim().optional(),
    aatoInr: MoneyZ,
    filingFrequency: z.enum(["monthly", "qrmp"]).default("monthly"),
    expectedFilingDate: DayZ.nullable().optional(),
    dueDate: DayZ.nullable().optional(),
  })
  .transform(
    (p): Profile => ({
      gstin: p.gstin,
      legalName: p.legalName ?? "",
      aatoPaise: p.aatoInr,
      filingFrequency: p.filingFrequency,
      expectedFilingDate: p.expectedFilingDate ?? null,
      dueDate: p.dueDate ?? null,
    }),
  );

export const PrevReturnZ = z.object({
  period: z.string().trim().min(1),
  gstr1Liability: SplitZ,
  gstr3bLiability: SplitZ,
  closingCreditBalance: SplitZ.optional(),
  filedOn: DayZ.nullable().optional(),
  dueOn: DayZ.nullable().optional(),
});

function parseJson(f: RoleFile): unknown {
  try {
    return JSON.parse((f.text ?? "").replace(/^ï»¿/, ""));
  } catch {
    throw new GstParseError(`${f.name}: not a valid .json file. Export it again and upload it.`);
  }
}

function zodOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, file: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new GstParseError(`${file}: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  return r.data;
}

async function gridsOf(f: RoleFile): Promise<{ grid: Grid; sheet?: string }[]> {
  if (f.kind === "csv") return [{ grid: parseCsv(f.text ?? "") }];
  const sheets = await readXlsx(Buffer.from(f.base64 ?? "", "base64"));
  return sheets.map((s) => ({ grid: s.grid, sheet: s.name }));
}

/**
 * ADR-008 wrong-department sniff for the framework (AgentScope.inputSniff), run before any model
 * call: every register file (sales, purchases, payables, e-invoice) goes through sniffRegister,
 * sheet by sheet; a file none of whose sheets is a GST register stops the run with sniffRegister's
 * message (which names the agent that handles it). Files that are missing or not recognised are
 * left to the input schema.
 */
export async function gstInputSniff(files: { name: string; bytes: Buffer }[]): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { input } = classifyFiles(files);
  for (const f of input.files) {
    if (f.role !== "sales" && f.role !== "purchases" && f.role !== "payables" && f.role !== "einvoice") continue;
    if (f.role === "einvoice" && f.kind === "json") continue;
    let grids: { grid: Grid }[];
    try {
      grids = await gridsOf(f);
    } catch {
      continue; // unreadable: the parser reports it
    }
    const sniffs = grids.map((g) => sniffRegister(g.grid, f.name, f.role as "sales" | "purchases" | "payables" | "einvoice"));
    if (sniffs.length && sniffs.every((m) => m !== null)) return { ok: false, reason: sniffs[0] as string };
  }
  return { ok: true };
}

/**
 * First sheet (in workbook order) that has a register header row. Every sheet is sniffed first
 * (ADR-008): a file from another department fails closed before any model call.
 */
async function firstTable(f: RoleFile, role: "sales" | "purchases" | "payables" | "einvoice") {
  const grids = await gridsOf(f);
  const sniffs = grids.map((g) => sniffRegister(g.grid, f.name, role));
  if (sniffs.every((m) => m !== null)) throw new GstParseError(sniffs[0] ?? `${f.name}: empty file`);
  let lastError: unknown = null;
  for (const [i, g] of grids.entries()) {
    if (sniffs[i] !== null) continue;
    try {
      return registerTable(g.grid, f.name, f.kind === "xlsx" ? g.sheet : undefined);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new GstParseError(`${f.name}: empty workbook`);
}

/** Parse every role file. The result is a GstExtract without model classifications. */
export async function loadGstData(input: GstInput, job: Pick<JobContext, "period" | "fy">): Promise<GstExtract> {
  const byRole = (r: FileRole) => input.files.find((f) => f.role === r);
  const need = (r: FileRole) => {
    const f = byRole(r);
    if (!f) throw new GstParseError(`${LABEL[r]} is missing`);
    return f;
  };
  const notes: string[] = [];

  const profileFile = need("profile");
  const profile = zodOrThrow(ProfileZ, parseJson(profileFile), profileFile.name);

  const salesFile = need("sales");
  const sales = parseSalesTable(await firstTable(salesFile, "sales"));
  const purchaseFile = need("purchases");
  const purchases = parsePurchaseTable(await firstTable(purchaseFile, "purchases"));

  const twoBFile = need("gstr2b");
  const twoB = twoBFile.kind === "json" ? parse2bJson(parseJson(twoBFile), twoBFile.name) : parse2bSheets(await readXlsx(Buffer.from(twoBFile.base64 ?? "", "base64")), twoBFile.name);
  notes.push(...twoB.notes);

  let prev: PrevReturn | null = null;
  const prevFile = byRole("prev");
  if (prevFile) {
    const p = zodOrThrow(PrevReturnZ, parseJson(prevFile), prevFile.name);
    prev = { loc: prevFile.name, period: p.period, gstr1: p.gstr1Liability, gstr3b: p.gstr3bLiability, closingCredit: p.closingCreditBalance ?? zeroTax(), filedOn: p.filedOn ?? null, dueOn: p.dueOn ?? null };
  }

  const payablesFile = byRole("payables");
  const payables = payablesFile ? parsePayablesTable(await firstTable(payablesFile, "payables")) : [];

  const einvoiceFile = byRole("einvoice");
  if (einvoiceFile) {
    const irns = einvoiceFile.kind === "json" ? parseEinvoiceJson(parseJson(einvoiceFile)) : parseEinvoiceTable(await firstTable(einvoiceFile, "einvoice"));
    for (const d of sales.docs) if (!d.irn) d.irn = irns.get(matchKey(d.number)) ?? null;
  }
  const ewayFile = byRole("eway");
  if (ewayFile) notes.push(`${ewayFile.name}: e-way bill data received; GST Prep v1.0.0 does not check it`);
  for (const name of input.ignored) notes.push(`${name}: not a recognised GST input; ignored`);

  return {
    period: job.period,
    fy: job.fy,
    profile,
    sales: sales.docs,
    purchases: purchases.docs,
    payables,
    gstr2b: twoB.docs,
    prev,
    ledgers: [],
    hsnReads: [],
    sources: {
      sales: { file: salesFile.name, style: sales.style, format: salesFile.kind as "csv" | "xlsx" },
      purchases: { file: purchaseFile.name, style: purchases.style, format: purchaseFile.kind as "csv" | "xlsx" },
      gstr2b: { file: twoBFile.name, format: twoBFile.kind as "json" | "xlsx" },
      ...(prevFile ? { prev: { file: prevFile.name, format: "json" as const } } : {}),
      ...(payablesFile ? { payables: { file: payablesFile.name, format: payablesFile.kind } } : {}),
      ...(einvoiceFile ? { einvoice: { file: einvoiceFile.name, format: einvoiceFile.kind } } : {}),
    },
    notes,
  };
}
