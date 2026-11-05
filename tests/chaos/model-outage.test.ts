// Chaos: Anthropic outage. The real router and the real Grok provider (fake fetch), with Claude
// failing exactly as its provider surfaces an outage after its own retries (support/model-world.ts;
// the SDK-level retry / backoff / Retry-After is unit-tested in src/lib/ai/providers/__tests__/claude.test.ts),
// driven through the onboarding extractor and an agent run — the places a person meets a model failure.
// What a person sees: with XAI_API_KEY set, Grok answers instead (masked, nothing lost); without
// it, onboarding says "Automatic reading failed (Claude unavailable …). Answer the questions below
// instead." and an agent's model check becomes "Check by hand" with the reason — never a silent
// success, never a guess. A credentials problem is reported as such and is not hidden by failover.
import { describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { detectPii } from "@/lib/ai/anonymizer";
import { ProviderError } from "@/lib/ai/errors";
import { extractSpec } from "@/lib/agents/onboarding/extract";
import { PEOPLE } from "@/lib/agents/onboarding/__fixtures__/synthetic";
import { echoAgent } from "@/lib/agents/echo";
import { runAgent } from "@/lib/agents/core/runner";
import { echoWorld, rows } from "../fakes/agent-world";
import { claudeDown, modelWorld } from "./support/model-world";

const PROMPT =
  "Onboard Acme Widgets Pvt Ltd — private limited, PAN AAACE1234F, GSTIN 29AAACE1234F1Z2, contact accounts@acmewidgets.example, GST monthly, assign Priya Sharma, reviewer Ravi Kumar.";

/** Grok as a model would answer: copies the placeholders it was given (it never sees the values). */
function grokReadsOnboarding(body: { messages: { role: string; content: string }[] }) {
  const user = body.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const token = (kind: string) => user.match(new RegExp(`⟨${kind}_\\d+⟩`))?.[0];
  return {
    output: {
      legalName: token("ORG"),
      entityType: "PVT_LTD",
      pan: token("PAN"),
      gstins: [token("GSTIN")],
      contactEmail: token("EMAIL"),
      services: [{ service: "GST", frequency: "MONTHLY" }],
      assigneeName: token("NAME"),
    },
    confidence: 0.93,
  };
}

const overloaded = () => claudeDown(529);

describe("Claude down, Grok configured → failover", () => {
  it("Claude 529 after its retries: Grok reads the sentence, masked, and the partner sees the fields filled in", async () => {
    const m = modelWorld({ claude: [], claudeFallback: overloaded(), grok: grokReadsOnboarding });
    const x = await extractSpec(PROMPT, { router: m.router, runId: "onb-1", people: PEOPLE });

    // User-visible: the spec came back (unmasked locally), no "failed" note.
    expect(x.notes).toEqual([]);
    expect(x.spec).toMatchObject({ legalName: "Acme Widgets Pvt Ltd", entityType: "PVT_LTD", pan: "AAACE1234F", gstins: ["29AAACE1234F1Z2"], contactEmail: "accounts@acmewidgets.example" });

    // One Claude call (the provider retried inside it), logged as PROVIDER_ERROR; Grok answered first time.
    expect(m.claude.requests).toHaveLength(1);
    expect(m.sleeps).toEqual([]);
    expect(m.rows.map((r) => [r.provider, r.status])).toEqual([
      ["claude", "PROVIDER_ERROR"],
      ["grok", "OK"],
    ]);
    expect(m.rows[0].error).toMatch(/Claude unavailable \(529\)/);
    expect(m.rows[1]).toMatchObject({ anonymized: true, tier: "FAST", model: "grok-4" });

    // Grok got the masked request only: no PAN / GSTIN / email / staff name in the payload.
    expect(m.xai.bodies).toHaveLength(1);
    const sent = m.xai.bodies[0];
    expect(detectPii(sent)).toEqual([]);
    for (const raw of ["AAACE1234F", "29AAACE1234F1Z2", "accounts@acmewidgets.example", "Priya Sharma", "Acme Widgets Pvt Ltd"]) expect(sent).not.toContain(raw);
  });

  it("Claude still rate-limited (429) after its Retry-After waits also fails over to Grok", async () => {
    const m = modelWorld({ claude: [], claudeFallback: claudeDown(429), grok: grokReadsOnboarding });
    const x = await extractSpec(PROMPT, { router: m.router, runId: "onb-2", people: PEOPLE });
    expect(x.spec.pan).toBe("AAACE1234F");
    expect(m.rows[0].error).toMatch(/Claude rate limited \(429\)/);
    expect(m.rows.map((r) => [r.provider, r.status])).toEqual([
      ["claude", "PROVIDER_ERROR"],
      ["grok", "OK"],
    ]);
  });

  it("Claude AND Grok down: the Grok outage is surfaced with its status; the partner is told to answer the questions", async () => {
    const m = modelWorld({ claude: [], claudeFallback: overloaded(), grok: { status: 503 } });
    const x = await extractSpec(PROMPT, { router: m.router, runId: "onb-3", people: PEOPLE });
    expect(x.notes).toEqual(["Automatic reading failed (Grok unavailable (503).). Answer the questions below instead."]);
    expect(x.spec.pan).toBeUndefined(); // nothing guessed: the clarifier will ask for it
    expect(m.xai.bodies).toHaveLength(4); // the real Grok provider retried 503 with backoff before giving up
    expect(m.sleeps).toEqual([500, 1000, 2000]);
    expect(m.rows.map((r) => [r.provider, r.status])).toEqual([
      ["claude", "PROVIDER_ERROR"],
      ["grok", "PROVIDER_ERROR"],
      [null, "PROVIDER_ERROR"], // "no provider left" is logged too
    ]);
  });
});

describe("Claude down, no XAI_API_KEY → clear error, no silent success", () => {
  it("the router throws the Claude outage (typed, failover-able) after logging it", async () => {
    const m = modelWorld({ claude: [], claudeFallback: overloaded() });
    const err = await m.router
      .run({ task: "gst.classify-ledgers", privacy: "anonymize-then-cloud", difficulty: "sop", runId: "r-1", messages: [{ role: "user", content: "Classify these ledgers." }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ provider: "claude", kind: "outage", status: 529, failoverable: true });
    expect(m.rows.map((r) => r.status)).toEqual(["PROVIDER_ERROR", "PROVIDER_ERROR"]);
    expect(m.rows[1].error).toBe("Claude is unavailable and Grok is not configured (XAI_API_KEY empty).");
    expect(m.xai.bodies).toHaveLength(0);
  });

  it("onboarding falls back to questions and says why", async () => {
    const m = modelWorld({ claude: [], claudeFallback: overloaded() });
    const x = await extractSpec(PROMPT, { router: m.router, runId: "onb-4", people: PEOPLE });
    expect(x.notes).toHaveLength(1);
    expect(x.notes[0]).toMatch(/^Automatic reading failed \(Claude unavailable \(529\): .*\)\. Answer the questions below instead\.$/);
    expect(x.spec).toEqual({});
  });

  it("an agent's model check becomes 'check by hand' with the outage named; the pack is still prepared from code", async () => {
    const w = echoWorld();
    const m = modelWorld({ claude: [], claudeFallback: claudeDown(503) });
    const out = await runAgent(echoAgent, "job-1", { ...w.deps, router: m.router }, { startedById: "u-priya" });
    expect(out.ok).toBe(true);
    const llm = rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")!;
    expect(llm).toMatchObject({ status: "na", source: "llm" });
    expect(String(llm.message)).toMatch(/model check failed \(Claude unavailable \(503\).*\); review manually/);
    expect((llm.evidence as { flags?: string[] }).flags).toEqual(["llm-error"]);
    // Figures come from code, so the outage does not change them.
    expect(rows(w.db, "agentRun")[0]).toMatchObject({ status: "AGENT_DONE", figures: { rowCount: 3, totalPaise: 4745649, largestPaise: 2345650 } });
  });

  it("ANTHROPIC_API_KEY unset: 'not configured' is the message, nothing is called", async () => {
    const m = modelWorld({ claude: null });
    const x = await extractSpec(PROMPT, { router: m.router, runId: "onb-5", people: PEOPLE });
    expect(x.notes).toEqual(["Automatic reading failed (Claude is unavailable and Grok is not configured (XAI_API_KEY empty).). Answer the questions below instead."]);
    expect(m.claude.requests).toHaveLength(0);
  });
});

describe("a credentials problem is not an outage", () => {
  it("Claude 401 is surfaced as auth and never retried on Grok, even with XAI_API_KEY set", async () => {
    const m = modelWorld({ claude: [claudeDown(401)], grok: grokReadsOnboarding });
    const err = await m.router
      .run({ task: "tax.match-ais", privacy: "anonymize-then-cloud", difficulty: "sop", runId: "r-2", messages: [{ role: "user", content: "Match AIS rows." }] })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "ProviderError", provider: "claude", kind: "auth", status: 401 });
    expect((err as Error).message).toBe("Claude rejected the credentials (401).");
    expect(m.claude.requests).toHaveLength(1); // auth errors are not retried
    expect(m.xai.bodies).toHaveLength(0);
  });
});
