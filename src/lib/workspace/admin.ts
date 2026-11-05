// /admin/firm-os/workspace: read models and the two saves (a role default, a person's own setting).
// Admins only. Every save writes the row and an AuditEvent in one transaction, with the before /
// after values and the plain-English change list the admin confirmed. Nothing is ever removed:
// "reset to role default" saves nulls (follow the role) on the person's row.
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { canManageWorkspace, firmRole, type FirmRole } from "@/lib/rbac/policy";
import { formatDateTimeIst } from "@/lib/agents/core/format";
import { logAudit } from "@/lib/audit/log";
import { canAccessModule } from "./access";
import { followsRole, roleDefaultChanges, userSettingChanges, type RoleDefaultInput, type UserSettingInput } from "./changes";
import { ALWAYS_ON, FIRM_ROLES, MODULE_KEYS, ROLE_LABELS, isFirmRole, type ModuleKey } from "./registry";
import { parseModuleList, resolveWorkspace, roleFocus, roleModules, type SettingSource } from "./settings";

export type AdminWorkspaceDb = Pick<PrismaClient, "$transaction" | "workspaceSetting" | "roleWorkspaceDefault" | "user" | "auditEvent">;

export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 403 | 404; error: string };

const fail = (status: 400 | 403 | 404, error: string) => ({ ok: false as const, status, error });

export const ADMIN_ONLY = "Only an admin can change workspace settings.";
export const NOTHING_CHANGED = "Nothing has changed. Change a setting, then save.";
export const ADMIN_KEEPS_ADMIN = "Admins always keep the Admin module, so it stays switched on for them.";

const ist = (d: Date | null | undefined) => (d ? `${formatDateTimeIst(d)} IST` : null);

// ------------------------------------------------------------------ people

type UserRow = { id: string; name: string | null; email: string; role: "EMPLOYEE" | "ADMIN"; level: string; department: string; active: boolean };
const USER_SELECT = { id: true, name: true, email: true, role: true, level: true, department: true, active: true } as const;

/** A DB user in the session shape, so firmRole and the access rules read them the same way. */
export function asSessionUser(u: UserRow): NonNullable<SessionUser> {
  return { id: u.id, name: u.name, email: u.email, image: null, role: u.role, active: u.active, department: u.department, level: u.level };
}

type SettingDbRow = { userId: string; modules: unknown; focusMode: boolean | null; companionEnabled: boolean; updatedAt: Date };

export function settingInput(row: Pick<SettingDbRow, "modules" | "focusMode" | "companionEnabled"> | null | undefined): UserSettingInput {
  return row ? { modules: parseModuleList(row.modules), focusMode: row.focusMode, companionEnabled: row.companionEnabled } : { modules: null, focusMode: null, companionEnabled: false };
}

export type PersonRow = {
  id: string;
  name: string;
  email: string;
  role: FirmRole;
  roleLabel: string;
  active: boolean;
  modulesFrom: SettingSource;
  focusMode: boolean;
  companionEnabled: boolean;
};

export type RoleDefaultView = { role: FirmRole; label: string; modules: ModuleKey[]; focusMode: boolean; from: "role" | "built-in"; updatedAt: string | null };

export async function loadRoleDefaults(db: AdminWorkspaceDb): Promise<RoleDefaultView[]> {
  const rows = await db.roleWorkspaceDefault.findMany({ select: { role: true, modules: true, focusMode: true, updatedAt: true } });
  return FIRM_ROLES.map((role) => {
    const row = rows.find((r) => r.role === role) ?? null;
    const m = roleModules(role, row);
    return { role, label: ROLE_LABELS[role], modules: m.modules, focusMode: roleFocus(role, row).focusMode, from: m.from, updatedAt: ist(row?.updatedAt) };
  });
}

async function personRows(db: AdminWorkspaceDb, users: UserRow[]): Promise<PersonRow[]> {
  if (!users.length) return [];
  const [settings, roles] = await Promise.all([
    db.workspaceSetting.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, modules: true, focusMode: true, companionEnabled: true, updatedAt: true } }),
    db.roleWorkspaceDefault.findMany({ select: { role: true, modules: true, focusMode: true } }),
  ]);
  return users.map((u) => {
    const su = asSessionUser(u);
    const role = firmRole(su);
    const w = resolveWorkspace(su, settings.find((s) => s.userId === u.id) ?? null, roles.find((r) => r.role === role) ?? null);
    return { id: u.id, name: u.name ?? u.email, email: u.email, role, roleLabel: ROLE_LABELS[role], active: u.active, modulesFrom: w.modulesFrom, focusMode: w.focusMode, companionEnabled: w.companionEnabled };
  });
}

/** People whose name or email contains `q` (case-insensitive), up to `take`. */
export async function searchPeople(db: AdminWorkspaceDb, q: string, take = 20): Promise<PersonRow[]> {
  const term = q.trim().slice(0, 100);
  if (!term) return [];
  const users = await db.user.findMany({
    where: { OR: [{ name: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }] },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take,
    select: USER_SELECT,
  });
  return personRows(db, users);
}

/** People with anything of their own saved (rows reset to "follow the role" are left out). */
export async function peopleWithOwnSettings(db: AdminWorkspaceDb, take = 50): Promise<PersonRow[]> {
  const rows = await db.workspaceSetting.findMany({ orderBy: { updatedAt: "desc" }, take: take * 2, select: { userId: true, modules: true, focusMode: true, companionEnabled: true } });
  const ids = rows.filter((r) => !followsRole(settingInput(r))).map((r) => r.userId).slice(0, take);
  if (!ids.length) return [];
  const users = await db.user.findMany({ where: { id: { in: ids } }, orderBy: [{ name: "asc" }, { email: "asc" }], select: USER_SELECT });
  return personRows(db, users);
}

export type PersonDetail = PersonRow & {
  setting: UserSettingInput;
  roleDefault: { label: string; modules: ModuleKey[]; focusMode: boolean };
  /** Modules the person's role may use at all (a switched-on module outside this list has no effect). */
  allowed: ModuleKey[];
  /** Modules this role always keeps (cannot be switched off). */
  alwaysOn: ModuleKey[];
  /** What they can open now. */
  effective: ModuleKey[];
  updatedAt: string | null;
};

export async function loadPerson(db: AdminWorkspaceDb, userId: string): Promise<PersonDetail | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!u) return null;
  const su = asSessionUser(u);
  const role = firmRole(su);
  const [setting, roleRow] = await Promise.all([
    db.workspaceSetting.findUnique({ where: { userId }, select: { userId: true, modules: true, focusMode: true, companionEnabled: true, updatedAt: true } }),
    db.roleWorkspaceDefault.findUnique({ where: { role }, select: { modules: true, focusMode: true } }),
  ]);
  const w = resolveWorkspace(su, setting, roleRow);
  return {
    id: u.id,
    name: u.name ?? u.email,
    email: u.email,
    role,
    roleLabel: ROLE_LABELS[role],
    active: u.active,
    modulesFrom: w.modulesFrom,
    focusMode: w.focusMode,
    companionEnabled: w.companionEnabled,
    setting: settingInput(setting),
    roleDefault: { label: ROLE_LABELS[role], modules: roleModules(role, roleRow).modules, focusMode: roleFocus(role, roleRow).focusMode },
    allowed: MODULE_KEYS.filter((k) => canAccessModule(su, k)),
    alwaysOn: [...ALWAYS_ON[role]],
    effective: w.modules,
    updatedAt: ist(setting?.updatedAt),
  };
}

// ------------------------------------------------------------------ access notes

/** A typical active member of each role, to say which modules a role can never use. */
const SAMPLE: Record<FirmRole, NonNullable<SessionUser>> = {
  staff: { id: "sample-staff", name: null, email: null, image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level: "EXECUTIVE" },
  manager: { id: "sample-manager", name: null, email: null, image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level: "MANAGER" },
  partner: { id: "sample-partner", name: null, email: null, image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level: "PARTNER" },
  admin: { id: "sample-admin", name: null, email: null, image: null, role: "ADMIN", active: true, department: "GENERAL", level: "EXECUTIVE" },
};

const NO_EFFECT = (who: string) => `${who} cannot use this, so switching it on has no effect.`;

/** Per-module notes for a role's form: modules the role can never use, and the tracker's allow-list. */
export function roleAccessNotes(role: FirmRole): Partial<Record<ModuleKey, string>> {
  const notes: Partial<Record<ModuleKey, string>> = {};
  for (const k of MODULE_KEYS) {
    if (k === "work") notes.work = "Opens only for people on the work tracker's allow-list.";
    else if (!canAccessModule(SAMPLE[role], k)) notes[k] = NO_EFFECT(`${ROLE_LABELS[role]} members`);
  }
  return notes;
}

/** Per-module notes for one person's form, from what their role and account allow. */
export function personAccessNotes(p: Pick<PersonDetail, "allowed" | "name" | "active">): Partial<Record<ModuleKey, string>> {
  const notes: Partial<Record<ModuleKey, string>> = {};
  for (const k of MODULE_KEYS) {
    if (p.allowed.includes(k)) continue;
    notes[k] = !p.active ? "Their account is inactive, so this stays hidden." : k === "work" ? "Not on the work tracker's allow-list, so it stays hidden." : NO_EFFECT(p.name);
  }
  return notes;
}

// ------------------------------------------------------------------ saves

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function saveRoleDefault(actor: SessionUser, role: string, input: RoleDefaultInput, db: AdminWorkspaceDb): Promise<AdminResult<{ changes: string[] }>> {
  if (!actor || !canManageWorkspace(actor)) return fail(403, ADMIN_ONLY);
  if (!isFirmRole(role)) return fail(404, "That role does not exist. Choose Staff, Manager, Partner or Admin.");
  const after: RoleDefaultInput = { modules: parseModuleList(input.modules) ?? [], focusMode: input.focusMode };
  if (ALWAYS_ON[role].some((k) => !after.modules.includes(k))) return fail(400, ADMIN_KEEPS_ADMIN);
  const row = await db.roleWorkspaceDefault.findUnique({ where: { role }, select: { modules: true, focusMode: true } });
  const before: RoleDefaultInput = { modules: roleModules(role, row).modules, focusMode: roleFocus(role, row).focusMode };
  const changes = roleDefaultChanges(role, before, after);
  if (!changes.length) return fail(400, NOTHING_CHANGED);
  await db.$transaction(async (tx) => {
    await tx.roleWorkspaceDefault.upsert({
      where: { role },
      create: { role, modules: json(after.modules), focusMode: after.focusMode, updatedById: actor.id },
      update: { modules: json(after.modules), focusMode: after.focusMode, updatedById: actor.id },
    });
    await logAudit(tx, { actorId: actor.id, action: "workspace-role-default", entity: "RoleWorkspaceDefault", entityId: role, meta: { before, after, changes, savedBefore: !!row } });
  });
  return { ok: true, data: { changes } };
}

export async function saveUserSetting(actor: SessionUser, userId: string, input: UserSettingInput, db: AdminWorkspaceDb): Promise<AdminResult<{ changes: string[] }>> {
  if (!actor || !canManageWorkspace(actor)) return fail(403, ADMIN_ONLY);
  const u = await db.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!u) return fail(404, "That person was not found. Search again and pick them from the list.");
  const role = firmRole(asSessionUser(u));
  const after: UserSettingInput = { modules: input.modules === null ? null : (parseModuleList(input.modules) ?? []), focusMode: input.focusMode, companionEnabled: input.companionEnabled };
  if (after.modules && ALWAYS_ON[role].some((k) => !after.modules!.includes(k))) return fail(400, ADMIN_KEEPS_ADMIN);
  const [row, roleRow] = await Promise.all([
    db.workspaceSetting.findUnique({ where: { userId }, select: { modules: true, focusMode: true, companionEnabled: true } }),
    db.roleWorkspaceDefault.findUnique({ where: { role }, select: { modules: true, focusMode: true } }),
  ]);
  const before = settingInput(row);
  const changes = userSettingChanges(before, after, { label: ROLE_LABELS[role], modules: roleModules(role, roleRow).modules, focusMode: roleFocus(role, roleRow).focusMode });
  if (!changes.length) return fail(400, NOTHING_CHANGED);
  const data = {
    modules: after.modules === null ? Prisma.DbNull : json(after.modules),
    focusMode: after.focusMode,
    companionEnabled: after.companionEnabled,
    updatedById: actor.id,
  };
  await db.$transaction(async (tx) => {
    await tx.workspaceSetting.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await logAudit(tx, { actorId: actor.id, action: "workspace-user-setting", entity: "WorkspaceSetting", entityId: userId, meta: { before, after, changes, role } });
  });
  return { ok: true, data: { changes } };
}
