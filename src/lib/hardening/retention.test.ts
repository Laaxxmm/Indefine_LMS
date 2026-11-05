// DPDP retention (ADR-006, docs/dpdp/retention.md): AgentRun.inputs cleared after 30 days and
// OnboardingRun copies 30 days after the run last changed, with the rows kept; identifiers masked in
// the free text of ModelCall and AuditEvent; only heartbeats older than 7 days removed; escalations
// mirrored; one AuditEvent per run; the cron route needs the secret.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { EscalationDb } from "@/lib/audit/escalations";
import { RetentionWorld } from "../../../tests/fakes/retention-world";
import {
  AGENT_RUN_INPUTS_DAYS,
  FREE_TEXT_SWEEP_BATCH,
  HEARTBEAT_DAYS,
  ONBOARDING_CLEARED,
  ONBOARDING_COPY_DAYS,
  clearExpiredAgentRunInputs,
  clearStaleOnboardingCopies,
  purgeExpiredRows,
  rateLimitBucketCutoff,
  runRetention,
  sweepFreeText,
  type RetentionDb,
} from "./retention";

// Compile-time: the app's client (with its `omit` config) is what the cron passes.
export const _prismaFits = (p: (typeof import("@/lib/prisma"))["prisma"]): RetentionDb & EscalationDb => p;

const NOW = new Date("2026-11-05T21:00:00.000Z"); // 02:30 IST, 6 Nov
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY + extraMs);

function seeded() {
  const w = new RetentionWorld();
  const run = (id: string, over: Partial<RetentionWorld["runs"][number]>) => w.runs.push({ id, inputs: { extracted: [{ party: "Acme" }] }, inputsPurgeAt: null, startedAt: ago(1), figures: { total: 1 }, status: "APPROVED", ...over });
  run("expired", { inputsPurgeAt: ago(0, -1000) }); // purge time passed 1 s ago
  run("due-now", { inputsPurgeAt: NOW }); // exactly due
  run("fresh", { inputsPurgeAt: ago(-5) }); // 5 days to go
  run("legacy-old", { inputsPurgeAt: null, startedAt: ago(AGENT_RUN_INPUTS_DAYS + 1) });
  run("legacy-new", { inputsPurgeAt: null, startedAt: ago(AGENT_RUN_INPUTS_DAYS - 1) });
  run("already-null", { inputs: null, inputsPurgeAt: ago(10) });
  const beat = (id: string, at: Date) => w.beats.push({ id, userId: "u-priya", at, source: "lms" });
  beat("b-8d", ago(8));
  beat("b-7d-1s", ago(HEARTBEAT_DAYS, -1000));
  beat("b-7d", ago(HEARTBEAT_DAYS));
  beat("b-6d", ago(6));
  beat("b-now", NOW);
  // Rate-limit buckets: the longest default window is an hour, so a bucket goes once its window
  // started more than 1 h + 1 day ago.
  const bucket = (key: string, windowStart: Date) => w.buckets.push({ key, windowStart, count: 3 });
  bucket("companion:old-token", ago(3));
  bucket("onboard:u-priya", ago(1, -60 * 60_000 - 1000)); // window ended 1 day + 1 s ago
  bucket("agent-run:u-ravi", ago(1, -60 * 60_000 + 1000)); // window ended 1 s less than a day ago
  bucket("companion:live-token", NOW);
  w.calls.push({ id: "mc-1", runId: "run-1", agent: "gst", task: "gst.extract", provider: "claude", tier: "SMART", escalationLevel: 1, status: "OK", escalated: true, createdAt: ago(1) });
  w.calls.push({ id: "mc-err", runId: "run-2", agent: "gst", task: "gst.extract", provider: "claude", tier: "SMART", escalationLevel: 0, status: "PROVIDER_ERROR", escalated: false, createdAt: ago(2), error: "Provider rejected: PAN ABCPK1234F for kiran@kumar.test" });
  const ob = (id: string, over: Partial<RetentionWorld["onboarding"][number]>) =>
    w.onboarding.push({ id, prompt: "Onboard Kiran Kumar, PAN ABCPK1234F", spec: { pan: "ABCPK1234F" }, plan: { jobs: 12 }, status: "DONE", firmClientId: "fc-1", error: null, updatedAt: ago(1), ...over });
  ob("ob-done-old", { updatedAt: ago(ONBOARDING_COPY_DAYS) }); // exactly due
  ob("ob-failed-old", { status: "FAILED", firmClientId: null, error: "site creation failed", plan: null, updatedAt: ago(90) });
  ob("ob-draft-old", { status: "DRAFT", firmClientId: null, plan: null, updatedAt: ago(ONBOARDING_COPY_DAYS + 1) });
  ob("ob-done-fresh", { updatedAt: ago(ONBOARDING_COPY_DAYS - 1) });
  ob("ob-erased", { prompt: "[erased]", spec: { erased: true }, plan: null, updatedAt: ago(400) });
  const audit = (id: string, action: string, meta: Record<string, unknown>) => w.audits.push({ id, actorId: "u-ravi", action, entity: "AgentRun", entityId: "run-1", meta, createdAt: ago(3) });
  audit("a-comment", "comment", { text: "Kiran Kumar PAN ABCPK1234F is wrong" });
  audit("a-retract", "retract-filing", { from: "FILED_BY_HUMAN", to: "APPROVED", eventId: "ev-1", note: "wrong ARN, call 9876543210" });
  audit("a-plain", "comment", { text: "Check INV-3" });
  audit("a-close", "close", { evidence: { sha256: "9876543210ab" } });
  return w;
}

describe("AgentRun.inputs (≤ 30 days)", () => {
  it("clears inputs past inputsPurgeAt (or 30 days after start for older runs) and keeps every row and its other fields", async () => {
    const w = seeded();
    expect(await clearExpiredAgentRunInputs(w.db, NOW)).toBe(3);
    const byId = Object.fromEntries(w.runs.map((r) => [r.id, r]));
    expect(w.runs.map((r) => r.id)).toEqual(["expired", "due-now", "fresh", "legacy-old", "legacy-new", "already-null"]);
    for (const id of ["expired", "due-now", "legacy-old", "already-null"]) expect(byId[id].inputs, id).toBeNull();
    for (const id of ["fresh", "legacy-new"]) expect(byId[id].inputs, id).not.toBeNull();
    expect(byId.expired).toMatchObject({ figures: { total: 1 }, status: "APPROVED" });
    expect(w.log).toEqual(["agentRun.updateMany"]); // an update, never a delete
  });
});

describe("ActivityHeartbeat (7 days) and RateLimitBucket (a day after the window ends)", () => {
  it("removes only heartbeats older than 7 days, and only buckets whose window ended more than a day ago", async () => {
    const w = seeded();
    expect(await purgeExpiredRows(w.db, NOW)).toEqual({ heartbeats: 2, rateLimitBuckets: 2 });
    expect(w.beats.map((b) => b.id)).toEqual(["b-7d", "b-6d", "b-now"]);
    expect(w.buckets.map((b) => b.key)).toEqual(["agent-run:u-ravi", "companion:live-token"]);
    expect(await purgeExpiredRows(w.db, NOW)).toEqual({ heartbeats: 0, rateLimitBuckets: 0 });
  });

  it("the bucket cutoff follows the longest window in force (an env override of any scope)", () => {
    expect(rateLimitBucketCutoff(NOW, {})).toEqual(new Date(NOW.getTime() - 60 * 60_000 - DAY));
    expect(rateLimitBucketCutoff(NOW, { RATE_LIMIT_COMPANION: "100/6h" })).toEqual(new Date(NOW.getTime() - 6 * 60 * 60_000 - DAY));
  });
});

describe("OnboardingRun copies (30 days after the run last changed)", () => {
  it("clears the typed request, extracted details and plan of runs untouched for 30 days; keeps the row and its status", async () => {
    const w = seeded();
    expect(await clearStaleOnboardingCopies(w.db, NOW)).toBe(3);
    const byId = Object.fromEntries(w.onboarding.map((r) => [r.id, r]));
    for (const id of ["ob-done-old", "ob-failed-old", "ob-draft-old"]) expect(byId[id], id).toMatchObject({ prompt: ONBOARDING_CLEARED, spec: { cleared: true }, plan: null });
    expect(byId["ob-failed-old"]).toMatchObject({ status: "FAILED", error: "site creation failed", firmClientId: null });
    expect(byId["ob-done-fresh"]).toMatchObject({ prompt: expect.stringContaining("ABCPK1234F"), plan: { jobs: 12 } });
    expect(byId["ob-erased"]).toMatchObject({ prompt: "[erased]", spec: { erased: true } });
    expect(w.onboarding).toHaveLength(5);
    expect(w.log).toEqual(["onboardingRun.updateMany"]); // an update, never a delete
    expect(await clearStaleOnboardingCopies(w.db, NOW)).toBe(0);
  });
});

describe("free text in ModelCall and AuditEvent (ADR-006: no raw client text)", () => {
  it("masks identifiers in typed audit notes and provider errors, keeping every other value; resumes from its cursor", async () => {
    const w = seeded();
    const r = await sweepFreeText(w.db, NOW, { auditFreeText: null, modelCallErrors: null });
    expect(r).toEqual({ auditNotesMasked: 2, modelErrorsMasked: 1, cursors: { auditFreeText: NOW.toISOString(), modelCallErrors: NOW.toISOString() } });
    const audit = Object.fromEntries(w.audits.map((a) => [a.id, a]));
    expect(audit["a-comment"]).toMatchObject({ action: "comment", entity: "AgentRun", entityId: "run-1", meta: { text: "Kiran Kumar PAN ⟨PAN_1⟩ is wrong" } });
    expect(audit["a-retract"].meta).toEqual({ from: "FILED_BY_HUMAN", to: "APPROVED", eventId: "ev-1", note: "wrong ARN, call ⟨PHONE_1⟩" });
    expect(audit["a-plain"].meta).toEqual({ text: "Check INV-3" }); // nothing to mask: not rewritten
    expect(audit["a-close"].meta).toEqual({ evidence: { sha256: "9876543210ab" } }); // not a free-text action
    expect(w.calls.find((c) => c.id === "mc-err")?.error).toBe("Provider rejected: PAN ⟨PAN_1⟩ for ⟨EMAIL_1⟩");
    expect(w.log.filter((l) => l.endsWith(".update"))).toEqual(["auditEvent.update", "auditEvent.update", "modelCall.update"]);

    // From the cursor: nothing new, nothing read again, nothing changed.
    w.log = [];
    expect(await sweepFreeText(w.db, NOW, r.cursors)).toMatchObject({ auditNotesMasked: 0, modelErrorsMasked: 0 });
    expect(w.log.filter((l) => l.endsWith(".update"))).toEqual([]);
  });

  it("stops at the batch size and records where the next night continues", async () => {
    const w = new RetentionWorld();
    for (let i = 0; i < FREE_TEXT_SWEEP_BATCH + 5; i++) w.audits.push({ id: `c-${i}`, actorId: "u", action: "comment", entity: "AgentRun", entityId: "r", meta: { text: `PAN ABCPK1234F #${i}` }, createdAt: ago(10, i * 1000) });
    const first = await sweepFreeText(w.db, NOW, { auditFreeText: null, modelCallErrors: null });
    expect(first.auditNotesMasked).toBe(FREE_TEXT_SWEEP_BATCH);
    expect(first.cursors.auditFreeText).toBe(ago(10, (FREE_TEXT_SWEEP_BATCH - 1) * 1000).toISOString());
    const second = await sweepFreeText(w.db, NOW, first.cursors);
    expect(second).toMatchObject({ auditNotesMasked: 5, cursors: { auditFreeText: NOW.toISOString() } });
    expect(JSON.stringify(w.audits)).not.toContain("ABCPK1234F");
  });
});

describe("runRetention", () => {
  it("runs every step and records one retention AuditEvent with the counts and cursors", async () => {
    const w = seeded();
    const s = await runRetention(w.db, NOW);
    expect(s).toEqual({
      at: NOW.toISOString(),
      agentRunInputsCleared: 3,
      onboardingCopiesCleared: 3,
      auditNotesMasked: 2,
      modelErrorsMasked: 1,
      heartbeatsDeleted: 2,
      rateLimitBucketsDeleted: 2,
      escalationsAudited: 1,
    });
    expect(w.audits.map((a) => a.action).slice(-2)).toEqual(["model-escalation", "retention"]);
    expect(w.audits.at(-1)).toMatchObject({
      actorId: "system:retention",
      entity: "AgentRun",
      entityId: null,
      meta: { ...s, cursors: { auditFreeText: NOW.toISOString(), modelCallErrors: NOW.toISOString() }, windows: { agentRunInputsDays: 30, onboardingCopyDays: 30, heartbeatDays: 7, rateLimitBucketGraceDays: 1 } },
    });
    // A second run the same night changes nothing but still records that it ran.
    expect(await runRetention(w.db, NOW)).toMatchObject({ agentRunInputsCleared: 0, onboardingCopiesCleared: 0, auditNotesMasked: 0, modelErrorsMasked: 0, heartbeatsDeleted: 0, rateLimitBucketsDeleted: 0, escalationsAudited: 0 });
    expect(w.audits.filter((a) => a.action === "retention")).toHaveLength(2);
    // The only deletes are the heartbeat and rate-limit bucket purges (scripts/lib/guards.ts NO_DELETE_EXEMPTIONS).
    expect(w.log.filter((l) => /delete/i.test(l))).toEqual(["activityHeartbeat.deleteMany", "rateLimitBucket.deleteMany", "activityHeartbeat.deleteMany", "rateLimitBucket.deleteMany"]);
  });

  it("the class-A copies the docs promise to clear are cleared (audit PoC retention-gaps, finding #20)", async () => {
    // Ported from .audit-sec/dpdp/retention-gaps.test.ts: only AgentRun.inputs and heartbeats were touched.
    const YEARS_AGO = new Date("2019-01-01T00:00:00.000Z");
    const w = new RetentionWorld();
    w.runs.push({ id: "run-old", inputs: { purchases: [{ supplierPan: "CDEPS7777K" }] }, inputsPurgeAt: null, startedAt: YEARS_AGO, figures: {}, status: "APPROVED" });
    w.beats.push({ id: "b-old", userId: "u1", at: YEARS_AGO, source: "lms" });
    w.onboarding.push({ id: "ob-old", prompt: "Onboard Kiran Kumar, PAN ABCPK1234F, phone 9876543210", spec: { pan: "ABCPK1234F" }, plan: { jobs: 1 }, status: "DONE", firmClientId: "fc-1", updatedAt: YEARS_AGO });
    w.calls.push({ id: "mc-old", runId: "run-old", agent: "gst", task: "x", provider: "claude", tier: "SMART", escalationLevel: 0, status: "PROVIDER_ERROR", escalated: false, createdAt: YEARS_AGO, error: "rejected: PAN ABCPK1234F" });
    w.audits.push({ id: "a-comment", actorId: "u1", action: "comment", entity: "AgentRun", entityId: "run-old", meta: { text: "Kiran Kumar PAN ABCPK1234F is wrong" }, createdAt: YEARS_AGO });
    await runRetention(w.db, NOW);
    expect(w.runs[0].inputs).toBeNull();
    expect(w.beats).toHaveLength(0);
    expect(w.onboarding[0]).toMatchObject({ id: "ob-old", prompt: ONBOARDING_CLEARED, spec: { cleared: true }, plan: null, status: "DONE" });
    expect(JSON.stringify([w.onboarding, w.calls, w.audits])).not.toContain("ABCPK1234F");
    expect(w.audits.find((a) => a.id === "a-comment")).toMatchObject({ action: "comment", entityId: "run-old" });
  });
});

describe("GET /api/cron/firm-os/retention", () => {
  const state = vi.hoisted(() => ({ world: null as unknown as RetentionWorld }));
  vi.mock("@/lib/prisma", () => ({ get prisma() { return state.world.db; } }));
  const req = (auth?: string) => new NextRequest("http://x/api/cron/firm-os/retention", { headers: auth ? { authorization: auth } : {} });

  beforeEach(() => {
    state.world = seeded();
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("401 without the secret, and nothing is touched", async () => {
    const { GET } = await import("@/app/api/cron/firm-os/retention/route");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(state.world.log).toEqual([]);
  });

  it("with the secret: runs retention and returns the summary", async () => {
    const { GET } = await import("@/app/api/cron/firm-os/retention/route");
    const r = await GET(req("Bearer s3cret-value"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      at: NOW.toISOString(),
      agentRunInputsCleared: 3,
      onboardingCopiesCleared: 3,
      auditNotesMasked: 2,
      modelErrorsMasked: 1,
      heartbeatsDeleted: 2,
      rateLimitBucketsDeleted: 2,
      escalationsAudited: 1,
    });
    expect(state.world.beats).toHaveLength(3);
  });
});
