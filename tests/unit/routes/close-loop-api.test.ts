// /api/firm-os/jobs/[id]/{filed,turia-close,state} and /api/cron/firm-os/close-loop:
// auth → zod → one lib call → JSON, over the in-memory close-loop world (real lib code).
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloseLoopDeps } from "@/lib/close-loop/actions";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { CloseLoopWorld } from "../../fakes/close-loop-world";
import { activeSession } from "./harness";

let deps: CloseLoopDeps;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/close-loop/defaults", () => ({ closeLoopDeps: () => deps }));

const { auth } = await import("@/lib/auth");
const filed = (await import("@/app/api/firm-os/jobs/[id]/filed/route")).POST;
const turiaClose = (await import("@/app/api/firm-os/jobs/[id]/turia-close/route")).POST;
const state = (await import("@/app/api/firm-os/jobs/[id]/state/route")).POST;
const cron = (await import("@/app/api/cron/firm-os/close-loop/route")).GET;

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const priya = () => activeSession({ id: "u-priya" });
const req = (body: unknown) =>
  new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let w: CloseLoopWorld;
beforeEach(() => {
  w = new CloseLoopWorld();
  const manual = new ManualBridge(w.turiaRepo);
  deps = { db: w.db, verifier: w.verifier, turia: manual, manual, copyToFinal: async () => ({ copied: 1 }) };
  signedIn(priya());
});

function approvedJob() {
  const job = w.addJob({ state: "APPROVED", ackRef: null, filedAt: null, filedById: null });
  w.addFinal(job);
  return job;
}

describe("job routes — access and validation", () => {
  const routes = {
    filed: [filed, { ackRef: "AA1" }],
    "turia-close": [turiaClose, { turiaTaskRef: "TT-1", minutes: 30 }],
    state: [state, { to: "IN_PREP", expectedState: "ASSIGNED" }],
  } as const;

  for (const [name, [route, body]] of Object.entries(routes)) {
    it(`${name}: 401 signed out, 403 inactive, 403 staff not on the job, 404 unknown job`, async () => {
      const job = approvedJob();
      signedIn(null);
      expect((await route(req(body), ctx(job.id))).status).toBe(401);
      signedIn(activeSession({ id: "u-priya", active: false }));
      expect((await route(req(body), ctx(job.id))).status).toBe(403);
      signedIn(activeSession({ id: "u-other" }));
      const r = await route(req(body), ctx(job.id));
      expect(r.status).toBe(403);
      expect((await r.json()).error).toMatch(/assignee or reviewer, a manager or a partner/);
      signedIn(priya());
      expect((await route(req(body), ctx("missing-job"))).status).toBe(404);
      expect(w.job(job.id).state).toBe("APPROVED");
    });

    it(`${name}: 400 for a bad id or body`, async () => {
      const job = approvedJob();
      expect((await route(req(body), ctx("../etc"))).status).toBe(400);
      expect((await route(req("not json"), ctx(job.id))).status).toBe(400);
    });
  }

  it("turia-close: minutes must be a whole number above 0", async () => {
    const job = approvedJob();
    for (const minutes of [0, -5, 1.5, "30", 6001]) {
      const r = await turiaClose(req({ turiaTaskRef: "TT", minutes }), ctx(job.id));
      expect(r.status).toBe(400);
    }
    const noRef = await turiaClose(req({ minutes: 10 }), ctx(job.id));
    expect((await noRef.json()).error).toMatch(/Turia task ref/);
  });
});

describe("DONE cannot be set through the API", () => {
  it("state route: to DONE → 403 gate-required, for a partner too; nothing changes", async () => {
    const { job } = w.readyJob();
    signedIn(activeSession({ id: "u-partner", level: "PARTNER" }));
    const r = await state(req({ to: "DONE", expectedState: "CLOSING" }), ctx(job.id));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "gate-required", error: expect.stringMatching(/only by the close gate/) });
    expect(w.job(job.id).state).toBe("CLOSING");
    expect(w.events.some((e) => e.toState === "DONE")).toBe(false);
  });

  it("no other body field reaches DONE (unknown fields are ignored, the state enum is closed)", async () => {
    const { job } = w.readyJob();
    expect((await filed(req({ ackRef: "A", state: "DONE" }), ctx(job.id))).status).toBe(409); // CLOSING is not APPROVED
    expect((await state(req({ to: "done", expectedState: "CLOSING" }), ctx(job.id))).status).toBe(400);
    expect(w.job(job.id).state).toBe("CLOSING");
  });

  it("state route: FILED_BY_HUMAN is 400 (use /filed); an illegal edge is 409", async () => {
    const job = approvedJob();
    expect((await state(req({ to: "FILED_BY_HUMAN", expectedState: "APPROVED" }), ctx(job.id))).status).toBe(400);
    expect((await state(req({ to: "IN_PREP", expectedState: "APPROVED" }), ctx(job.id))).status).toBe(409);
  });
});

describe("golden path through the routes", () => {
  it("filed (ARN) → CLOSING; turia-close → DONE", async () => {
    const job = approvedJob();
    const f = await filed(req({ ackRef: "AA2710260012345" }), ctx(job.id));
    expect(f.status).toBe(200);
    expect(await f.json()).toMatchObject({ state: "CLOSING", ackRef: "AA2710260012345", turia: { status: "needs-input" } });

    const t = await turiaClose(req({ turiaTaskRef: "TT-77", minutes: 90 }), ctx(job.id));
    expect(t.status).toBe(200);
    expect(await t.json()).toMatchObject({ turia: { status: "CLOSED", minutesLogged: 90 }, close: { ok: true, state: "DONE" } });
    expect(w.job(job.id).state).toBe("DONE");
  });

  it("filed without the ARN for GST → 400; a second Turia ref → 409", async () => {
    const job = approvedJob();
    expect((await filed(req({}), ctx(job.id))).status).toBe(400);
    await filed(req({ ackRef: "AA1" }), ctx(job.id));
    await turiaClose(req({ turiaTaskRef: "TT-1", minutes: 5 }), ctx(job.id));
    const j2 = w.addJob();
    w.addFiledHistory(j2.id);
    await turiaClose(req({ turiaTaskRef: "TT-2", minutes: 5 }), ctx(j2.id));
    expect((await turiaClose(req({ turiaTaskRef: "TT-3", minutes: 5 }), ctx(j2.id))).status).toBe(409);
  });

  it("unexpected errors are not swallowed (500 via Next)", async () => {
    const job = approvedJob();
    deps = { ...deps, db: { ...w.db, jobTask: { ...w.db.jobTask, findFirst: async () => Promise.reject(new Error("db down")) } } };
    await expect(filed(req({ ackRef: "A" }), ctx(job.id))).rejects.toThrow("db down");
  });
});

describe("/api/cron/firm-os/close-loop", () => {
  const cronReq = (auth?: string) => new NextRequest("http://x/api/cron/firm-os/close-loop", { headers: auth ? { authorization: auth } : {} });
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("401 without or with a wrong bearer, and when CRON_SECRET is unset", async () => {
    vi.setSystemTime(new Date("2026-11-02T05:00:00Z"));
    expect((await cron(cronReq())).status).toBe(401);
    expect((await cron(cronReq("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron(cronReq("Bearer "))).status).toBe(401);
    expect(w.audits).toEqual([]);
  });

  it("out of hours: 200 no-op", async () => {
    w.readyJob();
    vi.setSystemTime(new Date("2026-11-08T05:00:00Z")); // Sunday
    const r = await cron(cronReq("Bearer s3cret-value"));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ skipped: "outside-working-hours" });
    expect(w.job(w.jobs[0].id).state).toBe("CLOSING");
  });

  it("in hours: closes ready jobs; a second firing changes nothing more", async () => {
    const { job } = w.readyJob();
    const held = w.addJob({ filedAt: new Date("2026-11-02T04:00:00Z") });
    w.addFiledHistory(held.id, new Date("2026-11-02T04:00:00Z"));
    w.addFinal(held);
    vi.setSystemTime(new Date("2026-11-02T05:00:00Z")); // Mon 10:30 IST
    const r = await cron(cronReq("Bearer s3cret-value"));
    expect(await r.json()).toMatchObject({ closed: [job.id], reminders: 1 });
    const r2 = await cron(cronReq("Bearer s3cret-value"));
    expect(await r2.json()).toMatchObject({ closed: [], reminders: 0, escalations: 0 });
    expect(w.coach).toHaveLength(1);
    // One summary AuditEvent for the run that changed something; none for the quiet second run.
    const summaries = w.audits.filter((a) => a.action === "reconcile");
    expect(summaries).toEqual([expect.objectContaining({ actorId: "system:close-loop-reconciler", entity: "JobTask", meta: expect.objectContaining({ closed: [job.id], reminders: 1 }) })]);
  });
});
