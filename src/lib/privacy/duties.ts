// Separation of duties on the privacy register (DPDP audit finding #28). One person must not carry
// a request from start to end on their own word:
//
//   verify   the person who logged a request does not verify the requester's identity; an "Other"
//            verification needs a note that says what was actually checked (at least 20 characters)
//   erase    an erasure is confirmed by a partner or an admin who did not verify the identity
//            (so at least two people: one checks who is asking, another decides what is erased)
//
// The verify checks are called from register.ts verifyIdentity(); the erasure check from
// erasure.ts confirmErasure(). Each check throws a Refusal (inside a step's transaction) or returns
// a sentence, like the rest of the register. Reads only.
import { isActive, isAdmin, isPartner, type SessionUser } from "@/lib/access";
import { Refusal } from "@/lib/corrections/result";
import type { PrivacyReadDb } from "./inventory";

export const OTHER_VERIFY_NOTE_MIN = 20;

export const SELF_VERIFY_MESSAGE = "You logged this request, so someone else must check the person's identity. Ask another admin or partner to verify it.";
export const OTHER_NOTE_MESSAGE = `Say what was checked to confirm the person's identity, in at least ${OTHER_VERIFY_NOTE_MIN} characters (for example which document was seen, and by whom).`;
export const SELF_ERASURE_MESSAGE =
  "You verified this person's identity, so a partner or another admin must confirm the erasure. Ask them to review the plan and confirm it.";
export const ERASURE_DECIDER_MESSAGE = "Only a partner or an admin can decide an erasure.";

/** The note an identity check needs: null when it is enough, else the sentence to show (400). */
export function verificationNoteProblem(method: string, note: string | null | undefined): string | null {
  if (!method.startsWith("Other")) return null;
  return (note?.trim().length ?? 0) >= OTHER_VERIFY_NOTE_MIN ? null : OTHER_NOTE_MESSAGE;
}

/** The person who logged the request may not verify it. Call inside the verify step; throws Refusal(403). */
export async function assertNotCreator(db: Pick<PrivacyReadDb, "privacyRequest">, requestId: string, user: SessionUser): Promise<void> {
  const r = await db.privacyRequest.findUnique({ where: { id: requestId }, select: { createdById: true } });
  if (r && user && r.createdById === user.id) throw new Refusal(403, SELF_VERIFY_MESSAGE);
}

/** Who recorded the identity check of a request (the actor of its verify-identity audit), or null. */
export async function verifierOf(db: Pick<PrivacyReadDb, "auditEvent">, requestId: string): Promise<string | null> {
  const ev = await db.auditEvent.findFirst({ where: { entity: "PrivacyRequest", entityId: requestId, action: "verify-identity" }, orderBy: { createdAt: "asc" }, select: { actorId: true } });
  return ev?.actorId ?? null;
}

/** An erasure is decided by an active partner or admin who did not verify the identity. Throws Refusal(403). */
export async function assertErasureDecider(db: Pick<PrivacyReadDb, "auditEvent">, requestId: string, user: SessionUser): Promise<void> {
  if (!user || !isActive(user) || !(isAdmin(user) || isPartner(user))) throw new Refusal(403, ERASURE_DECIDER_MESSAGE);
  if ((await verifierOf(db, requestId)) === user.id) throw new Refusal(403, SELF_ERASURE_MESSAGE);
}
