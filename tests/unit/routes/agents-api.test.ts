// /api/firm-os/agents/** route handlers: auth (401/403) → zod (400) → service → JSON, against the
// in-memory echo world (real service, real runner, fake SharePoint).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { echoWorld, rows, user, type World } from "../../fakes/agent-world";
import { recordingHook } from "../../fakes/agent-close-loop";

const state = vi.hoisted(() => ({ world: null as unknown as World, hook: null as unknown as ReturnType<typeof recordingHook> }));

// The agent-run rate limit (src/lib/hardening/rate-limit.ts) counts in RateLimitBucket through the
// app's Prisma client: the upsert returns the count after this request (1 unless a test says otherwise).
const bucket = vi.hoisted(() => ({ count: 1, windowStart: new Date() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: async () => [{ count: bucket.count, windowStart: bucket.windowStart }] } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/agents/service", async (orig) => ({ ...(await orig<typeof import("@/lib/agents/service")>()), defaultAgentDeps: async () => state.world.deps }));
// The routes inject the close-loop hook; here it is the real afterTransition over the world.
vi.mock("@/lib/close-loop/defaults", async (orig) => ({
  ...(await orig<typeof import("@/lib/close-loop/defaults")>()),
  withCloseLoopHook: (d: World["deps"]) => ({ ...d, afterTransition: state.hook.hook }),
}));

const { auth } = await import("@/lib/auth");
const run = await import("@/app/api/firm-os/agents/[agent]/jobs/[jobId]/run/route");
const submit = await import("@/app/api/firm-os/agents/runs/[id]/submit/route");
const changes = await import("@/app/api/firm-os/agents/runs/[id]/request-changes/route");
const rerun = await import("@/app/api/firm-os/agents/runs/[id]/rerun/route");
const { rerunBody, requestRerun } = await import("@/app/agents/[agent]/runs/[id]/ReviewPanels");
const approve = await import("@/app/api/firm-os/agents/runs/[id]/approve/route");
const finalize = await import("@/app/api/firm-os/agents/runs/[id]/finalize/route");
const comments = await import("@/app/api/firm-os/agents/runs/[id]/comments/route");
const mistakes = await import("@/app/api/firm-os/agents/runs/[id]/mistakes/route");
const download = await import("@/app/api/firm-os/agents/deliverables/[id]/route");
const preview = await import("@/app/api/firm-os/agents/deliverables/[id]/preview/route");
const decide = await import("@/app/api/firm-os/agents/mistakes/[id]/decide/route");

const as = (u: Session["user"] | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? { user: u, expires: "2099-01-01" } : null);
const post = (body?: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) });
const runJob = () => run.POST(post(), p({ agent: "echo", jobId: "job-1" }));

beforeEach(() => {
  state.world = echoWorld();
  state.hook = recordingHook(state.world);
});
afterEach(() => vi.clearAllMocks());

describe("auth", () => {
  it("401 when signed out, 403 when deactivated", async () => {
    as(null);
    expect((await runJob()).status).toBe(401);
    expect((await approve.POST(post({}), p({ id: "run-1" }))).status).toBe(401);
    expect((await download.GET(new Request("http://x"), p({ id: "d" }))).status).toBe(401);
    as(user("priya", { active: false }));
    expect((await runJob()).status).toBe(403);
    expect((await decide.POST(post({ decision: "approve" }), p({ id: "m" }))).status).toBe(403);
  });

  it("403 when the person may see the job but not take the action", async () => {
    as(user("ravi"));
    expect((await runJob()).status).toBe(403);
    as(user("priya"));
    expect((await runJob()).status).toBe(201);
    await submit.POST(post(), p({ id: "run-1" }));
    // The assignee approving their own pack.
    const r = await approve.POST(post({}), p({ id: "run-1" }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Only the reviewer, a manager or a partner may approve/);
    // Staff deciding a mistake rule.
    as(user("ravi"));
    expect((await decide.POST(post({ decision: "approve" }), p({ id: "nope" }))).status).toBe(403);
  });

  it("404 for someone not on the job (nothing leaks)", async () => {
    as(user("priya"));
    await runJob();
    as(user("outsider"));
    expect((await submit.POST(post(), p({ id: "run-1" }))).status).toBe(404);
    const id = rows(state.world.db, "deliverable")[0].id as string;
    expect((await download.GET(new Request("http://x"), p({ id }))).status).toBe(404);
    expect((await preview.GET(new Request("http://x"), p({ id }))).status).toBe(404);
  });
});

describe("rate limit (429)", () => {
  it("over the agent-run limit: run, re-run and request changes get 429 with Retry-After and start no run; reads are not limited", async () => {
    as(user("priya"));
    expect((await runJob()).status).toBe(201);
    await submit.POST(post(), p({ id: "run-1" }));
    bucket.count = 21;
    bucket.windowStart = new Date(Date.now() - 59 * 60_000 - 30_000); // 30 s left in the hour
    try {
      const r = await runJob();
      expect(r.status).toBe(429);
      expect(r.headers.get("Retry-After")).toBe("30");
      expect((await r.json()).error).toMatch(/You have made too many agent runs in an hour \(the limit is 20\)\. Wait 1 minute, then try again\./);
      as(user("ravi"));
      expect((await changes.POST(post({ note: "Recheck INV-2" }), p({ id: "run-1" }))).status).toBe(429);
      as(user("priya"));
      expect((await rerun.POST(post({ note: "again" }), p({ id: "run-1" }))).status).toBe(429);
      expect(rows(state.world.db, "agentRun")).toHaveLength(1);
      const id = rows(state.world.db, "deliverable")[0].id as string;
      expect((await preview.GET(new Request("http://x"), p({ id }))).status).toBe(200);
    } finally {
      bucket.count = 1;
    }
  });
});

describe("validation (400)", () => {
  it.each([
    ["request-changes without a note", () => changes.POST(post({ note: " " }), p({ id: "run-1" }))],
    ["request-changes with junk JSON", () => changes.POST(post("{not json"), p({ id: "run-1" }))],
    ["rerun without a note", () => rerun.POST(post({ note: "  " }), p({ id: "run-1" }))],
    ["rerun with an unknown field", () => rerun.POST(post({ note: "Use the new register", submitToPortal: true }), p({ id: "run-1" }))],
    ["approve with an unknown field", () => approve.POST(post({ note: "x", submitToPortal: true }), p({ id: "run-1" }))],
    ["comment empty", () => comments.POST(post({ text: "" }), p({ id: "run-1" }))],
    ["mistake without a rule", () => mistakes.POST(post({ finding: "missed it" }), p({ id: "run-1" }))],
    ["decide with a bad decision", () => decide.POST(post({ decision: "maybe" }), p({ id: "m" }))],
  ])("%s", async (_n, call) => {
    as(user("meera"));
    const r = await call();
    expect(r.status).toBe(400);
    expect(typeof (await r.json()).error).toBe("string");
  });
});

describe("happy paths", () => {
  it("run → submit → request changes → submit → approve → files; comments, preview, download, mistakes", async () => {
    as(user("priya"));
    expect(await (await runJob()).json()).toEqual({ runId: "run-1", status: "AGENT_DONE" });
    expect((await submit.POST(post(), p({ id: "run-1" }))).status).toBe(200);
    as(user("ravi"));
    const ch = await changes.POST(post({ note: "Recheck INV-2" }), p({ id: "run-1" }));
    expect(await ch.json()).toEqual({ runId: "run-2", status: "AGENT_DONE" });
    expect((await comments.POST(post({ text: "Looks fine now" }), p({ id: "run-2" }))).status).toBe(201);
    const id = rows(state.world.db, "deliverable").at(-1)!.id as string;
    const pv = await preview.GET(new Request("http://x"), p({ id }));
    expect((await pv.json()).sheets.map((s: { name: string }) => s.name)).toEqual(["Register", "Summary"]);
    const dl = await download.GET(new Request("http://x"), p({ id }));
    expect(dl.status).toBe(200);
    expect(dl.headers.get("Content-Disposition")).toBe('attachment; filename="ACME01_Echo-register_2026-10_v2.xlsx"');
    expect(dl.headers.get("Content-Type")).toContain("spreadsheetml");
    expect((await dl.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const m = await mistakes.POST(
      post({ finding: "Should flag amounts over ₹20,000", ruleProposal: { id: "echo.big", title: "Big", severity: "warn", kind: "deterministic", check: "echo.amount-over", evidence: "row", params: { limitPaise: 2000000 } } }),
      p({ id: "run-2" }),
    );
    expect(m.status).toBe(201);
    as(user("priya"));
    expect((await submit.POST(post(), p({ id: "run-2" }))).status).toBe(200);
    as(user("ravi"));
    const ap = await approve.POST(post({ note: null }), p({ id: "run-2" }));
    expect(await ap.json()).toEqual({ state: "APPROVED", final: ["ACME01_Echo-register_2026-10_v2.xlsx"] });
    // The approve route fired the close-loop hook once (it made the Final copy); the routes' other
    // transitions went through it with nothing to do.
    const fired = state.hook.hook.mock.calls.map((c) => `${c[0].from}→${c[0].to}`);
    expect(fired).toEqual(["AGENT_DONE→IN_REVIEW", "IN_REVIEW→IN_PREP", "AGENT_DONE→IN_REVIEW", "IN_REVIEW→APPROVED"]);
    expect(state.hook.outcomes.at(-1)).toEqual({ hook: "approved", result: { status: "copied", copied: 1 } });
    expect((await finalize.POST(post(), p({ id: "run-2" }))).status).toBe(200);
    expect(rows(state.world.db, "deliverable").filter((d) => d.kind === "Final")).toHaveLength(1);
    as(user("partner"));
    const mid = rows(state.world.db, "mistakeLog")[0].id as string;
    expect(await (await decide.POST(post({ decision: "approve" }), p({ id: mid }))).json()).toEqual({ status: "APPROVED", promotedToVersion: "1.1.0" });
  });
});

describe("re-run with a note from AGENT_DONE", () => {
  /** A mocked call() that hands the request to the real rerun route handler, as fetch would. */
  const send = vi.fn(async (url: string, body?: unknown) => {
    const m = /^\/api\/firm-os\/agents\/runs\/([^/]+)\/rerun$/.exec(url);
    if (!m) throw new Error(`unexpected url ${url}`);
    const res = await rerun.POST(post(body), p({ id: decodeURIComponent(m[1]) }));
    const data = (await res.json()) as Record<string, unknown>;
    return { ok: res.ok, error: res.ok ? null : String(data.error), data };
  });
  const job = () => rows(state.world.db, "jobTask")[0];
  const runRow = (id: string) => rows(state.world.db, "agentRun").find((r) => r.id === id)!;

  it("the assignee re-runs with a note: AGENT_DONE → IN_PREP (note on the event), then attempt 2 with that note; the old run is kept", async () => {
    as(user("priya"));
    await runJob();
    const r = await rerun.POST(post({ note: "Use the corrected register" }), p({ id: "run-1" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ runId: "run-2", status: "AGENT_DONE" });
    expect(job().state).toBe("AGENT_DONE");
    const events = rows(state.world.db, "jobTaskEvent").map((e) => `${e.fromState}→${e.toState}${e.note ? ` (${e.note})` : ""}`);
    expect(events).toContain("AGENT_DONE→IN_PREP (Use the corrected register)");
    expect(runRow("run-2")).toMatchObject({ attempt: 2, reviewNotes: "Use the corrected register", status: "AGENT_DONE" });
    expect(runRow("run-1")).toMatchObject({ status: "AGENT_DONE", reviewNotes: null }); // kept as it was, for the record
    expect(state.hook.hook.mock.calls.map((c) => `${c[0].from}→${c[0].to}`)).toEqual(["AGENT_DONE→IN_PREP"]);
    // The superseded run cannot be re-run again.
    const again = await rerun.POST(post({ note: "Once more" }), p({ id: "run-1" }));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/newer run exists/);
  });

  it("managers and partners may re-run; the reviewer (staff), admin and outsiders may not; not after submit", async () => {
    as(user("priya"));
    await runJob();
    as(user("ravi"));
    const reviewer = await rerun.POST(post({ note: "Recheck" }), p({ id: "run-1" }));
    expect(reviewer.status).toBe(403);
    expect((await reviewer.json()).error).toMatch(/Only the assignee, a manager or a partner/);
    as(user("admin"));
    expect((await rerun.POST(post({ note: "Recheck" }), p({ id: "run-1" }))).status).toBe(403);
    as(user("outsider"));
    expect((await rerun.POST(post({ note: "Recheck" }), p({ id: "run-1" }))).status).toBe(404);
    expect(job().state).toBe("AGENT_DONE");
    as(user("meera"));
    expect(await (await rerun.POST(post({ note: "Manager: recheck INV-2" }), p({ id: "run-1" }))).json()).toEqual({ runId: "run-2", status: "AGENT_DONE" });
    as(user("partner"));
    expect(await (await rerun.POST(post({ note: "Partner: recheck INV-3" }), p({ id: "run-2" }))).json()).toEqual({ runId: "run-3", status: "AGENT_DONE" });
    as(user("priya"));
    await submit.POST(post(), p({ id: "run-3" }));
    const late = await rerun.POST(post({ note: "Too late" }), p({ id: "run-3" }));
    expect(late.status).toBe(409); // IN_REVIEW: the reviewer requests changes instead
    expect(job().state).toBe("IN_REVIEW");
  });

  it("the review bar's re-run goes through the route (mocked call); a missing note never reaches it", async () => {
    as(user("priya"));
    await runJob();
    expect(rerunBody("  ")).toEqual({ ok: false, error: "Say why the agent is being re-run" });
    expect(rerunBody("ok")).toEqual({ ok: false, error: "Say why the agent is being re-run" });
    expect(await requestRerun("run-1", " ", send)).toEqual({ ok: false, error: "Say why the agent is being re-run" });
    expect(send).not.toHaveBeenCalled();
    expect(await requestRerun("run-1", "  Use the corrected register ", send)).toEqual({ ok: true, runId: "run-2" });
    expect(send).toHaveBeenCalledWith("/api/firm-os/agents/runs/run-1/rerun", { note: "Use the corrected register" });
    as(user("ravi"));
    expect(await requestRerun("run-2", "Reviewer tries", send)).toEqual({ ok: false, error: expect.stringMatching(/Only the assignee, a manager or a partner/) });
  });
});
