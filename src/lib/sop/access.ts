import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { isActive, isAdmin, isManagement } from "@/lib/access";

// SOP access model:
//  - view   : any internal-active user (all departments)
//  - author : admins (any department) + employees the admin granted edit access (SopEditor)
//  - edit a SOP : admins (any) OR a granted editor whose own department == the SOP's department
//  - manage grants : admins only
//  - remove a screen : admins and partners (it blanks the picture in every version; SOP review H1)
// scripts/lib/rbac-check.ts counts the exported functions here as policies (POLICY_FILES).
// (Single-tenant Entra + pre-provisioned rows means only internal members get a session.)

type SopUser = Session["user"] | null | undefined;

export function canViewSop(user: SopUser): boolean {
  return isActive(user);
}

export function isSopAdmin(user: SopUser): boolean {
  return isActive(user) && isAdmin(user);
}

async function isGrantedEditor(userId: string): Promise<boolean> {
  const grant = await prisma.sopEditor.findUnique({ where: { userId }, select: { id: true } });
  return !!grant;
}

// May this user author SOPs at all? (Admins, or a granted editor.) The department
// restriction for granted editors is enforced per-SOP by canEditSop().
export async function canCreateSop(user: SopUser): Promise<boolean> {
  if (!user || !isActive(user)) return false;
  if (isAdmin(user)) return true;
  return isGrantedEditor(user.id);
}

// May this user create/edit a SOP belonging to `department`?
// Admins: any department. Granted editors: only their own department.
export async function canEditSop(user: SopUser, department: string): Promise<boolean> {
  if (!user || !isActive(user)) return false;
  if (isAdmin(user)) return true;
  if (user.department !== department) return false;
  return isGrantedEditor(user.id);
}

// May this user remove a screenshot from a SOP for good (blank its picture in every version and
// re-file the Word files)? Active admins and partners: the same people who decide DPDP erasure.
export function canRemoveSopScreen(user: SopUser): boolean {
  return isActive(user) && isManagement(user);
}
