import { describe, expect, it } from "vitest";
import { loadFixtures, runAgentAccuracy, runFixtureOnce } from "@/lib/agents/core/accuracy-run";
import { createRecordedRouter } from "@/lib/agents/core/recorded-router";
import { getAgent } from "@/lib/agents/registry";
import type { ModelRequest } from "@/lib/ai/router";
import { JOB, extractOf, fixtureFiles, inputOf } from "./__fixtures__/base";
import { taxDeliverables } from "./deliverables";
import { TAX_CHECKLIST, TAX_MATCH_TASK, taxAgent, taxFigures, taxProbeMutation } from "./index";
import { parseTaxFiles } from "./parse";

const ROOT = "fixtures/accuracy";
const viaRouter =
  (router: ReturnType<typeof createRecordedRouter>) =>
  async <T,>(req: Omit<ModelRequest<T>, "runId">): Promise<T> => {
    const r = await router.run<T>({ ...req, runId: "r" } as ModelRequest<T>);
    if (r.status !== "ok") throw new Error(`model call not ok: ${r.status}`);
    return r.output;
  };
const fx = (id: string) => loadFixtures(ROOT, "tax").find((f) => f.id === id)!;

describe("taxAgent definition", () => {
  it("is registered with service IncomeTax and the tax pack", () => {
    expect(getAgent("tax")).toBe(taxAgent);
    expect(taxAgent).toMatchObject({ key: "tax", service: "IncomeTax", sopPackKey: "tax", modelAgent: "tax" });
    expect(taxAgent.defaultChecklist).toBe(TAX_CHECKLIST);
  });
  it("figures are integers", () => {
    for (const v of Object.values(taxFigures(extractOf("clean-salaried-new")))) expect(Number.isSafeInteger(v)).toBe(true);
  });
  it("llmContext lists notes, AIS and capital-gains lines with locations", () => {
    const text = taxAgent.llmContext!({ input: {} as never, extracted: extractOf("trap-capital-gains-itr1", undefined, { matches: [] }), figures: {}, job: JOB });
    expect(text).toContain("organiser.json profile.notes line 1: Salaried employee");
    expect(text).toContain("ais.csv row 2: sale-securities | Fixture Securities Ltd");
    expect(text).toContain("capital-gains.csv row 3: Fixture Steel Ltd equity | listed-equity");
    const bare = extractOf("typical-gap-missing-26as-ais", (o) => (o.profile.notes = ""), { matches: [] });
    expect(taxAgent.llmContext!({ input: {} as never, extracted: bare, figures: {}, job: JOB })).toMatch(/no notes/);
  });
});

describe("extract", () => {
  it("one tax.match-ais call with the Act-specific prompt and no amounts; matches validated", async () => {
    const f = fx("clean-salaried-new");
    const router = createRecordedRouter(f.recorded);
    const x = await taxAgent.extract({ input: parseTaxFiles(f.inputFiles), files: f.inputFiles, job: JOB, runId: "r", notes: "check HDFC", model: viaRouter(router) });
    expect(router.calls.map((c) => c.task)).toEqual([TAX_MATCH_TASK]);
    // Scoped call (ADR-008): the agent sends the user message only; the framework adds the system
    // prompt and wires the task's validator as contradictions (runner-level tests cover that).
    expect(router.calls[0].messages.map((m) => m.role)).toEqual(["user"]);
    expect(String(router.calls[0].messages[0].content)).toMatch(/Income-tax Act, 1961/);
    expect(String(router.calls[0].messages[0].content)).toContain("Reviewer notes: check HDFC");
    expect(x.aisMatches.map((m) => m.outcome)).toEqual(["matched", "matched"]);
  });
  it("no AIS income lines: no model call; no books ledgers: not in books without a model call", async () => {
    const router = createRecordedRouter({});
    const firm = fx("clean-firm-audit");
    expect((await taxAgent.extract({ input: parseTaxFiles(firm.inputFiles), files: firm.inputFiles, job: JOB, runId: "r", notes: null, model: viaRouter(router) })).aisMatches).toEqual([]);
    const noBooks = inputOf("clean-salaried-new", (o) => (o.otherSources = []));
    const x = await taxAgent.extract({ input: noBooks, files: [], job: JOB, runId: "r", notes: null, model: viaRouter(router) });
    expect(x.aisMatches.map((m) => m.outcome)).toEqual(["not_in_books", "not_in_books"]);
    expect(router.calls).toHaveLength(0);
  });
  it("refuses an FY without a verified rule set", async () => {
    const router = createRecordedRouter({});
    await expect(taxAgent.extract({ input: inputOf("clean-salaried-new"), files: [], job: { ...JOB, fy: "2026-27" }, runId: "r", notes: null, model: viaRouter(router) })).rejects.toThrow(/Income-tax Act, 2025/);
  });
});

describe("probeMutation", () => {
  it("adds ₹1 to business turnover and profit, else salary, else the first other source; originals untouched", () => {
    const read = (files: ReturnType<typeof fixtureFiles>) => JSON.parse(files.find((f) => f.name === "organiser.json")!.bytes.toString("utf8"));
    const biz = fixtureFiles("clean-44ad-presumptive");
    const before = biz.find((f) => f.name === "organiser.json")!.bytes.toString("utf8");
    const out = read(taxProbeMutation(biz));
    expect([out.business.turnover, out.business.booksProfit]).toEqual(["18000001.00", "1050001.00"]);
    expect(biz.find((f) => f.name === "organiser.json")!.bytes.toString("utf8")).toBe(before);
    expect(read(taxProbeMutation(fixtureFiles("clean-salaried-new"))).salary.gross).toBe("1500001.00");
    const osOnly = fixtureFiles("clean-salaried-new").map((f) => (f.name === "organiser.json" ? { ...f, bytes: Buffer.from(JSON.stringify({ ...JSON.parse(f.bytes.toString()), salary: null })) } : f));
    expect(read(taxProbeMutation(osOnly)).otherSources[0].amount).toBe("8001.00");
    const nothing = [{ name: "organiser.json", source: "fixture" as const, bytes: Buffer.from(JSON.stringify({ profile: {} })) }];
    expect(taxProbeMutation(nothing)).toBe(nothing);
    expect(taxProbeMutation([])).toEqual([]);
  });
});

describe("deliverables", () => {
  it("one workbook with the fixed sheets; reviewer questions listed with missing documents", () => {
    const x = extractOf("clean-salaried-new", undefined, { matches: [{ aisId: "A1", outcome: "matched", bookId: "B1" }, { aisId: "A2", outcome: "insufficient_evidence", bookId: null }] });
    const [wb] = taxDeliverables(x, []);
    if (wb.type !== "xlsx") throw new Error("expected xlsx");
    expect(wb.sheets.map((s) => s.name)).toEqual(["Computation", "26AS vs books", "AIS vs books", "Advance tax", "Capital gains", "MSME 43B(h)", "Audit and ITR", "Missing documents", "Checklist", "Verify"]);
    const missing = wb.sheets.find((s) => s.name === "Missing documents")!;
    expect(missing.rows).toEqual([{ item: "AIS A2 (HDFC Bank Ltd): which books ledger holds this income?", kind: "reviewer question" }]);
    const comp = wb.sheets[0];
    expect(comp.rows.find((r) => r.item === "Tax liability")).toMatchObject({ chosen: 105300, old: 272251, new: 105300 });
  });
  it("firms show no old/new columns; MSME results read as disallowed / not applied", () => {
    const [firm] = taxDeliverables(extractOf("clean-firm-audit", undefined, { matches: [] }), []);
    if (firm.type !== "xlsx") throw new Error("expected xlsx");
    expect(firm.sheets[0].rows[0]).toMatchObject({ old: null, new: null });
    const [m] = taxDeliverables(extractOf("trap-msme-46-days", undefined, { matches: [] }), []);
    if (m.type !== "xlsx") throw new Error("expected xlsx");
    expect(m.sheets.find((s) => s.name === "MSME 43B(h)")!.rows.map((r) => r.result)).toEqual(["Disallowed u/s 43B(h)", "Allowed", "Allowed"]);
    const [p] = taxDeliverables(extractOf("clean-44ad-presumptive", undefined, { files: { "msme.csv": "vendor,category,acceptance_date,amount,agreement_days,paid_on,outstanding_at_year_end\nV,micro,2026-03-01,100,,,yes\n" }, matches: [] }), []);
    if (p.type !== "xlsx") throw new Error("expected xlsx");
    expect(p.sheets.find((s) => s.name === "MSME 43B(h)")!.rows[0].result).toMatch(/presumptive: not applied/);
  });
});

describe("accuracy harness on the real fixtures", () => {
  it("passes the gate: ≥15 fixtures, exact figures, schema, replay, input sensitivity", async () => {
    const score = await runAgentAccuracy(taxAgent, { root: ROOT });
    expect(score.fixtures).toBeGreaterThanOrEqual(15);
    expect(score.figures.share).toBe(1);
    expect(score.replay.share).toBe(1);
    expect(score.pass).toBe(true);
  }, 120_000);
  it("wrong-department input fails the run before any model call", async () => {
    const roc = loadFixtures(ROOT, "roc").find((f) => f.id === "clean-small-private")!;
    const out = await runFixtureOnce(taxAgent, { ...fx("clean-salaried-new"), inputFiles: roc.inputFiles }, TAX_CHECKLIST);
    expect(out.error).toMatch(/run the ROC Prep agent/);
  });
});
