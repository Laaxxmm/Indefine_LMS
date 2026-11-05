// DPDP retention (ADR-006): AgentRun.inputs cleared after 30 days with the rows kept; only
// heartbeats older than 7 days removed; escalations mirrored; one AuditEvent per run; the cron
// route needs the secret.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { EscalationDb } from "@/lib/audit/escalations";
import { RetentionWorld } from "../../../tests/fakes/retention-world";
import { AGENT_RUN_INPUTS_DAYS, HEARTBEAT_DAYS, clearExpiredAgentRunInputs, purgeExpiredHeartbeats, runRetention, type RetentionDb } from "./retention";

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
  w.calls.push({ id: "mc-1", runId: "run-1", agent: "gst", task: "gst.extract", provider: "claude", tier: "SMART", escalationLevel: 1, status: "OK", escalated: true, createdAt: ago(1) });
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

describe("ActivityHeartbeat (7 days)", () => {
  it("removes only heartbeats older than 7 days", async () => {
    const w = seeded();
    expect(await purgeExpiredHeartbeats(w.db, NOW)).toBe(2);
    expect(w.beats.map((b) => b.id)).toEqual(["b-7d", "b-6d", "b-now"]);
    expect(await purgeExpiredHeartbeats(w.db, NOW)).toBe(0);
  });
});

describe("runRetention", () => {
  it("runs the three steps and records one retention AuditEvent with the counts", async () => {
    const w = seeded();
    const s = await runRetention(w.db, NOW);
    expect(s).toEqual({ at: NOW.toISOString(), agentRunInputsCleared: 3, heartbeatsDeleted: 2, escalationsAudited: 1 });
    expect(w.audits.map((a) => a.action)).toEqual(["model-escalation", "retention"]);
    expect(w.audits[1]).toMatchObject({ actorId: "system:retention", entity: "AgentRun", entityId: null, meta: { ...s, windows: { agentRunInputsDays: 30, heartbeatDays: 7 } } });
    // A second run the same night changes nothing but still records that it ran.
    expect(await runRetention(w.db, NOW)).toMatchObject({ agentRunInputsCleared: 0, heartbeatsDeleted: 0, escalationsAudited: 0 });
    expect(w.audits.map((a) => a.action)).toEqual(["model-escalation", "retention", "retention"]);
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
    expect(await r.json()).toEqual({ at: NOW.toISOString(), agentRunInputsCleared: 3, heartbeatsDeleted: 2, escalationsAudited: 1 });
    expect(state.world.beats).toHaveLength(3);
  });
});
