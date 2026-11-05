// Security finding #1 (audit PoC 04, "e-live"): task agents sent documents to the cloud with every
// person / company name in clear, because runAgent passed no dictionary and names are masked only
// through one. Now the runner builds a per-run dictionary (client master + staff + names each agent
// harvests from its parsed inputs) and the guardrail session carries it into every model call; a
// cloud call with no dictionary is refused. Providers are spies (no network). Synthetic values only.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadRouterConfig } from "@/lib/ai/config";
import { createRouter, type ModelCallRepo, type ModelRequest } from "@/lib/ai/router";
import type { ModelProvider, ProviderRequest, ProviderResult } from "@/lib/ai/types";
import { narrationNames } from "@/lib/ai/names";
import { classifyPrompt } from "@/lib/agents/books/classify";
import { DictionaryUnavailableError, createGuardrailSession } from "@/lib/agents/core/guardrails/session";
import type { AgentScope } from "@/lib/agents/core/guardrails/scope";
import { DEFAULT_FIXTURES_ROOT, loadApprovedMistakes, loadFixtures, packWithMistakes, runFixtureOnce } from "@/lib/agents/core/accuracy-run";
import { recordingKey } from "@/lib/agents/core/recorded-router";
import { buildRunDictionary, runAgent, type AnyAgent, type JobContext } from "@/lib/agents/core/runner";
import { AGENTS } from "@/lib/agents/registry";
import { echoAgent } from "@/lib/agents/echo";
import { echoWorld } from "../../fakes/agent-world";

const cfg = loadRouterConfig({ AI_DAILY_BUDGET_INR: "0" });
const repo = (): ModelCallRepo => ({ record: async () => {}, costInrSince: async () => 0, costInrForRun: async () => 0 });
function spy(id: "claude" | "grok" | "local", available: boolean, answer: (r: ProviderRequest) => unknown = () => ({ output: "x", confidence: 1 })) {
  const calls: ProviderRequest[] = [];
  const provider: ModelProvider = {
    id,
    isAvailable: async () => available,
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      calls.push(req);
      return { output: answer(req) as T, model: req.model, tokensIn: 1, tokensOut: 1, latencyMs: 1 };
    },
  };
  return { provider, calls };
}

const BOOKS_LINES = [
  { id: "S1", date: "2026-10-03", narration: "NEFT-RAJESH KUMAR SHARMA-HDFC0001234-SAL OCT", ref: "N123", amountPaise: 4500000 },
  { id: "S3", date: "2026-10-05", narration: "IMPS 9876543210 MEERA IYER RENT", ref: "I9", amountPaise: 2500000 },
  { id: "S4", date: "2026-10-06", narration: "CHQ 501009 ACME WIDGETS PVT LTD", ref: "C4", amountPaise: 999900 },
];
const booksScope: AgentScope = {
  department: "Books",
  tasks: [{ name: "books.classify-expenses", version: 1, schema: z.object({ suggestions: z.array(z.string().max(300)) }), systemPrompt: "classify", difficulty: "sop" }],
  ruleIds: [],
  inputSniff: () => ({ ok: true }),
};
const booksAgentLike = { key: "books", title: "Books", service: "Books" as const, defaultChecklist: { schemaVersion: 1 as const, key: "books", version: "1.0.0", rules: [] } };

function booksSession(claude: ReturnType<typeof spy>) {
  const router = createRouter({ providers: { claude: claude.provider, grok: spy("grok", false).provider, local: spy("local", false).provider }, repo: repo(), config: cfg });
  return createGuardrailSession({
    agent: booksAgentLike,
    scope: booksScope,
    route: (req) => router.run({ ...req, runId: "run-1" } as never),
    unwrap: (res) => (res.status === "ok" ? res.output : (() => { throw new Error(res.status); })()),
  });
}

describe("finding #1: the run dictionary reaches every task-agent model call", () => {
  it("PoC 04 e-live: books.classify-expenses through the real router masks the client-master director and every narration name", async () => {
    const prompt = classifyPrompt(BOOKS_LINES as never, ["Salaries", "Rent"], "Reviewer note: Rajesh Kumar Sharma is the director");
    const claude = spy("claude", true, () => ({ output: { suggestions: [] }, confidence: 1 }));
    const session = booksSession(claude);
    // What runAgent builds: client master (director) + the Books agent's narration harvest.
    session.setDictionary([{ value: "Rajesh Kumar Sharma", kind: "NAME" }, ...BOOKS_LINES.flatMap((l) => narrationNames(l.narration))]);
    await session.model({ task: "books.classify-expenses", privacy: "anonymize-then-cloud", difficulty: "sop", messages: [{ role: "user", content: prompt }] });
    const sent = claude.calls[0].messages.map((m) => m.content).join("\n");
    const leaked = ["RAJESH KUMAR SHARMA", "Rajesh Kumar Sharma", "MEERA IYER", "ACME WIDGETS PVT LTD"].filter((s) => sent.includes(s));
    expect(leaked).toEqual([]);
    expect(sent).toMatch(/⟨NAME_\d+⟩/);
  });

  it("a non-internal agent's anonymize-then-cloud call with an empty dictionary is refused before anything is sent", async () => {
    const claude = spy("claude", true, () => ({ output: { suggestions: [] }, confidence: 1 }));
    const session = booksSession(claude);
    await expect(session.model({ task: "books.classify-expenses", privacy: "anonymize-then-cloud", difficulty: "sop", messages: [{ role: "user", content: "S1 | NEFT-X" }] })).rejects.toBeInstanceOf(DictionaryUnavailableError);
    expect(claude.calls).toHaveLength(0);
    expect(() => session.assertNoViolation()).toThrow(/No client or staff names were available/);
  });

  it("a dictionary that could not be built refuses every cloud call and the run FAILS with a plain message (nothing sent)", async () => {
    const w = echoWorld();
    const strict: AnyAgent = {
      ...echoAgent,
      internal: false,
      dictionaryTerms: () => {
        throw new Error("register unreadable");
      },
    };
    const out = await runAgent(strict, "job-1", w.deps);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/list of names to hide from the AI could not be built/);
    expect(w.router.calls).toHaveLength(0);
  });

  it("the runner's dictionary carries the client name, the client master / staff directory and the agent's harvest", async () => {
    const job: JobContext = { jobTaskId: "j", title: "t", service: "Books", fy: "2026-27", period: "2026-10", clientCode: "ACME01", clientName: "Kestrel Widgets Pvt Ltd", assigneeId: null, reviewerId: null };
    const d = await buildRunDictionary({ dictionaryTerms: () => [{ value: "Zorvan Mandravel", kind: "NAME" }] }, {}, [], job, { forJob: async () => [{ value: "Ilsha Ostrakar", kind: "NAME" }] });
    expect(d.problem).toBeNull();
    expect(d.entries.map((e) => e.value).sort()).toEqual(["Ilsha Ostrakar", "Kestrel Widgets Pvt Ltd", "Zorvan Mandravel"]);
    const failing = await buildRunDictionary({}, {}, [], job, { forJob: async () => Promise.reject(new Error("db down")) });
    expect(failing.problem).toMatch(/client-master and staff names/);
  });

  const production = Object.values(AGENTS).filter((a) => a.scope && !a.internal);
  it("every production agent declares a dictionaryTerms hook", () => {
    expect(production.map((a) => a.key).sort()).toEqual(["audit", "books", "gst", "roc", "tax"]);
    for (const a of production) expect(typeof a.dictionaryTerms, a.key).toBe("function");
  });

  it.each(production.map((a) => [a.key, a] as const))("%s: fixture runs through the real router send none of the names harvested from the inputs", async (_key, def) => {
    const pack = packWithMistakes(def, loadApprovedMistakes(DEFAULT_FIXTURES_ROOT, def.key));
    const fixtures = loadFixtures(DEFAULT_FIXTURES_ROOT, def.key).filter((f) => !f.expected.error);
    let checkedNames = 0;
    let checkedCalls = 0;
    const refused: string[] = [];
    for (const fx of fixtures) {
      const payloads: ProviderRequest[] = [];
      const router = {
        async run<T>(req: ModelRequest<T>) {
          const answer = () => {
            const k = recordingKey(req);
            const out = Object.prototype.hasOwnProperty.call(fx.recorded, k) ? fx.recorded[k] : fx.recorded[req.task];
            return { output: structuredClone(out), confidence: 1 };
          };
          const claude = spy("claude", true, answer);
          const r = createRouter({ providers: { claude: claude.provider, grok: spy("grok", false).provider, local: spy("local", false).provider }, repo: repo(), config: cfg });
          try {
            const res = await r.run(req);
            if (res.status === "queued") refused.push(`${def.key}/${fx.id} ${String(req.task)}`);
            return res;
          } finally {
            payloads.push(...claude.calls);
          }
        },
      };
      await runFixtureOnce(def, fx, pack, router);
      const parsed = def.inputSchema.safeParse(fx.inputFiles);
      if (!parsed.success) continue;
      const job: JobContext = { jobTaskId: "fixture-job", title: def.title, service: def.service, fy: fx.expected.job?.fy ?? "2026-27", period: fx.expected.job?.period ?? "2026-10", clientCode: "ACCURACY", clientName: `Fixture ${fx.id}`, assigneeId: null, reviewerId: null };
      const { entries } = await buildRunDictionary(def, parsed.data, fx.inputFiles, job, undefined);
      const sent = payloads.map((p) => p.messages.map((m) => m.content).join("\n")).join("\n").replace(/\s+/g, " ").toLowerCase();
      checkedCalls += payloads.length;
      for (const e of entries) {
        if (e.value.startsWith("Fixture ")) continue;
        checkedNames++;
        expect(sent.includes(e.value.replace(/\s+/g, " ").toLowerCase()), `${def.key}/${fx.id}: "${e.value}" reached the provider`).toBe(false);
      }
    }
    expect(checkedNames + checkedCalls).toBeGreaterThan(0);
    // The post-mask leak gate (finding #3) never refuses a real fixture prompt: no false positives.
    expect(refused).toEqual([]);
  }, 120_000);
});
