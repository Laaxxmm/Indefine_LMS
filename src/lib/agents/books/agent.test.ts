import { describe, expect, it } from "vitest";
import { compareFigures, failureDetails } from "@/lib/agents/core/accuracy";
import { loadFixtures, runAgentAccuracy, runFixtureOnce, packWithMistakes, loadApprovedMistakes } from "@/lib/agents/core/accuracy-run";
import { previewWorkbook } from "@/lib/agents/core/preview";
import { createRecordedRouter } from "@/lib/agents/core/recorded-router";
import type { JobContext, ModelCaller } from "@/lib/agents/core/runner";
import { getAgent } from "@/lib/agents/registry";
import { BOOKS_CLASSIFY_TASK, booksAgent, computeBooksFigures } from "./index";
import { CLASSIFY_SYSTEM, INSUFFICIENT, chartHeads, classifyPrompt, classifySchema, groundingIssue, lineText, suggestClassifications, toSuggestions, validateClassification } from "./classify";
import { WrongDepartmentError, sniffCsv, sniffRows } from "./department";
import { classifyBooksFile, booksInputSchema, parseBooksFiles } from "./inputs";
import { booksPack } from "./pack";
import { BOOKS_MODEL_TASKS, booksTaskIds } from "./tasks";
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

describe("expense classification (the only model task, ADR-008)", () => {
  const lines = [
    { id: "S8", row: 9, date: "2026-10-30", narration: "UPI COURIER", ref: "U1", amountPaise: -118000 },
    { id: "S9", row: 10, date: "2026-10-31", narration: "GST ON CHARGES", ref: "", amountPaise: -22500 },
  ];
  const TB = parseTb("tb.csv", parseCsv("Ledger,Group,Debit\nBank Charges,Indirect Expenses,1\nRent,Indirect Expenses,1\nTrading Goods,Purchase Accounts,1\nSales,Sales Accounts,1")).tb;
  const ans = (lineId: string, ledger: string, quote: string, location = lineId, confidence = 0.9) => ({ lineId, ledger, confidence, evidence: { quote, location } });
  const viaRouter = (output: unknown) => {
    const router = createRecordedRouter({ [BOOKS_CLASSIFY_TASK]: output });
    const model: ModelCaller = async (req) => {
      const r = await router.run({ ...req, runId: "r1" } as never);
      if (r.status !== "ok") throw new Error(`not ok: ${r.status === "needs-review" ? r.issues.join("; ") : r.status}`);
      return r.output as never;
    };
    return { router, model };
  };

  it("registry: one versioned task, department prompt, closed schema, rule ids, validator", () => {
    expect(booksTaskIds()).toEqual(["books.classify-expenses@1"]);
    const t = BOOKS_MODEL_TASKS[0];
    expect(t.rules).toEqual(["books.suggestions-low-confidence", "books.classification-questions"]);
    expect(t.systemPrompt).toBe(CLASSIFY_SYSTEM);
    expect(CLASSIFY_SYSTEM).toMatch(/ONLY on month-end bookkeeping close/);
    expect(CLASSIFY_SYSTEM).toMatch(/Never compute/);
    expect(CLASSIFY_SYSTEM).toContain(`"${INSUFFICIENT}"`);
    expect(CLASSIFY_SYSTEM).toMatch(/JSON only/);
    for (const r of t.rules) expect(booksAgent.defaultChecklist.rules.some((x) => x.id === r)).toBe(true);
  });

  it("heads are the client's own expense/purchase ledgers; else every TB ledger; none without a TB", () => {
    expect(chartHeads(TB)).toEqual(["Bank Charges", "Rent", "Trading Goods"]);
    expect(chartHeads(parseTb("tb.csv", parseCsv("Ledger,Group,Debit\nZeta,Misc,1\nAlpha,Misc,1")).tb)).toEqual(["Alpha", "Zeta"]);
    expect(chartHeads(null)).toEqual([]);
  });

  it("closed enums: an invented ledger or an unknown line id fails the schema", () => {
    const schema = classifySchema(lines, ["Rent"]);
    expect(schema.safeParse({ suggestions: [ans("S8", "Courier Charges", "UPI COURIER")] }).success).toBe(false);
    expect(schema.safeParse({ suggestions: [ans("S99", "Rent", "UPI COURIER")] }).success).toBe(false);
    expect(schema.safeParse({ suggestions: [ans("S8", INSUFFICIENT, "UPI COURIER")] }).success).toBe(true);
    expect(schema.safeParse({ suggestions: [{ ...ans("S8", "Rent", "x"), note: "n".repeat(301) }] }).success).toBe(false);
  });

  it("grounding: quote must be in the line text, location must name the line, numbers must be the line's", () => {
    expect(groundingIssue(ans("S8", "Rent", "upi  courier"), lines[0])).toBeNull();
    expect(groundingIssue(ans("S8", "Rent", "1180.00"), lines[0])).toBeNull();
    expect(groundingIssue(ans("S8", "Rent", "PAYTM"), lines[0])).toMatch(/not in the line text/);
    expect(groundingIssue(ans("S8", "Rent", "UPI COURIER", "S9"), lines[0])).toMatch(/does not name the line/);
    expect(groundingIssue(ans("S8", "Rent", "| 1180.0"), lines[0])).toMatch(/number 1180.0/);
    expect(groundingIssue(ans("S8", "Rent", "x"), undefined)).toMatch(/unknown line/);
    expect(validateClassification({ suggestions: [ans("S8", "Rent", "UPI COURIER"), ans("S8", "Rent", "UPI COURIER")] }, lines)).toEqual(["S8: answered twice"]);
    expect(lineText(lines[1])).toBe("S9 | 2026-10-31 | GST ON CHARGES |  | 225.00");
  });

  it("no candidates → no model call; no ledger list → every line is a reviewer question, no model call", async () => {
    let calls = 0;
    const model = (async () => {
      calls++;
      return { suggestions: [] };
    }) as unknown as ModelCaller;
    expect(await suggestClassifications(model, [], TB, null)).toEqual({ suggestions: [], heads: ["Bank Charges", "Rent", "Trading Goods"] });
    const noTb = await suggestClassifications(model, lines, null, null);
    expect(calls).toBe(0);
    expect(noTb.suggestions.map((s) => s.status)).toEqual(["insufficient_evidence", "insufficient_evidence"]);
  });

  it("calls the router fast tier (sop), anonymised, with the books task, contradictions wired; abstain and ungrounded become questions", async () => {
    const { router, model } = viaRouter({ suggestions: [ans("S9", "Bank Charges", "GST ON CHARGES"), ans("S8", INSUFFICIENT, "UPI COURIER", "S8", 0.3)] });
    const out = await suggestClassifications(model, lines, TB, "check courier");
    const call = router.calls[0];
    expect(call).toMatchObject({ task: "books.classify-expenses", privacy: "anonymize-then-cloud", difficulty: "sop" });
    expect(call.messages[0].content).toBe(CLASSIFY_SYSTEM);
    expect(call.messages[1].content).toContain("Reviewer notes: check courier");
    expect(call.messages[1].content).toContain("Allowed ledgers: Bank Charges; Rent; Trading Goods");
    expect(typeof call.contradictions).toBe("function");
    expect(await call.contradictions!({ suggestions: [ans("S9", "Rent", "NOT THERE")] })).toEqual(['S9: quote "NOT THERE" is not in the line text']);
    expect(out.suggestions).toEqual([
      { lineId: "S8", ledger: INSUFFICIENT, confidence: 0.3, reason: "", status: "insufficient_evidence", evidence: { quote: "UPI COURIER", location: "S8" } },
      { lineId: "S9", ledger: "Bank Charges", confidence: 0.9, reason: "", status: "suggested", evidence: { quote: "GST ON CHARGES", location: "S9" } },
    ]);
    const bad = toSuggestions({ suggestions: [ans("S8", "Rent", "INVENTED TEXT"), ans("S8", "Bank Charges", "UPI COURIER")] }, lines);
    expect(bad.map((s) => [s.lineId, s.status, s.ledger])).toEqual([
      ["S8", "ungrounded", INSUFFICIENT],
      ["S9", "insufficient_evidence", INSUFFICIENT],
    ]);
  });

  it("a recorded answer naming a ledger the client does not have is refused (schema), so the run cannot use it", async () => {
    const { model } = viaRouter({ suggestions: [ans("S8", "Courier Charges", "UPI COURIER")] });
    await expect(suggestClassifications(model, lines, TB, null)).rejects.toThrow(/suggestions.0.ledger: Invalid enum value/);
  });

  it("prompt lists each line once and never asks for totals", () => {
    const p = classifyPrompt(lines, ["Rent"], null);
    expect(p).toContain("S8 | 2026-10-30 | UPI COURIER | U1 | 1180.00");
    expect(p).not.toMatch(/Reviewer notes|total/i);
  });
});

describe("wrong department fails closed before any model call (ADR-008 §7)", () => {
  const GST_REGISTER = "GSTIN of Recipient,Invoice No,Invoice Date,Taxable Value,IGST Amount\n29AAACE1234F1Z2,INV-1,05/10/2026,1000,180";
  it("sniffs GST, Tax and ROC documents; a TB is not mistaken for any of them", () => {
    expect(sniffCsv("sales-register.csv", Buffer.from(GST_REGISTER))).toEqual({ agent: "gst", label: "GST Prep" });
    expect(sniffRows(parseCsv("Name of Deductor,TAN of Deductor,Assessment Year,Amount\nX,BLRX12345A,2026-27,10"))).toEqual({ agent: "tax", label: "Tax Prep" });
    expect(sniffRows(parseCsv("Folio,Name,No. of Shares,DIN\n1,X,100,01234567"))).toEqual({ agent: "roc", label: "ROC Prep" });
    expect(sniffRows(parseCsv("Particulars,Group,Debit,Credit\nCash,Cash-in-Hand,1,"))).toBeNull();
    expect(sniffCsv("tb.xlsx", Buffer.from("PK"))).toBeNull();
  });
  it("input schema: GST registers instead of a TB → message naming the GST Prep agent", () => {
    const r = booksInputSchema.safeParse([{ name: "sales-register.csv", source: "fixture", bytes: Buffer.from(GST_REGISTER) }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Wrong department: sales-register.csv looks like a GST Prep document, not Books Close input. Run the GST Prep agent (/agents/gst) instead.");
  });
  it("a 'trial balance' file that is really a GST register stops the run in extract, before the classifier", async () => {
    let calls = 0;
    const model = (async () => {
      calls++;
      return { suggestions: [] };
    }) as unknown as ModelCaller;
    const input = { files: [{ name: "trial-balance.csv", kind: "tb" as const, bytes: Buffer.from(GST_REGISTER) }] };
    await expect(booksAgent.extract({ input, files: [], job: JOB, runId: "r", notes: null, model })).rejects.toBeInstanceOf(WrongDepartmentError);
    expect(calls).toBe(0);
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
    const ev = (quote: string, location: string) => ({ quote, location });
    const extracted = { ...parsed, chartHeads: [], suggestions: [ { lineId: "S8", ledger: INSUFFICIENT, confidence: 0.3, reason: "No courier ledger", status: "insufficient_evidence" as const, evidence: ev("UPI-SWIFT COURIERS-DOCS", "S8") }, { lineId: "S9", ledger: "Bank Charges", confidence: 0.5, reason: "", status: "suggested" as const, evidence: ev("GST ON CHARGES", "S9") }, { lineId: "S77", ledger: "Rent", confidence: 0.9, reason: "r", status: "suggested" as const, evidence: null }, { lineId: "S1", ledger: INSUFFICIENT, confidence: 0, reason: "x", status: "ungrounded" as const, evidence: null } ] };
    const drafts = booksPack({ extracted, figures: computeBooksFigures(extracted), job: JOB, results: [] });
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    if (d.type !== "xlsx") throw new Error("xlsx expected");
    expect(d.title).toBe("Month-end pack");
    const sug = d.sheets.find((s) => s.name === "Expense suggestions")!;
    expect(sug.rows.map((r) => r.status)).toEqual(["Reviewer question — documents insufficient; ask the client what this payment was for", "Suggestion — not posted; low confidence", "Suggestion — not posted", "Reviewer question — model answer not grounded; classify manually"]);
    expect(sug.rows.map((r) => r.ledger)).toEqual(["", "Bank Charges", "Rent", ""]);
    expect(sug.rows[1].reason).toBe("quote: \"GST ON CHARGES\"");
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
