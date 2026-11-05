// The recorded router: `<task>#2` answers the agreement re-ask (else the single answer is reused),
// every lookup key is listed, and the caller's `contradictions` validators run like the real
// router's last attempt (an issue → needs-review with the output).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MissingRecordingError, createRecordedRouter, recordingKey } from "./recorded-router";
import { runChecklist, type RuleDefinition } from "./checklist";

const req = (over: object = {}) => ({ task: "gst.check:gst.x" as const, privacy: "public" as const, difficulty: "judgement" as const, messages: [], runId: "r", ...over });
const V = z.object({ status: z.enum(["pass", "fail"]) });

describe("createRecordedRouter", () => {
  it("answers the re-ask from <task>#2 when recorded, else reuses the single answer; lists the keys looked up", async () => {
    const r = createRecordedRouter({ "gst.check:gst.x": { status: "fail" }, "gst.check:gst.x#2": { status: "pass" }, "gst.check:gst.y": { status: "fail" } });
    expect(await r.run(req({ schema: V }))).toMatchObject({ status: "ok", output: { status: "fail" } });
    expect(await r.run(req({ schema: V, secondOpinion: true }))).toMatchObject({ status: "ok", output: { status: "pass" } });
    expect(await r.run(req({ task: "gst.check:gst.y", schema: V, secondOpinion: true }))).toMatchObject({ status: "ok", output: { status: "fail" } });
    expect(r.asked).toEqual(["gst.check:gst.x", "gst.check:gst.x#2", "gst.check:gst.y#2"]);
    expect(recordingKey({ task: "gst.a", secondOpinion: true })).toBe("gst.a#2");
    await expect(r.run(req({ task: "gst.check:gst.none" }))).rejects.toBeInstanceOf(MissingRecordingError);
  });

  it("runs contradictions: an issue returns needs-review with the output and the issue", async () => {
    const r = createRecordedRouter({ "gst.check:gst.x": { status: "fail" } });
    const res = await r.run(req({ schema: V, contradictions: (o: { status: string }) => (o.status === "fail" ? ["fail needs a quote"] : []) }));
    expect(res).toMatchObject({ status: "needs-review", output: { status: "fail" }, issues: ["contradiction: fail needs a quote"], needsPartnerReview: true });
    const clean = await r.run(req({ schema: V, contradictions: async () => [] }));
    expect(clean).toMatchObject({ status: "ok", needsPartnerReview: false });
  });
});

describe("checklist engine: abstain and framework outcomes", () => {
  const rule: RuleDefinition = { id: "x.r", title: "Rule", severity: "warn", kind: "llm", check: "Q?", evidence: "row" };
  const run = (answer: unknown, context = "row 1: Acme") => runChecklist({ key: "x", version: "1.0.0", rules: [rule] }, {}, { registry: new Map(), llmCheck: async () => answer, llmContext: () => context });

  it("insufficient_evidence → na + insufficient-evidence with the model's question; a grounded quote is kept", async () => {
    const [r] = await run({ status: "insufficient_evidence", message: "Ask for the lease deed.", evidence: { quote: "acme", location: "row 1" } });
    expect(r).toMatchObject({ status: "na", message: "Rule: insufficient evidence — Ask for the lease deed.", evidence: { quote: "acme", location: "row 1" }, flags: ["insufficient-evidence"] });
    const [bare] = await run({ status: "insufficient_evidence", evidence: { quote: "not there", location: "row 1" } });
    expect(bare).toMatchObject({ status: "na", message: "Rule: insufficient evidence — the documents do not show the answer", evidence: null, flags: ["insufficient-evidence"] });
  });
  it("framework outcomes (disagreement, out-of-scope) become na with their flag", async () => {
    expect((await run({ guardrail: "model-disagreement", message: "two reads differ" }))[0]).toMatchObject({ status: "na", message: "two reads differ", flags: ["model-disagreement"] });
    expect((await run({ guardrail: "out-of-scope", message: "not owned" }))[0]).toMatchObject({ status: "na", flags: ["out-of-scope"] });
    expect((await run({ guardrail: "something-else", message: "x" }))[0]).toMatchObject({ flags: ["llm-evidence-missing"] });
  });
});
