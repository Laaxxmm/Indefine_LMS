// Route-level enforcement of the workspace settings. Call requireModule() at the top of a module's
// layout (or page) right after its own access guard:
//
//   const session = await auth();
//   if (!session?.user) redirect("/");
//   if (!canViewClients(session.user)) redirect("/dashboard");   // the area's own rule, unchanged
//   await requireModule(session.user, "clients");                 // then the workspace switch
//
// A person whose role may not use the module goes to /dashboard as before (no message: the area's
// own guard normally catches them first). A person whose module is switched off goes to
// /dashboard?module-off=<key>; the dashboard shows moduleOffNotice() as a plain sentence.
// Never call it for the dashboard itself, which is everyone's landing page.
// While the Firm OS master switch is off (FIRM_OS_ENABLED, flag.ts), a Firm OS module sends everyone
// to /dashboard?module-off=firm-os instead, and requireFirmOs() closes the admin Firm OS pages.
//
// The companion is not a module but a per-person switch (WorkspaceSetting.companionEnabled);
// requireCompanion() gates /companion the same way and the dashboard explains it the same way.
import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/access";
import { canUseCompanion } from "@/lib/companion/access";
import { canAccessModule } from "./access";
import { FIRM_OS_OFF_MESSAGE, firmOsEnabled } from "./flag";
import { isFirmOsModule, isModuleKey, moduleLabel, type ModuleKey } from "./registry";
import { companionAllowedFor, isModuleEnabled, type WorkspaceDb } from "./settings";

/** Query parameter the dashboard reads to explain why the person landed there. */
export const MODULE_OFF_PARAM = "module-off";

/** The `module-off` value for the companion switch (not a module key). */
export const COMPANION_OFF = "companion";
/** The `module-off` value while the Firm OS master switch is off (src/lib/workspace/flag.ts). */
export const FIRM_OS_OFF = "firm-os";

type OffKey = ModuleKey | typeof COMPANION_OFF | typeof FIRM_OS_OFF;

export function moduleOffHref(key: OffKey): string {
  return `/dashboard?${MODULE_OFF_PARAM}=${key}`;
}

/** The plain sentence shown on the dashboard: what is wrong and what to do. */
export function moduleOffMessage(key: OffKey): string {
  if (key === FIRM_OS_OFF) return FIRM_OS_OFF_MESSAGE;
  const what = key === COMPANION_OFF ? "The Companion" : moduleLabel(key);
  return `${what} is turned off for your account. If you need it, ask an admin to turn it on in Workspace settings.`;
}

/** The message for a dashboard search-param value, or null when there is nothing (or nothing known) to say. */
export function moduleOffNotice(param: string | string[] | null | undefined): string | null {
  const v = Array.isArray(param) ? param[0] : param;
  return isModuleKey(v) || v === COMPANION_OFF || v === FIRM_OS_OFF ? moduleOffMessage(v) : null;
}

/**
 * May this person open the companion pairing page? Never while Firm OS is switched off; otherwise
 * the companion's own rule (active, and the person's switch on or an admin or partner) with the
 * switch read from the workspace settings — the answer the pairing routes give (hasCompanionAccess).
 */
export async function companionVisibleFor(user: SessionUser, db?: WorkspaceDb): Promise<boolean> {
  if (!firmOsEnabled()) return false;
  return canUseCompanion(user, await companionAllowedFor(user, db));
}

/** Redirects away unless the person may pair the companion. Returns when they may. */
export async function requireCompanion(user: SessionUser, db?: WorkspaceDb): Promise<void> {
  if (!user) redirect("/");
  if (!firmOsEnabled()) redirect(moduleOffHref(FIRM_OS_OFF));
  if (!(await companionVisibleFor(user, db))) redirect(moduleOffHref(COMPANION_OFF));
}

/** Redirects to the dashboard (which says why) while the Firm OS master switch is off. */
export function requireFirmOs(user: SessionUser): void {
  if (!user) redirect("/");
  if (!firmOsEnabled()) redirect(moduleOffHref(FIRM_OS_OFF));
}

/** Redirects away unless the person may use `key` and has it switched on. Returns when they may. */
export async function requireModule(user: SessionUser, key: ModuleKey, db?: WorkspaceDb): Promise<void> {
  if (!user) redirect("/");
  if (!canAccessModule(user, key)) redirect("/dashboard");
  if (isFirmOsModule(key) && !firmOsEnabled()) redirect(moduleOffHref(FIRM_OS_OFF));
  if (!(await isModuleEnabled(user, key, db))) redirect(moduleOffHref(key));
}
