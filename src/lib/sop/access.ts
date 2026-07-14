import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

// SOP access model:
//  - view  : any internal-active user (all departments)
//  - edit/create : admins + globally-granted editors (SopEditor)
//  - manage grants : admins only
// (Single-tenant Entra + pre-provisioned rows means only internal members get a session.)

export function canViewSop(user: Session["user"] | null | undefined): boolean {
  return !!user && user.active === true;
}

export function isSopAdmin(user: Session["user"] | null | undefined): boolean {
  return !!user && user.active === true && user.role === "ADMIN";
}

export async function canEditSop(user: Session["user"] | null | undefined): Promise<boolean> {
  if (!user || user.active !== true) return false;
  if (user.role === "ADMIN") return true;
  const grant = await prisma.sopEditor.findUnique({ where: { userId: user.id }, select: { id: true } });
  return !!grant;
}
