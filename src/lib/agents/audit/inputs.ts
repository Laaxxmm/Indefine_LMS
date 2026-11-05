// Audit Assist inputs: which gathered file is which (by name, as data) and the deterministic parse
// of each — year-end and prior-year TB, entity profile, sampling plan, ledger-detail populations,
// variance explanations and disclosure notes. No model is involved here.
import { z } from "zod";
import { sniffCsv, sniffRows, wrongDepartmentMessage, WrongDepartmentError } from "@/lib/agents/books/department";
import { cell, locateColumns, parseAmountPaise, parseDay, readTable, type Cells, type ColumnAliases, type ParseIssue } from "@/lib/agents/books/table";
import { parseTb, type TbData, type TbField } from "@/lib/agents/books/tb";
import type { InputFile, JobContext } from "@/lib/agents/core/runner";
import { EntityProfileSchema, type EntityProfile } from "./caro";
import { SAMPLING } from "./config";

export type AuditFileKind = "column-map" | "tb-prior" | "tb" | "entity" | "sampling" | "population" | "explanations" | "notes" | "bank-statement";

/** First match wins; matched against the lower-case file name. */
export const AUDIT_FILE_PATTERNS: [AuditFileKind, RegExp][] = [
  ["column-map", /^column[-_ ]?map\.json$/],
  ["entity", /^(entity|profile|company)[-_ a-z]*\.json$/],
  ["sampling", /^sampling[-_ a-z]*\.json$/],
  ["population", /^(population|pop|ledger[-_ ]detail)[-_ ]/],
  ["tb-prior", /(prior|previous|(^|[^a-z])py([^a-z]|$)|last[-_ ]?year).*(tb|trial)|(tb|trial).*(prior|previous|(^|[^a-z])py([^a-z]|$)|last[-_ ]?year)/],
  ["tb", /trial[-_ ]?balance|(^|[^a-z])tb([^a-z]|$)/],
  ["explanations", /explanation|variance/],
  ["notes", /notes|disclosure/],
  ["bank-statement", /statement|stmt/],
];

export const classifyAuditFile = (name: string): AuditFileKind | null => {
  const n = name.toLowerCase();
  if (!/\.(csv|xlsx|txt|md|json)$/.test(n)) return null;
  for (const [kind, re] of AUDIT_FILE_PATTERNS) if (re.test(n)) return kind;
  return null;
};

export type AuditInputFile = { name: string; kind: AuditFileKind | null; bytes: Buffer };
export type AuditInput = { files: AuditInputFile[] };

const InputFileZ = z.object({ name: z.string(), source: z.string(), bytes: z.instanceof(Buffer) }).passthrough();

export const auditInputSchema = z.array(InputFileZ).transform((files, ctx): AuditInput => {
  const out = files.map((f) => ({ name: f.name, kind: classifyAuditFile(f.name), bytes: f.bytes }));
  if (!out.some((f) => f.kind === "tb")) {
    for (const f of out) {
      const d = sniffCsv(f.name, f.bytes);
      if (d) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: wrongDepartmentMessage(f.name, d, "Audit Assist") });
        return { files: out };
      }
    }
    const bank = out.find((f) => f.kind === "bank-statement");
    if (bank) ctx.addIssue({ code: z.ZodIssueCode.custom, message: wrongDepartmentMessage(bank.name, { agent: "books", label: "Books Close" }, "Audit Assist") });
    else ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A year-end trial balance export (file name containing 'trial-balance' or 'tb', CSV or XLSX) is required" });
  }
  return { files: out };
}) as unknown as z.ZodType<AuditInput, z.ZodTypeDef, InputFile[]>;

// ------------------------------------------------------------------ parsed shapes

export type PopItem = { row: number; date: string | null; ref: string; party: string; amountPaise: number };
export type PopulationConfig = { method: "mus" | "random"; sampleSize: number | null; seed: string; tbLedgers: string[] };
export type Population = { name: string; file: string; items: PopItem[]; config: PopulationConfig };
export type Explanation = { row: number; key: string; text: string };
export type Notes = { file: string; lines: string[] };

export type AuditExtract = {
  files: { name: string; kind: AuditFileKind | null }[];
  tb: TbData | null;
  priorTb: TbData | null;
  profile: EntityProfile | null;
  populations: Population[];
  explanations: Explanation[];
  notes: Notes | null;
  issues: ParseIssue[];
};

export const SamplingFileSchema = z
  .object({
    seed: z.string().min(1).max(120).optional(),
    populations: z
      .record(
        z
          .object({
            method: z.enum(["mus", "random"]).optional(),
            sampleSize: z.number().int().min(1).max(10_000).optional(),
            seed: z.string().min(1).max(120).optional(),
            tbLedgers: z.array(z.string().min(1)).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

type PopField = "date" | "ref" | "party" | "amount" | "debit" | "credit";
export const POPULATION_ALIASES: ColumnAliases<PopField> = {
  date: ["date", "voucher date", "invoice date", "txn date"],
  ref: ["ref", "reference", "invoice no", "invoice number", "voucher no", "vch no", "bill no", "document no"],
  party: ["party", "party name", "particulars", "customer", "vendor", "supplier", "name", "narration", "ledger"],
  amount: ["amount", "value", "invoice value", "net amount", "total"],
  debit: ["debit", "dr"],
  credit: ["credit", "cr"],
};

type ExplField = "key" | "text";
const EXPLANATION_ALIASES: ColumnAliases<ExplField> = {
  key: ["area", "wp ref", "wp", "lead", "lead schedule", "ledger", "account"],
  text: ["explanation", "reason", "comment", "remarks", "management explanation"],
};

const toPaise = (v: unknown, label: string, issues: ParseIssue[], file: string): number | null => {
  if (v === undefined) return null;
  const p = parseAmountPaise(String(v));
  if (!p.ok) {
    issues.push({ file, row: 0, message: `${label}: ${p.reason}` });
    return null;
  }
  return p.paise;
};

export function parseProfile(file: string, text: string, issues: ParseIssue[]): EntityProfile | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    issues.push({ file, row: 0, message: "entity profile is not valid JSON" });
    return null;
  }
  const p = EntityProfileSchema.safeParse(json);
  if (!p.success) {
    issues.push({ file, row: 0, message: `entity profile: ${p.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` });
    return null;
  }
  const { paidUpCapital, reserves, maxBorrowings, turnover, priorTurnover, materiality, ...rest } = p.data;
  return {
    ...rest,
    paidUpCapitalPaise: toPaise(paidUpCapital, "paidUpCapital", issues, file),
    reservesPaise: toPaise(reserves, "reserves", issues, file),
    maxBorrowingsPaise: toPaise(maxBorrowings, "maxBorrowings", issues, file),
    turnoverPaise: toPaise(turnover, "turnover", issues, file),
    priorTurnoverPaise: toPaise(priorTurnover, "priorTurnover", issues, file),
    materialityPaise: toPaise(materiality, "materiality", issues, file),
  };
}

export function parsePopulation(file: string, rows: Cells): { items: PopItem[] | null; issues: ParseIssue[] } {
  const loc = locateColumns(rows, POPULATION_ALIASES, ["amount|debit|credit"]);
  if (!loc) return { items: null, issues: [{ file, row: 0, message: "no header row with an Amount (or Debit/Credit) column" }] };
  const c = loc.columns;
  const items: PopItem[] = [];
  const issues: ParseIssue[] = [];
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((x) => (x ?? "").trim() === "")) continue;
    const ref = cell(row, c.ref);
    const party = cell(row, c.party);
    if (/^(grand\s+)?total$/i.test(ref) || /^(grand\s+)?total$/i.test(party)) continue;
    const a = parseAmountPaise(cell(row, c.amount));
    const d = parseAmountPaise(cell(row, c.debit));
    const k = parseAmountPaise(cell(row, c.credit));
    const bad = [a, d, k].find((x) => !x.ok);
    if (bad && !bad.ok) {
      issues.push({ file, row: r + 1, message: bad.reason });
      continue;
    }
    const amountPaise = (a as { paise: number }).paise + (d as { paise: number }).paise - (k as { paise: number }).paise;
    if (amountPaise === 0) continue;
    items.push({ row: r + 1, date: parseDay(cell(row, c.date)), ref, party, amountPaise });
  }
  return { items, issues };
}

export function parseExplanations(file: string, rows: Cells): { data: Explanation[]; issues: ParseIssue[] } {
  const loc = locateColumns(rows, EXPLANATION_ALIASES, ["key", "text"]);
  if (!loc) return { data: [], issues: [{ file, row: 0, message: "no header row with Area and Explanation columns" }] };
  const data: Explanation[] = [];
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const key = cell(rows[r], loc.columns.key);
    const text = cell(rows[r], loc.columns.text);
    if (key && text) data.push({ row: r + 1, key, text: text.slice(0, 500) });
  }
  return { data, issues: [] };
}

const popName = (file: string) =>
  file
    .toLowerCase()
    .replace(/\.(csv|xlsx|txt)$/, "")
    .replace(/^(population|pop|ledger[-_ ]detail)[-_ ]/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "population";

export async function parseAuditFiles(input: AuditInput, job: Pick<JobContext, "clientCode" | "fy">): Promise<AuditExtract> {
  const issues: ParseIssue[] = [];
  const out: AuditExtract = { files: input.files.map((f) => ({ name: f.name, kind: f.kind })), tb: null, priorTb: null, profile: null, populations: [], explanations: [], notes: null, issues };
  let map: Record<string, Record<string, string>> = {};
  let sampling: z.infer<typeof SamplingFileSchema> = {};
  for (const f of input.files) {
    if (f.kind === "column-map" || f.kind === "sampling") {
      try {
        const json = JSON.parse(f.bytes.toString("utf8"));
        if (f.kind === "column-map") map = z.record(z.record(z.string())).parse(json);
        else {
          const s = SamplingFileSchema.safeParse(json);
          if (s.success) sampling = s.data;
          else issues.push({ file: f.name, row: 0, message: `sampling plan ignored: ${s.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` });
        }
      } catch {
        issues.push({ file: f.name, row: 0, message: `${f.kind} file is not valid JSON; ignored` });
      }
    }
  }
  const seen = new Set<AuditFileKind>();
  for (const f of input.files) {
    if (!f.kind || f.kind === "column-map" || f.kind === "sampling" || f.kind === "bank-statement") continue;
    if (f.kind !== "population") {
      if (seen.has(f.kind)) {
        issues.push({ file: f.name, row: 0, message: `a second ${f.kind} file; only the first is used` });
        continue;
      }
      seen.add(f.kind);
    }
    if (f.kind === "entity") {
      out.profile = parseProfile(f.name, f.bytes.toString("utf8"), issues);
      continue;
    }
    if (f.kind === "notes" && /\.(txt|md)$/i.test(f.name)) {
      out.notes = { file: f.name, lines: f.bytes.toString("utf8").replace(/^﻿/, "").split(/\r?\n/) };
      continue;
    }
    const { table, issues: readIssues } = await readTable(f);
    issues.push(...readIssues);
    if (f.kind === "tb" || f.kind === "tb-prior") {
      const r = parseTb(f.name, table.rows, (map[f.kind] ?? {}) as Partial<Record<TbField, string>>);
      issues.push(...r.issues);
      if (f.kind === "tb") {
        out.tb = r.tb;
        if (!r.tb) {
          const d = sniffRows(table.rows);
          if (d) throw new WrongDepartmentError(f.name, d, "Audit Assist");
        }
      } else out.priorTb = r.tb;
    } else if (f.kind === "notes") {
      out.notes = { file: f.name, lines: table.rows.map((r) => r.filter(Boolean).join(" ")) };
    } else if (f.kind === "explanations") {
      const r = parseExplanations(f.name, table.rows);
      issues.push(...r.issues);
      out.explanations = r.data;
    } else {
      const name = popName(f.name);
      const r = parsePopulation(f.name, table.rows);
      issues.push(...r.issues);
      if (!r.items) continue;
      const cfg = sampling.populations?.[name] ?? {};
      out.populations.push({
        name,
        file: f.name,
        items: r.items,
        config: {
          method: cfg.method ?? SAMPLING.defaultMethod,
          sampleSize: cfg.sampleSize ?? null,
          // Seed: the plan's population seed, else the plan seed + population, else client/FY/population.
          seed: cfg.seed ?? `${sampling.seed ?? `${job.clientCode}/FY${job.fy}`}/${name}`,
          tbLedgers: cfg.tbLedgers ?? [],
        },
      });
    }
  }
  return out;
}
