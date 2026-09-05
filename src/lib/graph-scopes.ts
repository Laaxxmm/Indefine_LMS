// Delegated Microsoft Graph scopes, in three tiers. Pure: no imports, asserted by
// scripts/verify-graph-scopes.ts.
//
//   SIGNIN_SCOPES    what every employee grants at sign-in. Identity only, no
//                    offline_access, so Entra issues no refresh token and nothing
//                    long-lived sits in the database for people who never need Graph.
//   ELEVATED_SCOPES  what a live-session organiser (or an admin acting as one) grants
//                    once at /connect: calendar, meetings, transcripts and drive writes.
//   LEAD_SCOPES      ELEVATED plus Teams chat, for the work-tracker lead's nudges.
//
// Everything that reads video, syncs users or uploads files uses the app-only token
// first (src/lib/graph.ts getAppOnlyToken); a delegated token is only needed where
// Graph insists on acting as a person: someone's calendar, someone's OneDrive
// /Recordings, someone's chat.

const IDENTITY = "openid profile email User.Read";
export const SIGNIN_SCOPES = IDENTITY;
export const ELEVATED_SCOPES = `${IDENTITY} offline_access Files.Read.All Files.ReadWrite.All Calendars.ReadWrite OnlineMeetings.ReadWrite OnlineMeetingTranscript.Read.All OnlineMeetingArtifact.Read.All`;
export const LEAD_SCOPES = `${ELEVATED_SCOPES} Chat.Create ChatMessage.Send`;

/** Scopes Entra does not echo back in the token response's `scope` field. */
const OIDC = new Set(["openid", "profile", "email", "offline_access"]);

/** Does a granted scope string (as stored on the Account row) cover every Graph scope in `required`? */
export function scopesCover(granted: string | null | undefined, required: string): boolean {
  const have = new Set((granted ?? "").split(/\s+/).filter(Boolean).map((s) => s.slice(s.lastIndexOf("/") + 1)));
  return required.split(/\s+/).filter((s) => s && !OIDC.has(s)).every((s) => have.has(s));
}
