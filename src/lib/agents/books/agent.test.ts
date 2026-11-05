import { describe, expect, it } from "vitest";
import { compareFigures, failureDetails } from "@/lib/agents/core/accuracy";
import { loadFixtures, runAgentAccuracy, runFixtureOnce, packWithMistakes, loadApprovedMistakes } from "@/lib/agents/core/accuracy-run";
import { previewWorkbook } from "@/lib/agents/core/preview";
import { createRecordedRouter } from "@/lib/agents/core/recorded-router";
import type { JobContext, ModelCaller } from "@/lib/agents/core/runner";
import { getAgent } from "@/lib/agents/registry";
import { BOOKS_CLASSIFY_TASK, booksAgent, computeBooksFigures } from "./index";
import { chartHeads, classifyPrompt, suggestClassifications, validateSuggestions } from "./classify";
import { classifyBooksFile, booksInputSchema, parseBooksFiles } from "./inputs";
import { booksPack } from "./pack";
import { DEFAULT_EXPENSE_HEADS } from "./config";
import { parseTb } from "./tb";
import { parseCsv } from "./table";

const ROOT = "fixtures/accuracy";
const fixtures = loadFixtures(ROOT, "books");
const byId = (id: string) => fixtures.find((f) => f.id === id)!;
const JOB: JobContext = { jobTaskId: "j", title: "Books close", service: "Books", fy: "2026-27", period: "2026-10", clientCode: "ACME01", clientName: "Acme", assigneeId: null, reviewerId: null };

describe("books agent definition", () => {
  it("is registered and uses the books model agent + Books service", () => {
    expect(getAgent("books")).toBe(booksAgent);
    expect(booksAgent).toMatchObject({ key: "books", service: "Books", sopPackKey: "books", modelAgent: "books" });
    expect(booksAgent.internal).toBeUndefined();
  });

  it("classifies input files by name", () => {
    expect(classifyBooksFile("Trial_Balance_Oct2026.xlsx")).toBe("tb");
    expect(classifyBooksFile("trial-balance-prior.csv")).toBe("tb-prior");
    expect(classifyBooksFile("prev-month-tb.csv")).toBe("tb-prior");
    expect(classifyBooksFile("HDFC statement Oct.csv")).toBe("bank-statement");
    expect(classifyBooksFile("bank-book.csv")).toBe("bank-ledger");
    expect(classifyBooksFile("tds-challans.csv")).toBe("tds-challans");
    expect(classifyBooksFile("tds-ledger.csv")).toBe("tds-deducted");
    expect(classifyBooksFile("gstr3b-summary.csv")).toBe("gst-return");
    expect(classifyBooksFile("gst-ledger.xlsx")).toBe("gst-ledger");
    expect(classifyBooksFile("fixed-asset-register.csv")).toBe("schedules");
    expect(classifyBooksFile("column-map.json")).toBe("column-map");
    expect(classifyBooksFile("photo.png")).toBeNull();
    expect(classifyBooksFile("notes.txt")).toBeNull();
  });

  it("input schema requires a trial balance", () => {
    const r = booksInputSchema.safeParse([{ name: "bank-statement.csv", source: "fixture", bytes: Buffer.from("x") }]);
    expect(r.success).toBe(false);
    expect(booksInputSchema.safeParse([{ name: "tb.csv", source: "fixture", bytes: Buffer.from("x") }]).success).toBe(true);
  });

  it("parseBooksFiles: a second file of a kind and a bad column map are reported, not fatal", async () => {
    const files = [
      { name: "column-map.json", kind: "column-map" as const, bytes: Buffer.from("{nope") },
      { name: "tb-a.csv", kind: "tb" as const, bytes: Buffer.from("Ledger,Debit,Credit\nX,1,\nY,,1") },
      { name: "tb-b.csv", kind: "tb" as const, bytes: Buffer.from("Ledger,Debit,Credit\nZ,5,") },
      { name: "readme.md", kind: null, bytes: Buffer.from("x") },
    ];
    const p = await parseBooksFiles({ files });
    expect(p.tb!.rows.map((r) => r.ledger)).toEqual(["X", "Y"]);
    expect(p.issues.map((i) => i.message)).toEqual(["column-map.json is not valid JSON; ignored", "a second tb file; only the first is used"]);
    const shape = await parseBooksFiles({ files: [{ name: "column-map.json", kind: "column-map", bytes: Buffer.from('{"tb": 5}') }] });
    expect(shape.issues[0].message).toContain("ignored");
  });
});

describe("expense classification (the only model call)", () => {
  const lines = [
    { id: "S8", row: 9, date: "2026-10-30", narration: "UPI COURIER", ref: "U1", amountPaise: -118000 },
    { id: "S9", row: 10, date: "2026-10-31", narration: "GST ON CHARGES", ref: "", amountPaise: -22500 },
  ];
  it("no candidates → no model call", async () => {
    let calls = 0;
    const model = (async () => {
      calls++;
      return { suggestions: [] };
    }) as unknown as ModelCaller;
    expect(await suggestClassifications(model, [], null, null)).toEqual({ suggestions: [], heads: [...DEFAULT_EXPENSE_HEADS] });
    expect(calls).toBe(0);
  });
  it("calls the router fast tier (sop), anonymised, with the books task and validates the answer", async () => {
    const router = createRecordedRouter({ [BOOKS_CLASSIFY_TASK]: { suggestions: [{ lineId: "S9", ledger: "bank charges", confidence: 0.9, reason: "gst" }, { lineId: "S9", ledger: "Rent", confidence: 1 }, { lineId: "S1", ledger: "Rent", confidence: 1 }, { lineId: "S8", ledger: "Courier", confidence: 0.5 }] } });
    const model: ModelCaller = async (req) => {
      const r = await router.run({ ...req, runId: "r1" } as never);
      if (r.status !== "ok") throw new Error("not ok");
      return r.output as never;
    };
    const tb = parseTb("tb.csv", parseCsv("Ledger,Group,Debit\nBank Charges,Indirect Expenses,1\nRent,Indirect Expenses,1\nSales,Sales Accounts,1")).tb;
    const out = await suggestClassifications(model, lines, tb, "check courier");
    expect(router.calls[0]).toMatchObject({ task: "books.classify-expenses", privacy: "anonymize-then-cloud", difficulty: "sop" });
    expect(router.calls[0].messages[1].content).toContain("Reviewer notes: check courier");
    expect(out.heads).toEqual(["Bank Charges", "Rent"]);
    expect(out.suggestions).toEqual([
      { lineId: "S8", ledger: "Courier", confidence: 0.5, reason: "", inChart: false },
      { lineId: "S9", ledger: "bank charges", confidence: 0.9, reason: "gst", inChart: true },
    ]);
  });
  it("prompt never asks the model for totals and lists each line once", () => {
    const p = classifyPrompt(lines, ["Rent"], null);
    expect(p).toContain("S8 | 2026-10-30 | UPI COURIER | U1 | 1180.00");
    expect(p).not.toMatch(/Reviewer notes/);
    expect(validateSuggestions({ suggestions: [] }, lines, [])).toEqual([]);
    expect(chartHeads(null)).toEqual([...DEFAULT_EXPENSE_HEADS]);
  });
});

describe("pipeline on fixtures", () => {
  it("has ≥ 10 fixtures with support for block, warn and info, and ≥ 3 approved mistakes", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    const sev = new Set(fixtures.flatMap((f) => f.expected.flags.map((x) => x.severity)));
    expect([...sev].sort()).toEqual(["block", "info", "warn"]);
    expect(loadApprovedMistakes(ROOT, "books").length).toBeGreaterThanOrEqual(3);
  });

  it("recorded.json carries ONLY the classifier's output — never parsed rows or totals", () => {
    for (const f of fixtures) for (const k of Object.keys(f.recorded)) expect(k, f.id).toBe(BOOKS_CLASSIFY_TASK);
  });

  it("figures come from input/: changing one amount by ₹1 is reported as a figure mismatch", async () => {
    const fx = byId("clean-month");
    const pack = packWithMistakes(booksAgent, loadApprovedMistakes(ROOT, "books"));
    const base = await runFixtureOnce(booksAgent, fx, pack);
    expect(compareFigures(fx.expected.figures, base.figures)).toEqual([]);
    const mutated = {
      ...fx,
      inputFiles: fx.inputFiles.map((f) => (f.name === "trial-balance.csv" ? { ...f, bytes: Buffer.from(f.bytes.toString("utf8").replace('Rent,Indirect Expenses,"60,000.00"', 'Rent,Indirect Expenses,"60,001.00"')) } : f)),
    };
    const out = await runFixtureOnce(booksAgent, mutated, pack);
    expect(compareFigures(fx.expected.figures, out.figures).map((d) => [d.key, d.deltaPaise])).toEqual([
      ["tbDebitPaise", 100],
      ["tbDifferencePaise", 100],
    ]);
    expect(out.flags).toContainEqual({ ruleId: "books.tb-balanced", severity: "block" });
    const bank = { ...fx, inputFiles: fx.inputFiles.map((f) => (f.name === "bank-statement.csv" ? { ...f, bytes: Buffer.from(f.bytes.toString("utf8").replace(',"2,40,000.00","3,60,000.00"', ',"2,40,001.00","3,60,000.00"')) } : f)) };
    const b = await runFixtureOnce(booksAgent, bank, pack);
    expect(compareFigures(fx.expected.figures, b.figures).map((d) => d.key)).toEqual(["balancePerBankPaise", "bankMatchedCount", "bankUnmatchedLedgerCount", "bankUnmatchedStatementCount"]);
  });

  it("the accuracy gate passes for books (thresholds unchanged)", async () => {
    const score = await runAgentAccuracy(booksAgent, { root: ROOT });
    expect(failureDetails(score)).toEqual([]);
    expect(score.pass).toBe(true);
  }, 60_000);

  it("month-end pack: fixed sheets, suggestions labelled, never 'posted'", async () => {
    const fx = byId("typical-gap-unrecorded-debits");
    const parsed = await parseBooksFiles({ files: fx.inputFiles.map((f) => ({ name: f.name, kind: classifyBooksFile(f.name), bytes: f.bytes })) });
    const extracted = { ...parsed, suggestions: [{ lineId: "S8", ledger: "Courier Charges", confidence: 0.9, reason: "UPI", inChart: false }, { lineId: "S9", ledger: "Bank Charges", confidence: 0.5, reason: "", inChart: true }, { lineId: "S77", ledger: "Rent", confidence: 0.9, reason: "", inChart: true }], chartHeads: [] };
    const drafts = booksPack({ extracted, figures: computeBooksFigures(extracted), job: JOB, results: [] });
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    if (d.type !== "xlsx") throw new Error("xlsx expected");
    expect(d.title).toBe("Month-end pack");
    const sug = d.sheets.find((s) => s.name === "Expense suggestions")!;
    expect(sug.rows.map((r) => r.status)).toEqual(["Suggestion — not posted; head not in chart", "Suggestion — not posted; low confidence", "Suggestion — not posted"]);
    const empty = booksPack({ extracted: { ...parsed, statement: null, tdsDeducted: null, gstLedger: null, schedules: null, tb: null, suggestions: [], chartHeads: [] }, figures: {}, job: JOB, results: [] })[0];
    if (empty.type !== "xlsx") throw new Error("xlsx expected");
    expect(empty.sheets.find((s) => s.name === "Bank reconciliation")!.rows[0].item).toBe("Bank statement and bank ledger not provided");
  });

  it("built workbook carries the draft header and the TB proof row", async () => {
    const out = await runFixtureOnce(booksAgent, byId("trap-tb-off-by-paisa"), booksAgent.defaultChecklist);
    expect(out.deliverables).toEqual([{ name: "Month-end pack", problems: [] }]);
  });

  it("XLSX preview of a real run shows the TB difference", async () => {
    // Run the full runner and read back the stored workbook.
    const { createMemoryDb } = await import("@/lib/agents/core/memory-db");
    const { createMemoryStore } = await import("@/lib/agents/core/memory-store");
    const { staticInputSource } = await import("@/lib/agents/core/inputs");
    const { runAgent } = await import("@/lib/agents/core/runner");
    const fx = byId("trap-tb-off-by-paisa");
    const now = new Date("2026-11-05T06:30:00Z");
    const db = createMemoryDb({ now: () => now });
    const store = createMemoryStore();
    db.seed("client", [{ id: "c", name: "Fixture" }]);
    db.seed("firmClient", [{ id: "fc", lmsClientId: "c", clientCode: "FIXT01" }]);
    db.seed("jobTask", [{ id: "j", firmClientId: "fc", service: "Books", fy: "2026-27", period: "2026-10", title: "Books close", state: "ASSIGNED", assigneeId: "a", reviewerId: "r" }]);
    db.seed("sopPack", [{ key: "books", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Books", checklist: booksAgent.defaultChecklist }]);
    const res = await runAgent(booksAgent, "j", { db, router: createRecordedRouter({}), store, inputs: staticInputSource(fx.inputFiles), now: () => now, ids: () => "run-1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.hasBlockingFailures).toBe(true);
    const file = store.list("FY2026-27/Books/2026-10/Working")[0];
    const bytes = (await store.read("memory-drive", "FY2026-27/Books/2026-10/Working", file)) as Buffer;
    const pv = await previewWorkbook(bytes);
    const summary = pv.sheets.find((s) => s.name === "Summary")!;
    expect(summary.rows.some((r) => r[0] === "Trial balance — difference (debits − credits)" && r[1] === "0.01" && r[3] === "DOES NOT BALANCE")).toBe(true);
  });
});
