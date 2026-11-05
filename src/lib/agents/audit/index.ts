// Audit Assist agent (Phase 7): working papers from the year-end and prior-year trial balances,
// the entity profile and ledger detail — WP index (SA-aligned), materiality, lead schedules,
// sampling (MUS / seeded random, seed recorded), review notes, pending information and the CARO
// 2020 applicability checklist. Every deliverable is a "Draft for engagement partner"; the agent
// never expresses an audit opinion (opinion.ts guard). All arithmetic is deterministic code in
// integer paise; the only model call is the related-party LLM rule (tasks.ts).
import type { AgentDefinition } from "@/lib/agents/core/runner";
import { analyzeAudit, normalizeAuditExtract } from "./analysis";
import { auditInputSchema, parseAuditFiles, type AuditExtract, type AuditInput } from "./inputs";
import { TB_PROBE, probeCsvAmount } from "@/lib/agents/books/probe";
import { auditPack } from "./pack";
import { AUDIT_CHECKLIST, AUDIT_KEY, auditLlmContext, auditRegistry } from "./rules";

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

  async extract({ input, job }) {
    return parseAuditFiles(input, job);
  },

  compute(extracted) {
    return computeAuditFigures(extracted);
  },

  llmContext: auditLlmContext,

  deliverables({ extracted, figures, job, results }) {
    return auditPack({ extracted, figures, job, results });
  },
};
