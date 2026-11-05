// /api/firm-os/agents/** route handlers: auth (401/403) → zod (400) → service → JSON, against the
// in-memory echo world (real service, real runner, fake SharePoint).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { echoWorld, rows, user, type World } from "../../fakes/agent-world";
import { recordingHook } from "../../fakes/agent-close-loop";

const state = vi.hoisted(() => ({ world: null as unknown as World, hook: null as unknown as ReturnType<typeof recordingHook> }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
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

describe("validation (400)", () => {
  it.each([
    ["request-changes without a note", () => changes.POST(post({ note: " " }), p({ id: "run-1" }))],
    ["request-changes with junk JSON", () => changes.POST(post("{not json"), p({ id: "run-1" }))],
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
