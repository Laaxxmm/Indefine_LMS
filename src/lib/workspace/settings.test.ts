// Workspace module resolution: person override > saved role default > built-in default; access
// rules on top (a switched-on module never grants access); requireModule redirects with a message.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { canAccessModule } from "./access";
import { FIRM_OS_OFF_MESSAGE, firmOsEnabled, firmOsOffCronResponse, firmOsOffResponse } from "./flag";
import { MODULE_OFF_PARAM, moduleOffHref, moduleOffMessage, moduleOffNotice, requireFirmOs, requireModule } from "./guard";
import { BUILT_IN_ROLE_MODULES, FIRM_OS_MODULES, LMS_MODULES, MODULE_KEYS, MODULES, isFirmRole, isModuleKey, moduleForPath, sortModules } from "./registry";
import {
  companionAllowedFor,
  effectiveModules,
  firmOsOffWorkspace,
  focusModeFor,
  isModuleEnabled,
  loadWorkspace,
  parseModuleList,
  resolveWorkspace,
  type RoleDefaultRow,
  type SettingRow,
  type WorkspaceDb,
} from "./settings";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

type U = Session["user"];
const person = (over: Partial<U> = {}): U => ({ id: "u1", name: "Priya", email: "priya@indefine.test", image: null, role: "EMPLOYEE", active: true, department: "GST", level: "EXECUTIVE", ...over });
const staff = person();
const manager = person({ id: "u2", level: "MANAGER" });
const partner = person({ id: "u3", level: "PARTNER" });
const admin = person({ id: "u4", role: "ADMIN" });

function fakeDb(settings: Record<string, SettingRow> = {}, roles: Record<string, RoleDefaultRow> = {}) {
  const reads: string[] = [];
  const db: WorkspaceDb = {
    workspaceSetting: { findUnique: async ({ where }) => (reads.push(`user:${where.userId}`), settings[where.userId] ?? null) },
    roleWorkspaceDefault: { findUnique: async ({ where }) => (reads.push(`role:${where.role}`), roles[where.role] ?? null) },
  };
  return { db, reads };
}

beforeEach(() => vi.stubEnv("WORK_TRACKER_EMAILS", ""));
afterEach(() => vi.unstubAllEnvs());

describe("registry", () => {
  it("lists every module once, each with a label, routes and a description", () => {
    expect(MODULES.map((m) => m.key)).toEqual([...MODULE_KEYS]);
    for (const m of MODULES) {
      expect(m.label.length).toBeGreaterThan(2);
      expect(m.description.endsWith(".")).toBe(true);
      expect(m.routes.length).toBeGreaterThan(0);
      for (const r of [...m.routes, ...m.apiRoutes]) expect(r.startsWith("/")).toBe(true);
    }
  });

  it("finds the module that owns a path, longest route first", () => {
    expect(moduleForPath("/clients/abc")).toBe("clients");
    expect(moduleForPath("/focus")).toBe("agents");
    expect(moduleForPath("/workspace/job-1?tab=sop")).toBe("agents");
    expect(moduleForPath("/api/firm-os/workspace/next-task")).toBe("agents");
    expect(moduleForPath("/admin/firm-os/workspace")).toBe("admin");
    expect(moduleForPath("/video/1/")).toBe("learning");
    expect(moduleForPath("/dashboard")).toBeNull();
    expect(moduleForPath("/clientsx")).toBeNull();
    expect(moduleForPath("/")).toBeNull();
  });

  it("built-in defaults: staff work modules, managers add clients/comms/onboard, partners and admins everything", () => {
    expect(BUILT_IN_ROLE_MODULES.staff).toEqual(["learning", "leaderboard", "work", "tools", "agents", "coach", "search"]);
    expect(BUILT_IN_ROLE_MODULES.manager).toEqual(["learning", "leaderboard", "clients", "work", "tools", "onboard", "agents", "coach", "comms", "search"]);
    expect(BUILT_IN_ROLE_MODULES.partner).toEqual([...MODULE_KEYS]);
    expect(BUILT_IN_ROLE_MODULES.admin).toEqual([...MODULE_KEYS]);
  });

  it("sortModules drops unknown keys and repeats; guards for keys and roles", () => {
    expect(sortModules(["search", "nope", "agents", "agents"])).toEqual(["agents", "search"]);
    expect(isModuleKey("clients")).toBe(true);
    expect(isModuleKey("x")).toBe(false);
    expect(isFirmRole("manager")).toBe(true);
    expect(isFirmRole("owner")).toBe(false);
  });
});

describe("resolveWorkspace", () => {
  it("built-in default when nothing is saved", () => {
    const w = resolveWorkspace(staff, null, null);
    expect(w.role).toBe("staff");
    expect(w.modulesFrom).toBe("built-in");
    expect(w.configured).toEqual([...BUILT_IN_ROLE_MODULES.staff]);
    expect(w.modules).toEqual(["learning", "leaderboard", "tools", "agents", "coach", "search"]); // work: not on the allow-list
    expect(w.focusMode).toBe(false);
    expect(w.focusFrom).toBe("built-in");
    expect(w.companionEnabled).toBe(false);
  });

  it("saved role default beats the built-in one", () => {
    const w = resolveWorkspace(staff, null, { modules: ["agents", "search"], focusMode: true });
    expect(w.modulesFrom).toBe("role");
    expect(w.modules).toEqual(["agents", "search"]);
    expect(w.focusMode).toBe(true);
    expect(w.focusFrom).toBe("role");
  });

  it("a person's own setting beats the role default; null fields follow the role", () => {
    const role = { modules: ["agents", "search"], focusMode: true };
    const own = resolveWorkspace(staff, { modules: ["agents", "coach"], focusMode: false, companionEnabled: true }, role);
    expect(own.modulesFrom).toBe("user");
    expect(own.modules).toEqual(["agents", "coach"]);
    expect(own.focusMode).toBe(false);
    expect(own.focusFrom).toBe("user");
    expect(own.companionEnabled).toBe(true);
    const follows = resolveWorkspace(staff, { modules: null, focusMode: null, companionEnabled: false }, role);
    expect(follows.modulesFrom).toBe("role");
    expect(follows.modules).toEqual(["agents", "search"]);
    expect(follows.focusMode).toBe(true);
    expect(follows.focusFrom).toBe("role");
  });

  it("an empty list is a real choice (everything off), but broken JSON falls through to the next level", () => {
    expect(resolveWorkspace(staff, { modules: [], focusMode: null, companionEnabled: false }, null).modules).toEqual([]);
    expect(resolveWorkspace(staff, { modules: "agents", focusMode: null, companionEnabled: false }, { modules: ["search"], focusMode: false }).modules).toEqual(["search"]);
    expect(resolveWorkspace(staff, null, { modules: { agents: true }, focusMode: false }).modulesFrom).toBe("built-in");
    expect(parseModuleList(["agents", 3, "zzz"])).toEqual(["agents"]);
    expect(parseModuleList(null)).toBeNull();
  });

  it("a switched-on module never grants access the role does not have", () => {
    const everything = { modules: [...MODULE_KEYS], focusMode: null, companionEnabled: false };
    const w = resolveWorkspace(staff, everything, null);
    expect(w.configured).toContain("admin");
    expect(w.configured).toContain("onboard");
    expect(w.modules).not.toContain("admin"); // staff are not admins
    expect(w.modules).not.toContain("onboard"); // staff cannot onboard
    expect(w.modules).not.toContain("work"); // not on the tracker allow-list
    expect(w.modules).toContain("clients"); // every active person may view clients today
    expect(resolveWorkspace(person({ active: false }), everything, null).modules).toEqual(["learning", "leaderboard"]); // signed-in pages only
    expect(resolveWorkspace(null, everything, null).modules).toEqual([]);
  });

  it("the work tracker follows its own allow-list", () => {
    vi.stubEnv("WORK_TRACKER_EMAILS", "priya@indefine.test");
    expect(canAccessModule(staff, "work")).toBe(true);
    expect(resolveWorkspace(staff, null, null).modules).toContain("work");
  });

  it("an admin always keeps the Admin module, whatever is saved", () => {
    const w = resolveWorkspace(admin, { modules: ["agents"], focusMode: null, companionEnabled: false }, { modules: [], focusMode: false });
    expect(w.role).toBe("admin");
    expect(w.modules).toEqual(["agents", "admin"]);
    expect(resolveWorkspace(partner, { modules: ["agents"], focusMode: null, companionEnabled: false }, null).modules).toEqual(["agents"]);
  });

  it("roles come from firmRole: manager and partner levels, admin role", () => {
    expect(resolveWorkspace(manager, null, null).role).toBe("manager");
    expect(resolveWorkspace(manager, null, null).modules).toContain("onboard");
    expect(resolveWorkspace(partner, null, null).modules).not.toContain("admin");
    expect(resolveWorkspace(admin, null, null).modules).toContain("admin");
  });
});

describe("database helpers", () => {
  it("reads the person's row and their role's row", async () => {
    const { db, reads } = fakeDb({ u1: { modules: ["agents"], focusMode: true, companionEnabled: true } }, { staff: { modules: ["search"], focusMode: false } });
    const w = await loadWorkspace(staff, db);
    expect(reads.sort()).toEqual(["role:staff", "user:u1"]);
    expect(w.modules).toEqual(["agents"]);
    expect(await effectiveModules(staff, db)).toEqual(["agents"]);
    expect(await isModuleEnabled(staff, "agents", db)).toBe(true);
    expect(await isModuleEnabled(staff, "search", db)).toBe(false);
    expect(await focusModeFor(staff, db)).toBe(true);
    expect(await companionAllowedFor(staff, db)).toBe(true);
    expect(await companionAllowedFor(person({ active: false }), db)).toBe(false);
  });

  it("signed out: nothing is read and nothing is on", async () => {
    const { db, reads } = fakeDb();
    expect(await effectiveModules(null, db)).toEqual([]);
    expect(await focusModeFor(null, db)).toBe(false);
    expect(await companionAllowedFor(null, db)).toBe(false);
    expect(reads).toEqual([]);
  });

  it("isModuleEnabled skips the read when the role cannot use the module", async () => {
    const { db, reads } = fakeDb({ u1: { modules: [...MODULE_KEYS], focusMode: null, companionEnabled: false } });
    expect(await isModuleEnabled(staff, "admin", db)).toBe(false);
    expect(reads).toEqual([]);
  });
});

describe("requireModule", () => {
  it("returns when the module is on", async () => {
    const { db } = fakeDb();
    await expect(requireModule(staff, "agents", db)).resolves.toBeUndefined();
  });

  it("switched off → /dashboard with the module named, and a plain message for the dashboard", async () => {
    const { db } = fakeDb({ u1: { modules: ["search"], focusMode: null, companionEnabled: false } });
    await expect(requireModule(staff, "agents", db)).rejects.toThrow(`REDIRECT /dashboard?${MODULE_OFF_PARAM}=agents`);
    expect(moduleOffHref("clients")).toBe("/dashboard?module-off=clients");
    const msg = moduleOffMessage("agents");
    expect(msg).toBe("Agents is turned off for your account. If you need it, ask an admin to turn it on in Workspace settings.");
    expect(msg).not.toMatch(/\b(403|error|code)\b/i);
    expect(moduleOffNotice("agents")).toBe(msg);
    expect(moduleOffNotice(["clients", "x"])).toBe(moduleOffMessage("clients"));
    expect(moduleOffNotice("nonsense")).toBeNull();
    expect(moduleOffNotice(undefined)).toBeNull();
  });

  it("no role access → /dashboard without a message; signed out → sign-in", async () => {
    const { db } = fakeDb();
    const target = (u: U | null) => requireModule(u, "admin", db).then(() => "rendered", (e: Error) => e.message);
    expect(await target(staff)).toBe("REDIRECT /dashboard");
    expect(await target(null)).toBe("REDIRECT /");
  });
});

describe("the Firm OS master switch (FIRM_OS_ENABLED, default off)", () => {
  it("reads 1 / true / on / yes as on, anything else (unset included) as off", () => {
    for (const v of ["1", "true", "ON", " yes "]) expect(firmOsEnabled({ FIRM_OS_ENABLED: v })).toBe(true);
    for (const v of [undefined, "", "0", "false", "off", "no", "enabled"]) expect(firmOsEnabled({ FIRM_OS_ENABLED: v })).toBe(false);
  });

  it("off: the LMS modules the role may use, no Firm OS module, no focus mode, no companion — and nothing is read", async () => {
    vi.stubEnv("FIRM_OS_ENABLED", "");
    const { db, reads } = fakeDb({ u1: { modules: [...MODULE_KEYS], focusMode: true, companionEnabled: true } }, { staff: { modules: ["agents"], focusMode: true } });
    expect(await effectiveModules(staff, db)).toEqual(["learning", "leaderboard", "clients", "tools"]); // the work tracker keeps its allow-list
    expect(await effectiveModules(admin, db)).toEqual(LMS_MODULES.filter((k) => k !== "work"));
    for (const k of FIRM_OS_MODULES) expect(await isModuleEnabled(partner, k, db)).toBe(false);
    expect(await focusModeFor(staff, db)).toBe(false);
    expect(await companionAllowedFor(staff, db)).toBe(false);
    expect(reads).toEqual([]);
    expect(firmOsOffWorkspace(staff)).toMatchObject({ focusMode: false, companionEnabled: false, modulesFrom: "built-in" });
  });

  it("off: a Firm OS module sends everyone to the dashboard with the Firm OS sentence; an LMS module still follows its rules", async () => {
    vi.stubEnv("FIRM_OS_ENABLED", "");
    const { db } = fakeDb();
    await expect(requireModule(partner, "agents", db)).rejects.toThrow("REDIRECT /dashboard?module-off=firm-os");
    await expect(requireModule(staff, "onboard", db)).rejects.toThrow("REDIRECT /dashboard"); // the role rule comes first
    await expect(requireModule(staff, "clients", db)).resolves.toBeUndefined();
    expect(() => requireFirmOs(admin)).toThrow("REDIRECT /dashboard?module-off=firm-os");
    expect(moduleOffNotice("firm-os")).toBe(FIRM_OS_OFF_MESSAGE);
  });

  it("on: the saved settings decide again", async () => {
    const { db } = fakeDb({ u1: { modules: ["agents"], focusMode: true, companionEnabled: false } });
    expect(await effectiveModules(staff, db)).toEqual(["agents"]);
    expect(() => requireFirmOs(admin)).not.toThrow();
  });

  it("the API answer while off: 404 with the plain sentence; a cron skips with 200", async () => {
    const res = firmOsOffResponse();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: FIRM_OS_OFF_MESSAGE });
    const cron = firmOsOffCronResponse();
    expect(cron.status).toBe(200);
    expect(await cron.json()).toEqual({ ok: true, skipped: FIRM_OS_OFF_MESSAGE });
  });

  it("splits the registry: Firm OS modules and the LMS, every module in exactly one", () => {
    expect([...FIRM_OS_MODULES].sort()).toEqual(["agents", "coach", "comms", "onboard", "search"]);
    expect(sortModules([...FIRM_OS_MODULES, ...LMS_MODULES])).toEqual([...MODULE_KEYS]);
    expect(FIRM_OS_MODULES.some((k) => LMS_MODULES.includes(k))).toBe(false);
  });
});
