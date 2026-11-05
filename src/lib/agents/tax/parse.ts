// Tax input parsing (deterministic; no model). Staff drop these files in the job's ClientDocs:
//
//   organiser.json     taxpayer profile + books summary (salary, house property, business,
//                      other-source ledgers, TDS per books, advance tax, deductions claimed)  (required)
//   26as.csv           Form 26AS Part A: tan,deductor,section,amount_paid,tds_deposited       (optional*)
//   ais.csv            AIS information lines: id,category,source,description,amount           (optional*)
//   capital-gains.csv  asset,asset_type,acquired_on,sold_on,sale_value,cost,expenses          (optional)
//   msme.csv           vendor,category,acceptance_date,amount,agreement_days,paid_on,outstanding_at_year_end (optional)
//   prior-itr.json     { ay, filedOn, dueDate, lossesCarriedForward: [{ ay, type, amount, returnFiledInTime }] } (optional)
//
// (*) a missing 26AS or AIS does not stop the run: the missing-documents rule lists it.
// Statements are downloaded by staff; nothing here contacts any portal. Amounts → integer paise.
import { z } from "zod";
import type { InputFile } from "@/lib/agents/core/runner";
import { wrongDepartment } from "@/lib/agents/core/guardrails/shared";
import { isDayKey, optPaise, parseCsv, rupeesToPaise, yes } from "@/lib/agents/core/util";

const Day = z.string().refine(isDayKey, "date must be YYYY-MM-DD");
const Amount = z.union([z.string(), z.number()]);
const OptAmount = Amount.optional();

const ProfileSchema = z
  .object({
    name: z.string().trim().min(1),
    status: z.enum(["individual", "huf", "firm", "company"]),
    isLlp: z.boolean().default(false),
    dateOfBirth: Day.nullable().default(null),
    residentialStatus: z.enum(["resident", "rnor", "nonresident"]).default("resident"),
    parentsSenior: z.boolean().default(false),
    isDirector: z.boolean().default(false),
    hasUnlistedShares: z.boolean().default(false),
    regimeClaimed: z.enum(["old", "new"]).default("new"),
    form10IEAFiledOn: Day.nullable().default(null),
    optedBackToNewEarlier: z.boolean().default(false),
    companyRegime: z.enum(["115BAA", "normal"]).default("115BAA"),
    companyTurnoverPy2: OptAmount,
    businessKind: z.enum(["none", "business", "profession"]).default("none"),
    presumptive: z.enum(["44AD", "44ADA"]).nullable().default(null),
    specifiedProfession: z.boolean().default(false),
    commissionOrAgency: z.boolean().default(false),
    presumptiveLock: z.boolean().default(false),
    partnerInAuditedFirm: z.boolean().default(false),
    auditPlanned: z.boolean().default(false),
    itrFormPlanned: z.enum(["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6"]).nullable().default(null),
    plannedFilingDate: Day,
    notes: z.string().default(""),
  })
  .strict();

const OrganiserSchema = z
  .object({
    profile: ProfileSchema,
    salary: z.object({ gross: Amount, exemptAllowances: OptAmount, professionalTax: OptAmount, basicDa: OptAmount, employerNps: OptAmount }).strict().nullable().default(null),
    houseProperty: z.object({ selfOccupiedInterest: OptAmount }).strict().nullable().default(null),
    business: z
      .object({
        turnover: Amount,
        cashReceipts: OptAmount,
        nonAccountPayeeChequeReceipts: OptAmount,
        digitalReceipts: OptAmount,
        booksProfit: Amount,
        declaredIncome: OptAmount,
        cashPayments: OptAmount,
        totalPayments: OptAmount,
        otherDisallowances: OptAmount,
      })
      .strict()
      .nullable()
      .default(null),
    otherSources: z
      .array(z.object({ id: z.string().trim().min(1), nature: z.enum(["savings-interest", "deposit-interest", "dividend", "rent", "other"]), payer: z.string().trim().min(1), amount: Amount }).strict())
      .default([]),
    tdsInBooks: z.array(z.object({ tan: z.string().trim().min(1), deductor: z.string().trim().default(""), amount: Amount }).strict()).default([]),
    advanceTax: z.array(z.object({ date: Day, amount: Amount }).strict()).default([]),
    deductions: z
      .object({ "80C": OptAmount, "80CCD1B": OptAmount, "80DSelf": OptAmount, "80DParents": OptAmount, "80TTA": OptAmount, "80TTB": OptAmount, "80E": OptAmount, "80G": OptAmount })
      .strict()
      .default({}),
  })
  .strict();

const PriorItrSchema = z
  .object({
    ay: z.string().regex(/^\d{4}-\d{2}$/),
    filedOn: Day,
    dueDate: Day,
    lossesCarriedForward: z.array(z.object({ ay: z.string().regex(/^\d{4}-\d{2}$/), type: z.literal("business"), amount: Amount, returnFiledInTime: z.boolean() }).strict()).default([]),
  })
  .strict();

export type Profile = Omit<z.infer<typeof ProfileSchema>, "companyTurnoverPy2"> & { companyTurnoverPy2Paise: number };
export type Deductions = { s80C: number; s80CCD1B: number; s80DSelf: number; s80DParents: number; s80TTA: number; s80TTB: number; s80E: number; s80G: number };
export type OtherSource = { id: string; nature: "savings-interest" | "deposit-interest" | "dividend" | "rent" | "other"; payer: string; amountPaise: number };
export type Organiser = {
  profile: Profile;
  salary: { grossPaise: number; exemptAllowancesPaise: number; professionalTaxPaise: number; basicDaPaise: number; employerNpsPaise: number } | null;
  houseProperty: { selfOccupiedInterestPaise: number } | null;
  business: {
    turnoverPaise: number;
    cashReceiptsPaise: number;
    nonAccountPayeeChequePaise: number;
    digitalReceiptsPaise: number;
    booksProfitPaise: number;
    /** Presumptive cases: a higher income the taxpayer chooses to declare (s.44AD(1) "a sum higher"); 0 = none. */
    declaredIncomePaise: number;
    cashPaymentsPaise: number;
    totalPaymentsPaise: number;
    otherDisallowancesPaise: number;
  } | null;
  otherSources: OtherSource[];
  tdsInBooks: { tan: string; deductor: string; amountPaise: number }[];
  advanceTax: { date: string; amountPaise: number }[];
  deductions: Deductions;
};
export type Tds26As = { tan: string; deductor: string; section: string; amountPaidPaise: number; tdsPaise: number };
export type AisLine = { id: string; category: string; source: string; description: string; amountPaise: number };
export type CgRow = { asset: string; assetType: "listed-equity" | "other"; acquiredOn: string; soldOn: string; saleValuePaise: number; costPaise: number; expensesPaise: number };
export type MsmeRow = { vendor: string; category: "micro" | "small" | "medium" | "trader"; acceptanceDate: string; amountPaise: number; agreementDays: number | null; paidOn: string | null; outstandingAtYearEnd: boolean };
export type PriorItr = { ay: string; filedOn: string; dueDate: string; lossesCarriedForward: { ay: string; type: "business"; amountPaise: number; returnFiledInTime: boolean }[] };

export type TaxInput = {
  organiser: Organiser;
  form26as: Tds26As[] | null;
  ais: AisLine[] | null;
  capitalGains: CgRow[] | null;
  msme: MsmeRow[] | null;
  priorItr: PriorItr | null;
  files: string[];
};

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

function json(file: InputFile): unknown {
  try {
    return JSON.parse(file.bytes.toString("utf8"));
  } catch {
    throw new Error(`${file.name} is not valid JSON`);
  }
}

export function parseOrganiser(file: InputFile): Organiser {
  const p = OrganiserSchema.safeParse(json(file));
  if (!p.success) throw new Error(`${file.name}: ${issues(p.error)}`);
  const o = p.data;
  const at = (k: string) => `${file.name} ${k}`;
  const { companyTurnoverPy2, ...profile } = o.profile;
  if (profile.status === "individual" && !profile.dateOfBirth) throw new Error(`${at("profile.dateOfBirth")}: required for an individual`);
  if (profile.presumptive && profile.businessKind === "none") throw new Error(`${at("profile.presumptive")}: needs businessKind business or profession`);
  if (profile.businessKind !== "none" && !o.business) throw new Error(`${at("business")}: required when businessKind is ${profile.businessKind}`);
  const d = o.deductions;
  return {
    profile: { ...profile, companyTurnoverPy2Paise: optPaise(companyTurnoverPy2, at("profile.companyTurnoverPy2")) },
    salary: o.salary
      ? {
          grossPaise: rupeesToPaise(o.salary.gross, at("salary.gross")),
          exemptAllowancesPaise: optPaise(o.salary.exemptAllowances, at("salary.exemptAllowances")),
          professionalTaxPaise: optPaise(o.salary.professionalTax, at("salary.professionalTax")),
          basicDaPaise: optPaise(o.salary.basicDa, at("salary.basicDa")),
          employerNpsPaise: optPaise(o.salary.employerNps, at("salary.employerNps")),
        }
      : null,
    houseProperty: o.houseProperty ? { selfOccupiedInterestPaise: optPaise(o.houseProperty.selfOccupiedInterest, at("houseProperty.selfOccupiedInterest")) } : null,
    business: o.business
      ? {
          turnoverPaise: rupeesToPaise(o.business.turnover, at("business.turnover")),
          cashReceiptsPaise: optPaise(o.business.cashReceipts, at("business.cashReceipts")),
          nonAccountPayeeChequePaise: optPaise(o.business.nonAccountPayeeChequeReceipts, at("business.nonAccountPayeeChequeReceipts")),
          digitalReceiptsPaise: optPaise(o.business.digitalReceipts, at("business.digitalReceipts")),
          booksProfitPaise: rupeesToPaise(o.business.booksProfit, at("business.booksProfit")),
          declaredIncomePaise: optPaise(o.business.declaredIncome, at("business.declaredIncome")),
          cashPaymentsPaise: optPaise(o.business.cashPayments, at("business.cashPayments")),
          totalPaymentsPaise: optPaise(o.business.totalPayments, at("business.totalPayments")),
          otherDisallowancesPaise: optPaise(o.business.otherDisallowances, at("business.otherDisallowances")),
        }
      : null,
    otherSources: o.otherSources.map((s, i) => ({ id: s.id, nature: s.nature, payer: s.payer, amountPaise: rupeesToPaise(s.amount, at(`otherSources[${i}].amount`)) })),
    tdsInBooks: o.tdsInBooks.map((t, i) => ({ tan: t.tan.toUpperCase(), deductor: t.deductor, amountPaise: rupeesToPaise(t.amount, at(`tdsInBooks[${i}].amount`)) })),
    advanceTax: o.advanceTax.map((a, i) => ({ date: a.date, amountPaise: rupeesToPaise(a.amount, at(`advanceTax[${i}].amount`)) })),
    deductions: {
      s80C: optPaise(d["80C"], at("deductions.80C")),
      s80CCD1B: optPaise(d["80CCD1B"], at("deductions.80CCD1B")),
      s80DSelf: optPaise(d["80DSelf"], at("deductions.80DSelf")),
      s80DParents: optPaise(d["80DParents"], at("deductions.80DParents")),
      s80TTA: optPaise(d["80TTA"], at("deductions.80TTA")),
      s80TTB: optPaise(d["80TTB"], at("deductions.80TTB")),
      s80E: optPaise(d["80E"], at("deductions.80E")),
      s80G: optPaise(d["80G"], at("deductions.80G")),
    },
  };
}

const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;

export function parse26As(file: InputFile): Tds26As[] {
  return parseCsv(file.bytes.toString("utf8")).map((r, i) => {
    const at = `${file.name} row ${i + 2}`;
    const tan = (r.tan ?? "").toUpperCase();
    if (!TAN_RE.test(tan)) throw new Error(`${at}: TAN must look like BLRA00000A`);
    return { tan, deductor: r.deductor ?? "", section: r.section ?? "", amountPaidPaise: optPaise(r.amount_paid, `${at} amount_paid`), tdsPaise: rupeesToPaise(r.tds_deposited, `${at} tds_deposited`) };
  });
}

export function parseAis(file: InputFile): AisLine[] {
  return parseCsv(file.bytes.toString("utf8")).map((r, i) => {
    const at = `${file.name} row ${i + 2}`;
    if (!r.id) throw new Error(`${at}: id is required`);
    if (!r.category) throw new Error(`${at}: category is required`);
    return { id: r.id, category: r.category.toLowerCase(), source: r.source ?? "", description: r.description ?? "", amountPaise: rupeesToPaise(r.amount, `${at} amount`) };
  });
}

export function parseCapitalGains(file: InputFile): CgRow[] {
  return parseCsv(file.bytes.toString("utf8")).map((r, i) => {
    const at = `${file.name} row ${i + 2}`;
    const type = (r.asset_type ?? "").toLowerCase();
    if (type !== "listed-equity" && type !== "other") throw new Error(`${at}: asset_type must be listed-equity or other`);
    if (!isDayKey(r.acquired_on) || !isDayKey(r.sold_on)) throw new Error(`${at}: acquired_on and sold_on must be YYYY-MM-DD`);
    if (r.sold_on < r.acquired_on) throw new Error(`${at}: sold before it was acquired`);
    return {
      asset: r.asset ?? "",
      assetType: type,
      acquiredOn: r.acquired_on,
      soldOn: r.sold_on,
      saleValuePaise: rupeesToPaise(r.sale_value, `${at} sale_value`),
      costPaise: rupeesToPaise(r.cost, `${at} cost`),
      expensesPaise: optPaise(r.expenses, `${at} expenses`),
    };
  });
}

const MSME_CATS = new Set(["micro", "small", "medium", "trader"]);

export function parseMsme(file: InputFile): MsmeRow[] {
  return parseCsv(file.bytes.toString("utf8")).map((r, i) => {
    const at = `${file.name} row ${i + 2}`;
    const category = (r.category ?? "").toLowerCase();
    if (!MSME_CATS.has(category)) throw new Error(`${at}: category must be micro, small, medium or trader`);
    if (!isDayKey(r.acceptance_date)) throw new Error(`${at}: acceptance_date must be YYYY-MM-DD`);
    if (r.paid_on && !isDayKey(r.paid_on)) throw new Error(`${at}: paid_on must be YYYY-MM-DD or blank`);
    if (r.agreement_days && !/^\d+$/.test(r.agreement_days)) throw new Error(`${at}: agreement_days must be a whole number or blank`);
    return {
      vendor: r.vendor ?? "",
      category: category as MsmeRow["category"],
      acceptanceDate: r.acceptance_date,
      amountPaise: rupeesToPaise(r.amount, `${at} amount`),
      agreementDays: r.agreement_days ? Number(r.agreement_days) : null,
      paidOn: r.paid_on || null,
      outstandingAtYearEnd: yes(r.outstanding_at_year_end),
    };
  });
}

export function parsePriorItr(file: InputFile): PriorItr {
  const p = PriorItrSchema.safeParse(json(file));
  if (!p.success) throw new Error(`${file.name}: ${issues(p.error)}`);
  return { ...p.data, lossesCarriedForward: p.data.lossesCarriedForward.map((l, i) => ({ ...l, amountPaise: rupeesToPaise(l.amount, `${file.name} lossesCarriedForward[${i}].amount`) })) };
}

const byName = (files: InputFile[], name: string) => files.find((f) => f.name.toLowerCase() === name);

export function parseTaxFiles(files: InputFile[]): TaxInput {
  // Wrong-department input fails closed before any model call (ADR-008).
  const elsewhere = wrongDepartment(files, "tax");
  if (elsewhere) throw new Error(elsewhere);
  const problems: string[] = [];
  const attempt = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch (e) {
      problems.push((e as Error).message);
      return null;
    }
  };
  const opt = <T>(name: string, fn: (f: InputFile) => T): T | null => {
    const f = byName(files, name);
    return f ? attempt(() => fn(f)) : null;
  };
  const orgF = byName(files, "organiser.json");
  if (!orgF) problems.push("organiser.json is missing from the client documents");
  const organiser = orgF ? attempt(() => parseOrganiser(orgF)) : null;
  const form26as = opt("26as.csv", parse26As);
  const ais = opt("ais.csv", parseAis);
  const capitalGains = opt("capital-gains.csv", parseCapitalGains);
  const msme = opt("msme.csv", parseMsme);
  const priorItr = opt("prior-itr.json", parsePriorItr);
  if (problems.length || !organiser) throw new Error(problems.join("; "));
  return { organiser, form26as, ais, capitalGains, msme, priorItr, files: files.map((f) => f.name).sort() };
}

const InputFileZ = z.object({ name: z.string(), source: z.string(), bytes: z.instanceof(Buffer) }).passthrough();

export const taxInputSchema = z.array(InputFileZ).transform((files, ctx): TaxInput => {
  try {
    return parseTaxFiles(files as InputFile[]);
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    return z.NEVER;
  }
}) as unknown as z.ZodType<TaxInput, z.ZodTypeDef, InputFile[]>;
