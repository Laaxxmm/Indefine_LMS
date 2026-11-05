// Tax Prep agent (Phase 6). Prepares the income-tax draft pack: computation of income (old vs
// new regime for individuals / HUFs), ITR form selection, 26AS / AIS vs books reconciliation,
// advance tax with 234B/234C, tax-audit (s.44AB) applicability and the missing-documents list.
// It never files: a person prepares and files the return on the income-tax portal.
//
// Implemented law: FY 2025-26 / AY 2026-27 under the Income-tax Act, 1961 (Finance Act 2025).
// The Income-tax Act, 2025 rule set (tax year 2026-27) exists as data but is unverified, so the
// agent fails closed for that FY until a partner publishes verified numbers (data.ts).
//
// Model use: only to match AIS income lines to books ledgers by name (tax.match-ais) and for the
// one LLM rule (foreign assets). All tax, interest, totals and thresholds are deterministic code.
import type { AgentDefinition, InputFile } from "@/lib/agents/core/runner";
import { dayNumber, paiseToRupeeString, rupeesToPaise } from "@/lib/agents/roc/util";
import { analyseTax, isAisIncome, type AisMatch, type TaxExtract } from "./analyse";
import { ruleSetFor } from "./data";
import { taxDeliverables } from "./deliverables";
import { TAX_MATCH_AIS_SPEC, acceptedAisMatches, aisPrompt, matchAisSystem } from "./model-tasks";
import { taxInputSchema, type TaxInput } from "./parse";
import { TAX_CHECKLIST, TAX_KEY, taxRegistry } from "./rules";

export { TAX_CHECKLIST, TAX_KEY, taxRegistry } from "./rules";
export { TAX_MODEL_TASKS } from "./model-tasks";
export { analyseTax } from "./analyse";
export type { TaxExtract } from "./analyse";
export type { TaxInput } from "./parse";

export const TAX_MATCH_TASK = TAX_MATCH_AIS_SPEC.name;

/**
 * Accuracy-harness input-sensitivity probe: a copy of the files with one income amount in
 * organiser.json raised by ₹1 — business turnover and books profit when there is a business
 * (so presumptive and books cases both move), else gross salary, else the first other-source
 * ledger. Gross total income changes on every fixture. The originals are not modified.
 */
export function taxProbeMutation(files: InputFile[]): InputFile[] {
  const f = files.find((x) => x.name.toLowerCase() === "organiser.json");
  if (!f) return files;
  const org = JSON.parse(f.bytes.toString("utf8")) as {
    business?: Record<string, unknown> | null;
    salary?: Record<string, unknown> | null;
    otherSources?: Record<string, unknown>[];
  };
  const bump = (o: Record<string, unknown>, k: string) => (o[k] = paiseToRupeeString(rupeesToPaise(o[k] ?? 0, k) + 100));
  if (org.business) {
    bump(org.business, "turnover");
    bump(org.business, "booksProfit");
  } else if (org.salary) bump(org.salary, "gross");
  else if (org.otherSources?.length) bump(org.otherSources[0], "amount");
  else return files;
  return files.map((x) => (x === f ? { ...x, bytes: Buffer.from(JSON.stringify(org, null, 2), "utf8") } : { ...x }));
}
const ITR_NUMBER = { "ITR-1": 1, "ITR-2": 2, "ITR-3": 3, "ITR-4": 4, "ITR-5": 5, "ITR-6": 6 } as const;

/** Integer figures for the run (paise for amounts; dates YYYYMMDD; flags 0/1). */
export function taxFigures(x: TaxExtract): Record<string, number> {
  const a = analyseTax(x);
  return {
    grossTotalIncomePaise: a.chosen.grossTotalIncome,
    deductionsAllowedPaise: a.chosen.deductionsAllowed,
    totalIncomePaise: a.chosen.totalIncome,
    taxOldPaise: a.old?.tax.total ?? 0,
    taxNewPaise: a.personal ? a.new.tax.total : 0,
    taxLiabilityPaise: a.chosen.tax.total,
    rebate87APaise: a.chosen.tax.rebate,
    surchargePaise: a.chosen.tax.surcharge - a.chosen.tax.marginalRelief,
    cessPaise: a.chosen.tax.cess,
    regimeNew: a.regime.used === "new" ? 1 : 0,
    businessIncomePaise: a.businessIncome,
    presumptiveIncomePaise: a.presumptive.incomePaise,
    msmeDisallowancePaise: a.msme.disallowedPaise,
    capitalGainsPaise: a.cgResult.buckets.stcgOther + a.cgResult.buckets.stcg111A + a.cgResult.buckets.ltcg112 + a.cgResult.buckets.ltcg112A,
    tdsBooksPaise: a.tds.totalBooks,
    tds26asPaise: a.tds.total26as,
    tdsCreditPaise: a.tds.credit,
    aisUnexplainedPaise: a.ais.unexplainedPaise,
    advanceTaxPaidPaise: a.advance.paidPaise,
    interest234APaise: a.i234A,
    interest234BPaise: a.advance.i234B,
    interest234CPaise: a.advance.i234C,
    lateFee234FPaise: a.fee234F,
    netPayablePaise: a.netPayablePaise,
    auditRequired: a.audit.required ? 1 : 0,
    itrForm: ITR_NUMBER[a.itrForm],
    dueDate139: dayNumber(a.due139),
    lossCarriedForwardPaise: a.losses.carriedForwardPaise,
    lossLostPaise: a.losses.lostPaise,
    bfLossSetOffPaise: a.losses.bfSetOffPaise,
  };
}

export const taxAgent: AgentDefinition<TaxInput, TaxExtract> = {
  key: TAX_KEY,
  title: "Tax Prep",
  service: "IncomeTax",
  sopPackKey: TAX_KEY,
  modelAgent: "tax",
  inputSchema: taxInputSchema,
  defaultChecklist: TAX_CHECKLIST,
  checklistRegistry: taxRegistry,
  probeMutation: taxProbeMutation,

  async extract({ input, job, model, notes }) {
    const rs = ruleSetFor(job.fy);
    if (!rs.ok) throw new Error(rs.reason);
    const ais = input.ais ?? [];
    const books = input.organiser.otherSources;
    const incomeLines = ais.filter((l) => isAisIncome(l.category));
    let aisMatches: AisMatch[] = [];
    if (incomeLines.length && !books.length) {
      // No other-source ledgers at all: nothing to match against (code decides, no model call).
      aisMatches = incomeLines.map((l) => ({ aisId: l.id, outcome: "not_in_books", bookId: null }));
    } else if (incomeLines.length) {
      const ctx = { ais, books };
      const out = await model({
        task: TAX_MATCH_AIS_SPEC.name,
        privacy: "anonymize-then-cloud",
        difficulty: "sop",
        schema: TAX_MATCH_AIS_SPEC.schema,
        contradictions: (o) => TAX_MATCH_AIS_SPEC.validate!(o, ctx),
        messages: [
          { role: "system", content: matchAisSystem(rs.rules) },
          { role: "user", content: `${notes ? `Reviewer notes: ${notes}\n\n` : ""}${aisPrompt(ctx).text}` },
        ],
      });
      // The recorded router does not run contradictions: validate here as well.
      aisMatches = acceptedAisMatches(out, ctx);
    }
    return {
      fy: job.fy,
      organiser: input.organiser,
      form26as: input.form26as,
      ais: input.ais,
      capitalGains: input.capitalGains,
      msme: input.msme,
      priorItr: input.priorItr,
      aisMatches,
    };
  },

  compute: (extracted) => taxFigures(extracted),

  llmContext({ extracted: x }) {
    const lines: string[] = [];
    if (x.organiser.profile.notes) x.organiser.profile.notes.split(/\r?\n/).forEach((l, i) => lines.push(`organiser.json profile.notes line ${i + 1}: ${l}`));
    (x.ais ?? []).forEach((l, i) => lines.push(`ais.csv row ${i + 2}: ${l.category} | ${l.source} | ${l.description}`));
    (x.capitalGains ?? []).forEach((c, i) => lines.push(`capital-gains.csv row ${i + 2}: ${c.asset} | ${c.assetType}`));
    return lines.length ? lines.join("\n") : "(no notes, AIS lines or capital-gains rows were provided)";
  },

  deliverables: ({ extracted, results }) => taxDeliverables(extracted, results),
};
