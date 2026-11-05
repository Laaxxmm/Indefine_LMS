// Effective workspace for a person: which modules they see, whether focus mode is on, whether the
// companion extension may pair. Three levels, first one set wins:
//
//   1. WorkspaceSetting (per person)      modules / focusMode null = "follow the role"
//   2. RoleWorkspaceDefault[firmRole]      saved by an admin on /admin/firm-os/workspace
//   3. built-in role defaults              src/lib/workspace/registry.ts
//
// Then access applies on top (src/lib/workspace/access.ts): a switched-on module the role may not
// use is left out, so settings never grant access. An admin always keeps the Admin module.
// resolveWorkspace() is pure; the async helpers read the two rows by primary key.
import { isActive, type SessionUser } from "@/lib/access";
import { firmRole, type FirmRole } from "@/lib/rbac/policy";
import { canAccessModule } from "./access";
import { ALWAYS_ON, BUILT_IN_FOCUS, BUILT_IN_ROLE_MODULES, sortModules, type ModuleKey } from "./registry";

export type SettingRow = { modules: unknown; focusMode: boolean | null; companionEnabled: boolean };
export type RoleDefaultRow = { modules: unknown; focusMode: boolean };

/** Where a value came from: the person's own setting, the saved role default, or the built-in default. */
export type SettingSource = "user" | "role" | "built-in";

export type ResolvedWorkspace = {
  role: FirmRole;
  /** The list in force before access rules (what the admin page shows as switched on). */
  configured: ModuleKey[];
  /** What the person can actually open: configured ∩ allowed, plus ALWAYS_ON for the role. */
  modules: ModuleKey[];
  modulesFrom: SettingSource;
  focusMode: boolean;
  focusFrom: SettingSource;
  companionEnabled: boolean;
};

/** A stored module list, or null when the JSON is not a list (then the next level applies). Unknown keys are dropped. */
export function parseModuleList(json: unknown): ModuleKey[] | null {
  if (!Array.isArray(json)) return null;
  return sortModules(json.filter((k): k is string => typeof k === "string"));
}

/** The role's list: the saved default if it parses, else the built-in one. */
export function roleModules(role: FirmRole, roleRow: RoleDefaultRow | null | undefined): { modules: ModuleKey[]; from: "role" | "built-in" } {
  const saved = roleRow ? parseModuleList(roleRow.modules) : null;
  return saved ? { modules: saved, from: "role" } : { modules: [...BUILT_IN_ROLE_MODULES[role]], from: "built-in" };
}

export function roleFocus(role: FirmRole, roleRow: RoleDefaultRow | null | undefined): { focusMode: boolean; from: "role" | "built-in" } {
  return roleRow ? { focusMode: roleRow.focusMode, from: "role" } : { focusMode: BUILT_IN_FOCUS[role], from: "built-in" };
}

/** Pure resolution (see the header). `user` decides the role and the access rules. */
export function resolveWorkspace(user: SessionUser, setting: SettingRow | null | undefined, roleRow: RoleDefaultRow | null | undefined): ResolvedWorkspace {
  const role = firmRole(user);
  const own = setting ? parseModuleList(setting.modules) : null;
  const fromRole = roleModules(role, roleRow);
  const configured = own ?? fromRole.modules;
  const modules = sortModules([...configured, ...ALWAYS_ON[role]]).filter((k) => canAccessModule(user, k));
  const focus = setting?.focusMode ?? null;
  const fromRoleFocus = roleFocus(role, roleRow);
  return {
    role,
    configured,
    modules,
    modulesFrom: own ? "user" : fromRole.from,
    focusMode: focus ?? fromRoleFocus.focusMode,
    focusFrom: focus === null ? fromRoleFocus.from : "user",
    companionEnabled: setting?.companionEnabled ?? false,
  };
}

// ------------------------------------------------------------------ database

/** The two reads. PrismaClient satisfies it (callers cast, as the agents pages do for FirmDb). */
export interface WorkspaceDb {
  workspaceSetting: {
    findUnique(args: { where: { userId: string }; select: { modules: true; focusMode: true; companionEnabled: true } }): PromiseLike<SettingRow | null>;
  };
  roleWorkspaceDefault: {
    findUnique(args: { where: { role: string }; select: { modules: true; focusMode: true } }): PromiseLike<RoleDefaultRow | null>;
  };
}

async function prismaDb(): Promise<WorkspaceDb> {
  const { prisma } = await import("@/lib/prisma");
  return prisma as unknown as WorkspaceDb;
}

/** Reads the person's row and their role's row, then resolves. Signed out → nothing switched on. */
export async function loadWorkspace(user: SessionUser, db?: WorkspaceDb): Promise<ResolvedWorkspace> {
  if (!user) return resolveWorkspace(user, null, null);
  const d = db ?? (await prismaDb());
  const [setting, roleRow] = await Promise.all([
    d.workspaceSetting.findUnique({ where: { userId: user.id }, select: { modules: true, focusMode: true, companionEnabled: true } }),
    d.roleWorkspaceDefault.findUnique({ where: { role: firmRole(user) }, select: { modules: true, focusMode: true } }),
  ]);
  return resolveWorkspace(user, setting, roleRow);
}

/** Modules the person can open now (switched on and allowed by their role). */
export async function effectiveModules(user: SessionUser, db?: WorkspaceDb): Promise<ModuleKey[]> {
  return (await loadWorkspace(user, db)).modules;
}

export async function isModuleEnabled(user: SessionUser, key: ModuleKey, db?: WorkspaceDb): Promise<boolean> {
  if (!canAccessModule(user, key)) return false; // no read needed when the role cannot use it
  return (await effectiveModules(user, db)).includes(key);
}

export async function focusModeFor(user: SessionUser, db?: WorkspaceDb): Promise<boolean> {
  return !!user && (await loadWorkspace(user, db)).focusMode;
}

/** May this person pair the companion side-panel extension? Off unless an admin allows it. */
export async function companionAllowedFor(user: SessionUser, db?: WorkspaceDb): Promise<boolean> {
  return isActive(user) && (await loadWorkspace(user, db)).companionEnabled;
}
