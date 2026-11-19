// How a DPDP erasure marks Turia pull rows, so the next run neither copies the person back from
// Turia nor maps them again (src/lib/privacy/inventory.ts erases; sync.ts and admin.ts honour it).
//
//   client  TuriaClientLink.key and TuriaTaskMirror.clientKey (the client's normalised name)
//           become erasedClientKey(): "erased:" + a keyed hash of the old key. The pull hashes the
//           key of every task it reads the same way, so a task of an erased client is recognised
//           without the name being stored anywhere. The link is set to "ignored".
//   person  TuriaPersonLink.matchedBy becomes "erased" (name and email cleared, no LMS user). The
//           pull then never matches that Turia user again and writes "[erased]" for their name in
//           the assignee and reviewer lists it mirrors.
//
// The hash is keyed with the same secret as the privacy register's identifier hash (AUTH_SECRET in
// production, src/lib/privacy/locator.ts), so the key cannot be reversed by trying client names.
// Pure: no I/O.
import { createHmac } from "node:crypto";

export const ERASED_KEY_PREFIX = "erased:";
export const ERASED_PERSON = "erased";
/** What the pull writes for an erased person's name, and the erasure writes for their entries. */
export const ERASED_NAME = "[erased]";
/** The name an erased TuriaClientLink shows on the admin page: the privacy note. */
export const ERASED_CLIENT_NOTE = "[erased] Erased under a DPDP request. The Turia pull ignores this client; erase or anonymise it in Turia too.";

const DEFAULT_SECRET = "firm-os-privacy";

/** The erased form of a Turia client key ("acme traders private limited" -> "erased:3f…"). Already erased: unchanged. */
export function erasedClientKey(key: string, secret: string | undefined = process.env.AUTH_SECRET): string {
  if (isErasedKey(key)) return key;
  return ERASED_KEY_PREFIX + createHmac("sha256", secret || DEFAULT_SECRET).update(`turia-client:${key}`).digest("hex").slice(0, 40);
}

export const isErasedKey = (key: unknown): boolean => typeof key === "string" && key.startsWith(ERASED_KEY_PREFIX);
