// Audit working papers (XLSX), every sheet titled "… — Draft for engagement partner". Fixed sheets
// in a fixed order. Echoed text (ledger names, explanations, model messages) is sanitised for
// audit-opinion wording, then the whole workbook is checked: any opinion wording outside the CARO
// clause titles throws (fail closed). The agent prepares working papers; it never reports.
import type { ChecklistResultItem } from "@/lib/agents/core/checklist";
import type { DeliverableDraft, Figures, JobContext } from "@/lib/agents/core/runner";
import type { ColumnType, SheetSpec } from "@/lib/agents/core/templates";
import { rupees } from "@/lib/agents/books/table";
import { analyzeAudit } from "./analysis";
import { DRAFT_FOR_PARTNER, LEAD_AREAS, WP_INDEX } from "./config";
import type { AuditExtract } from "./inputs";
import { varianceBps } from "./leads";
import { assertNoOpinion, sanitizeSheets, type Exempt } from "./opinion";
import { isInsufficient } from "./tasks";

export const AUDIT_PACK_TITLE = `Audit working papers — ${DRAFT_FOR_PARTNER}`;
export const AUDIT_PACK_FILE = "Audit-working-papers";

export const AUDIT_SHEETS: Record<string, { name: string; columns: [string, string, ColumnType?, number?][] }> = {
  index: { name: "WP index", columns: [["ref", "Ref"], ["section", "Section", "text", 30], ["sa", "SA reference"], ["description", "Description", "text", 60], ["status", "Status", "text", 34]] },
  materiality: { name: "Materiality", columns: [["basis", "Basis", "text", 48], ["amount", "Amount", "inr"], ["note", "Note", "text", 60]] },
  leads: { name: "Lead schedules", columns: [["wp", "WP ref"], ["area", "Area", "text", 44], ["cy", "Current year", "inr"], ["py", "Prior year", "inr"], ["variance", "Variance", "inr"], ["pct", "Variance %", "percent"], ["explanation", "Explanation", "text", 60]] },
  detail: { name: "Lead detail", columns: [["wp", "WP ref"], ["ledger", "Ledger", "text", 40], ["group", "Group", "text", 28], ["cy", "Current year", "inr"], ["py", "Prior year", "inr"], ["variance", "Variance", "inr"]] },
  plan: {
    name: "Sampling plan",
    columns: [["population", "Population"], ["method", "Method"], ["seed", "Seed", "text", 36], ["items", "Items", "integer"], ["value", "Population value", "inr"], ["size", "Sample size", "integer"], ["interval", "Interval", "inr"], ["start", "Random start", "inr"], ["selected", "Selected", "integer"], ["selectedValue", "Selected value", "inr"], ["fingerprint", "Fingerprint", "text", 20]],
  },
  selections: { name: "Sample selections", columns: [["population", "Population"], ["pick", "Pick", "integer"], ["row", "Row", "integer"], ["ref", "Reference"], ["date", "Date", "date"], ["party", "Party", "text", 32], ["amount", "Amount", "inr"], ["point", "Selection point", "inr"]] },
  notes: { name: "Review notes", columns: [["no", "No", "integer"], ["wp", "WP ref"], ["note", "Note", "text", 80], ["severity", "Severity"], ["source", "Source"], ["status", "Status"], ["response", "Response", "text", 40]] },
  pending: { name: "Pending information", columns: [["no", "No", "integer"], ["item", "Item", "text", 60], ["reason", "Reason", "text", 60], ["from", "Requested from", "text", 24]] },
  caro: { name: "CARO 2020", columns: [["clause", "Clause"], ["title", "Title", "text", 70], ["applicability", "Applicability", "text", 16], ["basis", "Basis", "text", 60], ["information", "Information required", "text", 50], ["wp", "WP ref"]] },
  checklist: { name: "Checklist", columns: [["rule", "Rule", "text", 44], ["severity", "Severity"], ["status", "Status"], ["message", "Message", "text", 80], ["evidence", "Evidence", "text", 50]] },
};

/** Statutory CARO clause titles are the only cells exempt from the opinion-wording check. */
export const OPINION_EXEMPT: Exempt = { [AUDIT_SHEETS.caro.name]: ["title"] };

const cols = (k: keyof typeof AUDIT_SHEETS) => AUDIT_SHEETS[k].columns.map(([key, header, type, width]) => ({ key, header, type, width }));

const RULE_WP: Record<string, string> = {
  "audit.tb-balanced": "D1",
  "audit.lead-tie": "D1",
  "audit.prior-tb-balanced": "D1",
  "audit.variance-unexplained": "D4",
  "audit.caro-undetermined": "G2",
  "audit.caro-applicable": "G2",
  "audit.sample-below-minimum": "D5",
  "audit.population-tie": "D5",
  "audit.opinion-language-in-inputs": "F4",
  "audit.parse-issues": "F4",
  "audit.inputs-missing": "A4",
  "audit.related-party-disclosure": "E2",
};

export function auditPack(ctx: { extracted: AuditExtract; figures: Figures; job: JobContext; results: ChecklistResultItem[] }): DeliverableDraft[] {
  const { extracted: e, results } = ctx;
  const a = analyzeAudit(e);
  const sheets: SheetSpec[] = [];
  const leadRefs = new Set(a.leads?.schedules.map((s) => s.wp) ?? []);

  sheets.push({
    name: AUDIT_SHEETS.index.name,
    columns: cols("index"),
    rows: [
      ...WP_INDEX.map((w) => ({ ref: w.ref, section: w.section, sa: w.sa, description: w.description, status: w.ref === "G1" ? "Engagement partner" : ["A5", "D1", "D4", "D5", "G2"].includes(w.ref) ? "Draft prepared by the agent" : "To be prepared" })),
      ...LEAD_AREAS.filter((l) => leadRefs.has(l.wp)).map((l) => ({ ref: l.wp, section: "D Audit evidence — lead schedules", sa: "SA 500", description: l.name, status: "Draft prepared by the agent" })),
    ],
  });

  sheets.push({
    name: AUDIT_SHEETS.materiality.name,
    columns: cols("materiality"),
    rows: [
      { basis: "Overall materiality", amount: rupees(a.materialityPaise), note: a.materialityBasis },
      { basis: "Performance materiality", amount: rupees(a.performancePaise), note: "Used for variance analysis and MUS sample sizes" },
      { basis: "Revenue from operations (TB)", amount: a.revenuePaise === null ? null : rupees(a.revenuePaise) },
      { basis: "Note", note: "Materiality is a draft for the engagement partner to confirm (SA 320)" },
    ],
  });

  const explained = new Map(a.variances.map((v) => [v.schedule.wp, v]));
  sheets.push({
    name: AUDIT_SHEETS.leads.name,
    columns: cols("leads"),
    rows: (a.leads?.schedules ?? []).map((s) => {
      const v = explained.get(s.wp);
      const bps = varianceBps(s);
      return {
        wp: s.wp,
        area: `${s.name} (Dr + / Cr −)`,
        cy: rupees(s.cyPaise),
        py: e.priorTb ? rupees(s.pyPaise) : null,
        variance: e.priorTb ? rupees(s.variancePaise) : null,
        pct: e.priorTb && bps !== null ? bps / 10000 : null,
        explanation: v ? (v.explanation ? v.explanation.text : "MATERIAL VARIANCE — explanation required") : "",
      };
    }),
  });

  sheets.push({
    name: AUDIT_SHEETS.detail.name,
    columns: cols("detail"),
    rows: [
      ...(a.leads?.schedules ?? []).flatMap((s) => s.lines.map((l) => ({ wp: s.wp, ledger: l.ledger, group: l.group, cy: rupees(l.cyPaise), py: e.priorTb ? rupees(l.pyPaise) : null, variance: e.priorTb ? rupees(l.cyPaise - l.pyPaise) : null }))),
      ...(a.leads?.unmapped ?? []).map((u) => ({ wp: "UNMAPPED", ledger: u.ledger, group: u.group, cy: u.year === "CY" ? rupees(u.netPaise) : null, py: u.year === "PY" ? rupees(u.netPaise) : null, variance: null })),
    ],
  });

  sheets.push({
    name: AUDIT_SHEETS.plan.name,
    columns: cols("plan"),
    rows: a.samples.map(({ population: p, result: r }) => ({
      population: p.name,
      method: r.method === "mus" ? "MUS (systematic, random start)" : "Random (seeded)",
      seed: r.seed,
      items: r.populationCount,
      value: rupees(r.populationPaise),
      size: r.plannedSize,
      interval: r.intervalPaise === null ? null : rupees(r.intervalPaise),
      start: r.randomStart === null ? null : rupees(r.randomStart),
      selected: r.selections.length,
      selectedValue: rupees(r.selectedPaise),
      fingerprint: r.fingerprint,
    })),
  });

  sheets.push({
    name: AUDIT_SHEETS.selections.name,
    columns: cols("selections"),
    rows: a.samples.flatMap(({ population: p, result: r }) =>
      r.selections.map((s, i) => {
        const it = p.items[s.index];
        return { population: p.name, pick: i + 1, row: it.row, ref: it.ref, date: it.date, party: it.party, amount: rupees(it.amountPaise), point: s.point === null ? null : rupees(s.point) };
      }),
    ),
  });

  const fails = results.filter((r) => r.status === "fail" || r.flags.length);
  sheets.push({
    name: AUDIT_SHEETS.notes.name,
    columns: cols("notes"),
    rows: fails.map((r, i) => ({ no: i + 1, wp: RULE_WP[r.ruleId] ?? "F4", note: r.message || r.title, severity: r.severity, source: r.source === "llm" ? "Model check (verify)" : r.source === "mistake" ? "Firm rule (approved mistake)" : "Agent check", status: "Open", response: "" })),
  });

  const pending: { item: string; reason: string; from: string }[] = [];
  for (const m of a.missingInputs) pending.push({ item: m, reason: "Not provided with the audit-assist inputs", from: "Client / engagement team" });
  for (const m of a.caro.missing) pending.push({ item: `CARO applicability: ${m}`, reason: "Needed to decide whether CARO 2020 applies", from: "Client" });
  for (const v of a.variances.filter((x) => !x.explanation)) pending.push({ item: `Explanation for the variance in ${v.schedule.wp} ${v.schedule.name}`, reason: "Material variance vs prior year (SA 520)", from: "Client management" });
  for (const t of a.ties.filter((x) => x.differencePaise !== 0)) pending.push({ item: `Complete ledger detail for ${t.population}`, reason: "Population does not agree to the trial balance", from: "Client accounts team" });
  for (const r of results.filter(isInsufficient)) pending.push({ item: `${r.title}: documents insufficient`, reason: "The model could not tell from the documents (insufficient_evidence) — obtain the related-party list and the disclosure note", from: "Client / engagement team" });
  for (const c of a.clauses.filter((x) => x.applicability === "To determine" && x.information)) pending.push({ item: `CARO ${c.clause}: ${c.information}`, reason: c.basis, from: "Client" });
  sheets.push({ name: AUDIT_SHEETS.pending.name, columns: cols("pending"), rows: pending.map((p, i) => ({ no: i + 1, ...p })) });

  sheets.push({
    name: AUDIT_SHEETS.caro.name,
    columns: cols("caro"),
    rows: [
      { clause: "Order", title: "Applicability of CARO 2020 (para 1(2))", applicability: a.caro.status === "applicable" ? "Applicable" : a.caro.status === "not-applicable" ? "Not applicable" : "To determine", basis: a.caro.reasons.join("; "), information: a.caro.missing.join("; "), wp: "G2" },
      ...a.clauses.map((c) => ({ clause: c.clause, title: c.title, applicability: c.applicability, basis: c.basis, information: c.information, wp: c.wp })),
    ],
  });

  sheets.push({
    name: AUDIT_SHEETS.checklist.name,
    columns: cols("checklist"),
    rows: results.map((r) => ({ rule: r.title, severity: r.severity, status: r.status, message: r.message, evidence: [r.evidence?.quote, r.evidence?.location].filter(Boolean).join(" — ") })),
  });

  const clean = sanitizeSheets(sheets, OPINION_EXEMPT);
  assertNoOpinion(clean, OPINION_EXEMPT, AUDIT_PACK_TITLE);
  return [{ type: "xlsx", title: AUDIT_PACK_TITLE, fileBase: AUDIT_PACK_FILE, sheets: clean }];
}
