import type { Session } from "next-auth";

// §2 access rule — internal users only. Because Microsoft Entra is single-tenant and
// User rows are pre-provisioned by the admin org-sync (users-sync.ts), only internal
// tenant members can obtain a session. We additionally require an ACTIVE row. Keep the
// rule in this one function so it can be tightened later (departments/roles) without
// hunting through code. Do NOT fall back to `!!user`.
export function canUseCertificateTool(user: Session["user"] | undefined | null): boolean {
  return !!user && user.active === true;
}
