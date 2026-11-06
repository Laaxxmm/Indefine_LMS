// Security finding #12 (audit PoC 03 / 03b, ReDoS): mask() was quadratic on long delimiter-free
// runs (the EMAIL regex) — a 200 KB register cell took 40–75 s and blocked the event loop. Every
// pattern is now bounded / anchored, the '@' maskers scan linearly, and over-long runs and messages
// are cut (and flagged) before matching. Each 200 KB adversarial input must mask in < 200 ms.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_MASK_CHARS, MAX_RUN_CHARS, PATTERNS, capLongRuns, mask } from "@/lib/ai/anonymizer";
import { createGuardrailSession } from "@/lib/agents/core/guardrails/session";

const KB = 1024;
const size = 200 * KB;
const rep = (unit: string) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);

/** The audit's inputs (PoC 03) plus shapes aimed at the new maskers. */
const INPUTS: [string, string][] = [
  ["200KB of digits", rep("9")],
  ["200KB of 'A'", rep("A")],
  ["repeated '+91 '", rep("+91 ")],
  ["repeated '+91 9' (phone prefix, never 10 digits)", rep("+91 9")],
  ["'9 ' pairs", rep("9 ")],
  ["'9-' pairs", rep("9-")],
  ["email-ish 'a@a@a@'", rep("a@a@")],
  ["email-ish long local part then no TLD", rep("a") + "@" + rep("b").slice(0, 50 * KB)],
  ["email-ish 'a.a.a.a@'", rep("a.") + "@x"],
  ["dotted host 'x@a.a.a.a.'", "x@" + rep("a.")],
  ["'1 Jan 1' date-ish runs", rep("1 Jan 1 ")],
  ["'12/12/' date-ish runs", rep("12/12/")],
  ["bank-ac-ish digits with 'account' every 40 chars", rep("account 1 2 3 4 5 6 7 8 9 1 2 3 4 5 ")],
  ["aadhaar-ish '2345 6789 ' pairs", rep("2345 6789 ")],
  ["dictionary: 200KB of 'Rajesh '", rep("Rajesh ")],
  ["GSTIN-ish '29ABCDE1234F1Z' (missing last char)", rep("29ABCDE1234F1Z")],
  ["tokens: 200KB of '⟨PAN_1⟩'", rep("⟨PAN_1⟩")],
  ["mixed realistic ledger text", rep("S12 | 2026-10-03 | NEFT-ACME TRADERS-HDFC0001234-50100123456789 | REF9876543210 | 12,345.00\n")],
  ["narration rails 'NEFT-A '", rep("NEFT-A ")],
  ["spoken e-mail 'a at b dot '", rep("a at b dot ")],
  ["JSON name keys", rep('"party": "Ab Cd", ')],
  ["zero-width between letters", rep("A​")],
  ["fullwidth digits", rep("９")],
  ["door numbers + PIN context", rep("No. 1, road 560001 ")],
  ["boxed PAN-ish 'A B C D E '", rep("A B C D E ")],
  // Re-audit NEW-1: shapes aimed at the free-text name extractor and the dictionary normalisation.
  ["labelled names 'name: Ab Cd'", rep("name: Ab Cd\n")],
  ["honorifics 'Mr Mr '", rep("Mr Mr ")],
  ["UPI narrations", rep("UPI/P2A/123456789012/Ab Cd/")],
  ["capitalised runs 'Ab Cd Ef '", rep("Ab Cd Ef ")],
  ["camelCase runs 'AbCdEfGh '", rep("AbCdEfGh ")],
  // Round 3: Aadhaar last-4 and vehicle registration marks.
  ["masked runs 'XXXX XXXX '", rep("XXXX XXXX ")],
  ["'Aadhaar no. ' labels without digits", rep("Aadhaar no. ending XX-")],
  ["plate-ish 'KA 01 AB ' (never four digits)", rep("KA 01 AB ")],
  ["plate-ish 'KA-1-A-B-' runs", rep("KA-1-A-B-")],
  ["Bharat-ish '22 BH '", rep("22 BH ")],
];

const DICT = [
  { value: "Rajesh Kumar Sharma", kind: "NAME" as const },
  { value: "Acme Widgets Private Limited", kind: "ORG" as const },
  { value: "No. 12, 4th Cross, Jayanagar, Bengaluru 560041", kind: "ADDRESS" as const },
];

/** Best of three: the bound is on the algorithm, not on a busy CI box's scheduler. */
function bestMs(f: () => void): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    f();
    best = Math.min(best, performance.now() - t0);
  }
  return Math.round(best);
}

/**
 * 200 ms in `npm test` (run three times at every gate). Under `npm run test:coverage` the v8
 * instrumentation slows these regex-heavy loops (207 ms seen on a 79–85 ms input at the Phase 12
 * gate), so that run allows 1 s: still 40× below the quadratic bug (40–75 s), which is what this
 * file guards. FIRM_OS_COVERAGE_RUN is set by vitest.config.ts only when --coverage is passed.
 */
const BUDGET_MS = process.env.FIRM_OS_COVERAGE_RUN === "1" ? 1_000 : 200;

describe(`mask(): linear time on 200 KB adversarial inputs (< ${BUDGET_MS} ms each)`, () => {
  it.each(INPUTS)("%s", (_name, text) => {
    expect(text.length).toBeGreaterThanOrEqual(size);
    const ms = bestMs(() => mask(text, { dictionary: DICT }));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("every exported PATTERN is linear on its worst probe (PoC 03 'individual pattern worst cases')", () => {
    const probes: Record<string, string> = { EMAIL: rep("a@a."), PHONE: rep("9 "), BANK_AC: rep("9 "), AADHAAR: rep("2345 "), DATE: rep("1 Jan "), default: rep("A1") };
    for (const [k, re] of Object.entries(PATTERNS)) {
      const text = probes[k] ?? probes.default;
      const ms = bestMs(() => {
        const r = new RegExp(re.source, re.flags);
        for (let m = r.exec(text); m; m = r.exec(text)) if (m[0].length === 0) r.lastIndex++;
      });
      expect(ms, k).toBeLessThan(BUDGET_MS);
    }
  });

  it("EMAIL no longer scales quadratically: 100 KB costs about 4× 25 KB at most, not 16× (PoC 03b)", () => {
    const run = (n: number) => bestMs(() => {
      const r = new RegExp(PATTERNS.EMAIL.source, PATTERNS.EMAIL.flags);
      const t = "a".repeat(n * KB);
      for (let m = r.exec(t); m; m = r.exec(t)) if (m[0].length === 0) r.lastIndex++;
    });
    const small = Math.max(1, run(25));
    expect(run(100)).toBeLessThan(small * 8 + 20);
  });

  it("re-audit NEW-1: Devanagari text with a transliterated dictionary scales linearly (100 KB ≤ ~4× 25 KB)", () => {
    const text = (n: number) => "भुगतान राजेश कुमार को ".repeat(Math.ceil((n * KB) / 22));
    const run = (n: number) => bestMs(() => mask(text(n), { dictionary: DICT }));
    const small = Math.max(1, run(25));
    expect(run(100)).toBeLessThan(small * 8 + 40);
  });

  it("a 64 KB CSV cell of digits (an oversized register cell) masks quickly, cut and flagged (PoC 03b)", () => {
    const text = "ref,party,amount\nINV-1," + "7".repeat(64 * KB) + ",100.00";
    const ms = bestMs(() => mask(text));
    expect(ms).toBeLessThan(BUDGET_MS);
    const r = mask(text);
    expect(r.truncated).toEqual({ runs: 1, chars: 64 * KB - MAX_RUN_CHARS });
    expect(r.masked).toContain("characters not sent]");
    expect(r.masked.length).toBeLessThan(2 * MAX_RUN_CHARS);
  });
});

describe("size caps before masking (truncate + flag)", () => {
  it("a run longer than MAX_RUN_CHARS is cut with a visible marker; normal text is untouched", () => {
    expect(capLongRuns("ordinary text, 12,345.00")).toEqual({ text: "ordinary text, 12,345.00", runs: 0, chars: 0 });
    const long = "x".repeat(MAX_RUN_CHARS + 500);
    const c = capLongRuns(`a ${long} b`);
    expect(c.runs).toBe(1);
    expect(c.chars).toBe(500);
    expect(c.text).toBe(`a ${"x".repeat(MAX_RUN_CHARS)} […500 characters not sent] b`);
  });
  it("a message longer than MAX_MASK_CHARS is cut at the cap", () => {
    const words = "word ".repeat(Math.ceil((MAX_MASK_CHARS + 1000) / 5));
    const c = capLongRuns(words);
    expect(c.text.length).toBeLessThan(MAX_MASK_CHARS + 100);
    expect(c.chars).toBe(words.length - MAX_MASK_CHARS);
  });
  it("mask() reports no truncation for ordinary text", () => {
    expect(mask("PAN ABCDE1234F").truncated).toBeNull();
  });

  it("a scoped agent call with an over-long cell sends it shortened and the run carries the input-truncated warn row", async () => {
    const sent: string[] = [];
    const session = createGuardrailSession({
      agent: { key: "books", title: "Books", service: "Books", defaultChecklist: { schemaVersion: 1 as const, key: "books", version: "1.0.0", rules: [] } },
      scope: { department: "Books", tasks: [{ name: "books.classify-expenses", version: 1, schema: z.object({ n: z.number() }), systemPrompt: "x", difficulty: "sop" }], ruleIds: [], inputSniff: () => ({ ok: true }) },
      route: async (req) => {
        sent.push(req.messages.map((m) => m.content).join("\n"));
        return { status: "ok", output: { n: 1 } as never, provider: "local", model: "m", confidence: 1, escalated: false, anonymized: false, tokensIn: 0, tokensOut: 0, costInr: 0, needsPartnerReview: false, attempts: 1 };
      },
      unwrap: (res) => (res.status === "ok" ? res.output : (() => { throw new Error("x"); })()),
    });
    session.setDictionary([{ value: "Kestrel Widgets", kind: "ORG" }]);
    await session.model({ task: "books.classify-expenses", privacy: "anonymize-then-cloud", difficulty: "sop", messages: [{ role: "user", content: `S1 | ${"7".repeat(5000)} | 10.00` }] });
    expect(sent[0]).toContain("characters not sent]");
    expect(sent[0]).not.toContain("7".repeat(MAX_RUN_CHARS + 1));
    expect(session.truncationResult()).toMatchObject({ ruleId: "guardrail.input-truncated", severity: "warn", flags: ["input-truncated"] });
    expect(session.truncationResult()?.message).toMatch(/1 very long value in books\.classify-expenses@1 message 1 shortened/);
  });
});
