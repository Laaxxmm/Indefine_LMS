// The workspace switch in every module layout (src/lib/workspace/guard.ts requireModule): a module
// switched off sends the person to the dashboard, which says why; the area's own role rule still
// comes first, so switching a module on never opens a door. Above both sits the Firm OS master
// switch FIRM_OS_ENABLED (default off): while it is off every Firm OS module is closed for
// everyone, the LMS works as before, and no workspace setting is read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { MODULE_KEYS, type ModuleKey } from "@/lib/workspace/registry";
import { NotFoundSignal, TEST_EMAIL, activeSession, redirectTarget, renderHtml, workspaceRow } from "./harness";

const ws = vi.hoisted(() => ({ setting: null as unknown, reads: 0 }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/prisma", async () => {
  const { prismaMock, withWorkspace } = await import("./harness");
  const setting = () => {
    ws.reads += 1;
    return ws.setting;
  };
  return { prisma: withWorkspace(prismaMock, { setting }) };
});

const { auth } = await import("@/lib/auth");
const { moduleOffNotice } = await import("@/lib/workspace/guard");
const { FIRM_OS_OFF_MESSAGE } = await import("@/lib/workspace/flag");
const { ModuleOffNotice } = await import("@/app/workspace/ModuleOffNotice");

const as = (s: Session | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
type Layout = { default: (p: { children: React.ReactNode }) => unknown };

const MANAGER = activeSession({ level: "MANAGER" }); // every module but admin; on the work allow-list
const PARTNER = activeSession({ level: "PARTNER" });
const STAFF = activeSession();
const ADMIN = activeSession({ role: "ADMIN" });
const INACTIVE = activeSession({ active: false });
const OFF_TRACKER = activeSession({ level: "MANAGER", email: "not.on.the.list@indefine.test" });

/** Every layout that gates a module, the person its role rule turns away, and where they go. */
const LAYOUTS: { path: string; key: ModuleKey; load: () => Promise<Layout>; denied: Session | null; deniedTo: string | "not-found" }[] = [
  { path: "/clients", key: "clients", load: () => import("@/app/clients/layout"), denied: INACTIVE, deniedTo: "/dashboard" },
  { path: "/tools", key: "tools", load: () => import("@/app/tools/layout"), denied: INACTIVE, deniedTo: "/dashboard" },
  { path: "/work", key: "work", load: () => import("@/app/work/layout"), denied: OFF_TRACKER, deniedTo: "not-found" },
  { path: "/onboard", key: "onboard", load: () => import("@/app/onboard/layout"), denied: STAFF, deniedTo: "/dashboard" },
  { path: "/agents", key: "agents", load: () => import("@/app/agents/layout"), denied: INACTIVE, deniedTo: "/dashboard" },
  { path: "/focus", key: "agents", load: () => import("@/app/focus/layout"), denied: INACTIVE, deniedTo: "/dashboard" },
  { path: "/workspace", key: "agents", load: () => import("@/app/workspace/layout"), denied: INACTIVE, deniedTo: "/dashboard" },
  { path: "/coach", key: "coach", load: () => import("@/app/coach/layout"), denied: INACTIVE, deniedTo: "/dashboard" },
  { path: "/comms", key: "comms", load: () => import("@/app/comms/layout"), denied: INACTIVE, deniedTo: "/dashboard" },
  { path: "/search", key: "search", load: () => import("@/app/search/layout"), denied: INACTIVE, deniedTo: "/dashboard" },
  { path: "/wizard", key: "leaderboard", load: () => import("@/app/wizard/layout"), denied: null, deniedTo: "/" },
  { path: "/leaderboard", key: "leaderboard", load: () => import("@/app/leaderboard/layout"), denied: null, deniedTo: "/" },
  { path: "/team", key: "leaderboard", load: () => import("@/app/team/layout"), denied: null, deniedTo: "/" },
  { path: "/initiatives", key: "leaderboard", load: () => import("@/app/initiatives/layout"), denied: null, deniedTo: "/" },
  { path: "/checkin", key: "leaderboard", load: () => import("@/app/checkin/layout"), denied: null, deniedTo: "/" },
  { path: "/recap", key: "leaderboard", load: () => import("@/app/recap/layout"), denied: null, deniedTo: "/" },
  { path: "/video", key: "learning", load: () => import("@/app/video/layout"), denied: null, deniedTo: "/" },
  { path: "/quiz", key: "learning", load: () => import("@/app/quiz/layout"), denied: null, deniedTo: "/" },
];
const FIRM_OS_PATHS = ["/onboard", "/agents", "/focus", "/workspace", "/coach", "/comms", "/search"];
const ALL = [...MODULE_KEYS];

async function outcome(load: () => Promise<Layout>): Promise<string> {
  const { default: Layout } = await load();
  try {
    await Layout({ children: null });
    return "open";
  } catch (e) {
    if (e instanceof NotFoundSignal) return "not-found";
    return await redirectTarget(() => {
      throw e;
    });
  }
}

beforeEach(() => {
  vi.stubEnv("WORK_TRACKER_EMAILS", `lead@indefine.test,${TEST_EMAIL}`);
  ws.setting = null;
  ws.reads = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("Firm OS switched on: the workspace settings decide", () => {
  beforeEach(() => vi.stubEnv("FIRM_OS_ENABLED", "1"));

  it.each(LAYOUTS)("$path: open with $key on; off → /dashboard?module-off=$key", async ({ key, load }) => {
    as(MANAGER);
    ws.setting = workspaceRow(ALL);
    expect(await outcome(load)).toBe("open");
    ws.setting = workspaceRow(ALL.filter((k) => k !== key));
    expect(await outcome(load)).toBe(`/dashboard?module-off=${key}`);
  });

  it.each(LAYOUTS)("$path: the area's own rule still comes first, even with $key switched on", async ({ load, denied, deniedTo }) => {
    as(denied);
    ws.setting = workspaceRow(ALL);
    expect(await outcome(load)).toBe(deniedTo);
  });

  it("/admin: an admin always keeps the admin area, whatever is saved, without a read; others go back", async () => {
    const load = () => import("@/app/admin/layout");
    as(ADMIN);
    ws.setting = workspaceRow([]);
    expect(await outcome(load)).toBe("open");
    expect(ws.reads).toBe(0);
    as(MANAGER);
    ws.setting = workspaceRow(ALL);
    expect(await outcome(load)).toBe("/dashboard");
  });

  it("/companion: only people who may pair; the dashboard explains the rest", async () => {
    const load = () => import("@/app/companion/layout");
    as(STAFF);
    expect(await outcome(load)).toBe("/dashboard?module-off=companion");
    ws.setting = workspaceRow(null, { companionEnabled: true });
    expect(await outcome(load)).toBe("open");
    ws.setting = null;
    as(PARTNER); // the companion's own rule lets partners and admins pair
    expect(await outcome(load)).toBe("open");
    as(activeSession({ level: "PARTNER", active: false }));
    expect(await outcome(load)).toBe("/dashboard?module-off=companion");
  });

  it("built-in defaults (nothing saved): staff keep the LMS and their Firm OS work, but not Clients, Comms or Onboard", async () => {
    as(STAFF);
    const open = [];
    for (const l of LAYOUTS) if ((await outcome(l.load)) === "open") open.push(l.path);
    expect(open).toEqual(["/tools", "/work", "/agents", "/focus", "/workspace", "/coach", "/search", "/wizard", "/leaderboard", "/team", "/initiatives", "/checkin", "/recap", "/video", "/quiz"]);
  });
});

describe("Firm OS switched off (the default)", () => {
  it.each(FIRM_OS_PATHS)("%s sends everyone to the dashboard, which says Firm OS is not on; nothing is read", async (path) => {
    const { load } = LAYOUTS.find((l) => l.path === path)!;
    for (const who of [MANAGER, PARTNER, ADMIN]) { // people whose role may use every Firm OS module
      as(who);
      ws.setting = workspaceRow(ALL, { companionEnabled: true }); // would open everything if it were read
      expect(await outcome(load), path).toBe("/dashboard?module-off=firm-os");
    }
    expect(ws.reads).toBe(0);
  });

  it("/companion is closed the same way, for partners too", async () => {
    as(PARTNER);
    expect(await outcome(() => import("@/app/companion/layout"))).toBe("/dashboard?module-off=firm-os");
  });

  it("the LMS works as before: staff open every LMS area their role allows (Clients included), with no settings read", async () => {
    as(STAFF);
    ws.setting = workspaceRow([]); // would close everything if it were read
    for (const l of LAYOUTS.filter((x) => !FIRM_OS_PATHS.includes(x.path))) expect(await outcome(l.load), l.path).toBe("open");
    as(ADMIN);
    expect(await outcome(() => import("@/app/admin/layout"))).toBe("open");
    expect(ws.reads).toBe(0);
  });

  it("the area's own rule still applies to the LMS", async () => {
    for (const l of LAYOUTS.filter((x) => !FIRM_OS_PATHS.includes(x.path))) {
      as(l.denied);
      expect(await outcome(l.load), l.path).toBe(l.deniedTo);
    }
  });
});

describe("what the dashboard says", () => {
  it("a plain sentence per reason: a module, the companion, Firm OS itself; nothing for an unknown value", async () => {
    expect(moduleOffNotice("clients")).toBe("Clients is turned off for your account. If you need it, ask an admin to turn it on in Workspace settings.");
    expect(moduleOffNotice("companion")).toBe("The Companion is turned off for your account. If you need it, ask an admin to turn it on in Workspace settings.");
    expect(moduleOffNotice("firm-os")).toBe(FIRM_OS_OFF_MESSAGE);
    expect(FIRM_OS_OFF_MESSAGE).toBe("Firm OS is not switched on for the firm yet. Everything else works as before; ask an admin if you expected to use it.");
    expect(moduleOffNotice("nonsense")).toBeNull();
    const html = await renderHtml(ModuleOffNotice({ param: "firm-os" })!);
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/\b(404|403|FIRM_OS_ENABLED)\b/);
  });
});
