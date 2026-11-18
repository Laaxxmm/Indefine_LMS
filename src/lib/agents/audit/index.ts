// Audit Assist agent (Phase 7): working papers from the year-end and prior-year trial balances,
// the entity profile and ledger detail — WP index (SA-aligned), materiality, lead schedules,
// sampling (MUS / seeded random, seed recorded), review notes, pending information and the CARO
// 2020 applicability checklist. Every deliverable is a "Draft for engagement partner"; the agent
// never expresses an audit opinion (opinion.ts guard). All arithmetic is deterministic code in
// integer paise; the only model call is the related-party LLM rule (tasks.ts).
import type { AgentScope } from "@/lib/agents/core/guardrails/scope";
import { bumpAmountText, mutateCsvCell } from "@/lib/agents/core/probes";
import type { AgentDefinition, InputFile, InputProbe } from "@/lib/agents/core/runner";
import { sniffDepartment, wrongDepartmentMessage } from "@/lib/agents/books/department";
import { analyzeAudit, normalizeAuditExtract } from "./analysis";
import { auditDictionaryTerms, parseAuditFilesOnce } from "./dictionary";
import { auditInputSchema, classifyAuditFile, type AuditExtract, type AuditInput } from "./inputs";
import { TB_PROBE, probeCsvAmount, type ProbeTarget } from "@/lib/agents/books/probe";
import { auditPack } from "./pack";
import { AUDIT_CHECKLIST, AUDIT_KEY, auditLlmContext, auditRegistry } from "./rules";
import { AUDIT_MODEL_TASKS } from "./tasks";

/** The prior-year TB, with the same aliases as the year-end TB. */
const PRIOR_TB_PROBE: ProbeTarget = { ...TB_PROBE, matches: (name) => classifyAuditFile(name) === "tb-prior" };

/**
 * Per-input probes (second audit, M2): +₹1 on the first amount of the year-end trial balance
 * (required), of the prior-year trial balance, and of the first ledger-detail population file.
 */
export const AUDIT_INPUT_PROBES: readonly InputProbe[] = Object.freeze([
  { input: "trial balance", mutate: (files: InputFile[]) => probeCsvAmount(files, [TB_PROBE]) },
  { input: "prior trial balance", mutate: (files: InputFile[]) => probeCsvAmount(files, [PRIOR_TB_PROBE]) },
  { input: "population", mutate: (files: InputFile[]) => mutateCsvCell(files, /^(population|pop|ledger[-_ ]detail)[-_ ].*\.csv$/i, ["amount", "value", "debit"], (v) => (v.trim() ? bumpAmountText(v) : null)) },
]);

/** Audit Assist's ADR-008 scope: its task registry, every checklist rule, the shared Books / Audit department sniff. */
export const AUDIT_SCOPE: AgentScope = {
  department: "Audit",
  tasks: [...AUDIT_MODEL_TASKS],
  ruleIds: AUDIT_CHECKLIST.rules.map((r) => r.id),
  inputSniff: (files) =>
    sniffDepartment(
      files,
      "Audit Assist",
      (name) => classifyAuditFile(name) === "tb",
      (fs) => {
        const bank = fs.find((f) => classifyAuditFile(f.name) === "bank-statement");
        return bank ? wrongDepartmentMessage(bank.name, { agent: "books", label: "Books Close" }, "Audit Assist") : null;
      },
    ),
};

export { AUDIT_CHECKLIST, AUDIT_KEY, auditRegistry } from "./rules";
export { AUDIT_MODEL_TASKS, AUDIT_RELATED_PARTY_TASK } from "./tasks";
export type { AuditExtract, AuditInput } from "./inputs";

/** Integer figures (paise for amounts); caroApplicable 1 = applies, 0 = does not, −1 = undetermined. */
export function computeAuditFigures(raw: Partial<AuditExtract>): Record<string, number> {
  const e = normalizeAuditExtract(raw);
  const a = analyzeAudit(e);
  const f: Record<string, number> = {
    materialityPaise: a.materialityPaise,
    performanceMaterialityPaise: a.performancePaise,
    caroApplicable: a.caro.status === "applicable" ? 1 : a.caro.status === "not-applicable" ? 0 : -1,
    caroClausesApplicable: a.clauses.filter((c) => c.applicability === "Applicable").length,
    materialVarianceCount: a.variances.length,
    unexplainedVarianceCount: a.variances.filter((v) => !v.explanation).length,
    samplePopulationCount: a.samples.length,
    sampleItemsSelected: a.samples.reduce((s, x) => s + x.result.selections.length, 0),
    parseIssueCount: e.issues.length,
  };
  if (a.tb && e.tb) {
    f.tbDebitPaise = a.tb.debitPaise;
    f.tbCreditPaise = a.tb.creditPaise;
    f.tbDifferencePaise = a.tb.differencePaise;
    f.ledgerCount = e.tb.rows.length;
  }
  if (a.priorTb) {
    f.priorTbDebitPaise = a.priorTb.debitPaise;
    f.priorTbCreditPaise = a.priorTb.creditPaise;
  }
  if (a.leads) {
    f.leadScheduleCount = a.leads.schedules.length;
    f.unmappedLedgerCount = a.leads.unmapped.length;
  }
  if (a.revenuePaise !== null) f.revenuePaise = a.revenuePaise;
  for (const { population: p, result: r } of a.samples) {
    f[`sample.${p.name}.populationPaise`] = r.populationPaise;
    f[`sample.${p.name}.plannedSize`] = r.plannedSize;
    f[`sample.${p.name}.selected`] = r.selections.length;
    f[`sample.${p.name}.selectedPaise`] = r.selectedPaise;
    if (r.intervalPaise !== null) f[`sample.${p.name}.intervalPaise`] = r.intervalPaise;
    // Seed-sensitive pins: the MUS random start and the selection fingerprint's first 48 bits.
    if (r.randomStart !== null) f[`sample.${p.name}.randomStart`] = r.randomStart;
    f[`sample.${p.name}.fingerprint48`] = parseInt(r.fingerprint.slice(0, 12), 16);
  }
  return f;
}

export const auditAgent: AgentDefinition<AuditInput, AuditExtract> = {
  key: AUDIT_KEY,
  title: "Audit Assist",
  service: "Audit",
  sopPackKey: AUDIT_KEY,
  modelAgent: "audit",
  inputSchema: auditInputSchema,
  defaultChecklist: AUDIT_CHECKLIST,
  checklistRegistry: auditRegistry,
  /** Accuracy-harness probe: +₹1 on the first amount of the year-end TB (CSV). */
  probeMutation: (files) => probeCsvAmount(files, [TB_PROBE]),
  inputProbes: AUDIT_INPUT_PROBES,
  requiredInputs: ["trial balance"],
  scope: AUDIT_SCOPE,

  async extract({ input, job }) {
    return parseAuditFilesOnce(input, job); // the same parse the dictionary hook read
  },

  dictionaryTerms: (input, { job }) => auditDictionaryTerms(input, job),

  compute(extracted) {
    return computeAuditFigures(extracted);
  },

  llmContext: auditLlmContext,

  deliverables({ extracted, figures, job, results }) {
    return auditPack({ extracted, figures, job, results });
  },
};
