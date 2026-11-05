// Tax checklist: deterministic rule bodies and the default SopPack (key "tax", version 1.0.0).
// Bodies read the shared analysis (analyse.ts). One LLM rule (foreign assets / income → Schedule
// FA) reads the profile notes, AIS descriptions and capital-gains asset names. Three
// parameterised checks are registered for approved MistakeLog rules only.
import { createRuleRegistry, type ChecklistPack, type CheckOutcome, type RuleDefinition } from "@/lib/agents/core/checklist";
import { formatDayKey, formatInr } from "@/lib/agents/core/format";
import type { CheckInput } from "@/lib/agents/core/runner";
import { analyseTax, type TaxExtract } from "./analyse";
import type { TaxInput } from "./parse";

export const TAX_KEY = "tax";
export type TaxCheckInput = CheckInput<TaxInput, TaxExtract>;

const inr = (paise: number) => `₹${formatInr(paise / 100)}`;
const day = (k: string) => formatDayKey(k);
const pass = (message?: string): CheckOutcome => ({ status: "pass", message });
const na = (message: string): CheckOutcome => ({ status: "na", message });
const fail = (message: string, quote: string, location: string): CheckOutcome => ({ status: "fail", message, evidence: { quote, location } });
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isSafeInteger(v) ? v : fallback);
const strings = (v: unknown) => (Array.isArray(v) ? v.map((s) => String(s).toLowerCase()) : []);

export const taxRegistry = createRuleRegistry<TaxCheckInput>({
  "tax.regime-eligibility": ({ extracted: x }) => {
    const a = analyseTax(x);
    if (!a.personal) return na(`${x.organiser.profile.status}: no regime choice`);
    if (a.regime.claimed !== "old") return pass("new regime (default) claimed");
    if (!a.regime.oldEligible) return fail(`Old regime claimed but not available: ${a.regime.reason}. Computed under the new regime.`, "regimeClaimed: old", "organiser.json profile.regimeClaimed");
    return pass(a.regime.reason);
  },
  "tax.regime-deductions": ({ extracted: x }) => {
    const a = analyseTax(x);
    if (!a.newRegimeClaims.length) return pass();
    return fail(`New regime claimed with deductions it does not allow (s.115BAC(2)): ${a.newRegimeClaims.join(", ")}. They are ignored in the computation.`, a.newRegimeClaims[0], "organiser.json deductions / salary / houseProperty");
  },
  "tax.deduction-caps": ({ extracted: x }) => {
    const c = analyseTax(x).capsExceeded;
    if (!c.length) return pass();
    return fail(`Claims above the allowed amount (restricted in the computation): ${c.map((e) => `${e.section} claimed ${inr(e.claimed)}, allowed ${inr(e.cap)}`).join("; ")}`, c[0].section, "organiser.json deductions");
  },
  "tax.tds-mismatch": ({ extracted: x }, rule: RuleDefinition) => {
    const t = analyseTax(x).tds;
    if (!t.have26as) return na("Form 26AS not supplied (see missing documents)");
    const tol = num(rule.params?.tolerancePaise, 0);
    const bad = t.rows.filter((r) => Math.abs(r.diff) > tol);
    if (!bad.length) return pass("TDS per books equals Form 26AS for every TAN");
    const r = bad[0];
    return fail(
      `TDS differs on ${bad.length} TAN(s): ${bad.map((b) => `${b.tan} ${b.deductor} 26AS ${inr(b.form26as)} vs books ${inr(b.books)}`).join("; ")}. Credit claimed = lower of the two (${inr(t.credit)}).`,
      `${r.tan} ${formatInr(r.form26as / 100)}`,
      "26as.csv / organiser.json tdsInBooks",
    );
  },
  "tax.ais-not-in-books": ({ extracted: x }) => {
    const s = analyseTax(x).ais;
    if (!s.haveAis) return na("AIS not supplied (see missing documents)");
    const bad = s.rows.filter((r) => r.unexplainedPaise > 0);
    if (!bad.length) return pass("every AIS income line is in the books");
    const r = bad[0];
    return fail(
      `AIS income of ${inr(s.unexplainedPaise)} is not explained by the books${s.questions ? ` (${s.questions} reviewer question(s))` : ""}: ${bad.map((b) => `${b.line.id} ${b.line.source} ${inr(b.line.amountPaise)} — ${b.note}`).join("; ")}`,
      `${r.line.id},${r.line.category},${r.line.source}`,
      `ais.csv row ${(x.ais ?? []).indexOf(r.line) + 2}`,
    );
  },
  "tax.presumptive-conditions": ({ extracted: x }) => {
    const p = analyseTax(x).presumptive;
    if (!p.claimed) return na("no presumptive scheme claimed");
    if (!p.eligible) return fail(`s.${p.claimed} not available: ${p.reasons.join("; ")}. Business income computed from the books.`, `presumptive: ${p.claimed}`, "organiser.json profile.presumptive / business");
    return pass(`s.${p.claimed} conditions met; presumptive income ${inr(p.incomePaise)}`);
  },
  "tax.presumptive-declared-lower": ({ extracted: x }) => {
    const a = analyseTax(x);
    const p = a.presumptive;
    if (!p.claimed || !p.eligible) return na("no presumptive scheme in use");
    if (!p.declaredLower) return pass(`income offered at or above the s.${p.claimed} deemed income ${inr(p.incomePaise)}`);
    const t = a.auditIncomeTest;
    const clause = p.claimed === "44ADA" ? "s.44AB(d) read with s.44ADA(4)" : "s.44AB(e) read with s.44AD(4)-(5)";
    const above = t.totalIncomePaise > t.basicExemptionPaise;
    return fail(
      `Business income declared ${inr(a.businessIncome)} is below the s.${p.claimed} deemed income ${inr(p.incomePaise)}; the declared income is used. Tax audit u/s ${clause} applies when total income exceeds the basic exemption (${inr(t.basicExemptionPaise)}): total income ${inr(t.totalIncomePaise)}, so the audit is ${above ? "required" : "not required on this ground"}. Books of account are needed (s.44AA), the return is ITR-3 and advance tax follows the regular instalments${p.claimed === "44AD" ? "; s.44AD(4) bars the scheme for the next five years where profit was declared under s.44AD in an earlier year (confirm from the prior returns)" : ""}`,
      `declaredIncome ${formatInr(a.businessIncome / 100)}`,
      "organiser.json business.declaredIncome",
    );
  },
  "tax.audit-44ab": ({ extracted: x }) => {
    const a = analyseTax(x);
    if (a.audit.required && !x.organiser.profile.auditPlanned)
      return fail(`Tax audit required: ${a.audit.reason}. The job is planned as non-audit: Form 3CA/3CB-3CD needed and the due date is ${day(a.due139)}.`, "auditPlanned: false", "organiser.json profile.auditPlanned");
    return pass(a.audit.required ? `tax audit planned (${a.audit.reason})` : `no tax audit: ${a.audit.reason}`);
  },
  "tax.loss-carry-forward": ({ extracted: x }) => {
    const a = analyseTax(x);
    const l = a.losses;
    const problems: string[] = [];
    if (a.belated && (l.lostPaise > 0 || a.cgResult.lossCarriedForwardPaise > 0))
      problems.push(`return planned ${day(x.organiser.profile.plannedFilingDate)} after the due date ${day(a.due139)}: this year's loss of ${inr(l.lostPaise + a.cgResult.lossCarriedForwardPaise)} cannot be carried forward (s.80 / s.139(3))`);
    for (const b of l.bfInvalid) problems.push(`brought-forward loss of AY ${b.ay} (${inr(b.amountPaise)}) not allowed: ${b.reason}`);
    if (!problems.length) return pass(l.carriedForwardPaise ? `loss of ${inr(l.carriedForwardPaise)} carried forward` : "no loss to carry forward");
    return fail(problems.join("; "), `plannedFilingDate: ${x.organiser.profile.plannedFilingDate}`, a.belated ? "organiser.json profile.plannedFilingDate" : "prior-itr.json lossesCarriedForward");
  },
  "tax.msme-43bh": ({ extracted: x }) => {
    const m = analyseTax(x).msme;
    if (!m.applied) return na("presumptive income or no business: s.43B(h) does not apply");
    const hits = m.findings.filter((f) => f.disallowed);
    if (!hits.length) return pass("no micro / small enterprise dues beyond the allowed days");
    const f = hits[0];
    return fail(
      `s.43B(h): ${inr(m.disallowedPaise)} owed to micro / small enterprises at the year end and not paid within the allowed days is added back: ${hits.map((h) => `${h.vendor} ${inr(h.amountPaise)} (${h.daysToPay === null ? "unpaid" : `${h.daysToPay} days`}, allowed ${h.allowedDays})`).join("; ")}`,
      `${f.vendor},${f.category},${f.acceptanceDate}`,
      `msme.csv row ${m.findings.findIndex((z) => z.disallowed) + 2}`, // findings keep the file's row order
    );
  },
  "tax.advance-tax-interest": ({ extracted: x }) => {
    const a = analyseTax(x).advance;
    if (a.exempt) return na("resident senior citizen without business income: no advance tax (s.207(2))");
    const total = a.i234B + a.i234C;
    if (total <= 0) return pass(a.liable ? "advance tax paid in time" : "assessed tax below ₹10,000: no advance tax");
    return fail(`Interest u/s 234B ${inr(a.i234B)} and 234C ${inr(a.i234C)} on assessed tax ${inr(a.assessedTaxPaise)} with advance tax paid ${inr(a.paidPaise)}`, `advance tax paid ${formatInr(a.paidPaise / 100)}`, "organiser.json advanceTax");
  },
  "tax.late-filing": ({ extracted: x }) => {
    const a = analyseTax(x);
    if (!a.belated) return pass(`planned filing ${day(x.organiser.profile.plannedFilingDate)} is within the due date ${day(a.due139)}`);
    return fail(`Return planned ${day(x.organiser.profile.plannedFilingDate)}, after the due date ${day(a.due139)}: fee u/s 234F ${inr(a.fee234F)} and interest u/s 234A ${inr(a.i234A)}`, `plannedFilingDate: ${x.organiser.profile.plannedFilingDate}`, "organiser.json profile.plannedFilingDate");
  },
  "tax.itr-form": ({ extracted: x }) => {
    const a = analyseTax(x);
    const planned = x.organiser.profile.itrFormPlanned;
    if (!planned) return pass(`${a.itrForm} applies`);
    if (planned !== a.itrForm) return fail(`${planned} planned but ${a.itrForm} applies`, `itrFormPlanned: ${planned}`, "organiser.json profile.itrFormPlanned");
    return pass(`${planned} is right`);
  },
  "tax.regime-comparison": ({ extracted: x }) => {
    const a = analyseTax(x);
    if (!a.personal || !a.old || !a.regime.used) return na("no regime choice");
    const other = a.regime.used === "old" ? a.new : a.old;
    const otherAllowed = a.regime.used === "old" || a.regime.oldEligible;
    if (otherAllowed && other.tax.total < a.chosen.tax.total)
      return fail(`The ${other.regime} regime would cost ${inr(a.chosen.tax.total - other.tax.total)} less (${inr(other.tax.total)} vs ${inr(a.chosen.tax.total)}); confirm the client's choice`, `regimeClaimed: ${a.regime.claimed}`, "organiser.json profile.regimeClaimed");
    return pass(`${a.regime.used} regime is the cheaper permissible choice`);
  },
  "tax.missing-docs": ({ extracted: x }) => {
    const m = analyseTax(x).missingDocs;
    if (!m.length) return pass("all expected documents supplied");
    return fail(`Ask the client / staff for: ${m.join("; ")}`, m[0], "documents supplied for this job");
  },
  "tax.mat-check": ({ extracted: x }) => {
    const p = x.organiser.profile;
    if (p.status !== "company") return na("not a company");
    if (p.companyRegime === "115BAA") return pass("s.115BAA company: MAT does not apply");
    return fail("Company under the normal provisions: MAT (s.115JB) on book profit is not computed by the agent — compute and compare", "companyRegime: normal", "organiser.json profile.companyRegime");
  },

  // ---------------------------------------------------------------- mistake-loop checks
  "tax.ais-category-present": ({ extracted: x }, rule: RuleDefinition) => {
    const cats = strings(rule.params?.categories);
    const i = (x.ais ?? []).findIndex((l) => cats.includes(l.category));
    if (i < 0) return pass();
    const l = (x.ais ?? [])[i];
    return fail(`AIS reports ${l.category} (${l.source}, ${inr(l.amountPaise)}): explain its source of funds in the file`, `${l.id},${l.category},${l.source}`, `ais.csv row ${i + 2}`);
  },
  "tax.income-over": ({ extracted: x }, rule: RuleDefinition) => {
    const statuses = strings(rule.params?.statuses);
    if (statuses.length && !statuses.includes(x.organiser.profile.status)) return na(`${x.organiser.profile.status}: outside this rule's scope (${statuses.join(", ")})`);
    const limit = num(rule.params?.limitPaise, Number.MAX_SAFE_INTEGER);
    const ti = analyseTax(x).chosen.totalIncome;
    if (ti <= limit) return pass();
    return fail(`Total income ${inr(ti)} is above ${inr(limit)}: ${typeof rule.params?.action === "string" ? rule.params.action : "check the extra schedule"}`, `total income ${formatInr(ti / 100)}`, "computation");
  },
  "tax.tds-section-listed": ({ extracted: x }, rule: RuleDefinition) => {
    const secs = strings(rule.params?.sections);
    const i = (x.form26as ?? []).findIndex((t) => secs.includes(t.section.toLowerCase()));
    if (i < 0) return pass();
    const t = (x.form26as ?? [])[i];
    return fail(`Form 26AS shows TDS u/s ${t.section} by ${t.deductor} (${inr(t.tdsPaise)}): review`, `${t.tan},${t.section}`, `26as.csv row ${i + 2}`);
  },
});

const d = (id: string, title: string, severity: "block" | "warn" | "info", evidence: string): RuleDefinition => ({ id, title, severity, kind: "deterministic", check: id, evidence });

export const TAX_CHECKLIST: ChecklistPack = {
  schemaVersion: 1,
  key: TAX_KEY,
  version: "1.0.0",
  rules: [
    d("tax.regime-eligibility", "Old regime available for this taxpayer", "block", "regime claimed, Form 10-IEA and filing dates"),
    d("tax.regime-deductions", "No old-regime deductions under the new regime", "block", "deductions claimed"),
    d("tax.tds-mismatch", "TDS per books = Form 26AS (per TAN)", "block", "TAN, 26AS and books amounts"),
    d("tax.ais-not-in-books", "AIS income is in the books", "block", "AIS line and books ledger"),
    d("tax.presumptive-conditions", "Presumptive scheme conditions met (44AD / 44ADA)", "block", "status, turnover, cash share"),
    d("tax.audit-44ab", "Tax audit applicability (s.44AB)", "block", "turnover, cash share and audit plan"),
    d("tax.loss-carry-forward", "Loss carry-forward conditions (s.80 / s.72)", "block", "filing date, due date and loss years"),
    d("tax.msme-43bh", "s.43B(h) payments to micro / small enterprises", "warn", "vendor, acceptance and payment dates"),
    d("tax.presumptive-declared-lower", "Presumptive income declared below the deemed income (s.44AD / 44ADA; audit u/s 44AB(d)/(e))", "warn", "declared income, deemed income and total income"),
    d("tax.deduction-caps", "Chapter VI-A claims within the caps", "warn", "section, claimed and allowed"),
    d("tax.advance-tax-interest", "Advance tax paid in time (234B / 234C)", "warn", "instalments and amounts paid"),
    d("tax.late-filing", "Return within the s.139(1) due date", "warn", "planned filing and due date"),
    d("tax.itr-form", "ITR form planned is right", "warn", "form planned and form that applies"),
    d("tax.regime-comparison", "Cheaper permissible regime chosen", "info", "tax under each regime"),
    d("tax.missing-docs", "Documents needed for the return", "info", "documents missing"),
    d("tax.mat-check", "MAT (s.115JB) computed for normal-regime companies", "info", "company regime"),
    {
      id: "tax.foreign-asset",
      title: "Foreign assets or foreign income disclosed (Schedule FA / FSI)",
      severity: "warn",
      kind: "llm",
      check:
        "Do the documents show that this resident taxpayer holds any foreign asset (foreign bank account, foreign shares or ESOPs, foreign property) or received foreign-source income during the year, so that Schedule FA / FSI must be filled?",
      evidence: "the sentence or line showing the foreign asset or income, and where it is",
    },
  ],
};
