import type { Session } from "next-auth";

// Neo Centra — the directors' cockpit. Access follows the "Director" designation set
// in the admin panel (/admin/team → Director column, User.isDirector). Marking or
// unmarking someone there grants/revokes the tool automatically; nobody else sees it.
export function canUseNeoCentra(user: Session["user"] | null | undefined): boolean {
  return !!user && user.active === true && user.isDirector === true;
}
