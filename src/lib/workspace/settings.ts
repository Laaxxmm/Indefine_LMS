// Effective workspace for a person: which modules they see, whether focus mode is on, whether the
// companion extension may pair. Three levels, first one set wins:
//
//   1. WorkspaceSetting (per person)      modules / focusMode null = "follow the role"
//   2. RoleWorkspaceDefault[firmRole]      saved by an admin on /admin/firm-os/workspace
//   3. built-in role defaults              src/lib/workspace/registry.ts
//
// Then access applies on top (src/lib/workspace/access.ts): a switched-on module the role may not
// use is left out, so settings never grant access. An admin always keeps the Admin module.
// Above all three sits the master switch FIRM_OS_ENABLED (default off, src/lib/workspace/flag.ts):
// while it is off nobody has a Firm OS module and no settings row is read (firmOsOffWorkspace).
// resolveWorkspace() is pure; the async helpers read the two rows by primary key, once per request
// when no db is passed (the root layout, a module layout and its header all ask during one render).
import { cache } from "react";
import { isActive, type SessionUser } from "@/lib/access";
import { firmRole, type FirmRole } from "@/lib/rbac/policy";
import { canAccessModule } from "./access";
import { firmOsEnabled } from "./flag";
import { ALWAYS_ON, BUILT_IN_FOCUS, BUILT_IN_ROLE_MODULES, LMS_MODULES, sortModules, type ModuleKey } from "./registry";

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

// Imported lazily (client panels import this module's types) and once: concurrent first reads share
// one import. The client is read from the module on every call.
let prismaModule: Promise<typeof import("@/lib/prisma")> | undefined;
async function prismaDb(): Promise<WorkspaceDb> {
  prismaModule ??= import("@/lib/prisma");
  return (await prismaModule).prisma as unknown as WorkspaceDb;
}

/**
 * While the master switch FIRM_OS_ENABLED is off (src/lib/workspace/flag.ts): the LMS as it was
 * before Firm OS — every LMS module the role may use, no Firm OS module, no focus mode, no
 * companion — and nothing is read. The saved settings apply once the switch is on.
 */
export function firmOsOffWorkspace(user: SessionUser): ResolvedWorkspace {
  return {
    role: firmRole(user),
    configured: [...LMS_MODULES],
    modules: LMS_MODULES.filter((k) => canAccessModule(user, k)),
    modulesFrom: "built-in",
    focusMode: false,
    focusFrom: "built-in",
    companionEnabled: false,
  };
}

/** Reads the person's row and their role's row, then resolves. Signed out → nothing switched on. */
export async function loadWorkspace(user: SessionUser, db?: WorkspaceDb): Promise<ResolvedWorkspace> {
  if (!user) return resolveWorkspace(user, null, null);
  if (!firmOsEnabled()) return firmOsOffWorkspace(user);
  const d = db ?? (await prismaDb());
  const [setting, roleRow] = await Promise.all([
    d.workspaceSetting.findUnique({ where: { userId: user.id }, select: { modules: true, focusMode: true, companionEnabled: true } }),
    d.roleWorkspaceDefault.findUnique({ where: { role: firmRole(user) }, select: { modules: true, focusMode: true } }),
  ]);
  return resolveWorkspace(user, setting, roleRow);
}

// One read per person per request. React's cache() is request-scoped while a page renders and a
// plain call everywhere else (route handlers, scripts, tests), so nothing outlives the request.
const requestReads = cache(() => new Map<string, Promise<ResolvedWorkspace>>());

/** The access-relevant parts of the session user: a different role or status is a different read. */
const readKey = (u: NonNullable<SessionUser>) => JSON.stringify([u.id, u.email, u.role, u.level, u.department, u.active]);

/** loadWorkspace(), shared by every caller in the same request when no db is passed. */
export function workspaceFor(user: SessionUser, db?: WorkspaceDb): Promise<ResolvedWorkspace> {
  if (!user || db) return loadWorkspace(user, db);
  const reads = requestReads();
  const key = readKey(user);
  let read = reads.get(key);
  if (!read) {
    // A failed read fails every caller in this request alike; the next request reads again.
    read = loadWorkspace(user);
    reads.set(key, read);
  }
  return read;
}

/** Modules the person can open now (switched on and allowed by their role). */
export async function effectiveModules(user: SessionUser, db?: WorkspaceDb): Promise<ModuleKey[]> {
  return (await workspaceFor(user, db)).modules;
}

export async function isModuleEnabled(user: SessionUser, key: ModuleKey, db?: WorkspaceDb): Promise<boolean> {
  if (!canAccessModule(user, key)) return false; // no read needed when the role cannot use it
  if (ALWAYS_ON[firmRole(user)].includes(key)) return true; // nor for a module the role always keeps
  return (await effectiveModules(user, db)).includes(key);
}

export async function focusModeFor(user: SessionUser, db?: WorkspaceDb): Promise<boolean> {
  return !!user && (await workspaceFor(user, db)).focusMode;
}

/** May this person pair the companion side-panel extension? Off unless an admin allows it. */
export async function companionAllowedFor(user: SessionUser, db?: WorkspaceDb): Promise<boolean> {
  return isActive(user) && (await workspaceFor(user, db)).companionEnabled;
}
