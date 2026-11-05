import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@/lib/ai/router";
import { loadFixtures, runAgentAccuracy, runFixtureOnce } from "@/lib/agents/core/accuracy-run";
import { createRecordedRouter } from "@/lib/agents/core/recorded-router";
import { getAgent } from "@/lib/agents/registry";
import { baseExtract, JOB } from "./__fixtures__/base";
import { checklistSheet } from "@/lib/agents/core/checklist-sheet";
import { rocDeliverables } from "./deliverables";
import { ROC_CHECKLIST, ROC_MAP_TASK, rocAgent, rocFigures } from "./index";
import { parseRocFiles } from "./parse";

const ROOT = "fixtures/accuracy";

/** ExtractContext.model backed by a recorded router (as the runner wires it). */
const viaRouter =
  (router: ReturnType<typeof createRecordedRouter>) =>
  async <T,>(req: Omit<ModelRequest<T>, "runId">): Promise<T> => {
    const r = await router.run<T>({ ...req, runId: "r" } as ModelRequest<T>);
    if (r.status !== "ok") throw new Error(`model call not ok: ${r.status}`);
    return r.output;
  };

describe("rocAgent definition", () => {
  it("is registered and visible", () => {
    expect(getAgent("roc")).toBe(rocAgent);
    expect(rocAgent).toMatchObject({ key: "roc", service: "ROC", sopPackKey: "roc", modelAgent: "roc" });
    expect(rocAgent.defaultChecklist).toBe(ROC_CHECKLIST);
    expect(rocAgent.internal).toBeUndefined();
  });

  it("figures are integers", () => {
    const f = rocFigures(baseExtract());
    for (const v of Object.values(f)) expect(Number.isSafeInteger(v)).toBe(true);
    expect(f.mgt7a).toBe(1);
  });

  it("llmContext numbers the notes lines; no notes says so", () => {
    const withNotes = rocAgent.llmContext!({ input: {} as never, extracted: baseExtract({ notes: "a\nb" }), figures: {}, job: JOB });
    expect(withNotes).toBe("notes.txt line 1: a\nnotes.txt line 2: b");
    expect(rocAgent.llmContext!({ input: {} as never, extracted: baseExtract(), figures: {}, job: JOB })).toMatch(/no notes/);
  });
});

describe("extract", () => {
  const files = (id: string) => loadFixtures(ROOT, "roc").find((f) => f.id === id)!;
  it("trial balance: one model call to map ledgers, code sums", async () => {
    const fx = files("clean-trial-balance");
    const router = createRecordedRouter(fx.recorded);
    const input = parseRocFiles(fx.inputFiles);
    const x = await rocAgent.extract({ input, files: fx.inputFiles, job: JOB, runId: "r1", notes: "check GST input", model: viaRouter(router) });
    expect(router.calls.map((c) => c.task)).toEqual([ROC_MAP_TASK]);
    expect(router.calls[0].privacy).toBe("anonymize-then-cloud");
    expect(JSON.stringify(router.calls[0].messages)).toContain("Reviewer notes: check GST input");
    expect(x.financials.source).toBe("tb");
    expect(x.financials.current.reservesSurplus).toBe(35_00_000_00);
    expect(x.fy).toBe("2025-26");
  });
  it("summary and xlsx: no model call", async () => {
    for (const id of ["clean-small-private", "clean-xlsx-financials"]) {
      const fx = files(id);
      const router = createRecordedRouter({});
      const x = await rocAgent.extract({ input: parseRocFiles(fx.inputFiles), files: fx.inputFiles, job: JOB, runId: "r", notes: null, model: viaRouter(router) });
      expect(router.calls).toHaveLength(0);
      expect(x.financials.current.revenueFromOperations).toBe(2_40_00_000_00);
    }
  });
});

describe("deliverables", () => {
  it("workbook sheets and a DOCX of draft resolutions", () => {
    const d = rocDeliverables(baseExtract({ auditor: { termStartFy: "2021-22", reappointedAtThisAgm: true } }), []);
    expect(d.map((x) => x.type)).toEqual(["xlsx", "docx"]);
    const wb = d[0];
    if (wb.type !== "xlsx") throw new Error("expected xlsx");
    expect(wb.sheets.map((s) => s.name)).toEqual(["AOC-4", "MGT-7", "Shareholding", "DIR-3 KYC", "ADT-1 check", "Due dates and fees", "Checklist", "Verify"]);
    const doc = d[1];
    if (doc.type !== "docx") throw new Error("expected docx");
    const text = JSON.stringify(doc.blocks);
    expect(text).toContain("DRAFT");
    expect(text).toContain("reappointed as statutory auditor");
    expect(text).not.toContain("CSR");
  });
  it("OPC and CSR variants of the resolutions", () => {
    const opc = rocDeliverables(baseExtract({ company: { companyClass: "opc", agmDate: null } }), [])[1];
    if (opc.type !== "docx") throw new Error("expected docx");
    expect(JSON.stringify(opc.blocks)).not.toContain("annual general meeting of the members be held");
    const csr = rocDeliverables(baseExtract({ previous: { revenueFromOperations: 60_00_00_000_00, otherIncome: 0, totalExpenses: 55_00_00_000_00 }, auditor: { termStartFy: "2021-22" } }), [])[1];
    if (csr.type !== "docx") throw new Error("expected docx");
    expect(JSON.stringify(csr.blocks)).toContain("CSR obligation");
    expect(JSON.stringify(csr.blocks)).toContain("reappointed as statutory auditor");
  });
  it("checklist sheet carries evidence", () => {
    const s = checklistSheet([{ ruleId: "r", title: "t", severity: "warn", status: "fail", message: "m", evidence: { quote: "q", location: "l" }, source: "deterministic", flags: [] }]);
    expect(s.rows[0]).toMatchObject({ rule: "r", evidence: "q @ l" });
  });
});

describe("accuracy harness on the real fixtures", () => {
  it("every fixture passes 3× with exact figures and the mistakes replay", async () => {
    const score = await runAgentAccuracy(rocAgent, { root: ROOT });
    expect(score.fixtures).toBeGreaterThanOrEqual(15);
    expect(score.figures.share).toBe(1);
    expect(score.schema.share).toBe(1);
    expect(score.replay.share).toBe(1);
    expect(score.pass).toBe(true);
  }, 120_000);

  it("figures come from input/, not recorded.json: ₹1 more paid-up capital → figure mismatch", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "roc-mut-"));
    cpSync(join(ROOT, "roc", "clean-small-private"), join(tmp, "roc", "clean-small-private"), { recursive: true });
    const p = join(tmp, "roc", "clean-small-private", "input", "company.json");
    const company = JSON.parse(readFileSync(p, "utf8"));
    company.paidUpCapital = "10,00,001";
    writeFileSync(p, JSON.stringify(company));
    const score = await runAgentAccuracy(rocAgent, { root: tmp, runs: 1 });
    expect(score.figures.share).toBe(0);
    const keys = score.figures.diffs[0].diffs.map((d) => d.key);
    expect(keys).toContain("paidUpCapitalPaise");
    expect(keys).toContain("shareholdingDiffPaise");
    expect(score.pass).toBe(false);
  }, 60_000);

  it("₹1 on a trial-balance ledger changes the computed figures too", async () => {
    const fx = loadFixtures(ROOT, "roc").find((f) => f.id === "clean-trial-balance")!;
    const json = JSON.parse(fx.inputFiles.find((f) => f.name === "financials.json")!.bytes.toString("utf8"));
    json.trialBalance[10].credit = "2,40,00,001"; // Sales
    json.trialBalance[13].debit = "50,00,001"; // keep the TB balanced: salaries +1
    const mutated = { ...fx, inputFiles: fx.inputFiles.map((f) => (f.name === "financials.json" ? { ...f, bytes: Buffer.from(JSON.stringify(json)) } : f)) };
    const out = await runFixtureOnce(rocAgent, mutated, ROC_CHECKLIST);
    expect(out.figures.turnoverPaise).toBe(2_40_00_001_00);
  }, 60_000);

  it("a missing input fails the run with the reason", async () => {
    const fx = loadFixtures(ROOT, "roc").find((f) => f.id === "clean-small-private")!;
    const out = await runFixtureOnce(rocAgent, { ...fx, inputFiles: fx.inputFiles.filter((f) => f.name !== "auditor.json") }, ROC_CHECKLIST);
    expect(out.error).toMatch(/auditor\.json is missing/);
  });
});
