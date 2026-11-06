// Closed outputs (ADR-008 §2–3): abstainable enums, capped notes, the unbounded-string check, the
// grounded-number marker and the schema fingerprint used by the prompt lock.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  INSUFFICIENT_EVIDENCE,
  NOTE_MAX,
  ScopedVerdictSchema,
  abstainable,
  evidence,
  groundedNumber,
  groundedNumberInfo,
  groundedNumberPaths,
  hasAbstainOption,
  note,
  schemaFingerprint,
  shapeFingerprint,
  unboundedStrings,
} from "./schema";

describe("abstainable / note / evidence", () => {
  it("abstainable adds insufficient_evidence once", () => {
    const e = abstainable(z.enum(["blocked", "allowed"]));
    expect(e.options).toEqual(["blocked", "allowed", INSUFFICIENT_EVIDENCE]);
    expect(abstainable(e).options).toEqual(e.options);
    expect(e.safeParse("insufficient_evidence").success).toBe(true);
    expect(e.safeParse("maybe").success).toBe(false);
  });
  it("note() caps at 300 characters, never more", () => {
    expect(note().safeParse("x".repeat(NOTE_MAX)).success).toBe(true);
    expect(note().safeParse("x".repeat(NOTE_MAX + 1)).success).toBe(false);
    expect(note(1000).safeParse("x".repeat(NOTE_MAX + 1)).success).toBe(false);
    expect(note(20).safeParse("x".repeat(21)).success).toBe(false);
  });
  it("the scoped verdict needs evidence unless the model abstains", () => {
    expect(ScopedVerdictSchema.safeParse({ status: "fail", evidence: { quote: "q", location: "l" } }).success).toBe(true);
    expect(ScopedVerdictSchema.safeParse({ status: "fail" }).success).toBe(false);
    expect(ScopedVerdictSchema.safeParse({ status: "pass", evidence: { quote: " ", location: "l" } }).success).toBe(false);
    expect(ScopedVerdictSchema.safeParse({ status: "insufficient_evidence", message: "ask for note 4" }).success).toBe(true);
    expect(ScopedVerdictSchema.safeParse({ status: "insufficient_evidence", message: "x".repeat(301) }).success).toBe(false);
  });
});

describe("unboundedStrings (static closed-output check)", () => {
  it("a closed schema has none: enums, literals, evidence quote/location, capped notes, numbers", () => {
    const closed = z.object({
      items: z.array(z.object({ head: abstainable(z.enum(["a", "b"])), kind: z.literal("x"), amount: groundedNumber(), note: note().optional(), evidence: evidence() })).max(100),
      ok: z.boolean(),
    });
    expect(unboundedStrings(closed)).toEqual([]);
    expect(unboundedStrings(ScopedVerdictSchema)).toEqual([]);
  });
  it("free strings, over-long caps, any / unknown and record keys are reported with their path", () => {
    const open = z.object({
      reason: z.string(),
      rows: z.array(z.object({ text: z.string().max(5000), code: z.string().regex(/^\d+$/) })),
      blob: z.unknown(),
      extra: z.any().optional(),
      byName: z.record(z.number()),
      quote: z.string(), // a quote without a location beside it is not evidence
    });
    expect(unboundedStrings(open)).toEqual([
      "reason: free text without a length cap (use an enum, evidence(), or note() ≤ 300)",
      "rows[].text: text capped at 5000 > 300 characters",
      "rows[].code: free text without a length cap (use an enum, evidence(), or note() ≤ 300)",
      "blob: unconstrained value (unknown)",
      "extra: unconstrained value (any)",
      "byName.{key}: free text without a length cap (use an enum, evidence(), or note() ≤ 300)",
      "quote: free text without a length cap (use an enum, evidence(), or note() ≤ 300)",
    ]);
    expect(unboundedStrings(z.string())).toEqual(["(root): free text without a length cap (use an enum, evidence(), or note() ≤ 300)"]);
  });
  it("walks unions, effects, nullable, tuples and lazy schemas", () => {
    const s = z.object({ u: z.union([z.literal("insufficient_evidence"), z.string().max(8)]), e: z.string().max(5).refine(Boolean), n: z.string().nullable(), t: z.tuple([z.string()]) });
    expect(unboundedStrings(s)).toEqual([
      "n: free text without a length cap (use an enum, evidence(), or note() ≤ 300)",
      "t[0]: free text without a length cap (use an enum, evidence(), or note() ≤ 300)",
    ]);
  });
  it("hasAbstainOption: an abstainable enum or the literal anywhere", () => {
    expect(hasAbstainOption(z.object({ a: abstainable(z.enum(["x"])) }))).toBe(true);
    expect(hasAbstainOption(z.object({ a: z.union([z.string().max(4), z.literal(INSUFFICIENT_EVIDENCE)]) }))).toBe(true);
    expect(hasAbstainOption(z.object({ a: z.enum(["x", "y"]) }))).toBe(false);
  });
});

describe("groundedNumber marker", () => {
  it("survives chaining and wrapping; paths name array items", () => {
    const s = z.object({ lines: z.array(z.object({ paise: groundedNumber({ paise: true }).int().optional(), rupees: groundedNumber(), plain: z.number() })) });
    expect(groundedNumberPaths(s)).toEqual([
      { path: "lines[].paise", paise: true },
      { path: "lines[].rupees", paise: false },
    ]);
    expect(groundedNumberInfo(groundedNumber().int().nullable())).toEqual({ paise: false });
    expect(groundedNumberInfo(z.number())).toBeNull();
    expect(groundedNumber().description).toMatch(/Copy this number exactly/);
  });
});

describe("schemaFingerprint / shapeFingerprint", () => {
  it("changes with a cap, an enum value, a field or the grounded marker", () => {
    const base = z.object({ a: z.string().max(10), b: z.enum(["x", "y"]), n: z.number() });
    const fp = JSON.stringify(schemaFingerprint(base));
    expect(JSON.stringify(schemaFingerprint(z.object({ a: z.string().max(10), b: z.enum(["x", "y"]), n: z.number() })))).toBe(fp);
    expect(JSON.stringify(schemaFingerprint(z.object({ a: z.string().max(11), b: z.enum(["x", "y"]), n: z.number() })))).not.toBe(fp);
    expect(JSON.stringify(schemaFingerprint(z.object({ a: z.string().max(10), b: z.enum(["x", "z"]), n: z.number() })))).not.toBe(fp);
    expect(JSON.stringify(schemaFingerprint(z.object({ a: z.string().max(10), b: z.enum(["x", "y"]), n: groundedNumber() })))).not.toBe(fp);
    expect(JSON.stringify(schemaFingerprint(z.object({ a: z.string().max(10), b: z.enum(["x", "y"]) })))).not.toBe(fp);
  });
  it("shape ignores enum values but not whether an enum can abstain", () => {
    const tpl = z.object({ id: z.enum(["S1"]), head: abstainable(z.enum(["(ledger)"])) });
    expect(shapeFingerprint(z.object({ id: z.enum(["S4", "S9"]), head: abstainable(z.enum(["Rent", "Power"])) }))).toBe(shapeFingerprint(tpl));
    expect(shapeFingerprint(z.object({ id: z.enum(["S4"]), head: z.enum(["Rent"]) }))).not.toBe(shapeFingerprint(tpl));
    expect(shapeFingerprint(z.object({ id: z.string().max(4), head: abstainable(z.enum(["Rent"])) }))).not.toBe(shapeFingerprint(tpl));
  });
});
