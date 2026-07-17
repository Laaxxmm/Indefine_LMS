import type { Session } from "next-auth";

// Neo Centra — the directors' cockpit. Access is a fixed allowlist of the firm's
// directors (matched by email), plus whatever emails are in NEO_CENTRA_DIRECTOR_EMAILS.
// Nobody else sees the tool. The named list mirrors the source's director_registry.
//
// TODO: fill in the four missing emails (or set NEO_CENTRA_DIRECTOR_EMAILS in the env).
export type Director = { name: string; email: string; complianceOwner?: boolean; admin?: boolean };

export const DIRECTORS: Director[] = [
  { name: "Lakshmanan", email: "laaxxmm@gmail.com", admin: true },
  { name: "Abijithnanthan", email: "", complianceOwner: true },
  { name: "Kishore", email: "", complianceOwner: true },
  { name: "Rajkumar", email: "" },
  { name: "Vasanth", email: "" },
];

// Effective allowlist: env override (comma-separated) wins, else the DIRECTORS emails.
function directorEmails(): Set<string> {
  const env = (process.env.NEO_CENTRA_DIRECTOR_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const list = env.length ? env : DIRECTORS.map((d) => d.email.trim().toLowerCase()).filter(Boolean);
  return new Set(list);
}

export function canUseNeoCentra(user: Session["user"] | null | undefined): boolean {
  if (!user || user.active !== true || !user.email) return false;
  return directorEmails().has(user.email.toLowerCase());
}

// The director record for the signed-in user (for greeting / ownership).
export function currentDirector(user: Session["user"] | null | undefined): Director | null {
  if (!user?.email) return null;
  const email = user.email.toLowerCase();
  return DIRECTORS.find((d) => d.email.toLowerCase() === email) ?? null;
}

export function isNeoCentraAdmin(user: Session["user"] | null | undefined): boolean {
  return canUseNeoCentra(user) && currentDirector(user)?.admin === true;
}
