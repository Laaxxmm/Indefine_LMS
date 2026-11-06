import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadRouterConfig } from "../config";
import { prismaModelCallRepo, loadModelCalls } from "../db";
import { routerOutputJsonSchema, zodToJsonSchema } from "../json-schema";
import { costInr, estimateTokens, priceFor } from "../pricing";
import { backoffDelay, parseRetryAfter, withRetry } from "../retry";
import type { ModelCallRow } from "../router";

describe("config", () => {
  it("defaults to the current Claude tiers and safe numbers", () => {
    const c = loadRouterConfig({});
    expect(c.models).toMatchObject({ FAST: "claude-haiku-5-5", SMART: "claude-sonnet-5-5", HARD: "claude-opus-5-5", GROK: "grok-4" });
    expect(c).toMatchObject({ minConfidence: 0.75, dailyBudgetInr: 1000, usdInr: 88, anthropicApiKey: "", localBaseUrl: "" });
  });
  it("reads overrides and ignores garbage", () => {
    const c = loadRouterConfig({ MODEL_FAST: " claude-haiku-4-5 ", ROUTER_MIN_CONF: "0.8", USD_INR: "abc", AI_DAILY_BUDGET_INR: "-5", GROK_PRICE_IN_USD_PER_MTOK: "2" });
    expect(c.models.FAST).toBe("claude-haiku-4-5");
    expect(c.minConfidence).toBe(0.8);
    expect(c.usdInr).toBe(88);
    expect(c.dailyBudgetInr).toBe(1000);
    expect(c.grokPriceUsdPerMTok.input).toBe(2);
    expect(loadRouterConfig({ ROUTER_MIN_CONF: "5" }).minConfidence).toBe(0.75);
  });
});

describe("pricing", () => {
  const ctx = { usdInr: 88, grokPriceUsdPerMTok: { input: 3, output: 15 } };
  it("prices Claude tiers, Grok from config, local free", () => {
    expect(costInr("claude", "claude-opus-5-5", 1_000_000, 0, ctx)).toBe(352); // $4 × 88
    expect(costInr("claude", "claude-sonnet-5-5", 0, 1_000_000, ctx)).toBe(880); // $10 × 88
    expect(costInr("grok", "grok-4", 1_000_000, 1_000_000, ctx)).toBe(1584); // ($3+$15) × 88
    expect(costInr("local", "x", 1_000_000, 1_000_000, ctx)).toBe(0);
  });
  it("Haiku 5.5 long-prompt rate and conservative unknown-model price", () => {
    expect(priceFor("claude", "claude-haiku-5-5", 100_001, ctx)).toEqual({ input: 0.5, output: 2.5 });
    expect(priceFor("claude", "claude-haiku-5-5", 10, ctx)).toEqual({ input: 0.1, output: 0.5 });
    expect(priceFor("claude", "claude-unknown", 10, ctx)).toEqual({ input: 5, output: 25 });
  });
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("retry helpers", () => {
  it("backoff doubles, honours a longer Retry-After, caps at max", () => {
    const o = { baseDelayMs: 500, maxDelayMs: 4000 };
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, o))).toEqual([500, 1000, 2000, 4000]);
    expect(backoffDelay(0, o, 3000)).toBe(3000);
    expect(backoffDelay(0, o, 100)).toBe(500);
    expect(backoffDelay(0, o, 60_000)).toBe(4000);
  });
  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("not a date")).toBeUndefined();
    expect(parseRetryAfter("Thu, 05 Nov 2026 13:30:10 GMT", Date.parse("2026-11-05T13:30:00Z"))).toBe(10_000);
  });
  it("stops on a non-retryable error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fatal");
    });
    await expect(withRetry(fn, () => ({ retry: false }), { retries: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} })).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("zodToJsonSchema", () => {
  enum Num {
    A,
    B,
  }
  enum Str {
    X = "x",
  }
  it("converts the shapes agents use", () => {
    const s = z.object({
      name: z.string().describe("Legal name"),
      email: z.string().email(),
      at: z.string().datetime(),
      link: z.string().url(),
      count: z.number().int(),
      amount: z.number(),
      big: z.bigint(),
      ok: z.boolean(),
      nothing: z.null(),
      when: z.date(),
      kind: z.literal("gst"),
      n: z.literal(3),
      state: z.enum(["DRAFT", "DONE"]),
      num: z.nativeEnum(Num),
      str: z.nativeEnum(Str),
      tags: z.array(z.string()),
      pair: z.tuple([z.string(), z.number()]),
      meta: z.record(z.number()),
      either: z.union([z.string(), z.number()]),
      tagged: z.discriminatedUnion("t", [z.object({ t: z.literal("a") }), z.object({ t: z.literal("b") })]),
      maybe: z.string().nullable(),
      opt: z.string().optional(),
      def: z.number().default(1),
      ro: z.string().readonly(),
      caught: z.string().catch("x"),
      eff: z.string().transform((v) => v.trim()),
      brand: z.string().brand<"Pan">(),
      pipe: z.string().pipe(z.string()),
      lazy: z.lazy(() => z.string()),
      anything: z.any(),
    });
    const j = zodToJsonSchema(s) as { properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: boolean };
    expect(j.additionalProperties).toBe(false);
    expect(j.required).not.toContain("opt");
    expect(j.required).toContain("name");
    const p = j.properties;
    expect(p.name).toEqual({ type: "string", description: "Legal name" });
    expect(p.email).toEqual({ type: "string", format: "email" });
    expect(p.at.format).toBe("date-time");
    expect(p.link.format).toBe("uri");
    expect(p.count.type).toBe("integer");
    expect(p.amount.type).toBe("number");
    expect(p.big.type).toBe("integer");
    expect(p.ok.type).toBe("boolean");
    expect(p.nothing.type).toBe("null");
    expect(p.when.format).toBe("date-time");
    expect(p.kind).toEqual({ type: "string", enum: ["gst"] });
    expect(p.n).toEqual({ type: "number", enum: [3] });
    expect(p.state.enum).toEqual(["DRAFT", "DONE"]);
    expect(p.num).toEqual({ type: "number", enum: [0, 1] });
    expect(p.str).toEqual({ type: "string", enum: ["x"] });
    expect(p.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(p.pair.type).toBe("array");
    expect(p.meta).toEqual({ type: "object", additionalProperties: { type: "number" } });
    expect((p.either.anyOf as unknown[]).length).toBe(2);
    expect((p.tagged.anyOf as unknown[]).length).toBe(2);
    expect(p.maybe.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
    expect(p.def.type).toBe("number");
    expect(p.ro.type).toBe("string");
    expect(p.caught.type).toBe("string");
    expect(p.eff.type).toBe("string");
    expect(p.brand.type).toBe("string");
    expect(p.pipe.type).toBe("string");
    expect(p.lazy.type).toBe("string");
    expect(p.anything.anyOf).toBeDefined();
  });
  it("stops at a recursion depth", () => {
    type Tree = { child?: Tree };
    const tree: z.ZodType<Tree> = z.lazy(() => z.object({ child: tree.optional() }));
    expect(JSON.stringify(zodToJsonSchema(tree)).length).toBeGreaterThan(10);
  });
  it("wraps the caller schema as { output, confidence }", () => {
    const w = routerOutputJsonSchema(z.object({ a: z.string() })) as { properties: Record<string, { type?: string }>; required: string[] };
    expect(w.required).toEqual(["output", "confidence"]);
    expect(w.properties.output.type).toBe("object");
    expect(w.properties.confidence.type).toBe("number");
  });
});

describe("db (Prisma repository, injected client)", () => {
  function fakeDb(sum: unknown) {
    return {
      modelCall: {
        create: vi.fn(async () => ({})),
        aggregate: vi.fn(async () => ({ _sum: { costInr: sum } })),
        findMany: vi.fn(async () => [
          { createdAt: new Date("2026-11-05T05:00:00Z"), agent: "gst", provider: "claude", status: "OK", escalated: false, costInr: { toString: () => "1.2345" }, tokensIn: 1, tokensOut: 2 },
        ]),
      },
    };
  }
  it("records rows and sums cost (null sum → 0)", async () => {
    const db = fakeDb(null);
    const repo = prismaModelCallRepo(db as never);
    const row = { runId: "r", costInr: 1 } as ModelCallRow;
    await repo.record(row);
    expect(db.modelCall.create).toHaveBeenCalledWith({ data: row });
    expect(await repo.costInrSince(new Date(0))).toBe(0);
    const db2 = fakeDb("12.5");
    expect(await prismaModelCallRepo(db2 as never).costInrForRun("r")).toBe(12.5);
    expect(db2.modelCall.aggregate).toHaveBeenCalledWith({ _sum: { costInr: true }, where: { runId: "r" } });
  });
  it("loads usage rows with Decimal → number", async () => {
    const db = fakeDb(0);
    const rows = await loadModelCalls(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-06T00:00:00Z"), db as never);
    expect(rows[0].costInr).toBe(1.2345);
    expect(db.modelCall.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { createdAt: { gte: expect.any(Date), lt: expect.any(Date) } } }));
  });
});
