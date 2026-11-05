import { describe, expect, it } from "vitest";
import { ChecklistPackSchema, loadRuleSet, type RuleDefinition } from "@/lib/agents/core/checklist";
import { CLEAN_MATCHES, checkInput, extractOf } from "./__fixtures__/base";
import type { TaxExtract } from "./analyse";
import { TAX_CHECKLIST, taxRegistry } from "./rules";

const rule = (id: string, params?: Record<string, unknown>): RuleDefinition => ({ id, title: id, severity: "block", kind: "deterministic", check: id, evidence: "e", ...(params ? { params } : {}) });
const run = (id: string, x: TaxExtract, params?: Record<string, unknown>) => taxRegistry.get(id)!(checkInput(x), rule(id, params));
const clean = () => extractOf("clean-salaried-new");

describe("default pack", () => {
  it("is valid, 1.0.0, every deterministic rule has a body, one LLM rule", () => {
    expect(ChecklistPackSchema.parse(TAX_CHECKLIST).version).toBe("1.0.0");
    expect(loadRuleSet(TAX_CHECKLIST, taxRegistry).ok).toBe(true);
    expect(TAX_CHECKLIST.rules.filter((r) => r.kind === "llm").map((r) => r.id)).toEqual(["tax.foreign-asset"]);
  });
  it("the clean salaried case passes or is n/a on every deterministic rule", () => {
    for (const r of TAX_CHECKLIST.rules.filter((x) => x.kind === "deterministic")) expect([r.id, run(r.id, clean()).status]).not.toEqual([r.id, "fail"]);
  });
});

describe("regime rules", () => {
  it("tax.regime-eligibility: old in time passes, old belated fails, new passes, firm na", () => {
    expect(run("tax.regime-eligibility", extractOf("clean-salaried-new", (o) => (o.profile.regimeClaimed = "old"))).status).toBe("pass");
    const late = run("tax.regime-eligibility", extractOf("clean-salaried-new", (o) => Object.assign(o.profile, { regimeClaimed: "old", plannedFilingDate: "2026-08-01" })));
    expect(late.status).toBe("fail");
    expect(late.message).toMatch(/filed by the due date 2026-07-31/);
    expect(run("tax.regime-eligibility", clean()).status).toBe("pass");
    expect(run("tax.regime-eligibility", extractOf("clean-firm-audit")).status).toBe("na");
  });
  it("tax.regime-deductions: any old-regime claim under the new regime fails", () => {
    expect(run("tax.regime-deductions", extractOf("clean-salaried-new", (o) => (o.deductions = { "80G": "1" }))).message).toMatch(/80G/);
    expect(run("tax.regime-deductions", extractOf("clean-salaried-new", (o) => (o.houseProperty = { selfOccupiedInterest: "1,00,000" }))).message).toMatch(/s.24\(b\)/);
    expect(run("tax.regime-deductions", clean()).status).toBe("pass");
  });
  it("tax.deduction-caps: at the cap passes, a rupee over fails", () => {
    const old = (c: string) => extractOf("clean-salaried-new", (o) => Object.assign(o.profile, { regimeClaimed: "old" }) && (o.deductions = { "80C": c }));
    expect(run("tax.deduction-caps", old("1,50,000")).status).toBe("pass");
    expect(run("tax.deduction-caps", old("1,50,001")).message).toMatch(/80C claimed ₹1,50,001.00, allowed ₹1,50,000.00/);
  });
  it("tax.regime-comparison: flags a costlier permissible choice; info only", () => {
    expect(run("tax.regime-comparison", extractOf("trap-senior-citizen-slab")).status).toBe("fail");
    expect(run("tax.regime-comparison", clean()).status).toBe("pass");
    expect(run("tax.regime-comparison", extractOf("clean-company-115baa")).status).toBe("na");
  });
});

describe("26AS / AIS", () => {
  it("tax.tds-mismatch: ₹1 off fails; within a tolerance param passes; no 26AS na", () => {
    const off = extractOf("trap-26as-tds-one-rupee");
    expect(run("tax.tds-mismatch", off).status).toBe("fail");
    expect(run("tax.tds-mismatch", off, { tolerancePaise: 100 }).status).toBe("pass");
    expect(run("tax.tds-mismatch", extractOf("typical-gap-missing-26as-ais", undefined, { matches: [] })).status).toBe("na");
  });
  it("tax.ais-not-in-books: not in books / reviewer question fail; clean passes; no AIS na", () => {
    const r = run("tax.ais-not-in-books", extractOf("clean-salaried-new", undefined, { matches: [CLEAN_MATCHES[0], { aisId: "A2", outcome: "insufficient_evidence", bookId: null }] }));
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/1 reviewer question/);
    expect(r.evidence?.location).toBe("ais.csv row 3");
    expect(run("tax.ais-not-in-books", extractOf("clean-salaried-new", undefined, { matches: [CLEAN_MATCHES[0], { aisId: "A2", outcome: "not_in_books", bookId: null }] })).message).toMatch(/not in the books/);
    expect(run("tax.ais-not-in-books", clean()).status).toBe("pass");
    expect(run("tax.ais-not-in-books", extractOf("typical-gap-missing-26as-ais", undefined, { matches: [] })).status).toBe("na");
  });
});

describe("business rules", () => {
  it("tax.presumptive-declared-lower: declared below the deemed income fails with the s.44AB clause; at or above passes; no scheme na", () => {
    const low = run("tax.presumptive-declared-lower", extractOf("trap-44ad-declared-below-deemed", undefined, { matches: [] }));
    expect(low).toMatchObject({ status: "fail", evidence: { quote: "declaredIncome 4,50,000.00", location: "organiser.json business.declaredIncome" } });
    expect(low.message).toMatch(/declared ₹4,50,000\.00 is below the s\.44AD deemed income ₹5,60,000\.00/);
    expect(low.message).toMatch(/s\.44AB\(e\) read with s\.44AD\(4\)-\(5\)/);
    expect(low.message).toMatch(/basic exemption \(₹4,00,000\.00\): total income ₹4,50,000\.00, so the audit is required/);
    const doc = run("tax.presumptive-declared-lower", extractOf("clean-44ada-doctor", (o) => (o.business.declaredIncome = "25,00,000")));
    expect(doc.message).toMatch(/s\.44AB\(d\) read with s\.44ADA\(4\)/);
    // Within the exemption: still flagged (lower declaration), but the audit is not required on this ground.
    const small = run("tax.presumptive-declared-lower", extractOf("trap-44ad-declared-below-deemed", (o) => (o.business.declaredIncome = "4,00,000"), { matches: [] }));
    expect(small.message).toMatch(/total income ₹4,00,000\.00, so the audit is not required on this ground/);
    expect(run("tax.presumptive-declared-lower", extractOf("clean-44ad-presumptive")).status).toBe("pass");
    expect(run("tax.presumptive-declared-lower", clean()).status).toBe("na");
    expect(run("tax.presumptive-declared-lower", extractOf("trap-44ad-over-limit-bearer-cheques", undefined, { matches: [] })).status).toBe("na");
  });
  it("tax.presumptive-conditions: over the limit fails, eligible passes, none claimed na", () => {
    expect(run("tax.presumptive-conditions", extractOf("trap-44ad-over-limit-bearer-cheques", undefined, { matches: [] })).status).toBe("fail");
    expect(run("tax.presumptive-conditions", extractOf("clean-44ad-presumptive")).message).toMatch(/presumptive income ₹11,40,000.00/);
    expect(run("tax.presumptive-conditions", clean()).status).toBe("na");
  });
  it("tax.audit-44ab: required and unplanned fails; planned passes; not required passes", () => {
    const x = extractOf("trap-44ad-over-limit-bearer-cheques", undefined, { matches: [] });
    expect(run("tax.audit-44ab", x).message).toMatch(/due date is 31 Oct 2026/);
    expect(run("tax.audit-44ab", extractOf("trap-44ad-over-limit-bearer-cheques", (o) => (o.profile.auditPlanned = true), { matches: [] })).status).toBe("pass");
    expect(run("tax.audit-44ab", clean()).message).toMatch(/no tax audit/);
  });
  it("tax.loss-carry-forward: belated loss fails; invalid brought-forward fails; nothing passes", () => {
    expect(run("tax.loss-carry-forward", extractOf("trap-belated-business-loss", undefined, { matches: [] })).message).toMatch(/cannot be carried forward/);
    const bf = extractOf("clean-salaried-new", undefined, { files: { "prior-itr.json": JSON.stringify({ ay: "2025-26", filedOn: "2025-07-25", dueDate: "2025-07-31", lossesCarriedForward: [{ ay: "2024-25", type: "business", amount: 1000, returnFiledInTime: false }] }) } });
    expect(run("tax.loss-carry-forward", bf).evidence?.location).toBe("prior-itr.json lossesCarriedForward");
    expect(run("tax.loss-carry-forward", clean()).message).toMatch(/no loss/);
    expect(run("tax.loss-carry-forward", extractOf("trap-belated-business-loss", (o) => (o.profile.plannedFilingDate = "2026-07-31"), { matches: [] })).message).toMatch(/carried forward/);
  });
  it("tax.msme-43bh: 46 days fails with the row; presumptive na; none passes", () => {
    const r = run("tax.msme-43bh", extractOf("trap-msme-46-days"));
    expect(r.status).toBe("fail");
    expect(r.evidence?.location).toBe("msme.csv row 2");
    expect(run("tax.msme-43bh", extractOf("clean-44ad-presumptive")).status).toBe("na");
    expect(run("tax.msme-43bh", extractOf("clean-firm-audit")).status).toBe("pass");
  });
});

describe("filing rules", () => {
  it("tax.advance-tax-interest: short fails; senior na; paid / below threshold pass", () => {
    expect(run("tax.advance-tax-interest", extractOf("typical-gap-advance-tax-short", undefined, { matches: [{ aisId: "A1", outcome: "matched", bookId: "B1" }] })).status).toBe("fail");
    expect(run("tax.advance-tax-interest", extractOf("trap-senior-citizen-slab", undefined, { matches: [] })).status).toBe("na");
    expect(run("tax.advance-tax-interest", extractOf("clean-firm-audit")).message).toMatch(/paid in time/);
    expect(run("tax.advance-tax-interest", clean()).message).toMatch(/below ₹10,000/);
  });
  it("tax.late-filing: a day late fails", () => {
    expect(run("tax.late-filing", extractOf("clean-salaried-new", (o) => (o.profile.plannedFilingDate = "2026-07-31"))).status).toBe("pass");
    expect(run("tax.late-filing", extractOf("clean-salaried-new", (o) => (o.profile.plannedFilingDate = "2026-08-01"))).message).toMatch(/234F ₹5,000.00/);
  });
  it("tax.itr-form: wrong form fails; none planned passes", () => {
    expect(run("tax.itr-form", extractOf("clean-salaried-new", (o) => (o.profile.itrFormPlanned = "ITR-2"))).message).toMatch(/ITR-2 planned but ITR-1 applies/);
    expect(run("tax.itr-form", extractOf("clean-salaried-new", (o) => (o.profile.itrFormPlanned = null))).status).toBe("pass");
  });
  it("tax.missing-docs and tax.mat-check", () => {
    expect(run("tax.missing-docs", extractOf("typical-gap-missing-26as-ais", undefined, { matches: [] })).message).toMatch(/Form 26AS/);
    expect(run("tax.mat-check", extractOf("trap-company-normal-mat")).status).toBe("fail");
    expect(run("tax.mat-check", extractOf("clean-company-115baa")).status).toBe("pass");
    expect(run("tax.mat-check", clean()).status).toBe("na");
  });
});

describe("mistake-loop checks", () => {
  it("tax.ais-category-present", () => {
    expect(run("tax.ais-category-present", extractOf("trap-ais-cash-deposit"), { categories: ["cash-deposit"] }).evidence?.location).toBe("ais.csv row 5");
    expect(run("tax.ais-category-present", clean(), { categories: ["cash-deposit"] }).status).toBe("pass");
    expect(run("tax.ais-category-present", clean()).status).toBe("pass");
  });
  it("tax.income-over with status scope", () => {
    const big = extractOf("trap-income-over-50-lakh", undefined, { matches: [] });
    expect(run("tax.income-over", big, { limitPaise: 50_00_000_00, statuses: ["individual"] }).status).toBe("fail");
    expect(run("tax.income-over", big, { limitPaise: 50_00_000_00 }).message).toMatch(/check the extra schedule/);
    expect(run("tax.income-over", extractOf("clean-company-115baa"), { limitPaise: 1, statuses: ["individual", "huf"] }).status).toBe("na");
    expect(run("tax.income-over", clean(), { limitPaise: 50_00_000_00 }).status).toBe("pass");
  });
  it("tax.tds-section-listed", () => {
    expect(run("tax.tds-section-listed", extractOf("trap-26as-194n"), { sections: ["194N"] }).evidence?.location).toBe("26as.csv row 4");
    expect(run("tax.tds-section-listed", clean(), { sections: ["194N"] }).status).toBe("pass");
  });
});
