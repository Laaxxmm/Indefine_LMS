// DPDP processing restrictions (src/lib/privacy/consent.ts) at every entry point that would send
// a client's data to a model: the agent runner, the agent service's re-run / change request, and
// comms draft creation. Each refuses with the same plain sentence, before any write or model call;
// once a partner lifts the restriction, work runs again. (Onboarding extraction: onboarding/service.test.ts.)
import { describe, expect, it } from "vitest";
import { echoAgent } from "@/lib/agents/echo";
import { runAgent } from "@/lib/agents/core/runner";
import { rerunAgent, requestChanges, startAgentRun, submitForReview } from "@/lib/agents/service";
import { createDraft } from "@/lib/agents/comms/service";
import { AI_RESTRICTED_MESSAGE, COMMS_RESTRICTED_MESSAGE } from "@/lib/privacy/consent";
import { echoWorld, rows, user } from "../../../tests/fakes/agent-world";
import { CommsWorld } from "../../../tests/fakes/comms-world";
import { scriptedRouter } from "../../../tests/fakes/comms-router";

const KEYS = ["ai-processing", "comms-drafts", "marketing"];
const restrictEvent = (entityId: string, keys = KEYS, requestId = "pr-1") => ({ actorId: "u-partner", action: "restrict-processing", entity: "Client", entityId, meta: { restrictions: keys, privacyRequestId: requestId, why: "consent-withdrawal" } });
const liftEvent = (entityId: string, keys = KEYS, requestId = "pr-1") => ({ actorId: "u-partner", action: "lift-restriction", entity: "Client", entityId, meta: { restrictions: keys, privacyRequestId: requestId, reason: "Written consent received" } });

describe("agent runner", () => {
  it("refuses a restricted client's job with AI_RESTRICTED before any run row, job move or model call", async () => {
    const w = echoWorld();
    w.db.seed("auditEvent", [restrictEvent("c1")]);
    const out = await runAgent(echoAgent, "job-1", w.deps, { startedById: "u-priya" });
    expect(out).toEqual({ ok: false, code: "AI_RESTRICTED", reason: AI_RESTRICTED_MESSAGE });
    expect(rows(w.db, "agentRun")).toEqual([]);
    expect(rows(w.db, "jobTaskEvent")).toEqual([]);
    expect(rows(w.db, "jobTask")[0].state).toBe("ASSIGNED");
    expect(rows(w.db, "deliverable")).toEqual([]);
    expect(w.router.asked).toEqual([]);
    expect(rows(w.db, "auditEvent").map((e) => e.action)).toEqual(["restrict-processing"]); // nothing else written
  });

  it("runs again once a partner has lifted the restriction; a restriction on another client changes nothing", async () => {
    const w = echoWorld();
    w.db.seed("auditEvent", [restrictEvent("c1"), liftEvent("c1"), restrictEvent("c-other")]);
    expect((await runAgent(echoAgent, "job-1", w.deps)).ok).toBe(true);
  });

  it("a restriction that does not cover AI processing (marketing only) does not stop a run", async () => {
    const w = echoWorld();
    w.db.seed("auditEvent", [restrictEvent("c1", ["marketing"])]);
    expect((await runAgent(echoAgent, "job-1", w.deps)).ok).toBe(true);
  });
});

describe("agent service", () => {
  it("Run agent answers 409 with the plain sentence", async () => {
    const w = echoWorld();
    w.db.seed("auditEvent", [restrictEvent("c1")]);
    expect(await startAgentRun(user("priya"), "echo", "job-1", w.deps)).toEqual({ ok: false, status: 409, error: AI_RESTRICTED_MESSAGE });
    expect(rows(w.db, "agentRun")).toEqual([]);
  });

  it("Re-run and Request changes are refused before the job moves back to IN_PREP (nothing half-written)", async () => {
    const w = echoWorld();
    const first = await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    if (!first.ok) throw new Error(first.error);
    const runId = first.data.runId;
    w.db.seed("auditEvent", [restrictEvent("c1")]);
    const before = { events: rows(w.db, "jobTaskEvent").length, runs: rows(w.db, "agentRun").length, audits: rows(w.db, "auditEvent").length };

    expect(await rerunAgent(user("priya"), runId, "Please re-check the register", w.deps)).toEqual({ ok: false, status: 409, error: AI_RESTRICTED_MESSAGE });
    expect(rows(w.db, "jobTask")[0].state).toBe("AGENT_DONE");

    const submitted = await submitForReview(user("priya"), runId, w.deps);
    expect(submitted.ok).toBe(true); // no model call: allowed
    const after = rows(w.db, "jobTaskEvent").length;
    expect(await requestChanges(user("ravi"), runId, "Fix the related-party line", w.deps)).toEqual({ ok: false, status: 409, error: AI_RESTRICTED_MESSAGE });
    expect(rows(w.db, "jobTask")[0].state).toBe("IN_REVIEW");
    expect(rows(w.db, "jobTaskEvent")).toHaveLength(after);
    expect(rows(w.db, "agentRun")).toHaveLength(before.runs);
    expect(rows(w.db, "agentRun")[0].status).toBe("AGENT_DONE"); // not marked CHANGES_REQUESTED
  });
});

describe("comms draft creation", () => {
  function world() {
    const w = new CommsWorld();
    const acme = w.addClient({ lmsClientId: "c-acme" });
    const job = w.addJob(acme);
    return { w, job };
  }
  const priya = user("priya");

  it("refuses with the plain sentence before drafting or storing anything, and calls no model", async () => {
    const { w, job } = world();
    w.audits.push({ id: "ae-r", createdAt: new Date("2026-11-01T05:00:00Z"), ...restrictEvent("c-acme") });
    const r = scriptedRouter([]);
    expect(await createDraft(w.db, priya, { kind: "status", jobId: job.id }, { router: r.router, now: new Date("2026-11-05T06:00:00Z") })).toEqual({ ok: false, status: 409, error: AI_RESTRICTED_MESSAGE });
    expect(r.calls).toEqual([]);
    expect(w.drafts).toEqual([]);
    expect(w.audits.map((a) => a.action)).toEqual(["restrict-processing"]);
  });

  it("honours a drafts-only restriction too, and drafts again after the lift", async () => {
    const { w, job } = world();
    w.audits.push({ id: "ae-r", createdAt: new Date("2026-11-01T05:00:00Z"), ...restrictEvent("c-acme", ["comms-drafts"]) });
    const offline = { router: scriptedRouter([], { available: false }).router, now: new Date("2026-11-05T06:00:00Z") };
    expect(await createDraft(w.db, priya, { kind: "status", jobId: job.id }, offline)).toEqual({ ok: false, status: 409, error: COMMS_RESTRICTED_MESSAGE });
    w.audits.push({ id: "ae-l", createdAt: new Date("2026-11-02T05:00:00Z"), ...liftEvent("c-acme", ["comms-drafts"]) });
    expect((await createDraft(w.db, priya, { kind: "status", jobId: job.id }, offline)).ok).toBe(true);
  });
});
