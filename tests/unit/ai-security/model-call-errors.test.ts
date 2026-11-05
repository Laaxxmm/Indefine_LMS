// Security finding #18 (audit PoC 02): ModelCall.error persisted validator text computed on the
// UNMASKED output — names and UPI handles the regexes missed were stored indefinitely — and raw
// provider error text. Now the column (and AgentRun.error) holds a classification only.
// Providers are fakes (no network). Synthetic values only.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadRouterConfig } from "@/lib/ai/config";
import { ProviderError } from "@/lib/ai/errors";
import { providerErrorCode, validatorCode } from "@/lib/ai/call-errors";
import { createRouter, type ModelCallRepo, type ModelCallRow } from "@/lib/ai/router";
import type { ModelProvider, ProviderRequest, ProviderResult } from "@/lib/ai/types";
import { verhoeffCheckDigit } from "@/lib/ai/anonymizer";
import { runAgent } from "@/lib/agents/core/runner";
import { echoAgent, ECHO_RELATED_PARTY_TASK } from "@/lib/agents/echo";
import { echoWorld, rows } from "../../fakes/agent-world";
import { CHAOS_PACK, modelCallingAgent } from "../../chaos/support/model-world";

const AADHAAR = "23456789012" + verhoeffCheckDigit("23456789012");

function spyProvider(id: "claude" | "grok" | "local", answer: (req: ProviderRequest, n: number) => unknown, opts: { available?: boolean; error?: Error } = {}) {
  const calls: ProviderRequest[] = [];
  const provider: ModelProvider = {
    id,
    isAvailable: async () => opts.available ?? true,
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      calls.push(req);
      if (opts.error) throw opts.error;
      return { output: answer(req, calls.length) as T, model: req.model, tokensIn: 10, tokensOut: 10, latencyMs: 1 };
    },
  };
  return { provider, calls };
}
function memRepo() {
  const rows: ModelCallRow[] = [];
  const repo: ModelCallRepo = { record: async (r) => void rows.push(r), costInrSince: async () => 0, costInrForRun: async () => 0 };
  return { repo, rows };
}
const off = (id: "grok" | "local") => spyProvider(id, () => ({}), { available: false }).provider;
const cfg = loadRouterConfig({ AI_DAILY_BUDGET_INR: "0" });

describe("ModelCall.error holds a classification only (#18)", () => {
  it("PoC 02: a validator echoing the model's quote stores neither the name, the UPI handle nor the PAN", async () => {
    const claude = spyProvider("claude", () => ({ output: { note: "NEFT-RAJESH KUMAR SHARMA-rajesh.k@okhdfcbank ⟨PAN_1⟩" }, confidence: 0.99 }));
    const { repo, rows: logged } = memRepo();
    const router = createRouter({ providers: { claude: claude.provider, grok: off("grok"), local: off("local") }, repo, config: cfg });
    const res = await router.run({
      task: "books.classify-expenses",
      privacy: "anonymize-then-cloud",
      difficulty: "sop",
      runId: "R",
      schema: z.object({ note: z.string() }),
      // Mirrors books/classify.ts groundingIssue(): it echoes the model's quote into the issue text.
      contradictions: (o) => [`S1: quote "${o.note}" is not in the line text`],
      messages: [{ role: "user", content: "S1 | 2026-10-01 | NEFT-RAJESH KUMAR SHARMA-rajesh.k@okhdfcbank | PAN ABCDE1234F | 500.00" }],
    });
    expect(res.status).toBe("needs-review");
    const errors = logged.map((r) => r.error ?? "").join("\n");
    for (const s of ["RAJESH", "rajesh.k@okhdfcbank", "okhdfcbank", "ABCDE1234F", "quote \""]) expect(errors).not.toContain(s);
    expect(logged.map((r) => r.error)).toEqual(["validator: ungrounded quote", "validator: ungrounded quote", "validator: ungrounded quote"]);
  });

  it("schema failures store the zod code and schema path, never the received value", async () => {
    const claude = spyProvider("claude", () => ({ output: { pan: "Rajesh Kumar ABCDE1234F" }, confidence: 0.99 }));
    const { repo, rows: logged } = memRepo();
    const router = createRouter({ providers: { claude: claude.provider, grok: off("grok"), local: off("local") }, repo, config: cfg });
    await router.run({ task: "gst.x", privacy: "anonymize-then-cloud", difficulty: "novel", runId: "R", schema: z.object({ pan: z.enum(["A", "B"]) }), messages: [{ role: "user", content: "x" }] });
    expect(logged[0].error).toBe("schema: invalid_enum_value at pan");
  });

  it("a provider error that echoes the request is stored as its kind and status only", async () => {
    const echoing = new ProviderError("claude", "bad_request", `Claude rejected the request (400): messages.0.content contains "PAN ABCDE1234F, Aadhaar ${AADHAAR}"`, 400);
    const claude = spyProvider("claude", () => ({}), { error: echoing });
    const { repo, rows: logged } = memRepo();
    const router = createRouter({ providers: { claude: claude.provider, grok: off("grok"), local: off("local") }, repo, config: cfg });
    await expect(router.run({ task: "gst.x", privacy: "anonymize-then-cloud", difficulty: "sop", runId: "R", messages: [{ role: "user", content: "x" }] })).rejects.toBe(echoing);
    expect(logged[0]).toMatchObject({ status: "PROVIDER_ERROR", error: "provider: Claude rejected the request (400)" });
  });

  it("token maps stay per run: run B cannot unmask run A's tokens; rows carry hashes, never prompts", async () => {
    const seen: string[] = [];
    const claude = spyProvider("claude", (req) => {
      seen.push(req.messages.map((m) => m.content).join("|"));
      return { output: "echo ⟨PAN_1⟩ ⟨AADHAAR_1⟩ ⟨PHONE_1⟩ ⟨PAN_2⟩", confidence: 0.99 };
    });
    const { repo, rows: logged } = memRepo();
    const router = createRouter({ providers: { claude: claude.provider, grok: off("grok"), local: off("local") }, repo, config: cfg });
    // Free-text answers: "all" restores every known placeholder (the default "grounded" would keep them masked, #25).
    const a = await router.run<string>({ task: "gst.a", privacy: "anonymize-then-cloud", difficulty: "sop", runId: "A", unmask: "all", messages: [{ role: "user", content: `PAN ABCDE1234F Aadhaar ${AADHAAR} phone 9876543210` }] });
    const b = await router.run<string>({ task: "gst.b", privacy: "anonymize-then-cloud", difficulty: "sop", runId: "B", unmask: "all", messages: [{ role: "user", content: "nothing sensitive, PAN FGHIJ5678K only" }] });
    expect(seen[0]).not.toContain("ABCDE1234F");
    expect(a.status === "ok" && a.output).toBe(`echo ABCDE1234F ${AADHAAR} 9876543210 ⟨PAN_2⟩`);
    expect(b.status === "ok" && b.output).toBe("echo FGHIJ5678K ⟨AADHAAR_1⟩ ⟨PHONE_1⟩ ⟨PAN_2⟩");
    for (const r of logged) {
      const json = JSON.stringify(r);
      expect(json).not.toContain("ABCDE1234F");
      expect(json).not.toContain(AADHAAR);
      expect(r.promptHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("escalation feedback is masked with the same map: the second provider call never sees raw values", async () => {
    let n = 0;
    const claude = spyProvider("claude", () => (++n === 1 ? { output: { v: "bad" }, confidence: 0.99 } : { output: { v: "ok" }, confidence: 0.99 }));
    const { repo } = memRepo();
    const router = createRouter({ providers: { claude: claude.provider, grok: off("grok"), local: off("local") }, repo, config: cfg });
    await router.run({
      task: "gst.x",
      privacy: "anonymize-then-cloud",
      difficulty: "sop",
      runId: "R",
      schema: z.object({ v: z.string() }),
      contradictions: (o) => (o.v === "bad" ? ["client ABCDE1234F phone 9876543210 mismatch"] : []),
      messages: [{ role: "user", content: "PAN ABCDE1234F" }],
    });
    const all = JSON.stringify(claude.calls);
    expect(claude.calls.length).toBe(2);
    expect(all).not.toContain("ABCDE1234F");
    expect(all).not.toContain("9876543210");
  });
});

describe("AgentRun.error and ChecklistResult.message keep a classification, never the issue wording", () => {
  const issues = ['contradiction: S1: quote "NEFT-RAJESH KUMAR SHARMA-rajesh.k@okhdfcbank" is not in the line text', "pan: Invalid enum value. Expected 'A', received 'ABCDE1234F'"];

  it("a needs-review result without output fails the run with the issue classes only", async () => {
    const w = echoWorld({ pack: false });
    w.db.seed("sopPack", [CHAOS_PACK]);
    w.deps.router = { run: async () => ({ status: "needs-review", output: null, issues, needsPartnerReview: true }) as never };
    const out = await runAgent(modelCallingAgent({ calls: 1, privacy: "anonymize-then-cloud" }), "job-1", w.deps);
    expect(out).toMatchObject({ ok: false, code: "FAILED", reason: "Model output not usable (validator: ungrounded quote; schema: invalid at pan)" });
    const stored = JSON.stringify(rows(w.db, "agentRun"));
    for (const s of ["RAJESH", "okhdfcbank", "ABCDE1234F"]) expect(stored).not.toContain(s);
  });

  it("the same failure on an LLM rule leaves no wording in the checklist row", async () => {
    const w = echoWorld();
    w.deps.router = { run: async () => ({ status: "needs-review", output: null, issues, needsPartnerReview: true }) as never };
    expect((await runAgent(echoAgent, "job-1", w.deps)).ok).toBe(true);
    const llm = rows(w.db, "checklistResult").find((r) => r.ruleId === ECHO_RELATED_PARTY_TASK.replace("echo.check:", "")) as { message: string };
    expect(llm.message).toMatch(/Model output not usable \(validator: ungrounded quote; schema: invalid at pan\)/);
    expect(llm.message).not.toContain("RAJESH");
  });

  it("issue and provider classifications are fixed text", () => {
    expect(validatorCode('S1: number 98765 in the quote is not a number of the line')).toBe("validator: ungrounded number");
    expect(validatorCode("S2: answered twice")).toBe("validator: duplicate answer");
    expect(validatorCode("anything else about Rajesh")).toBe("validator: rejected");
    expect(providerErrorCode("grok", new ProviderError("grok", "outage", "Grok down: body says PAN ABCDE1234F", 503))).toBe("provider: Grok unavailable (503)");
  });
});
