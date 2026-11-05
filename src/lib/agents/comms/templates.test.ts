// Deterministic templates (Phase 10): one snapshot per kind, facts filled by code (DD MMM YYYY,
// ₹ Indian grouping, the recorded ack ref), tone rules hold, bad input is refused.
import { describe, expect, it } from "vitest";
import { factTokens, factsIn, residualProblems, stripFacts, tokenFacts } from "./facts";
import { lintTone } from "./tone";
import { CommsInputError, answerParagraphs, buildTemplate, periodLabel, renderBody, stageSentence, type JobFacts, type TemplateInput } from "./templates";
import { JOB, PEOPLE, SAMPLES } from "../../../../tests/fakes/comms-fixtures";

const english = (t: ReturnType<typeof buildTemplate>) => `${t.subject}\n\n${renderBody(t)}`;

describe("templates — one snapshot per kind", () => {
  for (const [kind, input] of Object.entries(SAMPLES)) {
    it(`${kind}: deterministic text, every fact present, tone rules hold`, () => {
      const t = buildTemplate(input);
      expect(english(t)).toMatchSnapshot();
      expect(buildTemplate(input)).toEqual(t); // deterministic
      expect(lintTone(renderBody(t), { requireAsk: t.requiresAsk })).toEqual([]);
      for (const f of t.facts.filter((x) => x.kind !== "token" && x.kind !== "item")) expect(english(t), f.value).toContain(f.value);
      for (const p of t.paragraphs) expect(p.length).toBeLessThanOrEqual(280);
      // The template adds nothing date-, money- or number-like beyond its facts.
      for (const p of [t.subject, ...t.paragraphs]) expect(residualProblems(p, t.facts), p).toEqual([]);
    });
  }

  it("dates are DD MMM YYYY (IST day), amounts ₹ with Indian grouping, the ack ref as recorded", () => {
    const t = buildTemplate(SAMPLES["filing-completed"]);
    expect(t.paragraphs).toEqual([
      "Your GSTR-3B for October 2026 was filed on 18 Nov 2026.",
      "The acknowledgement number is AA2911260123456.",
      "The amount paid with this return was ₹1,23,456.00.",
    ]);
    expect(t.facts.map((f) => f.kind).sort()).toEqual(["amount", "date", "label", "name", "name", "period", "ref"]);
  });

  it("greeting falls back when there is no contact; the sign-off is the staff member and the firm", () => {
    const t = buildTemplate({ ...SAMPLES.status, contactName: null } as TemplateInput);
    expect(t.greeting).toBe("Dear Sir or Madam,");
    expect(renderBody(t).endsWith("Regards,\nPriya Sharma\nIndefine")).toBe(true);
  });
});

describe("template input checks", () => {
  const bad = (input: TemplateInput, status: 400 | 409, msg: RegExp) => {
    try {
      buildTemplate(input);
      throw new Error("expected CommsInputError");
    } catch (e) {
      expect(e).toBeInstanceOf(CommsInputError);
      expect((e as CommsInputError).status).toBe(status);
      expect((e as Error).message).toMatch(msg);
    }
  };
  it("filing-completed needs the filing and ack ref recorded (409)", () => {
    bad({ ...PEOPLE, kind: "filing-completed", job: JOB }, 409, /Mark filed/);
  });
  it("due-reminder needs a statutory due date (409), a payment ask needs an amount (400), not for a filed job (409)", () => {
    const by = new Date("2026-11-18T09:00:00+05:30");
    bad({ ...PEOPLE, kind: "due-reminder", job: { ...JOB, statutoryDueOn: null }, ask: "confirm", replyBy: by }, 409, /due date/);
    bad({ ...PEOPLE, kind: "due-reminder", job: JOB, ask: "payment", replyBy: by }, 400, /amount/);
    bad({ ...PEOPLE, kind: "due-reminder", job: JOB, ask: "confirm", replyBy: by, amountInr: -5 }, 400, /above/);
    bad({ ...PEOPLE, kind: "due-reminder", job: { ...JOB, state: "DONE" }, ask: "confirm", replyBy: by }, 409, /already filed/);
  });
  it("doc-chase needs 1 to 8 documents, each at most 160 characters", () => {
    const base = SAMPLES["doc-chase"] as Extract<TemplateInput, { kind: "doc-chase" }>;
    bad({ ...base, items: [] }, 400, /at least one/);
    bad({ ...base, items: Array.from({ length: 9 }, (_, i) => `Document ${i}`) }, 400, /At most 8/);
    bad({ ...base, items: ["x".repeat(161)] }, 400, /longer than 160/);
    expect(buildTemplate({ ...base, items: ["Bank statement", "bank statement"] }).items).toEqual(["Bank statement"]);
  });
  it("query-response: topic and answer required and short; one ask at most", () => {
    const base = SAMPLES["query-response"] as Extract<TemplateInput, { kind: "query-response" }>;
    bad({ ...base, topic: " " }, 400, /topic is required/);
    bad({ ...base, answer: "" }, 400, /answer is required/);
    bad({ ...base, answer: "word ".repeat(130) }, 400, /longer than 600/);
    bad({ ...base, answer: "Please send the lease. Please also send the rent receipts." }, 400, /more than one thing/);
    bad({ ...base, clientName: "" }, 400, /Client name/);
  });
});

describe("helpers", () => {
  it("periodLabel: month, quarter, annual, anything else", () => {
    expect(periodLabel("2026-10", "2026-27")).toBe("October 2026");
    expect(periodLabel("Q2", "2026-27")).toBe("Q2 of FY 2026-27");
    expect(periodLabel("Annual", "2026-27")).toBe("FY 2026-27");
    expect(periodLabel("H1", "2026-27")).toBe("H1 (FY 2026-27)");
    expect(periodLabel("2026-13", "2026-27")).toBe("2026-13 (FY 2026-27)");
  });
  it("stageSentence covers every state without naming internal stages", () => {
    const states: JobFacts["state"][] = ["DRAFT", "ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING", "DONE"];
    for (const s of states) expect(stageSentence({ ...JOB, state: s })).not.toMatch(/agent|AGENT|IN_/);
    expect(stageSentence({ ...JOB, state: "DONE", filedAt: new Date("2026-11-18T10:00:00Z") })).toBe("It was filed on 18 Nov 2026.");
    expect(stageSentence({ ...JOB, state: "DONE" })).toBe("It has been filed.");
  });
  it("answerParagraphs splits long answers at sentences and refuses a sentence over 280 characters", () => {
    const s = `${"a".repeat(150)}.`;
    expect(answerParagraphs(`${s} ${s.replace(/^a/, "B")}`)).toHaveLength(2);
    expect(() => answerParagraphs(`${"a".repeat(281)}.`)).toThrow(/longer than 280/);
    expect(() => answerParagraphs("A.\n\nB.\n\nC.\n\nD.")).toThrow(/more than 3/);
  });
  it("factTokens finds dates, amounts, references and numbers without overlaps", () => {
    expect(factTokens("Pay ₹1,23,456.00 by 20 Nov 2026 for GSTR-3B (ARN AA2911260123456), 3 invoices, October 2026, 2.5 lakh").map((t) => [t.kind, t.value])).toEqual([
      ["amount", "₹1,23,456.00"],
      ["date", "20 Nov 2026"],
      ["ref", "GSTR-3B"],
      ["ref", "AA2911260123456"],
      ["number", "3"],
      ["date", "October 2026"],
      ["amount", "2.5 lakh"],
    ]);
    expect(tokenFacts("no numbers here")).toEqual([]);
  });
  it("residualProblems names what a rewrite added; stripFacts / factsIn work longest first", () => {
    const facts = [{ kind: "date" as const, value: "20 Nov 2026" }, { kind: "amount" as const, value: "₹1,000.00" }];
    expect(residualProblems("Pay ₹1,000.00 by 20 Nov 2026.", facts)).toEqual([]);
    expect(residualProblems("Pay by 21 Nov 2026.", facts)).toHaveLength(2); // digits + month
    expect(residualProblems("Pay by Friday or by the end of the month.", facts)).toHaveLength(2);
    expect(residualProblems("Pay Rs 500 or 18% to x@y.in, see www.x.in", facts)).toHaveLength(4);
    expect(stripFacts("a 20 Nov 2026 b", facts)).toBe("a   b");
    expect(factsIn("by 20 Nov 2026", facts)).toEqual([facts[0]]);
  });
});
