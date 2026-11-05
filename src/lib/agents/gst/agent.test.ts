// GST Prep end to end through the real runner (memory db + memory store + recorded router), the
// accuracy gate, input sensitivity (₹1 in the input → figure mismatch), fail-closed paths, the
// probe, the deliverables and the SopPack seed.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { ACCURACY_THRESHOLDS } from "@/lib/agents/core/accuracy";
import { FIXTURE_NOW, loadFixtures, runAgentAccuracy } from "@/lib/agents/core/accuracy-run";
import { staticInputSource } from "@/lib/agents/core/inputs";
import { createMemoryDb } from "@/lib/agents/core/memory-db";
import { createMemoryStore } from "@/lib/agents/core/memory-store";
import { createRecordedRouter } from "@/lib/agents/core/recorded-router";
import { jobFolder, runAgent, type InputFile } from "@/lib/agents/core/runner";
import { getAgent } from "@/lib/agents/registry";
import { GST_CHECKLIST, GST_FREE_SUPPLIES_TASK, gstAgent, gstLlmContext } from "./index";
import { classifyFiles, loadGstData } from "./input";
import { gstProbeMutation } from "./probe";
import { gstSopPackSeed, seedGstSopPack } from "./seed";
import { validateVerdict, type Verdict } from "./tasks";

const ROOT = "fixtures/accuracy";
const FIXTURES = loadFixtures(ROOT, "gst");
const fx = (id: string) => FIXTURES.find((f) => f.id.endsWith(id))!;
const ONE_RUN = { ...ACCURACY_THRESHOLDS, runs: 1 };

function world(files: InputFile[], recorded: Record<string, unknown>) {
  const db = createMemoryDb({ now: () => FIXTURE_NOW });
  const store = createMemoryStore();
  db.seed("client", [{ id: "c1", name: "Synthetic Client" }]);
  db.seed("firmClient", [{ id: "fc1", lmsClientId: "c1", clientCode: "SYN01" }]);
  db.seed("jobTask", [{ id: "job-1", firmClientId: "fc1", service: "GST", fy: "2026-27", period: "2026-10", title: "GSTR-3B", state: "ASSIGNED", assigneeId: "u1", reviewerId: "u2" }]);
  db.seed("sopPack", [gstSopPackSeed()]);
  const router = createRecordedRouter(recorded);
  let n = 0;
  const deps = { db, router, store, inputs: staticInputSource(files), now: () => FIXTURE_NOW, ids: () => `run-${++n}` };
  return { db, store, router, deps };
}

describe("registration", () => {
  it("is registered under gst, visible, GST service, with a probe", () => {
    expect(getAgent("gst")).toBe(gstAgent);
    expect(gstAgent).toMatchObject({ service: "GST", sopPackKey: "gst", modelAgent: "gst" });
    expect(gstAgent.internal).toBeFalsy();
    expect(gstAgent.probeMutation).toBeTypeOf("function");
  });
});

describe("runAgent on a fixture (free samples)", () => {
  it("prepares the draft pack: AGENT_DONE, 5 Working files, checklist with evidence, model calls only for declared tasks", async () => {
    const f = fx("trap-free-samples");
    const w = world(f.inputFiles, f.recorded);
    const out = await runAgent(gstAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.figures).toMatchObject({ itcBlockedPaise: 360000, cashTaxPaise: 720000 });
    expect(out.deliverables.map((d) => d.name)).toEqual([
      "SYN01_GSTR-1-draft_2026-10_v1.xlsx",
      "SYN01_GSTR-3B-computation_2026-10_v1.xlsx",
      "SYN01_2B-reconciliation_2026-10_v1.xlsx",
      "SYN01_Exceptions_2026-10_v1.xlsx",
      "SYN01_Client-document-requests_2026-10_v1.docx",
    ]);
    expect(w.router.calls.map((c) => [c.task, c.privacy])).toEqual([
      ["gst.classify-ledgers", "anonymize-then-cloud"],
      [GST_FREE_SUPPLIES_TASK, "anonymize-then-cloud"],
    ]);
    const results = w.db.tables.checklistResult as { ruleId: string; status: string; evidence: { quote?: string; location?: string } | null }[];
    const failed = results.filter((r) => r.status === "fail").map((r) => r.ruleId);
    expect(failed).toEqual(["gst.blocked-credit", "gst.free-supplies"]);
    expect(results.find((r) => r.ruleId === "gst.free-supplies")?.evidence).toEqual({ quote: "Diwali gift hampers distributed free to dealers", location: "purchase-register.csv row 3" });

    // Exceptions workbook lists the failures; the document request list asks about the hampers.
    const working = jobFolder({ clientCode: "SYN01", fy: "2026-27", service: "GST", period: "2026-10" }, "Working").path;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await w.store.read("memory-drive", working, "SYN01_Exceptions_2026-10_v1.xlsx")) as unknown as ArrayBuffer);
    const rows: string[] = [];
    wb.getWorksheet("Exceptions")!.eachRow((r) => rows.push(String(r.getCell(2).value ?? "")));
    expect(rows).toEqual(expect.arrayContaining(["gst.blocked-credit", "gst.free-supplies"]));
    const docx = (await w.store.read("memory-drive", working, "SYN01_Client-document-requests_2026-10_v1.docx")) as Buffer;
    expect(docx.subarray(0, 2).toString()).toBe("PK");
  });

  it("3B workbook carries the set-off and the payment table", async () => {
    const f = fx("typical-setoff-igst-heavy");
    const w = world(f.inputFiles, f.recorded);
    const out = await runAgent(gstAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    const working = jobFolder({ clientCode: "SYN01", fy: "2026-27", service: "GST", period: "2026-10" }, "Working").path;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await w.store.read("memory-drive", working, "SYN01_GSTR-3B-computation_2026-10_v1.xlsx")) as unknown as ArrayBuffer);
    const pay = wb.getWorksheet("6.1 Payment")!;
    const sgst = pay.getRow(14); // header row 11; IGST 12, CGST 13, SGST 14
    expect([sgst.getCell(1).value, sgst.getCell(3).value, sgst.getCell(5).value, sgst.getCell(7).value]).toEqual(["SGST", 4500, 4500, 27000]);
  });

  it("fails closed on a trial balance named like a sales register, before any model call", async () => {
    const f = fx("clean-tally-csv");
    const files = f.inputFiles.map((x) => (x.name === "sales-register.csv" ? { ...x, bytes: Buffer.from("Particulars,Group,Opening Balance,Debit,Credit,Closing Balance\nCash,Assets,0,10,0,10") } : x));
    const w = world(files, f.recorded);
    const out = await runAgent(gstAgent, "job-1", w.deps);
    expect(out).toMatchObject({ ok: false, code: "FAILED" });
    expect(!out.ok && out.reason).toMatch(/Books Close/);
    expect(w.router.calls).toHaveLength(0);
    expect((w.db.tables.jobTask as { state: string }[])[0].state).toBe("IN_PREP");
  });

  it("stops with the missing inputs listed", async () => {
    const w = world([], {});
    const out = await runAgent(gstAgent, "job-1", w.deps);
    expect(!out.ok && out.reason).toMatch(/Inputs incomplete: profile\.json .* is missing/);
  });
});

describe("accuracy", () => {
  it("passes the gate on the committed fixtures (one run each here; the CLI runs three)", async () => {
    const s = await runAgentAccuracy(gstAgent, { root: ROOT, thresholds: ONE_RUN });
    expect(s.reasons).toEqual([]);
    expect(s.pass).toBe(true);
    expect(s.fixtures).toBeGreaterThanOrEqual(15);
  }, 120_000);

  it("₹1 changed in an input file (recordings untouched) is caught as a figure mismatch", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gst-probe-"));
    const id = FIXTURES.find((f) => f.id.endsWith("clean-tally-csv"))!.id;
    cpSync(join(ROOT, "gst", id), join(tmp, "gst", id), { recursive: true });
    const p = join(tmp, "gst", id, "input", "sales-register.csv");
    const csv = readFileSync(p, "utf8");
    expect(csv).toContain(",100000.00,");
    writeFileSync(p, csv.replace(",100000.00,", ",100001.00,"));
    const s = await runAgentAccuracy(gstAgent, { root: tmp, thresholds: ONE_RUN });
    expect(s.pass).toBe(false);
    expect(s.figures.diffs[0].diffs.map((d) => d.key)).toEqual(expect.arrayContaining(["outwardTaxablePaise", "b2bTaxablePaise"]));
  }, 60_000);

  it("every recorded LLM verdict quotes the llmContext text verbatim and names a row in it", async () => {
    for (const f of FIXTURES) {
      const { input } = classifyFiles(f.inputFiles);
      const x = await loadGstData(input, { period: "2026-10", fy: "2026-27" });
      expect(validateVerdict(f.recorded[GST_FREE_SUPPLIES_TASK] as Verdict, gstLlmContext(x)), f.id).toEqual([]);
    }
  });

  it("recorded.json holds only declared model tasks (no parsed rows or totals)", () => {
    for (const f of FIXTURES) expect(Object.keys(f.recorded).every((k) => ["gst.classify-ledgers", "gst.read-hsn", GST_FREE_SUPPLIES_TASK].includes(k)), f.id).toBe(true);
  });
});

describe("probeMutation", () => {
  it("bumps the first taxable value of a CSV sales register by ₹1, on a copy", () => {
    const files = fx("clean-tally-csv").inputFiles;
    const before = files.map((x) => x.bytes.toString("utf8"));
    const out = gstProbeMutation(files);
    expect(files.map((x) => x.bytes.toString("utf8"))).toEqual(before);
    const sales = out.find((x) => x.name === "sales-register.csv")!.bytes.toString("utf8");
    expect(sales).toContain(",100001.00,");
    expect(sales).not.toContain(",100000.00,");
  });
  it("falls back to the profile's expected filing date for XLSX registers; leaves unknown inputs unchanged", () => {
    const out = gstProbeMutation(fx("clean-xlsx-tally-2b-excel").inputFiles);
    expect(JSON.parse(out.find((x) => x.name === "profile.json")!.bytes.toString("utf8")).expectedFilingDate).toBe("2099-12-31");
    const late = gstProbeMutation(fx("typical-late-filing-interest").inputFiles.map((x) => (x.name.startsWith("sales") ? { ...x, name: "sales.xlsx" } : x)));
    expect(JSON.parse(late.find((x) => x.name === "profile.json")!.bytes.toString("utf8")).expectedFilingDate).toBe("2026-12-01");
    const junk: InputFile[] = [{ name: "sales.csv", source: "fixture", bytes: Buffer.from("not,a\nregister,at all") }, { name: "profile.json", source: "fixture", bytes: Buffer.from("{bad") }];
    expect(gstProbeMutation(junk).map((x) => x.bytes.toString())).toEqual(junk.map((x) => x.bytes.toString()));
  });
});

describe("SopPack seed", () => {
  it("row for key gst 1.0.0 carrying the default checklist", () => {
    expect(gstSopPackSeed({ createdById: "u1" })).toMatchObject({ key: "gst", version: "1.0.0", major: 1, minor: 0, patch: 0, active: true, createdById: "u1", checklist: GST_CHECKLIST });
  });
  it("create-only and idempotent", async () => {
    const created: unknown[] = [];
    const db = (existing: { version: string } | null) => ({ sopPack: { findFirst: async () => existing, create: async (a: { data: unknown }) => (created.push(a.data), a.data) } }) as never;
    expect(await seedGstSopPack(db(null))).toEqual({ created: true, version: "1.0.0" });
    expect(await seedGstSopPack(db({ version: "1.2.0" }))).toEqual({ created: false, version: "1.2.0" });
    expect(created).toHaveLength(1);
  });
});
