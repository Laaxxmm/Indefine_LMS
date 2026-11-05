// GST Prep agent (Phase 5) — prepares a DRAFT GST pack for a monthly / QRMP GST JobTask:
// GSTR-1 draft workbook, GSTR-3B computation, GSTR-2B vs books reconciliation, exceptions list and
// a client document-request list, written to {Period}/Working for human review. It never files,
// pays, signs or contacts anyone; staff file on the portal after partner approval.
//
//   inputs   → gstInputSchema (sort files by role) → extract: loadGstData (deterministic parsers:
//              Tally/Zoho CSV/XLSX registers, GSTR-2B JSON/Excel, profile, previous return,
//              payables, e-invoice) + classify (model: ledger → s.17(5)/RCM, description → HSN)
//   compute  → computeFigures (integer paise; GSTR-1 tables, 3B, set-off, interest, late fee)
//   checks   → GST_CHECKLIST (SopPack "gst" 1.0.0) with gstRegistry; one LLM rule (free supplies)
import type { AgentScope } from "@/lib/agents/core/guardrails/scope";
import type { AgentDefinition } from "@/lib/agents/core/runner";
import { classify } from "./classify";
import { computeFigures } from "./compute";
import { gstDeliverables } from "./deliverables";
import { gstInputSchema, gstInputSniff, loadGstData } from "./input";
import { GST_INPUT_PROBES, GST_REQUIRED_INPUTS, gstProbeMutation } from "./probe";
import { GST_CHECKLIST, GST_KEY, gstRegistry } from "./rules";
import { GST_MODEL_TASKS } from "./tasks";
import type { GstExtract, GstInput } from "./types";

/** GST Prep's ADR-008 scope: the task registry (tasks.ts), every checklist rule, the register sniff (sniff.ts). */
export const GST_SCOPE: AgentScope = {
  department: "GST",
  tasks: [...GST_MODEL_TASKS],
  ruleIds: GST_CHECKLIST.rules.map((r) => r.id),
  inputSniff: gstInputSniff,
};

export { GST_CHECKLIST, GST_KEY, gstRegistry } from "./rules";
export { CLASSIFY_LEDGERS_TASK, READ_HSN_TASK } from "./classify";
export const GST_FREE_SUPPLIES_TASK = "gst.check:gst.free-supplies" as const;

/** Documents shown to the model for LLM rules: ledger names and descriptions with their rows (no amounts). */
export function gstLlmContext(x: GstExtract): string {
  const lines: string[] = [`Purchase register (${x.sources.purchases.file}):`];
  for (const p of x.purchases) {
    const desc = p.lines.map((l) => l.description).filter(Boolean).join("; ");
    lines.push(`${p.loc}: supplier "${p.supplier}" | ledger "${p.ledger}"${desc && desc !== p.ledger ? ` | description "${desc}"` : ""}`);
  }
  lines.push("", `Sales register (${x.sources.sales.file}):`);
  for (const d of x.sales) {
    const desc = d.lines.map((l) => l.description).filter(Boolean).join("; ");
    lines.push(`${d.loc}: customer "${d.party}" | ${d.docType} ${d.number.trim()}${desc ? ` | description "${desc}"` : ""}`);
  }
  return lines.join("\n");
}

export const gstAgent: AgentDefinition<GstInput, GstExtract> = {
  key: GST_KEY,
  title: "GST Prep",
  service: "GST",
  sopPackKey: GST_KEY,
  modelAgent: "gst",
  inputSchema: gstInputSchema,
  defaultChecklist: GST_CHECKLIST,
  checklistRegistry: gstRegistry,

  async extract({ input, job, model, notes }) {
    const data = await loadGstData(input, job);
    return classify(data, model, notes);
  },

  compute(extracted) {
    return computeFigures(extracted);
  },

  llmContext({ extracted }) {
    return gstLlmContext(extracted);
  },

  deliverables: gstDeliverables,
  probeMutation: gstProbeMutation,
  inputProbes: GST_INPUT_PROBES,
  requiredInputs: GST_REQUIRED_INPUTS,
  scope: GST_SCOPE,
  coverageExemptions: {
    "gst.pack-config":
      "compares the active SOP pack's parameters with the GST computation; the harness always runs the agent's own default pack (plus promoted mistakes), so the rule cannot fail in a fixture. Its failing case is unit-tested in gst/rules.test.ts.",
  },
};
