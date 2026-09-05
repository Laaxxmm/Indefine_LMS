// Who is who. Every access rule in the app starts from these four predicates, so a
// reader can answer "who can do X" by grepping for the helper instead of for
// role/level string literals.
//
//   isActive     signed in and not deactivated by the M365 org sync (users-sync.ts)
//   isAdmin      role = ADMIN — promoted from ADMIN_EMAILS on first sign-in, or in /admin/team
//   isPartner    level = PARTNER — the firm's directors, set per user in /admin/team
//   isManagement admin or partner
//
// Module-specific rules compose these and live next to the module they guard:
//   src/lib/clients/core.ts        canViewClients / canManageClients / isClientsAdmin
//   src/lib/sop/access.ts          canViewSop / isSopAdmin / canCreateSop / canEditSop
//   src/lib/neo-centra/access.ts   canUseNeoCentra / isNeoCentraAdmin
//   src/lib/certificates/access.ts canUseCertificateTool
//   src/lib/office-tools/access.ts canUseOfficeTools
//   src/lib/work/core.ts           canUseWork / isWorkLead (email allow-list, not role)
//
// Admin pages and routes use isAdmin directly. Nothing here touches the database.
import type { Session } from "next-auth";

export type SessionUser = Session["user"] | null | undefined;

export function isActive(user: SessionUser): boolean {
  return !!user && user.active === true;
}

export function isAdmin(user: SessionUser): boolean {
  return !!user && user.role === "ADMIN";
}

export function isPartner(user: SessionUser): boolean {
  return !!user && user.level === "PARTNER";
}

export function isManagement(user: SessionUser): boolean {
  return isAdmin(user) || isPartner(user);
}
