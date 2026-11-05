import { describe, expect, it } from "vitest";
import { FIRM_PREAMBLE, composeSystemPrompt } from "@/lib/agents/core/guardrails/scope";
import { looksLikeGstFile, numbersGrounded, numbersIn, quoteIn, wrongDepartment } from "@/lib/agents/core/guardrails/shared";
import { LedgerMappingSchema, ROC_AOC2_CHECK_SPEC, ROC_MAP_TASK_SPEC, ROC_MODEL_TASKS, ROC_PREAMBLE, acceptedMappings, ledgerPrompt, mapLedgersUserMessage, validateLedgerMapping } from "./model-tasks";
import type { TbLine } from "./parse";
import { ROC_CHECKLIST } from "./rules";

const TB: TbLine[] = [
  { ledger: "Share Capital", debitPaise: 0, creditPaise: 100 },
  { ledger: "Suspense", debitPaise: 5, creditPaise: 0 },
  { ledger: "HDFC Bank", debitPaise: 95, creditPaise: 0 },
];
const ev = (i: number, quote = TB[i].ledger) => ({ quote, location: `financials.json trialBalance[${i}]` });
const file = (name: string, text: string) => ({ name, bytes: Buffer.from(text) });

describe("ROC task registry (ADR-008)", () => {
  it("names every task roc.<task>, version 1, and serves only ROC rule ids", () => {
    const ruleIds = new Set(ROC_CHECKLIST.rules.map((r) => r.id));
    for (const t of ROC_MODEL_TASKS) {
      expect(t.name.startsWith("roc.")).toBe(true);
      expect(t.version).toBe(1);
      expect((t.ruleIds ?? []).every((r) => ruleIds.has(r))).toBe(true);
    }
  });
  it("the mapping prompt carries the firm and department preambles (framework) and the ROC department note", () => {
    const system = composeSystemPrompt("ROC", ROC_MAP_TASK_SPEC);
    expect(system.startsWith(FIRM_PREAMBLE)).toBe(true);
    expect(system).toContain(ROC_PREAMBLE);
    expect(ROC_PREAMBLE).toMatch(/Companies Act, 2013/);
    expect(ROC_MAP_TASK_SPEC.systemPrompt).toMatch(/insufficient_evidence/);
  });
  it("closed output: heads are an enum with insufficient_evidence; quotes capped at 300", () => {
    expect(LedgerMappingSchema.safeParse({ mappings: [{ ledger: "X", head: "goodwill", evidence: ev(0) }] }).success).toBe(false);
    expect(LedgerMappingSchema.safeParse({ mappings: [{ ledger: "X", head: "insufficient_evidence", evidence: ev(0) }] }).success).toBe(true);
    expect(LedgerMappingSchema.safeParse({ mappings: [{ ledger: "X", head: "cashAndBank", evidence: { quote: "x".repeat(301), location: "l" } }] }).success).toBe(false);
  });
  it("the prompt shows ledger names with line labels and no amounts", () => {
    const { text, labels } = ledgerPrompt(TB);
    expect(labels[2]).toBe("financials.json trialBalance[2]");
    expect(text).not.toMatch(/\b100\b|\b95\b/);
    expect(mapLedgersUserMessage(TB, "see note")).toContain("Reviewer notes: see note");
    expect(mapLedgersUserMessage(TB, null)).not.toContain("Reviewer notes");
  });
});

describe("validateLedgerMapping / acceptedMappings", () => {
  it("accepts grounded mappings and turns abstentions into questions", () => {
    const out = { mappings: [{ ledger: "Share Capital", head: "shareCapital" as const, evidence: ev(0) }, { ledger: "Suspense", head: "insufficient_evidence" as const, evidence: ev(1) }] };
    expect(validateLedgerMapping(out, TB)).toEqual([]);
    expect(acceptedMappings(out, TB)).toEqual({ mappings: [{ ledger: "Share Capital", head: "shareCapital" }], questions: ["Suspense"], dropped: [] });
  });
  it("drops unknown ledgers, wrong locations, invented quotes and conflicting heads", () => {
    const out = {
      mappings: [
        { ledger: "Goodwill", head: "otherAssets" as const, evidence: ev(0, "Goodwill") },
        { ledger: "Share Capital", head: "shareCapital" as const, evidence: { quote: "Share Capital", location: "line 1" } },
        { ledger: "HDFC Bank", head: "cashAndBank" as const, evidence: ev(2, "HDFC Bank current account") },
        { ledger: "Suspense", head: "otherAssets" as const, evidence: ev(1) },
        { ledger: "Suspense", head: "otherLiabilities" as const, evidence: ev(1) },
      ],
    };
    const issues = validateLedgerMapping(out, TB);
    expect(issues.join("\n")).toMatch(/"Goodwill" is not in the trial balance/);
    expect(issues.join("\n")).toMatch(/location "line 1" is not a line given/);
    expect(issues.join("\n")).toMatch(/"HDFC Bank": quote is not copied/);
    expect(issues.join("\n")).toMatch(/mapped to two heads/);
    const acc = acceptedMappings(out, TB);
    expect(acc.mappings).toEqual([]);
    expect(acc.dropped).toEqual(["Goodwill", "Share Capital", "HDFC Bank", "Suspense", "Suspense"]);
    expect(ROC_MAP_TASK_SPEC.validate!(out, { financials: { kind: "tb", trialBalance: TB } } as never)).toEqual(issues);
    expect(ROC_MAP_TASK_SPEC.validate!(out, { financials: { kind: "summary" } } as never)).not.toEqual([]); // no TB: every mapping names a foreign ledger
  });
  it("the AOC-2 verdict quote must come from the notes", () => {
    const v = { status: "fail" as const, evidence: { quote: "rent paid to a relative", location: "notes.txt line 2" } };
    expect(ROC_AOC2_CHECK_SPEC.validate!(v, "notes.txt line 2: Rent paid to a relative of the director")).toEqual([]);
    expect(ROC_AOC2_CHECK_SPEC.validate!(v, "notes.txt line 1: nothing")).toHaveLength(1);
  });
});

describe("grounding helpers", () => {
  it("quoteIn is whitespace- and case-insensitive; empty quotes never match", () => {
    expect(quoteIn("A  long\nline", "long LINE")).toBe(true);
    expect(quoteIn("abc", "  ")).toBe(false);
  });
  it("numbers in a value must appear in its quote", () => {
    expect(numbersIn("Rs 1,20,000.50 on 31-03")).toEqual(["120000.50", "31", "03"]);
    expect(numbersGrounded("₹1,20,000", "interest 120000 credited")).toBe(true);
    expect(numbersGrounded("₹1,20,001", "interest 120000 credited")).toBe(false);
  });
});

describe("wrong-department sniff", () => {
  it("tax inputs given to ROC name the Tax agent; ROC inputs given to Tax name ROC", () => {
    expect(wrongDepartment([file("organiser.json", "{}"), file("26AS.csv", "tan")], "roc")).toMatch(/income-tax inputs \(organiser\.json, 26as\.csv\): run the Tax Prep agent/);
    expect(wrongDepartment([file("company.json", "{}")], "tax")).toMatch(/run the ROC Prep agent, not Tax Prep/);
  });
  it("GST registers name the GST agent", () => {
    expect(wrongDepartment([file("sales-register.csv", "a,b")], "roc")).toMatch(/GST Prep agent/);
    expect(wrongDepartment([file("data.csv", "Invoice No,GSTIN,Taxable value\n")], "tax")).toMatch(/data\.csv/);
    expect(looksLikeGstFile(file("data.csv", "invoice,party"))).toBe(false);
    expect(looksLikeGstFile(file("gstin.json", "{}"))).toBe(false);
    expect(looksLikeGstFile(file("GSTR-2B.json", "{}"))).toBe(true);
  });
  it("own inputs, or nothing recognisable, pass the sniff", () => {
    expect(wrongDepartment([file("company.json", "{}"), file("26as.csv", "")], "roc")).toBeNull();
    expect(wrongDepartment([file("readme.txt", "")], "roc")).toBeNull();
  });
});
