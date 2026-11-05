import { describe, expect, it } from "vitest";
import { FIRM_PREAMBLE, composeSystemPrompt } from "@/lib/agents/core/guardrails/scope";
import { inputOf } from "./__fixtures__/base";
import { TAX_RULESETS } from "./data";
import { AisMatchSchema, TAX_FOREIGN_ASSET_CHECK_SPEC, TAX_MATCH_AIS_SPEC, TAX_MODEL_TASKS, TAX_PREAMBLE, acceptedAisMatches, aisPrompt, matchAisUserMessage, taxYearLine, validateAisMatches, type AisMatchOutput } from "./model-tasks";
import { TAX_CHECKLIST } from "./rules";

const i = inputOf("clean-salaried-new");
const ctx = { ais: i.ais ?? [], books: i.organiser.otherSources };
const ev = (quote: string, location: string) => ({ quote, location });
const B1 = ev("B1 | savings-interest | SBI Savings Account", "organiser.json otherSources[0]");
const B2 = ev("B2 | deposit-interest | HDFC Bank Fixed Deposit", "organiser.json otherSources[1]");

describe("Tax task registry (ADR-008)", () => {
  it("tasks are tax.<task>@1 serving tax rules only", () => {
    const ids = new Set(TAX_CHECKLIST.rules.map((r) => r.id));
    for (const t of TAX_MODEL_TASKS) {
      expect(t.name.startsWith("tax.")).toBe(true);
      expect(t.version).toBe(1);
      expect((t.ruleIds ?? []).every((r) => ids.has(r))).toBe(true);
    }
  });
  it("the system prompt is fixed per version (firm + income-tax preambles); the user message names the Act and year", () => {
    expect(taxYearLine(TAX_RULESETS["2025-26"])).toMatch(/Income-tax Act, 1961 .* assessment year 2026-27/);
    expect(composeSystemPrompt("IncomeTax", TAX_MATCH_AIS_SPEC).startsWith(FIRM_PREAMBLE)).toBe(true);
    expect(TAX_MATCH_AIS_SPEC.systemPrompt).toContain(TAX_PREAMBLE);
    expect(matchAisUserMessage(TAX_RULESETS["2026-27"], ctx, null)).toMatch(/Income-tax Act, 2025/);
    expect(matchAisUserMessage(TAX_RULESETS["2025-26"], ctx, "see note")).toMatch(/^Reviewer notes: see note/);
    expect(TAX_MATCH_AIS_SPEC.systemPrompt).toMatch(/insufficient_evidence/);
  });
  it("closed outputs", () => {
    expect(AisMatchSchema.safeParse({ matches: [{ aisId: "A1", outcome: "maybe", bookId: null, evidence: B1 }] }).success).toBe(false);
    expect(AisMatchSchema.safeParse({ matches: [{ aisId: "A1", outcome: "insufficient_evidence", bookId: null, evidence: B1 }] }).success).toBe(true);
  });
  it("the prompt lists income lines and ledgers, never amounts", () => {
    const p = aisPrompt(ctx);
    expect([...p.aisLines.keys()]).toEqual(["A1", "A2"]); // salary line is informational
    expect(p.text).toContain("ais.csv row 3: A2 | interest-deposit | HDFC Bank Ltd | Interest from term deposit");
    expect(p.text).not.toMatch(/42,?000|8,?000/);
  });
});

describe("validateAisMatches / acceptedAisMatches", () => {
  it("accepts grounded matches", () => {
    const out: AisMatchOutput = { matches: [{ aisId: "A1", outcome: "matched", bookId: "B1", evidence: B1 }, { aisId: "A2", outcome: "matched", bookId: "B2", evidence: B2 }] };
    expect(validateAisMatches(out, ctx)).toEqual([]);
    expect(acceptedAisMatches(out, ctx)).toEqual([
      { aisId: "A1", outcome: "matched", bookId: "B1" },
      { aisId: "A2", outcome: "matched", bookId: "B2" },
    ]);
  });
  it("rejects unknown ids, nature mismatch, wrong quotes, named ledgers on abstain, duplicates", () => {
    const out: AisMatchOutput = {
      matches: [
        { aisId: "A3", outcome: "matched", bookId: "B1", evidence: B1 }, // salary line, not income
        { aisId: "A1", outcome: "matched", bookId: "B2", evidence: B2 }, // savings line vs deposit ledger
        { aisId: "A2", outcome: "matched", bookId: "B9", evidence: B2 },
        { aisId: "A2", outcome: "not_in_books", bookId: "B2", evidence: ev("A2", "ais.csv row 3") },
      ],
    };
    const issues = validateAisMatches(out, ctx).join("\n");
    expect(issues).toMatch(/A3 is not an AIS income line/);
    expect(issues).toMatch(/interest-savings line cannot match a deposit-interest ledger/);
    expect(issues).toMatch(/ledger B9 does not exist/);
    expect(issues).toMatch(/must not name a ledger/);
    expect(issues).toMatch(/A2 answered twice/);
    expect(acceptedAisMatches(out, ctx)).toEqual([
      { aisId: "A1", outcome: "dropped", bookId: null },
      { aisId: "A2", outcome: "dropped", bookId: null },
    ]);
    expect(TAX_MATCH_AIS_SPEC.validate!(out, i).length).toBeGreaterThan(0); // validate reads the AIS lines and ledgers from the parsed input
  });
  it("evidence must quote the cited line; missing answers are unanswered", () => {
    const out: AisMatchOutput = {
      matches: [
        { aisId: "A1", outcome: "matched", bookId: "B1", evidence: ev("SBI savings, interest", "organiser.json otherSources[0]") },
        { aisId: "A2", outcome: "insufficient_evidence", bookId: null, evidence: ev("HDFC Bank Ltd", "ais.csv row 2") },
      ],
    };
    expect(validateAisMatches(out, ctx)).toEqual(["AIS A1: evidence must quote the matched ledger line organiser.json otherSources[0]", "AIS A2: evidence must quote its AIS line ais.csv row 3"]);
    expect(acceptedAisMatches({ matches: [{ aisId: "A2", outcome: "insufficient_evidence", bookId: null, evidence: ev("HDFC Bank Ltd", "ais.csv row 3") }] }, ctx)).toEqual([
      { aisId: "A1", outcome: "unanswered", bookId: null },
      { aisId: "A2", outcome: "insufficient_evidence", bookId: null },
    ]);
  });
  it("the foreign-asset verdict quote must be in the documents", () => {
    const v = { status: "fail" as const, evidence: ev("RSUs of Fixture Inc", "organiser.json profile.notes line 1") };
    expect(TAX_FOREIGN_ASSET_CHECK_SPEC.validate!(v, "organiser.json profile.notes line 1: Holds RSUs of Fixture Inc (USA)")).toEqual([]);
    expect(TAX_FOREIGN_ASSET_CHECK_SPEC.validate!(v, "nothing")).toHaveLength(1);
  });
});
