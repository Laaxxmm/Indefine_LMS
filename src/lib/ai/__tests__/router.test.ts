import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { detectPii } from "../anonymizer";
import { loadRouterConfig, type RouterConfig } from "../config";
import { BudgetExceededError, NoProviderAvailableError, ProviderError, ProviderOutputError, ProviderUnavailableError } from "../errors";
import { costInr } from "../pricing";
import type { ProviderSet } from "../providers";
import {
  createRouter,
  decideRoute,
  modelCallTask,
  run as defaultRun,
  sha256,
  type ModelCallRepo,
  type ModelCallRow,
  type RouteDecision,
  type RouteInput,
} from "../router";
import type { ModelProvider, ModelRequest, ProviderId, ProviderRequest, ProviderResult } from "../types";
import { gen, rng } from "./synthetic";
import { istDayStart } from "@/lib/ist";

// ---------------------------------------------------------------- fakes

type Step = { output: unknown; confidence?: number; tokensIn?: number; tokensOut?: number } | Error | ((req: ProviderRequest) => ProviderResult);

function fakeProvider(id: ProviderId, available: boolean, steps: Step[] = []) {
  const calls: ProviderRequest[] = [];
  const provider: ModelProvider = {
    id,
    isAvailable: async () => available,
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      calls.push(req);
      const step = steps.shift();
      if (step === undefined) throw new Error(`${id}: no scripted step left`);
      if (step instanceof Error) throw step;
      if (typeof step === "function") return step(req) as ProviderResult<T>;
      const body = "confidence" in step ? { output: step.output, confidence: step.confidence } : step.output;
      return { output: body as T, model: req.model, tokensIn: step.tokensIn ?? 1000, tokensOut: step.tokensOut ?? 500, latencyMs: 42 };
    },
  };
  return { provider, calls };
}

function memRepo(opts: { runSpent?: number; daySpent?: number } = {}) {
  const rows: ModelCallRow[] = [];
  const since: Date[] = [];
  const repo: ModelCallRepo = {
    async record(row) {
      rows.push(row);
    },
    async costInrSince(d) {
      since.push(d);
      return (opts.daySpent ?? 0) + rows.reduce((s, r) => s + r.costInr, 0);
    },
    async costInrForRun(runId) {
      return (opts.runSpent ?? 0) + rows.filter((r) => r.runId === runId).reduce((s, r) => s + r.costInr, 0);
    },
  };
  return { repo, rows, since };
}

const NOW = new Date("2026-11-05T13:30:00.000Z"); // 19:00 IST

function setup(o: {
  claude?: Step[] | false;
  grok?: Step[] | false;
  local?: Step[] | false;
  env?: Record<string, string>;
  repo?: ReturnType<typeof memRepo>;
}) {
  const claude = fakeProvider("claude", o.claude !== false, o.claude || []);
  const grok = fakeProvider("grok", o.grok !== undefined && o.grok !== false, o.grok || []);
  const local = fakeProvider("local", o.local !== undefined && o.local !== false, o.local || []);
  const providers: ProviderSet = { claude: claude.provider, grok: grok.provider, local: local.provider };
  const config: RouterConfig = loadRouterConfig({ AI_DAILY_BUDGET_INR: "500", ...o.env });
  const mem = o.repo ?? memRepo();
  const router = createRouter({ providers, repo: mem.repo, config, now: () => NOW });
  return { router, claude, grok, local, rows: mem.rows, since: mem.since, config };
}

const base = (o: Partial<ModelRequest<unknown>> = {}): ModelRequest<unknown> => ({
  task: "gst.extract-invoices",
  privacy: "anonymize-then-cloud",
  difficulty: "sop",
  runId: "run-1",
  messages: [
    { role: "system", content: "You read GST invoices." },
    { role: "user", content: "Summarise invoice 42." },
  ],
  ...o,
});
const Total = z.object({ total: z.number() });

// ---------------------------------------------------------------- decideRoute (pure, table)

const all = { local: true, claude: true, grok: true };
const noLocal = { local: false, claude: true, grok: true };
type Row = [string, RouteInput, Partial<Extract<RouteDecision, { kind: "call" }>> | { kind: "queue" } | { kind: "unavailable" }];
const table: Row[] = [
  ["sop, anonymize, local down → Claude FAST masked", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 0, available: noLocal }, { kind: "call", provider: "claude", tier: "FAST", anonymize: true, canEscalate: true, needsPartnerReview: false }],
  ["sop, anonymize, local up → local, unmasked", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 0, available: all }, { kind: "call", provider: "local", tier: "LOCAL", anonymize: false, canEscalate: true }],
  ["sop, local up, 1st escalation → Claude FAST", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 1, available: all }, { provider: "claude", tier: "FAST", canEscalate: true }],
  ["sop, local up, 2nd escalation → Claude SMART, last", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 2, available: all }, { provider: "claude", tier: "SMART", canEscalate: false }],
  ["sop, local-only, local down → queue", { difficulty: "sop", privacy: "local-only", escalationLevel: 0, available: noLocal }, { kind: "queue" }],
  ["sop, local-only, local up → local, no escalation", { difficulty: "sop", privacy: "local-only", escalationLevel: 0, available: all }, { provider: "local", tier: "LOCAL", anonymize: false, canEscalate: false }],
  ["novel, local-only, local down → queue (never cloud)", { difficulty: "novel", privacy: "local-only", escalationLevel: 0, available: noLocal }, { kind: "queue" }],
  ["sop, escalation 1 → SMART", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 1, available: noLocal }, { tier: "SMART", canEscalate: true }],
  ["sop, escalation 2 → HARD, last", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 2, available: noLocal }, { tier: "HARD", canEscalate: false }],
  ["sop, escalation 5 → capped at HARD", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 5, available: noLocal }, { tier: "HARD", canEscalate: false }],
  ["judgement → SMART", { difficulty: "judgement", privacy: "anonymize-then-cloud", escalationLevel: 0, available: all }, { provider: "claude", tier: "SMART", canEscalate: true }],
  ["judgement escalation 1 → HARD, last", { difficulty: "judgement", privacy: "anonymize-then-cloud", escalationLevel: 1, available: all }, { tier: "HARD", canEscalate: false }],
  ["novel → HARD, masked, partner review", { difficulty: "novel", privacy: "anonymize-then-cloud", escalationLevel: 0, available: all }, { provider: "claude", tier: "HARD", anonymize: true, needsPartnerReview: true, canEscalate: false }],
  ["novel + public → HARD unmasked", { difficulty: "novel", privacy: "public", escalationLevel: 0, available: all }, { tier: "HARD", anonymize: false, needsPartnerReview: true }],
  ["public sop → FAST, may skip masking", { difficulty: "sop", privacy: "public", escalationLevel: 0, available: noLocal }, { tier: "FAST", anonymize: false }],
  ["Claude down, Grok configured → Grok", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 0, available: { local: false, claude: false, grok: true } }, { provider: "grok", tier: "FAST", anonymize: true }],
  ["novel, Claude down → Grok HARD", { difficulty: "novel", privacy: "anonymize-then-cloud", escalationLevel: 0, available: { local: false, claude: false, grok: true } }, { provider: "grok", tier: "HARD", needsPartnerReview: true }],
  ["Claude down, no Grok key → unavailable", { difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 0, available: { local: false, claude: false, grok: false } }, { kind: "unavailable" }],
];

describe("decideRoute (pure routing policy)", () => {
  it.each(table)("%s", (_name, input, expected) => {
    expect(decideRoute(input)).toMatchObject(expected);
  });
});

// ---------------------------------------------------------------- run()

describe("run(): spec Phase 2 task 4 cases", () => {
  it("sop + local unavailable + anonymize → Claude FAST, anonymized=true, logged with masked hash and ₹ cost", async () => {
    const t = setup({ claude: [{ output: { total: 1200 }, confidence: 0.9 }] });
    const res = await t.router.run(base({ schema: Total }));
    expect(res).toMatchObject({ status: "ok", provider: "claude", model: "claude-haiku-5-5", anonymized: true, escalated: false, output: { total: 1200 }, confidence: 0.9, needsPartnerReview: false });
    expect(t.claude.calls[0].model).toBe("claude-haiku-5-5");
    expect(t.claude.calls[0].system).toContain("You read GST invoices.");
    expect(t.claude.calls[0].system).toContain("⟨PAN_1⟩"); // router instructions explain placeholders
    expect(t.rows).toHaveLength(1);
    const expectedCost = costInr("claude", "claude-haiku-5-5", 1000, 500, { usdInr: 88, grokPriceUsdPerMTok: { input: 3, output: 15 } });
    expect(expectedCost).toBeCloseTo(0.0308, 4);
    expect(t.rows[0]).toMatchObject({ status: "OK", provider: "claude", tier: "FAST", anonymized: true, agent: "gst", task: "gst.extract-invoices", costInr: expectedCost, tokensIn: 1000, tokensOut: 500, latencyMs: 42 });
    expect(t.rows[0].promptHash).toMatch(/^[0-9a-f]{64}$/);
    if (res.status === "ok") expect(res.costInr).toBe(expectedCost);
  });

  it("sop + local-only + local unavailable → QUEUED_FOR_HUMAN with zero cloud calls", async () => {
    const t = setup({ claude: [{ output: "x", confidence: 1 }], grok: [{ output: "x", confidence: 1 }] });
    const res = await t.router.run(base({ privacy: "local-only" }));
    expect(res).toMatchObject({ status: "queued", needsPartnerReview: true, attempts: 0 });
    expect(t.claude.calls).toHaveLength(0);
    expect(t.grok.calls).toHaveLength(0);
    expect(t.rows.map((r) => r.status)).toEqual(["QUEUED_FOR_HUMAN"]);
    expect(t.rows[0].provider).toBeNull();
  });

  it("schema fail → FAST→SMART; again → HARD; third → needsPartnerReview and stop (each attempt logged)", async () => {
    const bad = { output: { total: "twelve hundred" }, confidence: 0.95 };
    const t = setup({ claude: [bad, bad, bad, { output: { total: 1 }, confidence: 1 }] });
    const res = await t.router.run(base({ schema: Total }));
    expect(res.status).toBe("needs-review");
    expect(res.needsPartnerReview).toBe(true);
    if (res.status === "needs-review") {
      expect(res.output).toBeNull();
      expect(res.issues.join(" ")).toMatch(/total/);
      expect(res.attempts).toBe(3);
      expect(res.escalated).toBe(true);
      expect(res.costInr).toBeGreaterThan(0);
    }
    expect(t.claude.calls.map((c) => c.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(t.rows.map((r) => [r.status, r.tier, r.escalationLevel, r.escalated])).toEqual([
      ["SCHEMA_FAIL", "FAST", 0, false],
      ["SCHEMA_FAIL", "SMART", 1, true],
      ["SCHEMA_FAIL", "HARD", 2, true],
    ]);
    // escalated attempts carry masked feedback about the failure
    expect(t.claude.calls[1].messages.at(-1)?.content).toMatch(/rejected/);
  });

  it("schema fail once then success at SMART → ok, escalated, totals summed", async () => {
    const t = setup({ claude: [{ output: { total: "x" }, confidence: 0.9 }, { output: { total: 7 }, confidence: 0.9 }] });
    const res = await t.router.run(base({ schema: Total }));
    expect(res).toMatchObject({ status: "ok", output: { total: 7 }, escalated: true, model: "claude-sonnet-5-5", tokensIn: 2000, tokensOut: 1000, attempts: 2 });
  });

  it("confidence below ROUTER_MIN_CONF escalates (LOW_CONFIDENCE); last low-confidence output is returned for review", async () => {
    const low = { output: { total: 5 }, confidence: 0.5 };
    const t = setup({ claude: [low, low, low] });
    const res = await t.router.run(base({ schema: Total }));
    expect(res).toMatchObject({ status: "needs-review", output: { total: 5 }, needsPartnerReview: true });
    expect(t.rows.map((r) => r.status)).toEqual(["LOW_CONFIDENCE", "LOW_CONFIDENCE", "LOW_CONFIDENCE"]);
  });

  it("ROUTER_MIN_CONF is configurable", async () => {
    const t = setup({ claude: [{ output: { total: 5 }, confidence: 0.5 }], env: { ROUTER_MIN_CONF: "0.4" } });
    expect((await t.router.run(base({ schema: Total }))).status).toBe("ok");
  });

  it("checklist contradictions escalate like a schema failure", async () => {
    const t = setup({ claude: [{ output: { total: 5 }, confidence: 0.99 }, { output: { total: 6 }, confidence: 0.99 }] });
    const contradictions = vi.fn((o: { total: number }) => (o.total === 5 ? ["total does not match line items"] : []));
    const res = await t.router.run({ ...base(), schema: Total, contradictions });
    expect(res).toMatchObject({ status: "ok", output: { total: 6 }, escalated: true });
    expect(t.rows[0]).toMatchObject({ status: "LOW_CONFIDENCE" });
    expect(t.rows[0].error).toMatch(/contradiction: total does not match/);
  });

  it("novel → HARD tier, anonymized, needsPartnerReview", async () => {
    const t = setup({ claude: [{ output: { total: 3 }, confidence: 0.9 }] });
    const res = await t.router.run(base({ difficulty: "novel", schema: Total }));
    expect(res).toMatchObject({ status: "ok", model: "claude-opus-5-5", anonymized: true, needsPartnerReview: true });
    expect(t.rows[0].tier).toBe("HARD");
  });

  it("novel that fails validation stops at once (already at the top tier)", async () => {
    const t = setup({ claude: [{ output: { total: "?" }, confidence: 0.9 }] });
    const res = await t.router.run(base({ difficulty: "novel", schema: Total }));
    expect(res.status).toBe("needs-review");
    expect(t.claude.calls).toHaveLength(1);
  });

  it("Claude 5xx → Grok failover when XAI key is configured", async () => {
    const t = setup({
      claude: [new ProviderError("claude", "outage", "Claude unavailable (529)", 529)],
      grok: [{ output: { total: 9 }, confidence: 0.9 }],
    });
    const res = await t.router.run(base({ schema: Total }));
    expect(res).toMatchObject({ status: "ok", provider: "grok", model: "grok-4", anonymized: true, output: { total: 9 } });
    expect(t.rows.map((r) => [r.provider, r.status])).toEqual([
      ["claude", "PROVIDER_ERROR"],
      ["grok", "OK"],
    ]);
    expect(t.grok.calls[0].messages).toEqual(t.claude.calls[0].messages); // same masked payload
  });

  it("Claude 5xx and no Grok key → the error is surfaced, no silent success", async () => {
    const outage = new ProviderError("claude", "outage", "Claude unavailable (503)", 503);
    const t = setup({ claude: [outage] });
    await expect(t.router.run(base({ schema: Total }))).rejects.toBe(outage);
    expect(t.rows.map((r) => r.status)).toEqual(["PROVIDER_ERROR", "PROVIDER_ERROR"]);
  });

  it("rate limit after retries also fails over", async () => {
    const t = setup({ claude: [new ProviderError("claude", "rate_limit", "429", 429)], grok: [{ output: "ok", confidence: 0.9 }] });
    expect(await t.router.run(base())).toMatchObject({ status: "ok", provider: "grok", output: "ok" });
  });

  it("auth / bad-request / refusal errors are surfaced, never failed over", async () => {
    for (const kind of ["auth", "bad_request", "refusal"] as const) {
      const err = new ProviderError("claude", kind, kind);
      const t = setup({ claude: [err], grok: [{ output: "x", confidence: 1 }] });
      await expect(t.router.run(base())).rejects.toBe(err);
      expect(t.grok.calls).toHaveLength(0);
    }
  });

  it("no cloud provider at all → NoProviderAvailableError", async () => {
    const t = setup({ claude: false });
    await expect(t.router.run(base())).rejects.toBeInstanceOf(NoProviderAvailableError);
    expect(t.rows[0].status).toBe("PROVIDER_ERROR");
  });

  it("per-run budget exceeded → BudgetExceededError, logged BUDGET_REFUSED, zero provider calls", async () => {
    const t = setup({ claude: [{ output: "x", confidence: 1 }], repo: memRepo({ runSpent: 5 }) });
    const err = await t.router.run(base({ maxCostInr: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.scope).toBe("run");
    expect(err.message).toMatch(/budget for this run is exhausted: ₹5\.00 spent of ₹5\.00/);
    expect(t.claude.calls).toHaveLength(0);
    expect(t.rows.map((r) => r.status)).toEqual(["BUDGET_REFUSED"]);
  });

  it("per-run budget stops escalation mid-run once spent", async () => {
    const bad = { output: { total: "x" }, confidence: 0.9, tokensIn: 100_000, tokensOut: 50_000 };
    const t = setup({ claude: [bad, bad, bad] });
    const err = await t.router.run(base({ schema: Total, maxCostInr: 3 })).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(t.rows.map((r) => r.status)).toEqual(["SCHEMA_FAIL", "BUDGET_REFUSED"]);
  });

  it("daily budget (IST day) exceeded → BudgetExceededError", async () => {
    const t = setup({ claude: [{ output: "x", confidence: 1 }], repo: memRepo({ daySpent: 500 }) });
    const err = await t.router.run(base()).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.scope).toBe("day");
    expect(err.message).toMatch(/AI_DAILY_BUDGET_INR/);
    expect(t.since[0].toISOString()).toBe(istDayStart(NOW).toISOString());
    expect(t.since[0].toISOString()).toBe("2026-11-04T18:30:00.000Z");
  });

  it("AI_DAILY_BUDGET_INR=0 disables the daily cap", async () => {
    const t = setup({ claude: [{ output: "x", confidence: 1 }], repo: memRepo({ daySpent: 10_000 }), env: { AI_DAILY_BUDGET_INR: "0" } });
    expect((await t.router.run(base())).status).toBe("ok");
    expect(t.since).toHaveLength(0);
  });
});

describe("run(): DPDP leak test — spy on every provider payload", () => {
  const r = rng(424242);
  const secrets = {
    pan: gen.pan(r),
    gstin: gen.gstin(r),
    aadhaar: gen.aadhaarFormatted(r),
    phone: gen.phone(r),
    email: gen.email(r),
    account: gen.account(r),
    tan: gen.tan(r),
  };
  const messages: ModelRequest<unknown>["messages"] = [
    { role: "system", content: `Client Zorvan Mandravel, PAN ${secrets.pan}, GSTIN ${secrets.gstin}.` },
    { role: "user", content: `Aadhaar ${secrets.aadhaar}; phone ${secrets.phone}; mail ${secrets.email}; bank A/c ${secrets.account}; TAN ${secrets.tan}. Return the PAN.` },
  ];
  const Pan = z.object({ pan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/), holder: z.string() });

  it.each(["claude", "grok"] as const)("%s receives no PAN / GSTIN / Aadhaar / phone / e-mail; output is unmasked back", async (via) => {
    // The fake model answers with the placeholders it was given — like a real model would.
    const echo = (req: ProviderRequest): ProviderResult => {
      const text = `${req.system} ${req.messages.map((m) => m.content).join(" ")}`;
      const pan = text.match(/⟨PAN_\d+⟩/)?.[0] ?? "missing";
      const name = text.match(/⟨NAME_\d+⟩/)?.[0] ?? "missing";
      return { output: { output: { pan, holder: name }, confidence: 0.9 }, model: req.model, tokensIn: 10, tokensOut: 10, latencyMs: 1 };
    };
    const t =
      via === "claude"
        ? setup({ claude: [echo] })
        : setup({ claude: [new ProviderError("claude", "outage", "down", 500)], grok: [echo] });
    const res = await t.router.run({
      ...base({ messages }),
      schema: Pan,
      dictionary: [{ value: "Zorvan Mandravel", kind: "NAME" }],
    });
    const payloads = [...t.claude.calls, ...t.grok.calls].map((c) => JSON.stringify(c));
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      expect(detectPii(p)).toEqual([]);
      for (const v of Object.values(secrets)) expect(p).not.toContain(v);
      expect(p).not.toContain("Zorvan Mandravel");
    }
    expect(res).toMatchObject({ status: "ok", output: { pan: secrets.pan, holder: "Zorvan Mandravel" }, anonymized: true });
    // ModelCall rows never carry raw prompt text or PII
    const logged = JSON.stringify(t.rows);
    for (const v of Object.values(secrets)) expect(logged).not.toContain(v);
  });

  it("privacy 'public' skips masking on the wire, but the logged hash is still of the masked prompt", async () => {
    const t = setup({ claude: [{ output: "ok", confidence: 0.9 }] });
    await t.router.run(base({ privacy: "public", messages: [{ role: "user", content: `PAN ${secrets.pan}` }] }));
    expect(t.claude.calls[0].messages[0].content).toBe(`PAN ${secrets.pan}`);
    expect(t.rows[0].anonymized).toBe(false);
    expect(t.rows[0].promptHash).toBe(sha256(JSON.stringify([{ role: "user", content: "PAN ⟨PAN_1⟩" }])));
  });
});

describe("run(): local stub and edge cases", () => {
  it("local advertised but stub throws ProviderUnavailableError → falls back to Claude FAST, anonymized", async () => {
    const t = setup({ local: [new ProviderUnavailableError("local", "not wired")], claude: [{ output: "ok", confidence: 0.9 }] });
    const res = await t.router.run(base());
    expect(res).toMatchObject({ status: "ok", provider: "claude", model: "claude-haiku-5-5", anonymized: true, escalated: false });
    expect(t.rows.map((r) => [r.provider, r.status])).toEqual([
      ["local", "PROVIDER_ERROR"],
      ["claude", "OK"],
    ]);
  });

  it("local-only + local stub throws → queued, never cloud", async () => {
    const t = setup({ local: [new ProviderUnavailableError("local", "not wired")], claude: [{ output: "x", confidence: 1 }] });
    expect((await t.router.run(base({ privacy: "local-only" }))).status).toBe("queued");
    expect(t.claude.calls).toHaveLength(0);
  });

  it("local-only + working local → served locally, unmasked, no escalation on failure", async () => {
    const t = setup({ local: [{ output: { total: "bad" }, confidence: 0.9 }] });
    const res = await t.router.run(base({ privacy: "local-only", schema: Total }));
    expect(res).toMatchObject({ status: "needs-review", provider: "local", anonymized: false });
    expect(t.rows[0]).toMatchObject({ tier: "LOCAL", model: "local-open-weight", costInr: 0 });
  });

  it("unparseable model output (ProviderOutputError) counts as a schema failure and escalates", async () => {
    const t = setup({ claude: [new ProviderOutputError("claude", "Claude did not return valid JSON.", 50, 5), { output: "fine", confidence: 0.9 }] });
    const res = await t.router.run(base());
    expect(res).toMatchObject({ status: "ok", output: "fine", escalated: true });
    expect(t.rows[0]).toMatchObject({ status: "SCHEMA_FAIL", tokensIn: 50, tokensOut: 5 });
  });

  it("non-object response, wrong output type and out-of-range confidence are rejected", async () => {
    const t = setup({
      claude: [{ output: "not-an-object" }, { output: 123, confidence: 0.9 }, { output: "text", confidence: 7 }],
    });
    const res = await t.router.run(base());
    expect(res.status).toBe("needs-review");
    expect(t.rows.map((r) => r.status)).toEqual(["SCHEMA_FAIL", "SCHEMA_FAIL", "LOW_CONFIDENCE"]);
    if (res.status === "needs-review") expect(res.issues.join(" ")).toMatch(/confidence/);
  });

  it("free-text requests (no schema) return the string", async () => {
    const t = setup({ claude: [{ output: "Dear client, ...", confidence: 0.8 }] });
    const res = await t.router.run(base({ task: "comms.draft" }));
    expect(res).toMatchObject({ status: "ok", output: "Dear client, ..." });
    expect(t.claude.calls[0].jsonSchema).toMatchObject({ properties: { output: { type: "string" } } });
  });
});

vi.mock("../db", () => ({
  prismaModelCallRepo: () => ({ record: async () => {}, costInrSince: async () => 0, costInrForRun: async () => 0 }),
}));

describe("default run() wiring", () => {
  it("builds providers from env and fails closed when nothing is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("LOCAL_LLM_BASE_URL", "");
    try {
      await expect(defaultRun(base())).rejects.toBeInstanceOf(NoProviderAvailableError);
      const queued = await defaultRun(base({ privacy: "local-only" }));
      expect(queued.status).toBe("queued");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---------------------------------------------------------------- ADR-008 extensions

describe("ADR-008: forceTier, task@version, agreement re-ask", () => {
  it("decideRoute: a forced tier is used as is, with no escalation; local-only ignores it", () => {
    expect(decideRoute({ difficulty: "judgement", privacy: "anonymize-then-cloud", escalationLevel: 0, available: all, forceTier: "HARD" })).toMatchObject({ kind: "call", provider: "claude", tier: "HARD", canEscalate: false });
    expect(decideRoute({ difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 0, available: all, forceTier: "SMART" })).toMatchObject({ tier: "SMART", canEscalate: false });
    expect(decideRoute({ difficulty: "sop", privacy: "local-only", escalationLevel: 0, available: noLocal, forceTier: "HARD" })).toEqual(expect.objectContaining({ kind: "queue" }));
    expect(decideRoute({ difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 0, available: { local: false, claude: false, grok: true }, forceTier: "HARD" })).toMatchObject({ provider: "grok", tier: "HARD" });
  });

  it("run: ModelCall.task records task@version and #2; a forced tier does not escalate on a schema failure", async () => {
    const s = setup({ claude: [{ output: { total: 1 }, confidence: 0.9 }, { output: { wrong: true }, confidence: 0.9 }] });
    const ok = await s.router.run({ ...base({ schema: Total }), taskVersion: 3 });
    expect(ok.status).toBe("ok");
    const bad = await s.router.run({ ...base({ schema: Total }), taskVersion: 3, secondOpinion: true, forceTier: "HARD" });
    expect(bad).toMatchObject({ status: "needs-review", output: null, attempts: 1 });
    expect(s.rows.map((r) => [r.task, r.tier, r.status])).toEqual([
      ["gst.extract-invoices@3", "FAST", "OK"],
      ["gst.extract-invoices@3#2", "HARD", "SCHEMA_FAIL"],
    ]);
    expect(s.claude.calls.map((c) => c.model)).toEqual([s.config.models.FAST, s.config.models.HARD]);
  });

  it("modelCallTask", () => {
    expect(modelCallTask({ task: "gst.x" })).toBe("gst.x");
    expect(modelCallTask({ task: "gst.x", taskVersion: 2 })).toBe("gst.x@2");
    expect(modelCallTask({ task: "gst.x", taskVersion: 2, secondOpinion: true })).toBe("gst.x@2#2");
  });
});
