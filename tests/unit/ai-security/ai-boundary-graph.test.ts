// Security finding #19 (audit PoC 07): verify:ai-boundary was a literal grep with 12 bypasses. It is
// now an import-graph rule on the TypeScript AST (scripts/lib/guards.ts checkAiBoundary). Each
// bypass below raised no violation before; each must raise one now. Forbidden literals are
// assembled from pieces so this file passes the very scan it tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_GEMINI, LEGACY_GEMINI_CALLERS, checkAiBoundary } from "../../../scripts/lib/guards";
import { listRepoFiles } from "../../../scripts/lib/repo-files";

const ROOT = join(__dirname, "..", "..", "..");
const rules = (path: string, content: string) => checkAiBoundary([{ path, content }]).map((v) => v.rule);
const SDK = "@anthropic" + "-ai/sdk";
const ANTHROPIC = "api.anthropic" + ".com";

describe("ai-boundary: the 12 audit bypasses are caught", () => {
  const BYPASSES: [string, string, string][] = [
    ["import the legacy wrapper @/lib/gemini", 'import { callGemini } from "@/lib/gemini";\nexport const f = (t: string) => callGemini(t);', "ai-boundary:legacy-import"],
    ["host split across two literals", `const host = "https://api.anthropic" + ".com"; fetch(host + "/v1/messages");`, "ai-boundary:provider-host"],
    ["host from env", 'fetch(process.env.AI_HOST + "/v1/messages", { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY } });', "ai-boundary:egress-env"],
    ["host base64-decoded", `fetch(Buffer.from("${Buffer.from("https://" + ANTHROPIC).toString("base64")}", "base64").toString());`, "ai-boundary:provider-host"],
    ["host via array join", 'fetch(["https://api", "anthropic", "com"].join("."));', "ai-boundary:provider-host"],
    ["SDK path split in require", `const A = require("@anthropic" + "-ai" + "/sdk");`, "ai-boundary:sdk-import"],
    ["SDK via a const variable", `const name = "${SDK}"; const A = require(name);`, "ai-boundary:sdk-import"],
    ["OpenAI-compatible host (openrouter)", `fetch("https://openrouter" + ".ai/api/v1/chat/completions", { body: "{}" });`, "ai-boundary:provider-host"],
    ["Gemini via Vertex AI host", `fetch("https://us-central1-aiplatform.googleapis" + ".com/v1/projects/p/locations/l/publishers/google/models/gemini-pro:generateContent");`, "ai-boundary:provider-host"],
    ["Azure OpenAI host", `fetch("https://myfirm.openai.azure" + ".com/openai/deployments/gpt4/chat/completions");`, "ai-boundary:provider-host"],
    ["AWS Bedrock SDK", 'import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";', "ai-boundary:sdk-import"],
    ["import @/lib/transcribe (uploads whole files to Gemini)", 'import { transcribeVideo } from "@/lib/transcribe";', "ai-boundary:legacy-import"],
  ];
  it("there are 12", () => expect(BYPASSES).toHaveLength(12));
  it.each(BYPASSES)("caught: %s", (_name, content, rule) => {
    expect(rules("src/lib/firm-os-new-feature.ts", content)).toContain(rule);
  });

  it("more shapes: String.fromCharCode, atob, createRequire, a URL const passed to a wrapper", () => {
    const codes = [...("https://" + ANTHROPIC)].map((c) => c.charCodeAt(0)).join(", ");
    expect(rules("src/lib/x.ts", `fetch(String.fromCharCode(${codes}));`)).toContain("ai-boundary:provider-host");
    expect(rules("src/lib/x.ts", `fetch(atob("${Buffer.from("https://" + ANTHROPIC).toString("base64")}"));`)).toContain("ai-boundary:provider-host");
    expect(rules("src/lib/x.ts", `import { createRequire } from "node:module"; const req = createRequire(import.meta.url); const A = req("${SDK}");`)).toContain("ai-boundary:sdk-import");
    expect(rules("src/lib/x.ts", `const BASE = \`https://\${"api.anthropic"}.com\`; post(BASE);`)).toContain("ai-boundary:provider-host");
  });

  it("model providers are imported only by the router (type imports are fine)", () => {
    expect(rules("src/lib/agents/new.ts", 'import { createClaudeProvider } from "@/lib/ai/providers/claude";')).toEqual(["ai-boundary:provider-import"]);
    expect(rules("src/lib/ai/router.ts", 'import { createProviders } from "./providers";')).toEqual([]);
    expect(rules("src/lib/agents/new.ts", 'import type { ProviderSet } from "@/lib/ai/providers";')).toEqual([]);
  });

  it("Firm OS code may not import a legacy Gemini module even if it is a caller path", () => {
    expect(rules("src/lib/agents/x.ts", 'import { generateQuiz } from "@/lib/quiz-gen";')).toEqual(["ai-boundary:legacy-import"]);
  });

  it("Firm OS code that reaches legacy Gemini through a chain of imports is flagged", () => {
    const v = checkAiBoundary([
      { path: "src/lib/agents/x.ts", content: 'import { autoQuizFromVideo } from "@/lib/auto-quiz";' },
      { path: "src/lib/auto-quiz.ts", content: 'import { transcribeVideo } from "@/lib/transcribe";\nexport const f = () => transcriptGate("");' },
      { path: "src/lib/transcribe.ts", content: "export const transcribeVideo = 1;" },
    ]).map((x) => `${x.path} ${x.rule}`);
    expect(v).toEqual(["src/lib/agents/x.ts ai-boundary:firm-os-reaches-gemini"]);
  });
});

describe("ai-boundary on the real tree", () => {
  it("the four legacy Gemini callers (and the two admin quiz pages) are allow-listed with a reason and reach the mask gate", () => {
    const paths = LEGACY_GEMINI_CALLERS.map((c) => c.path);
    for (const p of ["src/lib/sop/gemini.ts", "src/lib/statutory/digest.ts", "src/lib/live/ingest.ts", "src/lib/auto-quiz.ts"]) expect(paths).toContain(p);
    for (const c of LEGACY_GEMINI_CALLERS) {
      expect(c.why.length, c.path).toBeGreaterThan(10);
      expect(c.gate.test(readFileSync(join(ROOT, c.path), "utf8")), c.path).toBe(true);
    }
    const files = ["src/lib/sop/gemini.ts", "src/lib/statutory/digest.ts", "src/lib/live/ingest.ts", "src/lib/auto-quiz.ts", "src/lib/sop/service.ts", ...LEGACY_GEMINI].map((p) => ({ path: p, content: readFileSync(join(ROOT, p), "utf8") }));
    expect(checkAiBoundary(files)).toEqual([]);
  });

  it("an allow-listed caller that stops reaching the gate is flagged", () => {
    const content = readFileSync(join(ROOT, "src/lib/live/ingest.ts"), "utf8").replace(/transcriptGate\(/g, "noGate(");
    expect(checkAiBoundary([{ path: "src/lib/live/ingest.ts", content }]).map((v) => v.rule)).toEqual(["ai-boundary:gate-missing"]);
  });

  it("the whole repository passes (what npm run verify:ai-boundary checks)", () => {
    const files = listRepoFiles()
      .filter((p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !p.split("/").includes("node_modules"))
      .map((p) => ({ path: p, content: readFileSync(join(ROOT, p), "utf8") }));
    expect(files.length).toBeGreaterThan(500);
    expect(checkAiBoundary(files).map((v) => `${v.path}:${v.line} ${v.rule}`)).toEqual([]);
  }, 120_000);
});
