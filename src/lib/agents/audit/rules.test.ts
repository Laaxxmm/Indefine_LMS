import { describe, expect, it } from "vitest";
import { ChecklistPackSchema, loadRuleSet, type RuleDefinition } from "@/lib/agents/core/checklist";
import type { JobContext } from "@/lib/agents/core/runner";
import { parseCsv } from "@/lib/agents/books/table";
import { parseTb } from "@/lib/agents/books/tb";
import { normalizeAuditExtract } from "./analysis";
import type { EntityProfile } from "./caro";
import type { AuditExtract, Population } from "./inputs";
import { composeSystemPrompt } from "@/lib/agents/core/guardrails/scope";
import { opinionHits } from "./opinion";
import { AUDIT_CHECKLIST, auditLlmContext, auditRegistry, type AuditCheckInput } from "./rules";
import { AUDIT_CHECK_SYSTEM, AUDIT_MODEL_TASKS, AUDIT_PREAMBLE } from "./tasks";

const JOB: JobContext = { jobTaskId: "j", title: "Audit", service: "Audit", fy: "2025-26", period: "Annual", clientCode: "ACME01", clientName: "Acme", assigneeId: null, reviewerId: null };
const tb = (csv: string, file = "tb.csv") => parseTb(file, parseCsv(`Ledger,Group,Debit,Credit\n${csv}`)).tb!;
const TB = "Capital,Capital Account,,1000.00\nSales,Sales Accounts,,10000.00\nCash,Cash-in-Hand,1000.00,\nPurchases,Purchase Accounts,10000.00,";
const PROFILE: EntityProfile = { companyClass: "private", holdingOrSubsidiary: false, holdingOrSubsidiaryOfPublic: false, paidUpCapitalPaise: 100000, reservesPaise: 0, maxBorrowingsPaise: 0, turnoverPaise: 1000000, priorTurnoverPaise: 1000000, materialityPaise: null };
const pop = (over: Partial<Population["config"]> = {}, n = 30, amount = 10000): Population => ({
  name: "sales",
  file: "population-sales.csv",
  items: Array.from({ length: n }, (_, i) => ({ row: i + 2, date: "2025-05-01", ref: `INV-${i}`, party: "P", amountPaise: amount })),
  config: { method: "mus", sampleSize: 25, seed: "s/sales", tbLedgers: [], ...over },
});
const ex = (over: Partial<AuditExtract> = {}): AuditExtract =>
  normalizeAuditExtract({ files: [{ name: "tb.csv", kind: "tb" }], tb: tb(TB), priorTb: tb(TB, "tb-prior.csv"), profile: PROFILE, populations: [pop()], notes: { file: "notes.txt", lines: ["x"] }, ...over });
const ruleOf = (id: string): RuleDefinition => AUDIT_CHECKLIST.rules.find((r) => r.id === id) ?? { id, title: id, severity: "warn", kind: "deterministic", check: id, evidence: "x" };
const run = (id: string, e: AuditExtract, over: Partial<RuleDefinition> = {}) => auditRegistry.get(id)!({ input: { files: [] }, extracted: e, figures: {}, job: JOB } as AuditCheckInput, { ...ruleOf(id), ...over });

describe("audit SOP pack", () => {
  it("valid v1.0.0, deterministic rules implemented, one LLM rule, numeric thresholds carry verify notes", () => {
    expect(ChecklistPackSchema.safeParse(AUDIT_CHECKLIST).success).toBe(true);
    expect(AUDIT_CHECKLIST).toMatchObject({ key: "audit", version: "1.0.0" });
    expect(loadRuleSet(AUDIT_CHECKLIST, auditRegistry).ok).toBe(true);
    expect(AUDIT_CHECKLIST.rules.filter((r) => r.kind === "llm").map((r) => r.id)).toEqual(["audit.related-party-disclosure"]);
    for (const r of AUDIT_CHECKLIST.rules) {
      if (Object.entries(r.params ?? {}).some(([k, v]) => typeof v === "number" && k !== "tolerancePaise")) expect(typeof r.params?.verify, r.id).toBe("string");
    }
    expect(AUDIT_CHECKLIST.rules.filter((r) => r.severity === "block").map((r) => r.id)).toEqual(["audit.tb-balanced", "audit.lead-tie", "audit.sample-below-minimum"]);
    expect(String(AUDIT_CHECKLIST.rules.find((r) => r.id === "audit.sample-below-minimum")?.params?.verify)).toMatch(/partner to confirm SOP/);
  });
  it("the related-party question carries the abstain instruction; the department preamble is the task's system prompt (ADR-008)", () => {
    const q = AUDIT_CHECKLIST.rules.find((r) => r.kind === "llm")!.check;
    expect(q).not.toMatch(/Statutory audit working papers only/);
    expect(q).toContain('"insufficient_evidence"');
    expect(AUDIT_CHECK_SYSTEM).toMatch(/Statutory audit working papers only; never give an audit opinion/);
    expect(composeSystemPrompt("Audit", AUDIT_MODEL_TASKS[0])).toContain(AUDIT_PREAMBLE);
  });
});

describe("block rules", () => {
  it("tb-balanced: pass / ₹0.01 off fails / unreadable fails", () => {
    expect(run("audit.tb-balanced", ex()).status).toBe("pass");
    const off = run("audit.tb-balanced", ex({ tb: tb(TB.replace("1000.00,\n", "1000.01,\n")) }));
    expect(off.status).toBe("fail");
    expect(off.message).toContain("₹0.01");
    expect(run("audit.tb-balanced", ex({ tb: null })).status).toBe("fail");
    expect(run("audit.tb-balanced", ex({ tb: null, files: [] })).evidence?.location).toBe("trial balance");
  });
  it("lead-tie: every ledger mapped passes; an unmapped CY or PY ledger fails; na without TB", () => {
    expect(run("audit.lead-tie", ex()).status).toBe("pass");
    const cy = run("audit.lead-tie", ex({ tb: tb(`${TB}\nSuspense,Suspense A/c,1.00,`) }));
    expect(cy.status).toBe("fail");
    expect(cy.evidence).toEqual({ quote: "Suspense Suspense A/c", location: "tb.csv row 6" });
    const py = run("audit.lead-tie", ex({ priorTb: tb(`${TB}\nOdd,,1.00,`, "tb-prior.csv") }));
    expect(py.evidence?.location).toBe("tb-prior.csv row 6");
    expect(run("audit.lead-tie", ex({ tb: null })).status).toBe("na");
    // Zoho account types mapped through a noted pattern: still a pass, with the grouping to confirm.
    const zoho = run("audit.lead-tie", ex({ tb: tb("Machine,Fixed Asset,100.00,\nCapital,Equity,,100.00"), priorTb: null }));
    expect(zoho.status).toBe("pass");
    expect(zoho.message).toBe('Lead schedules tie. Groupings to confirm: "Fixed Asset" → L-E (Zoho "Fixed Asset" (singular) → property, plant and equipment — partner to confirm Schedule III grouping.)');
  });
});

describe("warn / info rules", () => {
  it("prior-tb-balanced", () => {
    expect(run("audit.prior-tb-balanced", ex()).status).toBe("pass");
    expect(run("audit.prior-tb-balanced", ex({ priorTb: tb(TB.replace("1000.00,\n", "999.00,\n"), "p.csv") })).status).toBe("fail");
    expect(run("audit.prior-tb-balanced", ex({ priorTb: null })).status).toBe("na");
  });
  it("variance-unexplained: explained by WP ref or area name; na without PY", () => {
    // Materiality 1% of revenue 10,000 = 100; PM 75. Sales CY 10,000 vs PY 5,000 (Δ 5,000 ≥ 75, 100%) → material.
    const py = tb("Capital,Capital Account,,1000.00\nSales,Sales Accounts,,5000.00\nCash,Cash-in-Hand,1000.00,\nPurchases,Purchase Accounts,5000.00,", "p.csv");
    const f = run("audit.variance-unexplained", ex({ priorTb: py }));
    expect(f.status).toBe("fail");
    expect(f.message).toMatch(/^2 material variance/);
    expect(run("audit.variance-unexplained", ex({ priorTb: py, explanations: [{ row: 2, key: "L-K", text: "a" }, { row: 3, key: "purchases and direct costs", text: "b" }] })).status).toBe("pass");
    expect(run("audit.variance-unexplained", ex({ priorTb: null })).status).toBe("na");
  });
  it("caro-undetermined / caro-applicable", () => {
    expect(run("audit.caro-undetermined", ex()).status).toBe("pass");
    expect(run("audit.caro-undetermined", ex({ profile: null })).status).toBe("fail");
    expect(run("audit.caro-applicable", ex()).status).toBe("pass");
    const pub = run("audit.caro-applicable", ex({ profile: { ...PROFILE, companyClass: "public" } }));
    expect(pub.status).toBe("fail");
    expect(pub.message).toMatch(/clause\(s\) applicable/);
  });
  it("caro-small-company-pending-verification: fails only when the unverified limits would change CARO applicability", () => {
    const CR = 1_000_000_000;
    expect(run("audit.caro-small-company-pending-verification", ex({ fy: "2025-26" })).status).toBe("pass");
    const between = { ...PROFILE, paidUpCapitalPaise: 6 * CR, reservesPaise: 4.5 * CR, maxBorrowingsPaise: 2 * CR, turnoverPaise: 75 * CR, priorTurnoverPaise: 70 * CR };
    const r = run("audit.caro-small-company-pending-verification", ex({ fy: "2025-26", profile: between, files: [{ name: "entity.json", kind: "entity" }] }));
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/Applied \(verified — Companies \(Specification of Definitions Details\) Amendment Rules, 2022 .*: paid-up ≤ ₹4 crore, preceding-year turnover ≤ ₹40 crore\): the Order is applicable\. Unverified limits from 01 Dec 2025 \(paid-up ≤ ₹10 crore, turnover ≤ ₹100 crore\): it would be not applicable/);
    expect(r.evidence).toEqual({ location: "entity.json" });
    expect(opinionHits(r.message ?? "")).toEqual([]);
    // The year audited ends before the unverified entry: nothing pending.
    expect(run("audit.caro-small-company-pending-verification", ex({ fy: "2024-25", profile: between })).status).toBe("pass");
    // The applied determination stays on the verified limits.
    expect(run("audit.caro-applicable", ex({ fy: "2025-26", profile: between })).status).toBe("fail");
  });
  it("sample-below-minimum: 25 passes, 24 fails, smaller population is fine, na without populations", () => {
    expect(run("audit.sample-below-minimum", ex()).status).toBe("pass");
    expect(run("audit.sample-below-minimum", ex({ populations: [pop({ sampleSize: 24 })] })).status).toBe("fail");
    expect(run("audit.sample-below-minimum", ex({ populations: [pop({ sampleSize: 10 }, 10)] })).status).toBe("pass");
    expect(run("audit.sample-below-minimum", ex({ populations: [pop({ sampleSize: null })] })).status).toBe("pass");
    expect(run("audit.sample-below-minimum", ex({ populations: [pop({ sampleSize: 24 })] }), { params: { minSampleSize: 24 } }).status).toBe("pass");
    expect(run("audit.sample-below-minimum", ex({ populations: [] })).status).toBe("na");
  });
  it("population-tie: ties to the named TB ledgers exactly; ₹0.01 off fails; na when not linked", () => {
    expect(run("audit.population-tie", ex()).status).toBe("na");
    expect(run("audit.population-tie", ex({ populations: [pop({ tbLedgers: ["Sales"] }, 100, 10000)] })).status).toBe("pass"); // 100 × ₹100 = ₹10,000
    const off = run("audit.population-tie", ex({ populations: [pop({ tbLedgers: ["sales"] }, 100, 9999)] }));
    expect(off.status).toBe("fail");
    expect(off.evidence?.location).toBe("population-sales.csv");
  });
  it("opinion wording in echoed inputs is flagged", () => {
    expect(run("audit.opinion-language-in-inputs", ex()).status).toBe("pass");
    const r = run("audit.opinion-language-in-inputs", ex({ files: [{ name: "explanations.csv", kind: "explanations" }], explanations: [{ row: 3, key: "L-K", text: "In our opinion it grew" }] }));
    expect(r.evidence).toEqual({ quote: "in our opinion", location: "explanations.csv row 3" });
    expect(run("audit.opinion-language-in-inputs", ex({ populations: [{ ...pop(), items: [{ row: 2, date: null, ref: "X", party: "We certify Ltd", amountPaise: 1 }] }] })).status).toBe("fail");
  });
  it("parse-issues and inputs-missing", () => {
    expect(run("audit.parse-issues", ex()).status).toBe("pass");
    expect(run("audit.parse-issues", ex({ issues: [{ file: "a.csv", row: 0, message: "bad" }] })).evidence?.location).toBe("a.csv");
    expect(run("audit.parse-issues", ex({ issues: [{ file: "a.csv", row: 4, message: "bad" }] })).evidence?.location).toBe("a.csv row 4");
    expect(run("audit.inputs-missing", ex()).status).toBe("pass");
    expect(run("audit.inputs-missing", ex({ notes: null, priorTb: null, profile: null, populations: [] })).message).toMatch(/Prior-year.*Entity profile.*Ledger detail.*Disclosure notes/);
  });
});

describe("parameterised checks (promoted mistakes)", () => {
  it("ledger-name-present", () => {
    const e = ex({ tb: tb(`${TB}\nLoan from Director - S Rao,Unsecured Loans,,1.00\nDirector Loan Nil,Unsecured Loans,0,0`) });
    expect(run("audit.ledger-name-present", e, { params: { patterns: ["loan from director"] } }).status).toBe("fail");
    expect(run("audit.ledger-name-present", e, { params: { patterns: ["director loan"] } }).status).toBe("pass"); // zero balance ignored
    expect(run("audit.ledger-name-present", e).status).toBe("pass");
    expect(run("audit.ledger-name-present", ex({ tb: null })).status).toBe("na");
  });
  it("balance-sign", () => {
    const e = ex({ tb: tb(`${TB}\nOmega (advance),Sundry Debtors,,1.00\nVendor,Sundry Creditors,2.00,`) });
    expect(run("audit.balance-sign", e, { params: { groupPatterns: ["sundry debtors"], expect: "dr" } }).status).toBe("fail");
    expect(run("audit.balance-sign", e, { params: { groupPatterns: ["sundry creditors"], expect: "cr" } }).status).toBe("fail");
    expect(run("audit.balance-sign", e, { params: { groupPatterns: ["capital"], expect: "cr" } }).status).toBe("pass");
    expect(run("audit.balance-sign", ex({ tb: null })).status).toBe("na");
  });
  it("ledger-over-materiality: materiality 1% of ₹10,000 = ₹100; cash ₹1,000", () => {
    const e = ex();
    expect(run("audit.ledger-over-materiality", e, { params: { ledgerPatterns: ["^cash"], percentOfMateriality: 100 } }).status).toBe("fail");
    expect(run("audit.ledger-over-materiality", e, { params: { ledgerPatterns: ["^cash"], percentOfMateriality: 1000 } }).status).toBe("pass"); // limit ₹1,000, not above
    expect(run("audit.ledger-over-materiality", ex({ tb: null })).status).toBe("na");
  });
  it("a partial extract (replayed example) is normalised", () => {
    const partial = { tb: tb(`${TB}\nLoan from Director - X,Unsecured Loans,,1.00`) };
    const r = auditRegistry.get("audit.ledger-name-present")!({ input: undefined, extracted: partial, figures: {}, job: JOB } as unknown as AuditCheckInput, { ...ruleOf("audit.ledger-name-present"), params: { patterns: ["loan from director"] } });
    expect(r.status).toBe("fail");
  });
});

describe("LLM context", () => {
  it("lists every TB ledger with file + row and every non-blank note line; says when notes are absent", () => {
    const ctx = auditLlmContext({ input: { files: [] }, extracted: ex({ notes: { file: "notes.txt", lines: ["Related parties:", "", " Mr X, Director "] } }), figures: {}, job: JOB } as AuditCheckInput);
    expect(ctx).toContain("tb.csv row 2: Capital | Capital Account");
    expect(ctx).toContain("notes.txt line 3: Mr X, Director");
    expect(ctx).not.toContain("line 2:");
    const none = auditLlmContext({ input: { files: [] }, extracted: ex({ notes: null, tb: null }), figures: {}, job: JOB } as AuditCheckInput);
    expect(none).toContain("Disclosure notes: (no disclosure notes supplied)");
    expect(none).toContain("(trial balance not readable)");
  });
});
