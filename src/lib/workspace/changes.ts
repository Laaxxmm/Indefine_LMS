// Plain-English change summaries for /admin/firm-os/workspace: shown to the admin before saving
// and stored in the AuditEvent. Pure; safe to import in client panels.
import type { FirmRole } from "@/lib/rbac/policy";
import { ROLE_LABELS, moduleLabel, sortModules, type ModuleKey } from "./registry";

export type RoleDefaultInput = { modules: ModuleKey[]; focusMode: boolean };
/** A person's own setting; null = follow the role default. */
export type UserSettingInput = { modules: ModuleKey[] | null; focusMode: boolean | null; companionEnabled: boolean };

export const FOLLOW_ROLE: UserSettingInput = { modules: null, focusMode: null, companionEnabled: false };

const names = (keys: ModuleKey[]) => keys.map(moduleLabel).join(", ");
const onOff = (b: boolean) => (b ? "on" : "off");

/** "turns on Clients, Comms; turns off Tools", or null when the lists hold the same modules. */
export function moduleDiff(before: readonly ModuleKey[], after: readonly ModuleKey[]): string | null {
  const on = sortModules(after.filter((k) => !before.includes(k)));
  const off = sortModules(before.filter((k) => !after.includes(k)));
  const parts = [on.length ? `turns on ${names(on)}` : "", off.length ? `turns off ${names(off)}` : ""].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

export function roleDefaultChanges(role: FirmRole, before: RoleDefaultInput, after: RoleDefaultInput): string[] {
  const label = ROLE_LABELS[role];
  const out: string[] = [];
  const diff = moduleDiff(before.modules, after.modules);
  if (diff) out.push(`${label} default modules: ${diff}.`);
  if (before.focusMode !== after.focusMode) out.push(`Focus mode for ${label}: ${onOff(after.focusMode)} (was ${onOff(before.focusMode)}).`);
  return out;
}

export type RoleContext = { label: string; modules: readonly ModuleKey[]; focusMode: boolean };

export function userSettingChanges(before: UserSettingInput, after: UserSettingInput, role: RoleContext): string[] {
  const out: string[] = [];
  const diff = moduleDiff(before.modules ?? role.modules, after.modules ?? role.modules);
  if (before.modules === null && after.modules !== null) out.push(`Modules: their own list instead of the ${role.label} default${diff ? `; ${diff}` : ""}.`);
  else if (before.modules !== null && after.modules === null) out.push(`Modules: back to the ${role.label} default${diff ? `; ${diff}` : ""}.`);
  else if (diff) out.push(`Modules: ${diff}.`);

  if (before.focusMode !== after.focusMode) {
    if (after.focusMode === null) out.push(`Focus mode: back to the ${role.label} default (${onOff(role.focusMode)}).`);
    else out.push(`Focus mode: ${onOff(after.focusMode)}${before.focusMode === null ? ` (was the ${role.label} default, ${onOff(role.focusMode)})` : ""}.`);
  }
  if (before.companionEnabled !== after.companionEnabled) out.push(after.companionEnabled ? "Companion extension: allowed." : "Companion extension: not allowed.");
  return out;
}

/** True when the person follows their role in everything (nothing of their own is saved). */
export const followsRole = (s: UserSettingInput) => s.modules === null && s.focusMode === null && !s.companionEnabled;
