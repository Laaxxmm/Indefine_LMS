// GET /api/firm-os/workspace/next-task: NextTaskView JSON for the signed-in person; 401 signed out,
// 403 without agents access or with the Agents module switched off (plain sentences).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { echoWorld, user, type World } from "../../fakes/agent-world";
import { NextTaskViewZ } from "@/lib/workspace/contract";

const state = vi.hoisted(() => ({ world: null as unknown as World, setting: null as null | Record<string, unknown> }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return Object.assign(Object.create(state.world.db), {
      workspaceSetting: { findUnique: async () => state.setting },
      roleWorkspaceDefault: { findUnique: async () => null },
    });
  },
}));

const { auth } = await import("@/lib/auth");
const { GET } = await import("@/app/api/firm-os/workspace/next-task/route");
const as = (u: ReturnType<typeof user> | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? { user: u, expires: "2099-01-01" } : null);

beforeEach(() => {
  state.world = echoWorld();
  state.setting = null;
  vi.stubEnv("FIRM_OS_ECHO_AGENT", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/firm-os/workspace/next-task", () => {
  it("returns the contract for the assignee, uncached", async () => {
    as(user("priya"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = NextTaskViewZ.parse(await res.json());
    expect(body.status).toBe("task");
    expect(body.task!.action.kind).toBe("run-agent");
  });

  it("clear when nothing waits", async () => {
    as(user("outsider"));
    expect(NextTaskViewZ.parse(await (await GET()).json())).toMatchObject({ status: "clear", task: null, remaining: 0 });
  });

  it("401 signed out; 403 inactive; 403 with the Agents module off — plain sentences", async () => {
    as(null);
    let res = await GET();
    expect(res.status).toBe(401);
    as(user("priya", { active: false }));
    res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Your account cannot use agents. Ask an admin if you need them." });
    as(user("priya"));
    state.setting = { modules: ["search"], focusMode: null, companionEnabled: false };
    res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Agents is turned off for your account. If you need it, ask an admin to turn it on in Workspace settings." });
  });
});
