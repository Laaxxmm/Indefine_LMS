// Drafting end to end over the real ModelRouter (scripted provider): the scoped comms.polish task,
// anonymised before it leaves, validated after; every failure falls back to the template text
// and says so in the notes.
import { describe, expect, it } from "vitest";
import { detectPii } from "@/lib/ai/anonymizer";
import { BudgetExceededError } from "@/lib/ai/errors";
import type { ModelRequest } from "@/lib/ai/router";
import { FIRM_PREAMBLE, departmentPreamble } from "@/lib/agents/core/guardrails";
import { draftMessage, type DraftRequest } from "./compose";
import { CommsModelRejected, fallbackNote } from "./drafting";
import { buildTemplate, renderBody } from "./templates";
import { SAMPLES } from "../../../../tests/fakes/comms-fixtures";
import { scriptedRouter, sentText } from "../../../../tests/fakes/comms-router";

const req = (kind: keyof typeof SAMPLES, over: Partial<DraftRequest> = {}): DraftRequest => ({ ...SAMPLES[kind], department: "GST", language: "en", clientRequestedIds: false, ...over }) as DraftRequest;
const deps = (router: ReturnType<typeof scriptedRouter>["router"]) => ({ router, runId: "comms:test-1", maxCostInr: 10 });

/** A polish that rewords the opening of each paragraph and keeps every fact (works on masked text). */
const reword = (_r: unknown, input: Record<string, unknown>) => ({
  status: "polished",
  subject: input.subject,
  paragraphs: (input.paragraphs as string[]).map((p) => p.replace(/^This is an update on/, "Here is an update on").replace(/^It is prepared and/, "It is ready and")),
});

describe("draftMessage — English", () => {
  it("polished by the model: scoped task, department preamble, anonymised payload, facts intact", async () => {
    const r = scriptedRouter([reword]);
    const out = await draftMessage(req("status"), deps(r.router));
    expect(out.sources.wording).toBe("model");
    expect(out.english.body).toContain("Here is an update on your GSTR-3B for October 2026.");
    expect(out.english.body).toContain("It is ready and our team is reviewing it.");
    expect(out.english.body).toContain("The due date for filing is 20 Nov 2026.");
    expect(out.english.subject).toBe("GSTR-3B for October 2026 (Acme Traders Private Limited): status update");
    expect(out.notes).toEqual([]);
    expect(out.tone).toEqual([]);

    // What left the building: the scoped task's prompt, with names masked.
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].system).toContain(FIRM_PREAMBLE);
    expect(r.calls[0].system).toContain(departmentPreamble("GST"));
    const sent = sentText(r.calls);
    expect(sent).not.toContain("Acme Traders");
    expect(sent).not.toContain("Ravi Kumar");
    expect(sent).not.toContain("Priya Sharma"); // the signature never goes to the model
    expect(sent).toContain("⟨ORG_1⟩");
    expect(r.rows.map((x) => [x.task, x.agent, x.privacy, x.anonymized, x.status])).toEqual([["comms.polish.gst@2", "comms", "anonymize-then-cloud", true, "OK"]]);
    expect(out.stats.modelCalls).toBe(1);
  });

  it("no PAN or Aadhaar reaches the provider, and none reaches the message unless the client asked", async () => {
    const answer = "Your PAN ABCDE1234F is linked. Aadhaar 2345 6789 0124 is not needed.";
    const echo = (_r: unknown, input: Record<string, unknown>) => ({ status: "polished", subject: input.subject, paragraphs: input.paragraphs });
    const r = scriptedRouter([echo]);
    const out = await draftMessage(req("query-response", { answer } as Partial<DraftRequest>), deps(r.router));
    expect(detectPii(sentText(r.calls))).toEqual([]);
    expect(out.english.body).toContain("[PAN not included]");
    expect(out.english.body).toContain("[Aadhaar not included]");
    expect(out.english.body).not.toMatch(/ABCDE1234F|234F|6789/);
    expect(out.notes.join(" ")).toMatch(/2 identity number\(s\) \(PAN \/ Aadhaar\) left out/);

    const r2 = scriptedRouter([echo]);
    const asked = await draftMessage(req("query-response", { answer, clientRequestedIds: true } as Partial<DraftRequest>), deps(r2.router));
    expect(asked.english.body).toContain("XXXXXX234F");
    expect(asked.english.body).toContain("XXXX XXXX 0124");
    expect(asked.notes.join(" ")).toMatch(/masked to the last 4 characters, as the client asked/);
  });

  it("an invented date is rejected, escalated, and the draft falls back to the template", async () => {
    const invent = (_r: unknown, input: Record<string, unknown>) => ({
      status: "polished",
      subject: input.subject,
      paragraphs: (input.paragraphs as string[]).map((p) => p.replace("20 Nov 2026", "25 Nov 2026")),
    });
    const r = scriptedRouter([invent, invent, invent]);
    const out = await draftMessage(req("status"), deps(r.router));
    expect(out.sources.wording).toBe("template");
    expect(out.english.body).toBe(renderBody(buildTemplate(SAMPLES.status)));
    expect(out.notes).toEqual(["Template wording: the model's wording did not pass the fact and tone checks."]);
    expect(r.rows.map((x) => [x.tier, x.status])).toEqual([
      ["FAST", "LOW_CONFIDENCE"],
      ["SMART", "LOW_CONFIDENCE"],
      ["HARD", "LOW_CONFIDENCE"],
    ]);
    expect(r.rows[0].error).toMatch(/"25 Nov 2026" is a new date/);
    // The feedback to the model is masked too.
    expect(sentText(r.calls)).not.toContain("Acme Traders");
  });

  it("an invented amount is rejected the same way", async () => {
    const invent = (_r: unknown, input: Record<string, unknown>) => ({ status: "polished", subject: input.subject, paragraphs: (input.paragraphs as string[]).map((p) => p.replace("₹1,23,456.00", "₹1,32,456.00")) });
    const r = scriptedRouter([invent, invent, invent]);
    const out = await draftMessage(req("due-reminder"), deps(r.router));
    expect(out.sources.wording).toBe("template");
    expect(out.english.body).toContain("Please arrange the payment of ₹1,23,456.00 by 18 Nov 2026.");
  });

  it("no model key: template text, and the draft says so", async () => {
    const r = scriptedRouter([], { available: false });
    const out = await draftMessage(req("doc-chase"), deps(r.router));
    expect(out.sources.wording).toBe("template");
    expect(out.notes[0]).toBe("Template wording: the drafting model is not available (no model key is configured, or the provider is down).");
    expect(out.english.body).toContain("- Purchase invoice INV-104 dated 03 Oct 2026 from Sharma Steels");
    expect(out.tone).toEqual([]);
  });

  it("the model may abstain: template wording, with a note", async () => {
    const r = scriptedRouter([(_r: unknown, i: Record<string, unknown>) => ({ status: "insufficient_evidence", subject: i.subject, paragraphs: i.paragraphs })]);
    const out = await draftMessage(req("filing-completed"), deps(r.router));
    expect(out.sources.wording).toBe("template");
    expect(out.notes).toEqual(["Template wording: the model left the wording unchanged."]);
    expect(out.english.body).toContain("The acknowledgement number is AA2911260123456.");
  });

  it("without a router (deps null) the draft is the template", async () => {
    const out = await draftMessage(req("status"), null);
    expect(out.notes).toEqual(["Template wording: no model was asked."]);
    expect(out.stats.modelCalls).toBe(0);
  });

  it("a crashing router still yields a draft", async () => {
    const boom = { run: async (q: ModelRequest<unknown>) => Promise.reject(new TypeError(`socket hang up (${q.task})`)) };
    const out = await draftMessage(req("status"), { router: boom as never, runId: "comms:x" });
    expect(out.notes[0]).toBe("Template wording: the drafting model failed (TypeError).");
  });

  it("English is never translated when the client prefers English", async () => {
    const r = scriptedRouter([reword]);
    const out = await draftMessage(req("status"), deps(r.router));
    expect(out).toMatchObject({ language: "en", requestedLanguage: "en", translated: null, sources: { translation: "none" } });
    expect(out.stored).toEqual(out.english);
  });

  it("fallback notes name the cause", () => {
    expect(fallbackNote("wording", new BudgetExceededError("day", 1000, 1000))).toMatch(/budget/);
    expect(fallbackNote("translation", new CommsModelRejected("x"))).toBe("No translation: the model's translation did not pass the fact and tone checks.");
  });
});
