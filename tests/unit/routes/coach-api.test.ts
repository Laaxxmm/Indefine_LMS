// /api/firm-os/coach/{heartbeat,preferences,events/[id]/dismiss} and /api/cron/firm-os/coach:
// auth → zod → one coach call → JSON, over the in-memory coach world (real lib code).
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachWorld } from "../../fakes/coach-world";
import { activeSession } from "./harness";

let w: CoachWorld;
let now = new Date("2026-11-04T09:00:00+05:30");
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/agents/coach/defaults", () => ({ coachDb: () => w.db, coachDeps: () => ({ db: w.db, now: () => now }) }));

const { auth } = await import("@/lib/auth");
const heartbeat = (await import("@/app/api/firm-os/coach/heartbeat/route")).POST;
const preferences = (await import("@/app/api/firm-os/coach/preferences/route")).POST;
const dismiss = (await import("@/app/api/firm-os/coach/events/[id]/dismiss/route")).POST;
const cron = (await import("@/app/api/cron/firm-os/coach/route")).GET;

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const req = (body?: unknown) =>
  new Request("http://x/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const cronReq = (job: string | null, secret: string | null = "s3cret") =>
  new NextRequest(`http://x/api/cron/firm-os/coach${job ? `?job=${job}` : ""}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

beforeEach(() => {
  w = new CoachWorld();
  now = new Date("2026-11-04T09:00:00+05:30");
  signedIn(activeSession({ id: "u-priya" }));
  vi.stubEnv("FIRM_OS_BREAK_NUDGE", "1");
  vi.stubEnv("CRON_SECRET", "s3cret");
});
afterEach(() => vi.unstubAllEnvs());

describe("access", () => {
  const calls = {
    heartbeat: () => heartbeat(req({})),
    preferences: () => preferences(req({ morningBoard: false })),
    dismiss: () => dismiss(req(), ctx("coach-1")),
  };
  for (const [name, call] of Object.entries(calls)) {
    it(`${name}: 401 signed out, 403 inactive`, async () => {
      signedIn(null);
      expect((await call()).status).toBe(401);
      signedIn(activeSession({ id: "u-priya", active: false }));
      expect((await call()).status).toBe(403);
      expect(w.activityHeartbeat.rows).toEqual([]);
      expect(w.coachPreference.rows).toEqual([]);
    });
  }
});

describe("heartbeat", () => {
  it("stores who and when for the signed-in person; takes no data", async () => {
    const r = await heartbeat(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ recorded: true, nudge: null });
    expect(w.activityHeartbeat.rows).toEqual([expect.objectContaining({ userId: "u-priya", source: "lms" })]);
    for (const body of [{ url: "/clients/42" }, "not json", [1]]) expect((await heartbeat(req(body))).status).toBe(400);
  });

  it("stores nothing with the flag off", async () => {
    vi.stubEnv("FIRM_OS_BREAK_NUDGE", "");
    expect(await (await heartbeat(req({}))).json()).toEqual({ recorded: false, nudge: null });
    expect(w.activityHeartbeat.rows).toEqual([]);
  });
});

describe("preferences", () => {
  it("saves the person's own choices; 400 for unknown fields, bad snooze, or nothing", async () => {
    const r = await preferences(req({ breakNudges: false, morningBoard: false }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ breakNudges: false, morningBoard: false, snoozeUntil: null });
    expect(w.coachPreference.rows).toEqual([expect.objectContaining({ userId: "u-priya", breakNudges: false })]);
    for (const body of [{ userId: "u-meena", breakNudges: false }, { snoozeMinutes: 45 }, { snoozeMinutes: 1.5 }, {}, "x"]) {
      expect((await preferences(req(body))).status).toBe(400);
    }
  });
});

describe("dismiss", () => {
  it("own notice → 200; someone else's → 404; bad id → 400", async () => {
    const mine = w.coachEvent.insert({ userId: "u-priya", kind: "board", dedupeKey: "a" });
    const theirs = w.coachEvent.insert({ userId: "u-meena", kind: "summary", dedupeKey: "b" });
    expect((await dismiss(req(), ctx(String(mine.id)))).status).toBe(200);
    expect((await dismiss(req(), ctx(String(theirs.id)))).status).toBe(404);
    expect(theirs.dismissedAt).toBeNull();
    expect((await dismiss(req(), ctx("../x"))).status).toBe(400);
  });
});

describe("cron", () => {
  it("bearer CRON_SECRET only: 401 without it, with a wrong one, or in the query string", async () => {
    expect((await cron(cronReq("morning", null))).status).toBe(401);
    expect((await cron(cronReq("morning", "wrong"))).status).toBe(401);
    expect((await cron(new NextRequest("http://x/api/cron/firm-os/coach?job=morning&secret=s3cret"))).status).toBe(401);
    expect(w.coachEvent.rows).toEqual([]);
  });

  it("400 for a missing or unknown job", async () => {
    for (const job of [null, "everything"]) {
      const r = await cron(cronReq(job));
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/^job must be morning, reminders/);
    }
  });

  it("runs the morning board and the reminders", async () => {
    w.addUser("u-priya");
    w.addUser("u-ravi");
    w.addJob({ state: "IN_PREP", internalDueOn: new Date("2026-11-03T18:30:00Z") /* 04 Nov IST */ });
    expect(await (await cron(cronReq("morning"))).json()).toMatchObject({ created: 1, channel: "in-app" });
    now = new Date("2026-11-04T16:00:00+05:30");
    expect(await (await cron(cronReq("reminders"))).json()).toMatchObject({ reminders: 1 });
    expect(w.events().map((e) => e.kind)).toEqual(["board", "reminder"]);
  });
});
