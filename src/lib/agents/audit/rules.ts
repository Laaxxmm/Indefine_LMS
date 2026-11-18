// Audit Assist checklist: deterministic rule bodies, the related-party LLM rule, and the default
// SOP pack v1.0.0. Thresholds are rule params (data) with config.ts defaults; every threshold
// carries a `verify` note. No rule expresses or implies an audit opinion.
// audit.caro-small-company-pending-verification (warn): CARO applicability would change under
// small-company limits held as data but not yet partner-verified (they are never applied).
// Severity — PARTNER TO CONFIRM SOP: a planned sample below the SOP minimum (25 items, population
// larger than the sample) is a BLOCK, so the working papers cannot be approved on an under-sized
// sample without the partner's recorded decision (it was a warn before).
import { createRuleRegistry, type ChecklistPack, type CheckOutcome, type DeterministicCheck, type RuleDefinition } from "@/lib/agents/core/checklist";
import { formatDayKey, formatInr } from "@/lib/agents/core/format";
import type { CheckInput } from "@/lib/agents/core/runner";
import { matchRows, netPaise } from "@/lib/agents/books/tb";
import { analyzeAudit, normalizeAuditExtract } from "./analysis";
import { CARO, LEAD_AREAS_VERIFY, MATERIALITY, OPINION_VERIFY, SAMPLING, VARIANCE } from "./config";
import type { AuditExtract, AuditInput } from "./inputs";

export const AUDIT_KEY = "audit";
export type AuditCheckInput = CheckInput<AuditInput, AuditExtract>;

const inr = (paise: number) => `₹${formatInr(paise / 100)}`;
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : []);
const pass = (): CheckOutcome => ({ status: "pass" });
const na = (message: string): CheckOutcome => ({ status: "na", message });
const at = (file: string, row: number) => `${file} row ${row}`;

const normalized = new WeakMap<object, AuditExtract>();
const full = (e: Partial<AuditExtract>): AuditExtract => {
  if (!e || typeof e !== "object") return normalizeAuditExtract(e);
  const hit = normalized.get(e);
  if (hit) return hit;
  const n = normalizeAuditExtract(e);
  normalized.set(e, n);
  return n;
};
/** Bodies always see a complete extract (a replayed MistakeLog example may carry only part of it). */
const withFullExtract = (entries: Record<string, DeterministicCheck<AuditCheckInput>>) =>
  Object.fromEntries(Object.entries(entries).map(([k, fn]) => [k, (ci: AuditCheckInput, r: RuleDefinition) => fn({ ...ci, extracted: full(ci.extracted) }, r)]));

const A = (ci: AuditCheckInput) => analyzeAudit(ci.extracted);

export const auditRegistry = createRuleRegistry<AuditCheckInput>(
  withFullExtract({
    "audit.tb-balanced": (ci) => {
      const { tb } = ci.extracted;
      const t = A(ci).tb;
      if (!tb || !t) return { status: "fail", message: "The year-end trial balance could not be read", evidence: { location: ci.extracted.files.find((f) => f.kind === "tb")?.name ?? "trial balance" } };
      if (t.differencePaise === 0) return pass();
      return {
        status: "fail",
        message: `Year-end trial balance does not balance: debits ${inr(t.debitPaise)}, credits ${inr(t.creditPaise)}, difference ${inr(Math.abs(t.differencePaise))}`,
        evidence: { quote: `Total debits ${(t.debitPaise / 100).toFixed(2)} / total credits ${(t.creditPaise / 100).toFixed(2)}`, location: `${tb.file} (${tb.rows.length} ledgers)` },
      };
    },

    "audit.lead-tie": (ci) => {
      const l = A(ci).leads;
      if (!l) return na("Trial balance not readable");
      if (!l.unmapped.length && l.tie.cyLeadsPaise === l.tie.cyTbNetPaise && (l.tie.pyLeadsPaise === null || l.tie.pyLeadsPaise === l.tie.pyTbNetPaise)) {
        // Groups mapped through a noted pattern (Zoho account types): the partner confirms the grouping.
        if (!l.groupingNotes.length) return pass();
        return { status: "pass", message: `Lead schedules tie. Groupings to confirm: ${l.groupingNotes.map((n) => `"${n.group}" → ${n.wp} (${n.verify})`).join("; ")}` };
      }
      const u = l.unmapped[0];
      const file = u?.year === "PY" ? ci.extracted.priorTb!.file : ci.extracted.tb!.file;
      return {
        status: "fail",
        message: `Lead schedules do not tie to the trial balance: ${l.unmapped.length} ledger(s) not mapped to any lead schedule${u ? ` (first: ${u.ledger}, group "${u.group || "—"}", ${u.year}, ${inr(Math.abs(u.netPaise))})` : ""}. Map the group in the SOP grouping map.`,
        evidence: u ? { quote: `${u.ledger} ${u.group}`.trim(), location: at(file, u.row) } : { location: "Lead schedules sheet" },
      };
    },

    "audit.prior-tb-balanced": (ci) => {
      const t = A(ci).priorTb;
      if (!t) return na("Prior-year trial balance not provided");
      if (t.differencePaise === 0) return pass();
      return { status: "fail", message: `Prior-year trial balance does not balance (difference ${inr(Math.abs(t.differencePaise))}); comparatives are unreliable`, evidence: { location: ci.extracted.priorTb!.file } };
    },

    "audit.variance-unexplained": (ci) => {
      const a = A(ci);
      if (!ci.extracted.priorTb) return na("Prior-year trial balance not provided");
      const open = a.variances.filter((v) => !v.explanation);
      if (!open.length) return pass();
      const v = open[0].schedule;
      return {
        status: "fail",
        message: `${open.length} material variance(s) vs prior year without an explanation (≥ ${inr(a.performancePaise)} and ≥ ${VARIANCE.minPercent}%); first: ${v.wp} ${v.name} ${inr(v.cyPaise)} vs ${inr(v.pyPaise)}`,
        evidence: { quote: `${v.wp} ${v.name}`, location: "Lead schedules sheet" },
      };
    },

    "audit.caro-undetermined": (ci) => {
      const c = A(ci).caro;
      if (c.status !== "undetermined") return pass();
      return { status: "fail", message: `CARO 2020 applicability cannot be determined: ${c.missing.join("; ") || c.reasons.join("; ")}`, evidence: { location: ci.extracted.files.find((f) => f.kind === "entity")?.name ?? "entity profile" } };
    },

    "audit.caro-small-company-pending-verification": (ci) => {
      const a = A(ci);
      const d = a.caroPending[0];
      if (!d) return pass();
      const status = (s: string) => (s === "applicable" ? "applicable" : s === "not-applicable" ? "not applicable" : "undetermined");
      const crore = (p: number) => `₹${p / 1_00_00_000_00} crore`;
      return {
        status: "fail",
        message: `CARO 2020 applicability depends on small-company limits awaiting partner verification. Applied (verified — ${d.applied.source}: paid-up ≤ ${crore(d.applied.paidUpMaxPaise)}, preceding-year turnover ≤ ${crore(d.applied.turnoverMaxPaise)}): the Order is ${status(a.caro.status)}. Unverified limits from ${formatDayKey(d.effectiveFrom)} (paid-up ≤ ${crore(d.paidUpMaxPaise)}, turnover ≤ ${crore(d.turnoverMaxPaise)}): it would be ${status(d.status)} (${d.reasons.join("; ")}). The working papers follow the verified limits; the engagement partner confirms the notification before relying on the small-company exclusion.`,
        evidence: { location: ci.extracted.files.find((f) => f.kind === "entity")?.name ?? "entity profile" },
      };
    },

    "audit.caro-applicable": (ci) => {
      const a = A(ci);
      if (a.caro.status !== "applicable") return pass();
      const n = a.clauses.filter((c) => c.applicability === "Applicable").length;
      return { status: "fail", message: `CARO 2020 applies (${a.caro.reasons.join("; ")}); ${n} clause(s) applicable — see the CARO 2020 sheet`, evidence: { location: "CARO 2020 sheet" } };
    },

    "audit.sample-below-minimum": (ci, rule) => {
      const min = num(rule.params?.minSampleSize, SAMPLING.minSampleSize);
      const s = A(ci).samples.find((x) => x.population.config.sampleSize !== null && x.population.config.sampleSize < min && x.population.items.length > x.population.config.sampleSize);
      if (!s) return A(ci).samples.length ? pass() : na("No sampling populations provided");
      return {
        status: "fail",
        message: `Sample for ${s.population.name} is ${s.population.config.sampleSize} item(s), below the SOP minimum of ${min} (population ${s.population.items.length} items)`,
        evidence: { quote: `"sampleSize": ${s.population.config.sampleSize}`, location: ci.extracted.files.find((f) => f.kind === "sampling")?.name ?? "sampling plan" },
      };
    },

    "audit.population-tie": (ci) => {
      const ties = A(ci).ties;
      if (!ties.length) return na("No population is linked to TB ledgers");
      const off = ties.filter((t) => t.differencePaise !== 0);
      if (!off.length) return pass();
      const t = off[0];
      return {
        status: "fail",
        message: `Sampling population ${t.population} (${inr(t.populationPaise)}) does not agree to the TB (${t.ledgers.join(", ")}: ${inr(t.tbPaise)}); difference ${inr(Math.abs(t.differencePaise))} — the population may be incomplete`,
        evidence: { location: ci.extracted.populations.find((p) => p.name === t.population)!.file },
      };
    },

    "audit.opinion-language-in-inputs": (ci) => {
      const hits = A(ci).opinionInInputs;
      if (!hits.length) return pass();
      const h = hits[0];
      return { status: "fail", message: `${hits.length} input text(s) use audit-opinion wording ("${h.phrase}"); withheld from the working papers — reword before use`, evidence: { quote: h.phrase, location: at(h.file, h.row) } };
    },

    "audit.parse-issues": (ci) => {
      const i = ci.extracted.issues[0];
      if (!i) return pass();
      return { status: "fail", message: `${ci.extracted.issues.length} row(s) or file(s) could not be read; first: ${i.message}`, evidence: { quote: i.message, location: i.row ? at(i.file, i.row) : i.file } };
    },

    "audit.inputs-missing": (ci) => {
      const m = A(ci).missingInputs;
      if (!m.length) return pass();
      return { status: "fail", message: `Not provided (listed under Pending information): ${m.join("; ")}`, evidence: { location: "inputs" } };
    },

    // ------------------------------------------------------------ parameterised checks (promoted mistakes)

    "audit.ledger-name-present": (ci, rule) => {
      const { tb } = ci.extracted;
      if (!tb) return na("Trial balance not readable");
      const rows = matchRows(tb, { ledger: strings(rule.params?.patterns) }).filter((r) => netPaise(r) !== 0);
      if (!rows.length) return pass();
      const r = rows[0];
      return { status: "fail", message: `${rows.length} ledger(s) match the review list; first: ${r.ledger} ${inr(Math.abs(netPaise(r)))}`, evidence: { quote: r.ledger, location: at(tb.file, r.row) } };
    },

    "audit.balance-sign": (ci, rule) => {
      const { tb } = ci.extracted;
      if (!tb) return na("Trial balance not readable");
      const expect = rule.params?.expect === "cr" ? "cr" : "dr";
      const rows = matchRows(tb, { group: strings(rule.params?.groupPatterns), ledger: strings(rule.params?.ledgerPatterns) }).filter((r) => (expect === "dr" ? netPaise(r) < 0 : netPaise(r) > 0));
      if (!rows.length) return pass();
      const r = rows[0];
      return { status: "fail", message: `${rows.length} ledger(s) carry a ${expect === "dr" ? "credit" : "debit"} balance against their nature; first: ${r.ledger} ${inr(Math.abs(netPaise(r)))}`, evidence: { quote: `${r.ledger} ${r.group}`, location: at(tb.file, r.row) } };
    },

    "audit.ledger-over-materiality": (ci, rule) => {
      const { tb } = ci.extracted;
      if (!tb) return na("Trial balance not readable");
      const limit = Math.floor((A(ci).materialityPaise * num(rule.params?.percentOfMateriality, 100)) / 100);
      const rows = matchRows(tb, { ledger: strings(rule.params?.ledgerPatterns), group: strings(rule.params?.groupPatterns) }).filter((r) => Math.abs(netPaise(r)) > limit);
      if (!rows.length) return pass();
      const r = rows[0];
      return { status: "fail", message: `${r.ledger} ${inr(Math.abs(netPaise(r)))} is above ${inr(limit)}`, evidence: { quote: r.ledger, location: at(tb.file, r.row) } };
    },
  }),
);

/** Documents shown to the model for the related-party rule — quotes must come from this text verbatim. */
export function auditLlmContext(ci: AuditCheckInput): string {
  const e = full(ci.extracted);
  const lines: string[] = [];
  if (e.tb) {
    lines.push(`Trial balance ledgers (${e.tb.file}):`);
    for (const r of e.tb.rows) lines.push(`${e.tb.file} row ${r.row}: ${r.ledger} | ${r.group}`);
  } else lines.push("Trial balance ledgers: (trial balance not readable)");
  lines.push("");
  if (e.notes) {
    lines.push(`Disclosure notes (${e.notes.file}):`);
    e.notes.lines.forEach((l, i) => {
      if (l.trim()) lines.push(`${e.notes!.file} line ${i + 1}: ${l.trim()}`);
    });
  } else lines.push("Disclosure notes: (no disclosure notes supplied)");
  return lines.join("\n");
}

/** The rule question only: the department preamble is the task's system prompt (tasks.ts, ADR-008). */
export const RELATED_PARTY_QUESTION = [
  "Is there a trial-balance ledger for a related party (a director or a director's relative, key managerial personnel, or a holding, subsidiary, associate or group company) that the disclosure notes do not name as a related party?",
  "status fail = such a ledger exists and is not disclosed (quote the ledger line); pass = every related-party ledger is disclosed, or there is none (quote the disclosure line or a ledger line);",
  'na with message "insufficient_evidence" = the documents do not let you tell, e.g. no disclosure notes were supplied (quote the line that shows this).',
].join(" ");

const rule = (r: RuleDefinition) => r;

export const AUDIT_CHECKLIST: ChecklistPack = {
  schemaVersion: 1,
  key: AUDIT_KEY,
  version: "1.0.0",
  rules: [
    rule({ id: "audit.tb-balanced", title: "Year-end trial balance: debits = credits", severity: "block", kind: "deterministic", check: "audit.tb-balanced", evidence: "total debits, total credits and the TB file", params: { tolerancePaise: 0, verify: "Exact to the paisa; no tolerance." } }),
    rule({ id: "audit.lead-tie", title: "Lead schedules tie to the trial balance", severity: "block", kind: "deterministic", check: "audit.lead-tie", evidence: "unmapped ledger, its group and TB row", params: { verify: LEAD_AREAS_VERIFY } }),
    rule({ id: "audit.prior-tb-balanced", title: "Prior-year trial balance balances", severity: "warn", kind: "deterministic", check: "audit.prior-tb-balanced", evidence: "prior-year TB file" }),
    rule({
      id: "audit.variance-unexplained",
      title: "Material variances vs prior year are explained",
      severity: "warn",
      kind: "deterministic",
      check: "audit.variance-unexplained",
      evidence: "lead schedule, current and prior-year balances",
      params: { minPercent: VARIANCE.minPercent, performancePercent: MATERIALITY.performancePercent, revenueBps: MATERIALITY.revenueBps, verify: `${VARIANCE.verify} ${MATERIALITY.verify}` },
    }),
    rule({ id: "audit.caro-undetermined", title: "CARO 2020 applicability can be determined", severity: "warn", kind: "deterministic", check: "audit.caro-undetermined", evidence: "entity profile fields missing", params: { verify: CARO.verify } }),
    rule({
      id: "audit.caro-small-company-pending-verification",
      title: "CARO applicability does not hang on unverified small-company limits",
      severity: "warn",
      kind: "deterministic",
      check: "audit.caro-small-company-pending-verification",
      evidence: "entity profile: paid-up capital, preceding-year turnover; verified and unverified limits",
      params: { verify: CARO.verify },
    }),
    rule({ id: "audit.caro-applicable", title: "CARO 2020 applies — clause checklist to complete", severity: "info", kind: "deterministic", check: "audit.caro-applicable", evidence: "CARO determination", params: { verify: CARO.verify } }),
    rule({
      id: "audit.sample-below-minimum",
      title: "Sample sizes meet the SOP minimum",
      severity: "block",
      kind: "deterministic",
      check: "audit.sample-below-minimum",
      evidence: "population and planned sample size",
      params: {
        minSampleSize: SAMPLING.minSampleSize,
        confidenceFactorTenths: SAMPLING.confidenceFactorTenths,
        verify: `${SAMPLING.verify} Severity block (an under-sized sample needs the partner's recorded decision) — partner to confirm SOP.`,
      },
    }),
    rule({ id: "audit.population-tie", title: "Sampling populations agree to the trial balance", severity: "warn", kind: "deterministic", check: "audit.population-tie", evidence: "population file, population total and TB ledger balance" }),
    rule({ id: "audit.opinion-language-in-inputs", title: "No audit-opinion wording in texts carried into the working papers", severity: "warn", kind: "deterministic", check: "audit.opinion-language-in-inputs", evidence: "the phrase and its source row", params: { verify: OPINION_VERIFY } }),
    rule({ id: "audit.parse-issues", title: "Every input row could be read", severity: "warn", kind: "deterministic", check: "audit.parse-issues", evidence: "file and row that could not be read" }),
    rule({ id: "audit.inputs-missing", title: "All audit-assist inputs provided", severity: "info", kind: "deterministic", check: "audit.inputs-missing", evidence: "the inputs not provided" }),
    rule({
      id: "audit.related-party-disclosure",
      title: "Related-party ledgers are covered by the disclosure note",
      severity: "warn",
      kind: "llm",
      check: RELATED_PARTY_QUESTION,
      evidence: "the ledger line (file and row) or the disclosure line (file and line)",
    }),
  ],
};
