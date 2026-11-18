// ADR-009 controls that are proved by scanning the repository or by canaries, not by a single
// unit: OWASP LLM02 / LLM07 (no secret or environment value can enter a prompt; every production
// task declares its privacy class; no `public` privacy in Firm OS code), LLM03 (the SDK version a
// run records is the one installed), LLM05 (model output is only ever text: no HTML sinks, no
// model text in URLs or paths, no raw SQL or shell, a model-supplied link is never kept) and
// LLM06 (the model has no tools; its only output is data that code validates).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import { decideRoute, type ModelRequest } from "@/lib/ai/router";
import { createClaudeProvider } from "@/lib/ai/providers/claude";
import { createGrokProvider } from "@/lib/ai/providers/grok";
import type { ProviderRequest } from "@/lib/ai/types";
import { extractSpec } from "@/lib/agents/onboarding/extract";
import { AGENTS } from "@/lib/agents/registry";
import { isFirmOs } from "../../../../../scripts/lib/guards";
import { echoWorld, rows } from "../../../../../tests/fakes/agent-world";
import { DEFAULT_FIXTURES_ROOT, loadApprovedMistakes, loadFixtures, packWithMistakes, runFixtureOnce } from "../accuracy-run";
import { createRecordedRouter } from "../recorded-router";
import { runAgent } from "../runner";
import { echoAgent, ECHO_RELATED_PARTY_TASK } from "@/lib/agents/echo";
import { composeSystemPrompt, taskLabel, type ScopedAgentLike } from "./scope";
import { draftMessage, type DraftRequest } from "@/lib/agents/comms/compose";
import { COMMS_PROMPT_OWNERS } from "@/lib/agents/comms/tasks";
import { SAMPLES } from "../../../../../tests/fakes/comms-fixtures";
import { scriptedRouter } from "../../../../../tests/fakes/comms-router";
import { MODEL_SUPPLY_CHAIN } from "./supply-chain";

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const cache = new Map<string, string>();
const read = (p: string) => {
  let text = cache.get(p);
  if (text === undefined) cache.set(p, (text = readFileSync(join(ROOT, p), "utf8")));
  return text;
};
/** Scans read every file under src once; give them room on a busy CI box. */
const SCAN_TIMEOUT = 60_000;

/** Repo-relative code files under `dir` (tests excluded unless asked). */
function codeFiles(dir: string, opts: { tests?: boolean } = {}): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(ROOT, rel))) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = `${rel}/${name}`;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && (opts.tests || !/\.test\.tsx?$/.test(name))) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** Lines of a file with `//` comments and block-comment lines taken out (scans read code, not prose). */
const codeLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ""))
    .filter((l) => !/^\s*(\*|\/\*)/.test(l));

const hits = (files: string[], re: RegExp) => files.flatMap((f) => codeLines(read(f)).flatMap((l, i) => (re.test(l) ? [`${f}:${i + 1}: ${l.trim()}`] : [])));

const scoped = Object.values(AGENTS).filter((a) => a.scope);
const production = scoped.filter((a) => !a.internal);
const allTasks = scoped.flatMap((a) => a.scope!.tasks.map((t) => ({ agent: a as ScopedAgentLike, task: t })));
/** The comms drafter's tasks (one scoped owner per department, locked like the agents'). */
const commsOwners = Object.values(COMMS_PROMPT_OWNERS);
const commsTasks = commsOwners.flatMap((a) => a.scope!.tasks.map((t) => ({ agent: a, task: t })));

// ------------------------------------------------------------------ LLM05

describe("LLM05 improper output handling: model text is only ever rendered as text", () => {
  const src = codeFiles("src");
  it("no HTML / code sinks anywhere in src (React escapes everything else)", () => {
    expect(hits(src, /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/)).toEqual([]);
  }, SCAN_TIMEOUT);
  it("no unsafe raw SQL and no shell in src", () => {
    expect(hits(src, /\$queryRawUnsafe|\$executeRawUnsafe/)).toEqual([]);
    expect(hits(src, /from\s+["'](?:node:)?child_process["']|require\(\s*["'](?:node:)?child_process["']\s*\)/)).toEqual([]);
  }, SCAN_TIMEOUT);
  it("no model-output field (quote, message, note, reason, question, excerpt, evidence) inside a URL, redirect or path builder in Firm OS code", () => {
    const firmOs = src.filter((p) => isFirmOs(p));
    expect(firmOs.length).toBeGreaterThan(100);
    // node:path builders only (`(?<![\w.])path.` — a Zod issue's `i.path.join(".")` is not a file path).
    const sink = /href=\{|src=\{|action=\{|redirect\(|router\.(?:push|replace)\(|encodeURIComponent\(|new URL\(|deliverablePath\(|jobFolder\(|putNew\(|fileBase:|(?<![\w.])path\.(?:join|resolve)\(/;
    const modelField = /\.(?:quote|message|note|reason|question|excerpt|evidence)\b/;
    const bad = firmOs.flatMap((f) => codeLines(read(f)).flatMap((l, i) => (sink.test(l) && modelField.test(l) ? [`${f}:${i + 1}: ${l.trim()}`] : [])));
    expect(bad).toEqual([]);
  }, SCAN_TIMEOUT);
  it("model output carrying paths, URLs and HTML changes no deliverable name or folder, and keeps no link", async () => {
    const hostile = { status: "pass", message: '<img src=x onerror=alert(1)> ../../Final/evil https://evil.test/x', evidence: { quote: "Acme Traders", location: "register.csv row 2", link: "javascript:alert(1)" } };
    const w = echoWorld({ responses: { [ECHO_RELATED_PARTY_TASK]: hostile } });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok && out.deliverables.map((d) => d.name)).toEqual(["ACME01_Echo-register_2026-10_v1.xlsx"]);
    expect(rows(w.db, "deliverable").map((d) => d.spPath)).toEqual(["/sites/CL-ACME01/Compliance/FY2026-27/Books/2026-10/Working"]);
    const r = rows(w.db, "checklistResult").find((x) => x.ruleId === "echo.related-party")!;
    expect(r.evidence).toEqual({ quote: "Acme Traders", location: "register.csv row 2" }); // the schema and the engine both drop `link`
    expect(w.fake.violations).toEqual([]);
  });
});

// ------------------------------------------------------------------ LLM06

describe("LLM06 excessive agency: the model has no tools, only data that code validates", () => {
  const req: ProviderRequest = { model: "m", system: "s", messages: [{ role: "user", content: "u" }], jsonSchema: { type: "object", properties: {}, additionalProperties: false }, maxTokens: 10 };
  it("ProviderRequest has no field for tools", () => {
    expectTypeOf<keyof ProviderRequest>().toEqualTypeOf<"model" | "system" | "messages" | "jsonSchema" | "maxTokens">();
  });
  it("the Claude provider sends exactly model, max_tokens, messages, system and output_config", async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          seen.push(params);
          return { content: [{ type: "text", text: '{"output":{},"confidence":1}' }], model: "m", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    };
    await createClaudeProvider({ client: client as never }).complete(req);
    expect(Object.keys(seen[0]).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
  });
  it("the Grok provider sends no tool or function fields", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFake = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ model: "g", choices: [{ message: { content: '{"output":{},"confidence":1}' }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    await createGrokProvider({ apiKey: "k", fetch: fetchFake }).complete(req);
    expect(Object.keys(bodies[0]).sort()).toEqual(["max_tokens", "messages", "model", "response_format", "temperature"]);
  });
  it("no provider names tools, tool_choice, function calling or functions in code", () => {
    expect(hits(codeFiles("src/lib/ai/providers"), /\btools\b|tool_choice|tool_use|function_call|\bfunctions\b|parallel_tool_calls/)).toEqual([]);
  });
});

// ------------------------------------------------------------------ LLM02 / LLM07

const CANARY_ENV = [
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "GEMINI_API_KEY",
  "AUTH_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "MS_CLIENT_SECRET",
  "DATABASE_URL",
  "GRAPH_TOKEN_KEY",
  "CRON_SECRET",
  "NEO_TURIA_RELAY_TOKEN",
  "NEO_TURIA_COOKIE_KEY",
  "STATUTORY_RELAY_TOKEN",
  "SP_PNP_CERT_KEY_PEM",
  "SP_PNP_CERT_KEY_PASSPHRASE",
  "SECRET_BOX_KEY",
  "LOCAL_LLM_BASE_URL",
];
const canary = (name: string) => `CANARY-${name}-7f3a9c`;

describe("LLM02 / LLM07: no secret or environment value can enter a prompt", () => {
  beforeAll(() => {
    for (const n of CANARY_ENV) vi.stubEnv(n, canary(n));
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("prompt builders never read the environment, the secret box, the database or the router config", () => {
    const builders = [
      "src/lib/agents/core/guardrails/scope.ts",
      "src/lib/agents/core/guardrails/untrusted.ts",
      "src/lib/agents/core/guardrails/schema.ts",
      "src/lib/agents/core/guardrails/shared.ts",
      "src/lib/agents/onboarding/extract.ts",
      "src/lib/agents/gst/tasks.ts",
      "src/lib/agents/gst/classify.ts",
      "src/lib/agents/gst/index.ts",
      "src/lib/agents/roc/model-tasks.ts",
      "src/lib/agents/roc/index.ts",
      "src/lib/agents/tax/model-tasks.ts",
      "src/lib/agents/tax/index.ts",
      "src/lib/agents/books/classify.ts",
      "src/lib/agents/books/tasks.ts",
      "src/lib/agents/audit/tasks.ts",
      "src/lib/agents/audit/rules.ts",
      "src/lib/agents/echo/index.ts",
      "src/lib/agents/comms/tasks.ts",
      "src/lib/agents/comms/drafting.ts",
    ];
    expect(hits(builders, /process\.env|secret-box|@\/lib\/prisma|@\/lib\/ai\/config|@\/lib\/env\b/)).toEqual([]);
  });

  it("every composed system prompt and every message of every agent's fixture runs is free of canaries", async () => {
    const leaks: string[] = [];
    const look = (where: string, text: string) => {
      for (const n of CANARY_ENV) if (text.includes(canary(n))) leaks.push(`${where}: ${n}`);
    };
    for (const { agent, task } of [...allTasks, ...commsTasks]) look(taskLabel(task), composeSystemPrompt(agent.scope!.department, task));
    for (const def of scoped) {
      const pack = packWithMistakes(def, loadApprovedMistakes(DEFAULT_FIXTURES_ROOT, def.key));
      for (const fx of loadFixtures(DEFAULT_FIXTURES_ROOT, def.key).filter((f) => !f.expected.error).slice(0, 3)) {
        const router = createRecordedRouter(fx.recorded);
        await runFixtureOnce(def, fx, pack, router);
        for (const c of router.calls) look(`${def.key}/${fx.id} ${String(c.task)}`, JSON.stringify(c.messages));
      }
    }
    const calls: ModelRequest<unknown>[] = [];
    await extractSpec("Onboard Acme Widgets Pvt Ltd, GST monthly, assign Priya", {
      router: { run: async <T,>(r: ModelRequest<T>) => (calls.push(r as ModelRequest<unknown>), { status: "queued" as const, reason: "x", needsPartnerReview: true as const, runId: "r", attempts: 0 as const }) },
      runId: "r",
    });
    look("onboarding.extract-spec", JSON.stringify(calls.map((c) => c.messages)));
    expect(calls).toHaveLength(1);
    // The comms drafter: polish and translate calls of a doc-chase draft in Kannada.
    const comms = scriptedRouter([(_r: unknown, i: Record<string, unknown>) => ({ status: "polished", subject: i.subject, paragraphs: i.paragraphs }), { status: "insufficient_evidence", language: "kn", segments: ["x"] }]);
    await draftMessage({ ...SAMPLES["doc-chase"], department: "GST", language: "kn", clientRequestedIds: false } as DraftRequest, { router: comms.router, runId: "comms:canary", maxCostInr: 10 });
    expect(comms.calls).toHaveLength(2);
    look("comms drafts", JSON.stringify(comms.calls.map((c) => [c.system, c.messages])));
    expect(leaks).toEqual([]);
  }, 120_000);

  it("every production task declares privacy anonymize-then-cloud (or local-only), so the anonymiser runs on every cloud call", () => {
    const tasks = [...production, ...commsOwners].flatMap((a) => a.scope!.tasks.map((t) => [taskLabel(t), t.privacy ?? "(not declared)"]));
    expect(tasks.length).toBeGreaterThanOrEqual(9 + 14);
    for (const [label, privacy] of tasks) expect([label, privacy]).toEqual([label, expect.stringMatching(/^(anonymize-then-cloud|local-only)$/)]);
    for (const p of ["claude", "grok"] as const) {
      const d = decideRoute({ difficulty: "sop", privacy: "anonymize-then-cloud", escalationLevel: 0, available: { claude: p === "claude", grok: p === "grok", local: false } });
      expect(d).toMatchObject({ kind: "call", provider: p, anonymize: true });
    }
  });

  it('no Firm OS code asks for privacy "public" (client documents are never public data)', () => {
    expect(hits(codeFiles("src").filter((p) => isFirmOs(p)), /privacy\s*:\s*["']public["']/)).toEqual([]);
  }, SCAN_TIMEOUT);

  it("a scoped call asking for a privacy other than its task's declaration is a scope violation (no provider call)", async () => {
    const def = {
      ...echoAgent,
      scope: { ...echoAgent.scope!, tasks: [...echoAgent.scope!.tasks, { name: "echo.kinds" as const, version: 1, schema: echoAgent.scope!.tasks[0].schema, systemPrompt: "x", privacy: "anonymize-then-cloud" as const }] },
      async extract(ctx: Parameters<typeof echoAgent.extract>[0]) {
        await ctx.model({ task: "echo.kinds" as never, privacy: "public", difficulty: "sop", messages: [{ role: "user", content: "x" }] });
        return echoAgent.extract(ctx);
      },
    };
    const w = echoWorld();
    const out = await runAgent(def, "job-1", w.deps);
    expect(!out.ok && out.reason).toMatch(/task echo\.kinds@1 declares privacy "anonymize-then-cloud"; the call asked for "public"/);
    expect(w.router.calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ LLM03

describe("LLM03 supply chain: the SDK version a run records is the one installed and locked", () => {
  it("MODEL_SUPPLY_CHAIN = installed @anthropic-ai/sdk = package-lock.json", () => {
    const installed = JSON.parse(read("node_modules/@anthropic-ai/sdk/package.json")) as { version: string };
    const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { version: string; integrity?: string }> };
    expect(installed.version).toBe(MODEL_SUPPLY_CHAIN.sdkVersion);
    expect(lock.packages["node_modules/@anthropic-ai/sdk"]).toMatchObject({ version: MODEL_SUPPLY_CHAIN.sdkVersion, integrity: expect.stringMatching(/^sha512-/) });
  });
  it("every guardrail-run AuditEvent records the SDK and the model ids", async () => {
    const w = echoWorld();
    expect((await runAgent(echoAgent, "job-1", w.deps)).ok).toBe(true);
    const meta = (rows(w.db, "auditEvent").find((e) => e.action === "guardrail-run") as { meta: Record<string, unknown> }).meta;
    expect(meta.supplyChain).toEqual({ sdk: `@anthropic-ai/sdk@${MODEL_SUPPLY_CHAIN.sdkVersion}`, models: { ...MODEL_SUPPLY_CHAIN.models } });
  });
});
