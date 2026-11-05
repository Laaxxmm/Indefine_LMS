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
import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/access";
import { canAccessModule } from "./access";
import { isModuleKey, moduleLabel, type ModuleKey } from "./registry";
import { isModuleEnabled, type WorkspaceDb } from "./settings";

/** Query parameter the dashboard reads to explain why the person landed there. */
export const MODULE_OFF_PARAM = "module-off";

export function moduleOffHref(key: ModuleKey): string {
  return `/dashboard?${MODULE_OFF_PARAM}=${key}`;
}

/** The plain sentence shown on the dashboard: what is wrong and what to do. */
export function moduleOffMessage(key: ModuleKey): string {
  return `${moduleLabel(key)} is turned off for your account. If you need it, ask an admin to turn it on in Workspace settings.`;
}

/** The message for a dashboard search-param value, or null when there is nothing (or nothing known) to say. */
export function moduleOffNotice(param: string | string[] | null | undefined): string | null {
  const v = Array.isArray(param) ? param[0] : param;
  return isModuleKey(v) ? moduleOffMessage(v) : null;
}

/** Redirects away unless the person may use `key` and has it switched on. Returns when they may. */
export async function requireModule(user: SessionUser, key: ModuleKey, db?: WorkspaceDb): Promise<void> {
  if (!user) redirect("/");
  if (!canAccessModule(user, key)) redirect("/dashboard");
  if (!(await isModuleEnabled(user, key, db))) redirect(moduleOffHref(key));
}
