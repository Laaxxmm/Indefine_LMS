// Workspace settings admin service: saves write the row and an AuditEvent together, non-admins are
// refused, nothing-changed saves are refused, an admin keeps the Admin module, reset saves nulls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { createWorkspaceDb } from "../../../tests/fakes/workspace-db";
import {
  ADMIN_KEEPS_ADMIN,
  ADMIN_ONLY,
  NOTHING_CHANGED,
  loadPerson,
  loadRoleDefaults,
  peopleWithOwnSettings,
  personAccessNotes,
  roleAccessNotes,
  saveRoleDefault,
  saveUserSetting,
  searchPeople,
  type AdminWorkspaceDb,
} from "./admin";
import { FOLLOW_ROLE, moduleDiff, roleDefaultChanges, userSettingChanges } from "./changes";
import { BUILT_IN_ROLE_MODULES, MODULE_KEYS } from "./registry";
import { loadWorkspace, type WorkspaceDb } from "./settings";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type U = Session["user"];
const admin: U = { id: "u-admin", name: "Asha Admin", email: "asha@indefine.test", image: null, role: "ADMIN", active: true, department: "GENERAL", level: "EXECUTIVE" };
const partner: U = { ...admin, id: "u-anand", role: "EMPLOYEE", level: "PARTNER" };
const priya: U = { id: "u-priya", name: "Priya S", email: "priya@indefine.test", image: null, role: "EMPLOYEE", active: true, department: "GST", level: "EXECUTIVE" };

function world(seed?: Parameters<typeof createWorkspaceDb>[0]) {
  const w = createWorkspaceDb(seed);
  return { ...w, adb: w.db as unknown as AdminWorkspaceDb, wdb: w.db as unknown as WorkspaceDb };
}

describe("change summaries", () => {
  it("names what turns on and off, in registry order", () => {
    expect(moduleDiff(["agents", "tools"], ["clients", "agents", "comms"])).toBe("turns on Clients, Client comms drafts; turns off Tools");
    expect(moduleDiff(["agents"], ["agents"])).toBeNull();
    expect(roleDefaultChanges("staff", { modules: ["agents"], focusMode: false }, { modules: ["agents", "search"], focusMode: true })).toEqual([
      "Staff default modules: turns on Search.",
      "Focus mode for Staff: on (was off).",
    ]);
  });

  it("says when a person leaves or returns to the role default", () => {
    const role = { label: "Staff", modules: ["agents", "search"] as const, focusMode: false };
    expect(userSettingChanges(FOLLOW_ROLE, { modules: ["agents"], focusMode: true, companionEnabled: true }, { ...role, modules: [...role.modules] })).toEqual([
      "Modules: their own list instead of the Staff default; turns off Search.",
      "Focus mode: on (was the Staff default, off).",
      "Companion extension: allowed.",
    ]);
    expect(userSettingChanges({ modules: ["agents"], focusMode: true, companionEnabled: true }, FOLLOW_ROLE, { ...role, modules: [...role.modules] })).toEqual([
      "Modules: back to the Staff default; turns on Search.",
      "Focus mode: back to the Staff default (off).",
      "Companion extension: not allowed.",
    ]);
    expect(userSettingChanges(FOLLOW_ROLE, FOLLOW_ROLE, { ...role, modules: [...role.modules] })).toEqual([]);
  });
});

describe("saveRoleDefault", () => {
  it("saves the role default and an AuditEvent with before, after and the change list", async () => {
    const { t, adb, wdb } = world();
    const r = await saveRoleDefault(admin, "staff", { modules: ["agents", "search"], focusMode: true }, adb);
    expect(r).toEqual({ ok: true, data: { changes: ["Staff default modules: turns off Learning, Leaderboard and Trajectory, Work tracker, Tools, Daily Coach.", "Focus mode for Staff: on (was off)."] } });
    expect(t.roles).toHaveLength(1);
    expect(t.roles[0]).toMatchObject({ role: "staff", modules: ["agents", "search"], focusMode: true, updatedById: "u-admin" });
    expect(t.audit).toHaveLength(1);
    expect(t.audit[0]).toMatchObject({ actorId: "u-admin", action: "workspace-role-default", entity: "RoleWorkspaceDefault", entityId: "staff" });
    expect((t.audit[0].meta as { before: unknown }).before).toEqual({ modules: [...BUILT_IN_ROLE_MODULES.staff], focusMode: false });
    // The role default now applies to staff without their own setting.
    const w = await loadWorkspace(priya, wdb);
    expect(w.modules).toEqual(["agents", "search"]);
    expect(w.focusMode).toBe(true);
  });

  it("refuses non-admins (a partner too), unknown roles, no change, and Admin switched off for admins", async () => {
    const { t, adb } = world();
    expect(await saveRoleDefault(partner, "staff", { modules: [], focusMode: false }, adb)).toEqual({ ok: false, status: 403, error: ADMIN_ONLY });
    expect(await saveRoleDefault(null, "staff", { modules: [], focusMode: false }, adb)).toMatchObject({ status: 403 });
    expect(await saveRoleDefault(admin, "owner", { modules: [], focusMode: false }, adb)).toMatchObject({ ok: false, status: 404 });
    expect(await saveRoleDefault(admin, "staff", { modules: [...BUILT_IN_ROLE_MODULES.staff], focusMode: false }, adb)).toEqual({ ok: false, status: 400, error: NOTHING_CHANGED });
    expect(await saveRoleDefault(admin, "admin", { modules: ["agents"], focusMode: false }, adb)).toEqual({ ok: false, status: 400, error: ADMIN_KEEPS_ADMIN });
    expect(t.roles).toEqual([]);
    expect(t.audit).toEqual([]);
  });

  it("loadRoleDefaults shows built-in until saved, then the saved row with its IST time", async () => {
    const { adb } = world();
    expect((await loadRoleDefaults(adb)).map((r) => [r.role, r.from])).toEqual([
      ["staff", "built-in"],
      ["manager", "built-in"],
      ["partner", "built-in"],
      ["admin", "built-in"],
    ]);
    await saveRoleDefault(admin, "manager", { modules: ["agents"], focusMode: false }, adb);
    const m = (await loadRoleDefaults(adb)).find((r) => r.role === "manager")!;
    expect(m).toMatchObject({ from: "role", modules: ["agents"], updatedAt: "05 Nov 2026 12:00 IST" });
  });
});

describe("saveUserSetting", () => {
  it("saves a person's own list, focus and companion, with an AuditEvent; access still applies", async () => {
    const { t, adb, wdb } = world();
    const r = await saveUserSetting(admin, "u-priya", { modules: ["agents", "admin", "onboard"], focusMode: true, companionEnabled: true }, adb);
    expect(r.ok).toBe(true);
    expect(t.settings[0]).toMatchObject({ userId: "u-priya", modules: ["onboard", "agents", "admin"], focusMode: true, companionEnabled: true, updatedById: "u-admin" });
    expect(t.audit[0]).toMatchObject({ actorId: "u-admin", action: "workspace-user-setting", entity: "WorkspaceSetting", entityId: "u-priya" });
    const w = await loadWorkspace(priya, wdb);
    expect(w.modules).toEqual(["agents"]); // admin and onboard switched on, but staff cannot use them
    expect(w.focusMode).toBe(true);
    expect(w.companionEnabled).toBe(true);
  });

  it("reset to role default saves nulls on the same row (nothing removed) and is audited", async () => {
    const { t, adb, wdb } = world({ settings: [{ userId: "u-priya", modules: ["agents"], focusMode: true, companionEnabled: true, updatedAt: new Date() }] });
    const r = await saveUserSetting(admin, "u-priya", FOLLOW_ROLE, adb);
    expect(r.ok && r.data.changes[0]).toBe("Modules: back to the Staff default; turns on Learning, Leaderboard and Trajectory, Work tracker, Tools, Daily Coach, Search.");
    expect(t.settings).toHaveLength(1);
    expect(t.settings[0]).toMatchObject({ userId: "u-priya", modules: null, focusMode: null, companionEnabled: false });
    expect((await loadWorkspace(priya, wdb)).modulesFrom).toBe("built-in");
    expect(t.audit).toHaveLength(1);
  });

  it("refuses non-admins, unknown people, no change, and Admin switched off for an admin", async () => {
    const { t, adb } = world();
    expect(await saveUserSetting(priya, "u-priya", { modules: [...MODULE_KEYS], focusMode: null, companionEnabled: false }, adb)).toEqual({ ok: false, status: 403, error: ADMIN_ONLY });
    expect(await saveUserSetting(admin, "nobody", FOLLOW_ROLE, adb)).toMatchObject({ ok: false, status: 404 });
    expect(await saveUserSetting(admin, "u-priya", FOLLOW_ROLE, adb)).toEqual({ ok: false, status: 400, error: NOTHING_CHANGED });
    expect(await saveUserSetting(admin, "u-admin", { modules: ["agents"], focusMode: null, companionEnabled: false }, adb)).toEqual({ ok: false, status: 400, error: ADMIN_KEEPS_ADMIN });
    expect(t.settings).toEqual([]);
    expect(t.audit).toEqual([]);
  });
});

describe("people", () => {
  it("search by name or email; rows show role and where modules come from", async () => {
    const { adb } = world({ settings: [{ userId: "u-meera", modules: ["agents"], focusMode: null, companionEnabled: false, updatedAt: new Date() }] });
    const rows = await searchPeople(adb, "MEERA");
    expect(rows).toEqual([
      { id: "u-meera", name: "Meera K", email: "meera@indefine.test", role: "manager", roleLabel: "Manager", active: true, modulesFrom: "user", focusMode: false, companionEnabled: false },
    ]);
    expect((await searchPeople(adb, "indefine.test")).map((r) => r.role)).toEqual(["partner", "admin", "manager", "staff", "staff"]); // name order
    expect(await searchPeople(adb, "   ")).toEqual([]);
  });

  it("people with their own settings leaves out rows reset to follow the role", async () => {
    const { adb } = world({
      settings: [
        { userId: "u-meera", modules: ["agents"], focusMode: null, companionEnabled: false, updatedAt: new Date() },
        { userId: "u-priya", modules: null, focusMode: null, companionEnabled: false, updatedAt: new Date() },
      ],
    });
    expect((await peopleWithOwnSettings(adb)).map((p) => p.id)).toEqual(["u-meera"]);
  });

  it("loadPerson: setting, role default, allowed, always-on and effective modules; notes say why a module stays hidden", async () => {
    const { adb } = world();
    const p = (await loadPerson(adb, "u-priya"))!;
    expect(p.setting).toEqual(FOLLOW_ROLE);
    expect(p.roleDefault).toEqual({ label: "Staff", modules: [...BUILT_IN_ROLE_MODULES.staff], focusMode: false });
    expect(p.allowed).not.toContain("onboard");
    expect(p.alwaysOn).toEqual([]);
    expect(personAccessNotes(p).onboard).toBe("Priya S cannot use this, so switching it on has no effect.");
    expect(personAccessNotes(p).work).toBe("Not on the work tracker's allow-list, so it stays hidden.");
    expect((await loadPerson(adb, "u-admin"))!.alwaysOn).toEqual(["admin"]);
    expect(personAccessNotes((await loadPerson(adb, "u-old"))!).clients).toBe("Their account is inactive, so this stays hidden.");
    expect(await loadPerson(adb, "nobody")).toBeNull();
    expect(roleAccessNotes("staff").admin).toBe("Staff members cannot use this, so switching it on has no effect.");
    expect(roleAccessNotes("manager").onboard).toBeUndefined();
    expect(roleAccessNotes("admin").admin).toBeUndefined();
  });
});
