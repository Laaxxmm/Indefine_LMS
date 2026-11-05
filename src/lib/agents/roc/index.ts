// ROC Prep agent (Phase 6). Prepares the annual ROC draft pack for a company: AOC-4 and MGT-7 /
// MGT-7A data sheets, ADT-1 trigger check, DIR-3 KYC status list, draft board / AGM resolutions,
// due dates (shared statutory calendar) and an additional-fee estimate. It never files anything:
// staff key the figures into the MCA forms and file with the director's DSC.
//
// Model use: only to map trial-balance ledger names to Schedule III heads (when staff give a TB
// instead of a summary) and for the one LLM rule (related-party contracts → AOC-2). Every total,
// threshold, date and fee is deterministic TypeScript in integer paise (analyse.ts, data.ts).
import type { AgentDefinition } from "@/lib/agents/core/runner";
import { analyseRoc, columnFromTrialBalance, type RocExtract, type RocFinancials } from "./analyse";
import { rocDeliverables } from "./deliverables";
import { ROC_MAP_TASK_SPEC, acceptedMappings, mapLedgersUserMessage } from "./model-tasks";
import { parseFinancialsXlsx, rocInputSchema, type RocInput } from "./parse";
import { ROC_CHECKLIST, ROC_KEY, rocRegistry } from "./rules";
import { dayNumber } from "./util";

export { ROC_CHECKLIST, ROC_KEY, rocRegistry } from "./rules";
export { ROC_MODEL_TASKS, LedgerMappingSchema } from "./model-tasks";
export { analyseRoc } from "./analyse";
export type { RocExtract } from "./analyse";
export type { RocInput } from "./parse";

export const ROC_MAP_TASK = ROC_MAP_TASK_SPEC.name;

type ModelFn = Parameters<AgentDefinition<RocInput, RocExtract>["extract"]>[0]["model"];

async function financialsFrom(input: RocInput, model: ModelFn, notes: string | null): Promise<RocFinancials> {
  const f = input.financials;
  if (f.kind === "summary") return { source: "summary", current: f.current, previous: f.previous, unmappedLedgers: [], ledgerQuestions: [] };
  if (f.kind === "xlsx") {
    const cols = await parseFinancialsXlsx(f.fileName, f.bytes);
    return { source: "xlsx", ...cols, unmappedLedgers: [], ledgerQuestions: [] };
  }
  const tb = f.trialBalance;
  const out = await model({
    task: ROC_MAP_TASK_SPEC.name,
    privacy: "anonymize-then-cloud",
    difficulty: "sop",
    schema: ROC_MAP_TASK_SPEC.schema,
    contradictions: (o) => ROC_MAP_TASK_SPEC.validate!(o, tb),
    messages: [
      { role: "system", content: ROC_MAP_TASK_SPEC.system },
      { role: "user", content: mapLedgersUserMessage(tb, notes) },
    ],
  });
  // The recorded router does not run contradictions, so validation is applied here too: only
  // grounded, decided mappings are used; abstentions become reviewer questions.
  const { mappings, questions } = acceptedMappings(out, tb);
  const { column, unmapped } = columnFromTrialBalance(tb, mappings);
  const asked = new Set(questions.map((q) => q.trim().toLowerCase()));
  return { source: "tb", current: column, previous: f.previous, unmappedLedgers: unmapped.filter((l) => !asked.has(l.trim().toLowerCase())), ledgerQuestions: unmapped.filter((l) => asked.has(l.trim().toLowerCase())) };
}

/** Integer figures for the run (paise for amounts; dates as YYYYMMDD; flags 0/1). */
export function rocFigures(x: RocExtract): Record<string, number> {
  const a = analyseRoc(x);
  const due = (id: string) => dayNumber(a.forms.find((f) => f.id === id)?.statutoryDue ?? null);
  const delay = (id: string) => a.forms.find((f) => f.id === id)?.delayDays ?? 0;
  return {
    paidUpCapitalPaise: x.company.paidUpCapitalPaise,
    shareholdingTotalPaise: a.shareholding.totalPaise,
    shareholdingDiffPaise: a.shareholding.diffPaise,
    sharesTotal: a.shareholding.totalShares,
    turnoverPaise: a.current.turnover,
    turnoverPreviousPaise: a.previous.turnover,
    netWorthPaise: a.current.netWorth,
    profitBeforeTaxPaise: a.current.profitBeforeTax,
    totalAssetsPaise: a.current.assets,
    balanceSheetDiffPaise: a.balanceSheetDiffPaise,
    smallCompany: a.small.isSmall ? 1 : 0,
    mgt7a: a.annualReturnForm === "MGT-7A" ? 1 : 0,
    csrApplicable: a.csr.applicable ? 1 : 0,
    csrObligationPaise: a.csr.obligationPaise,
    agmDueDate: dayNumber(a.agm.dueDate),
    agmDelayDays: a.agm.delayDays,
    aoc4DueDate: due("aoc-4"),
    mgt7DueDate: due("mgt-7"),
    adt1DueDate: due("adt-1"),
    dir3KycDueDate: due("dir-3-kyc"),
    aoc4DelayDays: delay("aoc-4"),
    mgt7DelayDays: delay("mgt-7"),
    adt1DelayDays: delay("adt-1"),
    directorsKycPending: a.kycPending,
    auditorTermYear: a.auditor.termYear,
    adt1Required: a.auditor.adt1Required ? 1 : 0,
    msme1Applicable: a.msme1.applicable ? 1 : 0,
    dpt3Applicable: a.dpt3.applicable ? 1 : 0,
    normalFeePaise: a.fees.normalFeePaise,
    aoc4AdditionalFeePaise: a.fees.aoc4,
    mgt7AdditionalFeePaise: a.fees.mgt7,
    adt1AdditionalFeePaise: a.fees.adt1,
    dirKycLateFeePaise: a.fees.dirKyc,
    additionalFeeTotalPaise: a.fees.total,
  };
}

export const rocAgent: AgentDefinition<RocInput, RocExtract> = {
  key: ROC_KEY,
  title: "ROC Prep",
  service: "ROC",
  sopPackKey: ROC_KEY,
  modelAgent: "roc",
  inputSchema: rocInputSchema,
  defaultChecklist: ROC_CHECKLIST,
  checklistRegistry: rocRegistry,

  async extract({ input, job, model, notes }) {
    return {
      fy: job.fy,
      company: input.company,
      directors: input.directors,
      shareholding: input.shareholding,
      auditor: input.auditor,
      financials: await financialsFrom(input, model, notes),
      msme: input.msme,
      notes: input.notes,
    };
  },

  compute: (extracted) => rocFigures(extracted),

  llmContext({ extracted }) {
    if (!extracted.notes) return "notes.txt: (no notes to accounts were provided)";
    return extracted.notes
      .split(/\r?\n/)
      .map((line, i) => `notes.txt line ${i + 1}: ${line}`)
      .join("\n");
  },

  deliverables: ({ extracted, results }) => rocDeliverables(extracted, results),
};
