import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

// SOP access model:
//  - view   : any internal-active user (all departments)
//  - author : admins (any department) + employees the admin granted edit access (SopEditor)
//  - edit a SOP : admins (any) OR a granted editor whose own department == the SOP's department
//  - manage grants : admins only
// (Single-tenant Entra + pre-provisioned rows means only internal members get a session.)

type SopUser = Session["user"] | null | undefined;

export function canViewSop(user: SopUser): boolean {
  return !!user && user.active === true;
}

export function isSopAdmin(user: SopUser): boolean {
  return !!user && user.active === true && user.role === "ADMIN";
}

async function isGrantedEditor(userId: string): Promise<boolean> {
  const grant = await prisma.sopEditor.findUnique({ where: { userId }, select: { id: true } });
  return !!grant;
}

// May this user author SOPs at all? (Admins, or a granted editor.) The department
// restriction for granted editors is enforced per-SOP by canEditSop().
export async function canCreateSop(user: SopUser): Promise<boolean> {
  if (!user || user.active !== true) return false;
  if (user.role === "ADMIN") return true;
  return isGrantedEditor(user.id);
}

// May this user create/edit a SOP belonging to `department`?
// Admins: any department. Granted editors: only their own department.
export async function canEditSop(user: SopUser, department: string): Promise<boolean> {
  if (!user || user.active !== true) return false;
  if (user.role === "ADMIN") return true;
  if (user.department !== department) return false;
  return isGrantedEditor(user.id);
}
