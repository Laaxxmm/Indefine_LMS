// ROC Prep agent (Phase 6). Prepares the annual ROC draft pack for a company: AOC-4 and MGT-7 /
// MGT-7A data sheets, ADT-1 trigger check, DIR-3 KYC status list, draft board / AGM resolutions,
// due dates (shared statutory calendar) and an additional-fee estimate. It never files anything:
// staff key the figures into the MCA forms and file with the director's DSC.
//
// Model use: only to map trial-balance ledger names to Schedule III heads (when staff give a TB
// instead of a summary) and for the one LLM rule (related-party contracts → AOC-2). Every total,
// threshold, date and fee is deterministic TypeScript in integer paise (analyse.ts, data.ts).
import { z } from "zod";
import type { AgentDefinition } from "@/lib/agents/core/runner";
import { analyseRoc, columnFromTrialBalance, type RocExtract, type RocFinancials } from "./analyse";
import { rocDeliverables } from "./deliverables";
import { FIN_HEADS, HEAD_LABELS, parseFinancialsXlsx, rocInputSchema, type RocInput } from "./parse";
import { ROC_CHECKLIST, ROC_KEY, rocRegistry } from "./rules";
import { dayNumber } from "./util";

export { ROC_CHECKLIST, ROC_KEY, rocRegistry } from "./rules";
export { analyseRoc } from "./analyse";
export type { RocExtract } from "./analyse";
export type { RocInput } from "./parse";

export const ROC_MAP_TASK = "roc.map-ledgers" as const;

export const LedgerMappingSchema = z.object({
  mappings: z.array(z.object({ ledger: z.string().min(1), head: z.enum(FIN_HEADS) })).max(5000),
});

const MAP_SYSTEM = [
  "Map each trial-balance ledger of an Indian company to exactly one Schedule III head from the list.",
  "Copy each ledger name exactly as written. Use the head keys given, nothing else.",
  "Closing stock goes to inventories; GST / TDS receivable to otherAssets; provisions and statutory dues to otherLiabilities; opening profit and loss balance to reservesSurplus.",
  "Do not add up, total or change any amount.",
].join(" ");

async function financialsFrom(input: RocInput, model: Parameters<AgentDefinition<RocInput, RocExtract>["extract"]>[0]["model"], notes: string | null): Promise<RocFinancials> {
  const f = input.financials;
  if (f.kind === "summary") return { source: "summary", current: f.current, previous: f.previous, unmappedLedgers: [] };
  if (f.kind === "xlsx") {
    const cols = await parseFinancialsXlsx(f.fileName, f.bytes);
    return { source: "xlsx", ...cols, unmappedLedgers: [] };
  }
  const heads = FIN_HEADS.map((h) => `${h}: ${HEAD_LABELS[h]}`).join("\n");
  const ledgers = f.trialBalance.map((l) => `- ${l.ledger}`).join("\n");
  const out = await model({
    task: ROC_MAP_TASK,
    privacy: "anonymize-then-cloud",
    difficulty: "sop",
    schema: LedgerMappingSchema,
    messages: [
      { role: "system", content: MAP_SYSTEM },
      { role: "user", content: `${notes ? `Reviewer notes: ${notes}\n\n` : ""}Heads:\n${heads}\n\nLedgers:\n${ledgers}` },
    ],
  });
  const { column, unmapped } = columnFromTrialBalance(f.trialBalance, out.mappings);
  return { source: "tb", current: column, previous: f.previous, unmappedLedgers: unmapped };
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
