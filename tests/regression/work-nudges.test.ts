// LMS regression (Phase 12 §4): the /work nudge cron (/api/cron/work) behaves as before Firm OS —
// bearer-secret only, morning nudge names the people with open tasks and no pick (weekdays only),
// Friday nudge names who has not reviewed the week, wording and links unchanged — and the Firm OS
// close-loop cron shares the same secret handshake. The Teams post is captured, never sent.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const state = vi.hoisted(() => ({
  users: [] as { id: string; email: string; name: string }[],
  openTasks: {} as Record<string, number>,
  picks: {} as Record<string, number>,
  reviewed: [] as string[],
  posts: [] as string[],
}));

vi.mock("@/lib/work/teams", () => ({
  postTechWorkMessage: async (text: string) => {
    state.posts.push(text);
    return { ok: true };
  },
}));
vi.mock("@/lib/prisma", async () => {
  const { prismaMock } = await import("../unit/routes/harness");
  const where = (a: unknown) => (a as { where: Record<string, unknown> }).where;
  return {
    prisma: new Proxy({}, {
      get: (_t, key: string | symbol) => {
        if (key === "user") return { findMany: async () => state.users };
        if (key === "workTask") return { count: async (a: unknown) => state.openTasks[String(where(a).assigneeId)] ?? 0 };
        if (key === "dayPick") return { count: async (a: unknown) => state.picks[String(where(a).userId)] ?? 0 };
        if (key === "weekReview") return { findMany: async () => state.reviewed.map((userId) => ({ userId })) };
        return (prismaMock as Record<string | symbol, unknown>)[key];
      },
    }),
  };
});

const { GET } = await import("@/app/api/cron/work/route");
const SECRET = "test cron secret"; // placeholder with spaces (verify:secrets)
const call = (job: string, auth: string | null = `Bearer ${SECRET}`) =>
  GET(new NextRequest(`https://lms.indefine.in/api/cron/work?job=${job}`, { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("WORK_TRACKER_EMAILS", "lead@indefine.test,second@indefine.test");
  state.users = [
    { id: "u-lead", email: "lead@indefine.test", name: "Lakshmanan A" },
    { id: "u-2", email: "second@indefine.test", name: "Sowmya R" },
  ];
  state.openTasks = {};
  state.picks = {};
  state.reviewed = [];
  state.posts = [];
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/api/cron/work", () => {
  it("refuses callers without the bearer secret (and the query-string form)", async () => {
    vi.setSystemTime(new Date("2026-11-04T03:30:00Z"));
    expect((await call("morning", null)).status).toBe(401);
    expect((await call("morning", "Bearer wrong")).status).toBe(401);
    const qs = await GET(new NextRequest(`https://lms.indefine.in/api/cron/work?job=morning&secret=${SECRET}`));
    expect(qs.status).toBe(401);
    expect(state.posts).toEqual([]);
  });

  it("morning (weekday): names everyone with open tasks and no pick, links /work", async () => {
    vi.setSystemTime(new Date("2026-11-04T03:30:00Z")); // Wed 09:00 IST
    state.openTasks = { "u-lead": 2, "u-2": 1 };
    const res = await call("morning");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true, missing: ["lead@indefine.test", "second@indefine.test"] });
    expect(state.posts).toEqual(["Good morning. No pick for today yet: Lakshmanan and Sowmya. https://lms.indefine.in/work"]);
  });

  it("morning: nobody to nudge → nothing posted; weekend → skipped", async () => {
    vi.setSystemTime(new Date("2026-11-04T03:30:00Z"));
    state.openTasks = { "u-lead": 2 };
    state.picks = { "u-lead": 1 };
    expect(await (await call("morning")).json()).toEqual({ sent: false, missing: [] });
    vi.setSystemTime(new Date("2026-11-07T03:30:00Z")); // Sat
    expect(await (await call("morning")).json()).toEqual({ skipped: "weekend" });
    expect(state.posts).toEqual([]);
  });

  it("friday: names whoever has not reviewed the week, links /work/week", async () => {
    vi.setSystemTime(new Date("2026-11-06T10:30:00Z")); // Fri 16:00 IST
    state.reviewed = ["u-lead"];
    expect(await (await call("friday")).json()).toEqual({ sent: true, missing: ["second@indefine.test"] });
    expect(state.posts).toEqual(["Week review still pending: Sowmya. https://lms.indefine.in/work/week"]);
  });

  it("an unknown job is a 400", async () => {
    expect((await call("noon")).status).toBe(400);
  });
});

describe("Firm OS cron uses the same handshake", () => {
  it("/api/cron/firm-os/close-loop refuses a caller without the bearer secret", async () => {
    const { GET: closeLoop } = await import("@/app/api/cron/firm-os/close-loop/route");
    const res = await closeLoop(new NextRequest("https://lms.indefine.in/api/cron/firm-os/close-loop"));
    expect(res.status).toBe(401);
  });
});
