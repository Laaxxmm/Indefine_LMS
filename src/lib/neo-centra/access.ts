import type { Session } from "next-auth";

// Neo Centra — the directors' cockpit. Directors are the firm's Partners, so access
// follows the existing "Partner" level set in the admin panel (/admin/team → Level).
// Promoting/demoting someone to Partner there grants/revokes the tool automatically.
export function canUseNeoCentra(user: Session["user"] | null | undefined): boolean {
  return !!user && user.active === true && user.level === "PARTNER";
}

// A director who is also an admin sees every director's incentive detail; other
// directors see their own detail + everyone's bucket totals only.
export function isNeoCentraAdmin(user: Session["user"] | null | undefined): boolean {
  return canUseNeoCentra(user) && user!.role === "ADMIN";
}
