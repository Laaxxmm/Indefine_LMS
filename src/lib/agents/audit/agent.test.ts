import { describe, expect, it } from "vitest";
import { compareFigures, failureDetails } from "@/lib/agents/core/accuracy";
import { loadApprovedMistakes, loadFixtures, packWithMistakes, runAgentAccuracy, runFixtureOnce } from "@/lib/agents/core/accuracy-run";
import { runChecklist, loadRuleSet } from "@/lib/agents/core/checklist";
import { createMemoryDb } from "@/lib/agents/core/memory-db";
import { createMemoryStore } from "@/lib/agents/core/memory-store";
import { staticInputSource } from "@/lib/agents/core/inputs";
import { previewWorkbook } from "@/lib/agents/core/preview";
import { createRecordedRouter } from "@/lib/agents/core/recorded-router";
import { runAgent, type InputFile, type JobContext } from "@/lib/agents/core/runner";
import { WrongDepartmentError } from "@/lib/agents/books/department";
import { getAgent } from "@/lib/agents/registry";
import { analyzeAudit, plannedSize } from "./analysis";
import { DRAFT_FOR_PARTNER } from "./config";
import { AUDIT_RELATED_PARTY_TASK, auditAgent, computeAuditFigures } from "./index";
import { auditInputSchema, classifyAuditFile, parseAuditFiles, parsePopulation, parseProfile, type AuditInput } from "./inputs";
import { opinionHits } from "./opinion";
import { AUDIT_PACK_TITLE, OPINION_EXEMPT, auditPack } from "./pack";
import { auditLlmContext, type AuditCheckInput } from "./rules";
import { AUDIT_CHECK_SYSTEM, AUDIT_MODEL_TASKS, auditTaskIds, isInsufficient, validateRelatedPartyVerdict } from "./tasks";
import { parseCsv } from "@/lib/agents/books/table";

const ROOT = "fixtures/accuracy";
const fixtures = loadFixtures(ROOT, "audit");
const byId = (id: string) => fixtures.find((f) => f.id === id)!;
const JOB: JobContext = { jobTaskId: "j", title: "Audit", service: "Audit", fy: "2025-26", period: "Annual", clientCode: "ACME01", clientName: "Acme", assigneeId: null, reviewerId: null };
const toInput = (files: InputFile[]): AuditInput => ({ files: files.map((f) => ({ name: f.name, kind: classifyAuditFile(f.name), bytes: f.bytes })) });

describe("audit agent definition", () => {
  it("is registered with the Audit service and audit model agent", () => {
    expect(getAgent("audit")).toBe(auditAgent);
    expect(auditAgent).toMatchObject({ key: "audit", service: "Audit", sopPackKey: "audit", modelAgent: "audit" });
    expect(typeof auditAgent.probeMutation).toBe("function");
  });
  it("classifies files", () => {
    expect(classifyAuditFile("trial-balance.csv")).toBe("tb");
    expect(classifyAuditFile("trial-balance-prior.csv")).toBe("tb-prior");
    expect(classifyAuditFile("TB_PY_2024-25.xlsx")).toBe("tb-prior");
    expect(classifyAuditFile("tb-copy.csv")).toBe("tb");
    expect(classifyAuditFile("entity.json")).toBe("entity");
    expect(classifyAuditFile("sampling.json")).toBe("sampling");
    expect(classifyAuditFile("population-sales.csv")).toBe("population");
    expect(classifyAuditFile("variance-explanations.csv")).toBe("explanations");
    expect(classifyAuditFile("notes.txt")).toBe("notes");
    expect(classifyAuditFile("hdfc-statement.csv")).toBe("bank-statement");
    expect(classifyAuditFile("photo.jpg")).toBeNull();
    expect(classifyAuditFile("random.csv")).toBeNull();
  });
  it("model-task registry: one versioned task, the framework system prompt, the related-party rule", () => {
    expect(auditTaskIds()).toEqual(["audit.check:audit.related-party-disclosure@1"]);
    expect(AUDIT_MODEL_TASKS[0]).toMatchObject({ name: AUDIT_RELATED_PARTY_TASK, version: 1, systemPrompt: AUDIT_CHECK_SYSTEM, rules: ["audit.related-party-disclosure"], ruleIds: ["audit.related-party-disclosure"] });
    expect(auditAgent.scope?.tasks).toEqual([...AUDIT_MODEL_TASKS]);
  });
});

describe("wrong department fails closed before any model call", () => {
  it("GST registers → GST Prep; a bank statement without a TB → Books Close", () => {
    const gst = auditInputSchema.safeParse([{ name: "sales-register.csv", source: "fixture", bytes: Buffer.from("GSTIN,Invoice No,Taxable Value\n29AAACE1234F1Z2,1,100") }]);
    expect(gst.success).toBe(false);
    if (!gst.success) expect(gst.error.issues[0].message).toMatch(/GST Prep agent \(\/agents\/gst\)/);
    const bank = auditInputSchema.safeParse([{ name: "hdfc-statement.csv", source: "fixture", bytes: Buffer.from("Date,Narration,Withdrawal\n01/04/2025,x,1") }]);
    if (!bank.success) expect(bank.error.issues[0].message).toMatch(/Books Close agent \(\/agents\/books\)/);
    expect(bank.success).toBe(false);
    const none = auditInputSchema.safeParse([{ name: "readme.txt", source: "fixture", bytes: Buffer.from("hello") }]);
    if (!none.success) expect(none.error.issues[0].message).toMatch(/year-end trial balance/);
  });
  it("a 'TB' that is really an ROC register stops in extract", async () => {
    const input = toInput([{ name: "trial-balance.csv", source: "fixture", bytes: Buffer.from("Folio,Name,No. of Shares,DIN\n1,X,100,01234567") }]);
    await expect(auditAgent.extract({ input, files: [], job: JOB, runId: "r", notes: null, model: (async () => ({})) as never })).rejects.toBeInstanceOf(WrongDepartmentError);
  });
});

describe("input parsing", () => {
  it("entity profile: rupee amounts → paise; bad JSON / schema / amount reported", () => {
    const issues: { file: string; row: number; message: string }[] = [];
    const p = parseProfile("entity.json", JSON.stringify({ companyClass: "private", paidUpCapital: "1,00,000.50", turnover: 12000000 }), issues);
    expect(p).toMatchObject({ paidUpCapitalPaise: 10000050, turnoverPaise: 1200000000, reservesPaise: null });
    expect(parseProfile("e.json", "{", issues)).toBeNull();
    expect(parseProfile("e.json", JSON.stringify({ companyClass: "llc" }), issues)).toBeNull();
    parseProfile("e.json", JSON.stringify({ companyClass: "public", reserves: "abc" }), issues);
    expect(issues.map((i) => i.message)).toEqual(["entity profile is not valid JSON", expect.stringMatching(/companyClass/), expect.stringMatching(/reserves/)]);
  });
  it("population: amount or debit/credit columns, totals and zero rows skipped, bad amounts reported", () => {
    const r = parsePopulation("p.csv", parseCsv("Date,Voucher No,Particulars,Debit,Credit\n01/04/2025,V1,Rent,100.00,\n02/04/2025,V2,Refund,,40.00\n,Total,,100,40\n03/04/2025,V3,Zero,0,\n04/04/2025,V4,Bad,x,"));
    expect(r.items!.map((i) => [i.ref, i.amountPaise, i.date])).toEqual([
      ["V1", 10000, "2025-04-01"],
      ["V2", -4000, "2025-04-02"],
    ]);
    expect(r.issues).toHaveLength(1);
    expect(parsePopulation("p.csv", parseCsv("a,b\n1,2")).items).toBeNull();
  });
  it("seeds: plan population seed > plan seed + name > client/FY/name; bad plan and second files reported", async () => {
    const mk = (name: string, s: string) => ({ name, source: "fixture" as const, bytes: Buffer.from(s) });
    const pop = "Date,Invoice No,Party,Amount\n01/04/2025,I1,A,100";
    const tbCsv = "Ledger,Group,Debit,Credit\nCash,Cash-in-Hand,1,\nCapital,Capital Account,,1";
    const a = await parseAuditFiles(toInput([mk("trial-balance.csv", tbCsv), mk("population-sales.csv", pop), mk("population-exp.csv", pop), mk("sampling.json", JSON.stringify({ seed: "PLAN", populations: { sales: { seed: "OWN", method: "random" } } }))]), JOB);
    expect(a.populations.map((p) => [p.name, p.config.seed, p.config.method])).toEqual([
      ["sales", "OWN", "random"],
      ["exp", "PLAN/exp", "mus"],
    ]);
    const b = await parseAuditFiles(toInput([mk("trial-balance.csv", tbCsv), mk("tb-2.csv", tbCsv), mk("population-sales.csv", pop), mk("sampling.json", '{"oops": 1}'), mk("column-map.json", "{bad"), mk("notes.csv", "Note\nRelated: none"), mk("explanations.csv", "foo,bar")]), JOB);
    expect(b.populations[0].config.seed).toBe("ACME01/FY2025-26/sales");
    expect(b.notes).toEqual({ file: "notes.csv", lines: ["Note", "Related: none"] });
    expect(b.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/sampling plan ignored/), "column-map file is not valid JSON; ignored", "a second tb file; only the first is used", expect.stringMatching(/Area and Explanation/)]),
    );
  });
  it("planned size: plan > MUS formula (≥ SOP minimum) > SOP minimum; capped at the item count", () => {
    const pop = (method: "mus" | "random", n: number, amount: number, sampleSize: number | null) => ({ name: "p", file: "p.csv", items: Array.from({ length: n }, (_, i) => ({ row: i, date: null, ref: "", party: "", amountPaise: amount })), config: { method, sampleSize, seed: "s", tbLedgers: [] } });
    expect(plannedSize(pop("mus", 100, 1000, 30), 1)).toBe(30);
    expect(plannedSize(pop("mus", 10, 1000, 30), 1)).toBe(10);
    expect(plannedSize(pop("mus", 1000, 1000, null), 30000)).toBe(100); // ⌈1,000,000 × 3 / 30,000⌉ = 100
    expect(plannedSize(pop("mus", 1000, 1000, null), 3000000)).toBe(25); // formula 1 → SOP minimum
    expect(plannedSize(pop("random", 1000, 1000, null), 1)).toBe(25);
  });
});

describe("LLM verdict validation (grounding) and insufficient_evidence", () => {
  const ctx = "Trial balance ledgers (tb.csv):\ntb.csv row 7: Loan from Director - Mr R Kumar | Unsecured Loans\ntb.csv row 12: Cash | Cash-in-Hand\n\nDisclosure notes: (no disclosure notes supplied)";
  it("accepts a verbatim quote at a real row; refuses invented quotes, rows and numbers", () => {
    expect(validateRelatedPartyVerdict({ status: "fail", evidence: { quote: "loan from director -  mr r kumar", location: "tb.csv row 7" } }, ctx)).toEqual([]);
    expect(validateRelatedPartyVerdict({ status: "fail", evidence: { quote: "Loan from Director - Mr S Iyer", location: "tb.csv row 7" } }, ctx)).toHaveLength(1);
    expect(validateRelatedPartyVerdict({ status: "fail", evidence: { quote: "Cash", location: "tb.csv row 1" } }, ctx)).toEqual(['location "tb.csv row 1" does not name a document row or line']);
    expect(validateRelatedPartyVerdict({ status: "pass", evidence: { quote: "row 1", location: "Disclosure notes" } }, ctx)).toEqual(["number 1 in the quote is not in the documents"]);
    expect(validateRelatedPartyVerdict({ status: "na", message: "unsure", evidence: { quote: "(no disclosure notes supplied)", location: "Disclosure notes" } }, ctx)).toEqual(['na must carry the message "insufficient_evidence"']);
    expect(validateRelatedPartyVerdict({ status: "na", message: `insufficient_evidence ${"x".repeat(300)}`, evidence: { quote: "(no disclosure notes supplied)", location: "Disclosure notes" } }, ctx)).toEqual(["message longer than 300 characters"]);
    expect(validateRelatedPartyVerdict({ status: "na", message: "insufficient_evidence: none", evidence: { quote: "(no disclosure notes supplied)", location: "Disclosure notes" } }, ctx)).toEqual([]);
  });
  it("every recorded verdict in the fixtures passes the validator against its own llmContext", async () => {
    for (const fx of fixtures) {
      const v = fx.recorded[AUDIT_RELATED_PARTY_TASK] as Parameters<typeof validateRelatedPartyVerdict>[0];
      expect(v, fx.id).toBeTruthy();
      const extracted = await parseAuditFiles(toInput(fx.inputFiles), JOB);
      const context = auditLlmContext({ input: { files: [] }, extracted, figures: {}, job: JOB } as AuditCheckInput);
      expect(validateRelatedPartyVerdict(v, context), fx.id).toEqual([]);
    }
  });
  it("the engine keeps the insufficient_evidence verdict (na, no evidence flag) and the pack turns it into pending information", async () => {
    const fx = byId("typical-gap-insufficient-evidence");
    const extracted = await parseAuditFiles(toInput(fx.inputFiles), JOB);
    const loaded = loadRuleSet(auditAgent.defaultChecklist, auditAgent.checklistRegistry);
    if (!loaded.ok) throw new Error(loaded.errors.join());
    const ci = { input: toInput(fx.inputFiles), extracted, figures: computeAuditFigures(extracted), job: JOB };
    const results = await runChecklist(loaded.ruleSet, ci, { registry: auditAgent.checklistRegistry, llmCheck: async () => fx.recorded[AUDIT_RELATED_PARTY_TASK], llmContext: (_r, x) => auditLlmContext(x as AuditCheckInput) });
    const rp = results.find((r) => r.ruleId === "audit.related-party-disclosure")!;
    expect(rp).toMatchObject({ status: "na", source: "llm", flags: [] });
    expect(isInsufficient(rp)).toBe(true);
    const sheets = (auditPack({ ...ci, results })[0] as { sheets: { name: string; rows: Record<string, unknown>[] }[] }).sheets;
    const pending = sheets.find((s) => s.name === "Pending information")!.rows.map((r) => String(r.item));
    expect(pending).toContain("Related-party ledgers are covered by the disclosure note: documents insufficient");
  });
});

describe("pipeline on fixtures", () => {
  it("≥ 10 fixtures, every category, block and warn support, ≥ 3 approved mistakes, an insufficient_evidence fixture", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    expect(new Set(fixtures.map((f) => f.expected.category))).toEqual(new Set(["clean", "typical-gap", "trap"]));
    expect(new Set(fixtures.flatMap((f) => f.expected.flags.map((x) => x.severity)))).toEqual(new Set(["block", "warn", "info"]));
    expect(loadApprovedMistakes(ROOT, "audit").length).toBeGreaterThanOrEqual(3);
    expect(fixtures.some((f) => (f.recorded[AUDIT_RELATED_PARTY_TASK] as { message?: string }).message?.startsWith("insufficient_evidence"))).toBe(true);
  });
  it("recorded.json holds only the related-party verdict — never parsed rows or totals", () => {
    for (const f of fixtures) expect(Object.keys(f.recorded), f.id).toEqual([AUDIT_RELATED_PARTY_TASK]);
  });
  it("figures come from input/: +₹1 on one TB amount is reported as a figure mismatch (probe)", async () => {
    const fx = byId("clean-private-small-company");
    const pack = packWithMistakes(auditAgent, loadApprovedMistakes(ROOT, "audit"));
    const mutated = { ...fx, inputFiles: auditAgent.probeMutation!(fx.inputFiles) };
    expect(mutated.inputFiles.find((f) => f.name === "trial-balance.csv")!.bytes.toString()).toContain("Share Capital,Capital Account,,1000001.00") // +₹1 = 100 paise;
    const out = await runFixtureOnce(auditAgent, mutated, pack);
    expect(compareFigures(fx.expected.figures, out.figures).map((d) => [d.key, d.deltaPaise])).toEqual([
      ["tbCreditPaise", 100],
      ["tbDifferencePaise", -100],
    ]);
    expect(out.flags).toContainEqual({ ruleId: "audit.tb-balanced", severity: "block" });
    expect(auditAgent.probeMutation!([{ name: "notes.txt", source: "fixture", bytes: Buffer.from("x") }])[0].bytes.toString()).toBe("x");
  });
  it("the audit accuracy gate passes (thresholds unchanged)", async () => {
    const score = await runAgentAccuracy(auditAgent, { root: ROOT });
    expect(failureDetails(score)).toEqual([]);
    expect(score.pass).toBe(true);
  }, 60_000);
  it("no opinion wording anywhere in the working papers of any fixture (except CARO clause titles); every sheet titled for the engagement partner", async () => {
    for (const fx of fixtures) {
      const now = new Date("2026-11-05T06:30:00Z");
      const db = createMemoryDb({ now: () => now });
      const store = createMemoryStore();
      db.seed("client", [{ id: "c", name: "Fixture" }]);
      db.seed("firmClient", [{ id: "fc", lmsClientId: "c", clientCode: "FIXT01" }]);
      db.seed("jobTask", [{ id: "j", firmClientId: "fc", service: "Audit", fy: "2025-26", period: "Annual", title: "Audit", state: "ASSIGNED", assigneeId: "a", reviewerId: "r" }]);
      db.seed("sopPack", [{ key: "audit", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Audit", checklist: auditAgent.defaultChecklist }]);
      const res = await runAgent(auditAgent, "j", { db, router: createRecordedRouter(fx.recorded), store, inputs: staticInputSource(fx.inputFiles), now: () => now, ids: () => "run-1" });
      expect(res.ok, fx.id).toBe(true);
      const dir = "FY2025-26/Audit/Annual/Working";
      const file = store.list(dir)[0];
      expect(file).toBe("FIXT01_Audit-working-papers_Annual_v1.xlsx");
      const pv = await previewWorkbook((await store.read("memory-drive", dir, file)) as Buffer, { maxRows: 1000 });
      for (const s of pv.sheets) {
        expect(s.rows[0][0], `${fx.id}/${s.name}`).toBe(AUDIT_PACK_TITLE);
        const titleCol = s.name === "CARO 2020" ? 1 : -1;
        s.rows.slice(1).forEach((row) =>
          row.forEach((cell, c) => {
            if (c === titleCol) return;
            expect(opinionHits(cell), `${fx.id}/${s.name}: ${cell}`).toEqual([]);
          }),
        );
      }
    }
    expect(AUDIT_PACK_TITLE).toContain(DRAFT_FOR_PARTNER);
    expect(OPINION_EXEMPT).toEqual({ "CARO 2020": ["title"] });
  }, 60_000);
  it("an opinion-worded explanation is withheld in the lead schedule; the seed is written into the sampling plan", async () => {
    const fx = byId("trap-opinion-wording-in-explanation");
    const extracted = await parseAuditFiles(toInput(fx.inputFiles), JOB);
    const drafts = auditPack({ extracted, figures: computeAuditFigures(extracted), job: JOB, results: [] });
    const sheets = (drafts[0] as { sheets: { name: string; rows: Record<string, unknown>[] }[] }).sheets;
    const lk = sheets.find((s) => s.name === "Lead schedules")!.rows.find((r) => r.wp === "L-K")!;
    expect(String(lk.explanation)).toMatch(/^\[withheld/);
    const plan = sheets.find((s) => s.name === "Sampling plan")!.rows;
    expect(plan.map((r) => r.seed)).toEqual(["FIXTURE-FY2025-26/expenses", "FIXTURE-FY2025-26/sales"]); // file-name order
    const a = analyzeAudit(extracted);
    expect(plan[0].fingerprint).toBe(a.samples[0].result.fingerprint);
  });
  it("works without prior TB, profile or populations (materiality falls back to TB debits when no revenue)", async () => {
    const tbOnly = [{ name: "trial-balance.csv", source: "fixture" as const, bytes: Buffer.from("Ledger,Group,Debit,Credit\nCash,Cash-in-Hand,1000.00,\nCapital,Capital Account,,1000.00") }];
    const extracted = await parseAuditFiles(toInput(tbOnly), JOB);
    const f = computeAuditFigures(extracted);
    expect(f).toMatchObject({ materialityPaise: 500, performanceMaterialityPaise: 300, caroApplicable: -1, samplePopulationCount: 0, revenuePaise: 0 }); // 0.5% × ₹1,000 = ₹5; 75% = ₹3.75 → ₹3
    expect(f.priorTbDebitPaise).toBeUndefined();
    const drafts = auditPack({ extracted, figures: f, job: JOB, results: [] });
    expect(drafts[0].title).toBe(AUDIT_PACK_TITLE);
    expect(computeAuditFigures({}).tbDebitPaise).toBeUndefined();
    const withMat = await parseAuditFiles(toInput([...tbOnly, { name: "entity.json", source: "fixture", bytes: Buffer.from(JSON.stringify({ companyClass: "llp", materiality: 250 })) }]), JOB);
    expect(computeAuditFigures(withMat)).toMatchObject({ materialityPaise: 25000, caroApplicable: 0 });
  });
});
