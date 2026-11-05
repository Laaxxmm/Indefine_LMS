// Consent withdrawal (DPDP Act s.6(4)) as processing restrictions. A restriction is an AuditEvent
// { action: "restrict-processing", entity: "Client" | "User", entityId, meta.restrictions } — no
// column changes, nothing removed. What each restriction stops is listed in policy.ts RESTRICTIONS.
//
// Enforcement points (owned by other modules; they should call isAiProcessingRestricted() before
// work starts): the agent runner and ModelRouter (no new AI processing), comms drafting (no new
// drafts), onboarding / growth notes (no marketing use). For staff, withdrawal also switches off
// break nudges in CoachPreference, so no activity heartbeats are collected.
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { Refusal, fail, ok, type ServiceResult } from "@/lib/corrections/result";
import type { PrivacyReadDb } from "./inventory";
import { RESTRICTIONS, WITHDRAWAL_LIMITS, type RestrictionKey } from "./policy";
import { guardRegister, loadMatches, loadOpen, requireVerified, writeAudit, type PrivacyDeps, type Tx } from "./register";

export async function restrictInTx(
  tx: Tx,
  r: { actorId: string; requestId: string; entity: "Client" | "User"; entityId: string; keys: readonly RestrictionKey[]; why: "consent-withdrawal" | "erasure-hold" },
): Promise<void> {
  await writeAudit(tx, { actorId: r.actorId, action: "restrict-processing", entity: r.entity, entityId: r.entityId, meta: { restrictions: [...r.keys], privacyRequestId: r.requestId, why: r.why } });
}

const CLIENT_KEYS: readonly RestrictionKey[] = ["ai-processing", "comms-drafts", "marketing"];
const STAFF_KEYS: readonly RestrictionKey[] = ["coach-activity", "ai-processing"];
const labelOf = (k: RestrictionKey) => RESTRICTIONS.find((r) => r.key === k)?.label ?? k;

export async function withdrawConsent(user: SessionUser, id: string, deps: PrivacyDeps): Promise<ServiceResult<{ restricted: number; restrictions: string[] }>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  const actorId = user!.id;
  try {
    const out = await deps.db.$transaction(async (tx: Tx) => {
      await loadOpen(tx, id, ["consent-withdrawal"]);
      await requireVerified(tx, id);
      const matches = await loadMatches(tx, id);
      if (!matches.length) throw new Refusal(409, "No records were found for this person, so there is nothing to restrict. Close the request with that reply instead.");
      const applied = new Set<RestrictionKey>();
      for (const m of matches) {
        if (m.principalType === "staff") {
          const pref = await tx.coachPreference.findUnique({ where: { userId: m.ref }, select: { userId: true } });
          if (pref) await tx.coachPreference.update({ where: { userId: m.ref }, data: { breakNudges: false } });
          else await tx.coachPreference.create({ data: { userId: m.ref, breakNudges: false } });
          await restrictInTx(tx, { actorId, requestId: id, entity: "User", entityId: m.ref, keys: STAFF_KEYS, why: "consent-withdrawal" });
          STAFF_KEYS.forEach((k) => applied.add(k));
        } else {
          await restrictInTx(tx, { actorId, requestId: id, entity: "Client", entityId: m.ref, keys: CLIENT_KEYS, why: "consent-withdrawal" });
          CLIENT_KEYS.forEach((k) => applied.add(k));
        }
      }
      const restrictions = [...applied].map(labelOf);
      await tx.privacyRequest.update({
        where: { id },
        data: { status: "COMPLETED", handledById: actorId, outcome: `Processing restricted: ${restrictions.join("; ")}. ${WITHDRAWAL_LIMITS}` },
      });
      await writeAudit(tx, { actorId, action: "restrict-processing", entity: "PrivacyRequest", entityId: id, meta: { records: matches.length, restrictions: [...applied] } });
      return { restricted: matches.length, restrictions };
    });
    return ok(out);
  } catch (e) {
    if (e instanceof Refusal) return fail(e.status, e.message);
    throw e;
  }
}

/** Restrictions recorded for an LMS client or a user (empty when none). */
export async function processingRestrictions(db: Pick<PrivacyReadDb, "auditEvent">, q: { entity: "Client" | "User"; entityId: string }): Promise<RestrictionKey[]> {
  const events = await db.auditEvent.findMany({ where: { action: "restrict-processing", entity: q.entity, entityId: q.entityId }, select: { meta: true } });
  const keys = new Set<RestrictionKey>();
  for (const e of events) {
    const list = ((e.meta ?? {}) as Prisma.JsonObject).restrictions;
    if (Array.isArray(list)) for (const k of list) if (RESTRICTIONS.some((r) => r.key === k)) keys.add(k as RestrictionKey);
  }
  return [...keys];
}

/** For the agent runner, ModelRouter callers and comms: may this Firm OS client's data go to an AI model? */
export async function isAiProcessingRestricted(db: Pick<PrivacyReadDb, "auditEvent" | "firmClient">, firmClientId: string): Promise<boolean> {
  const fc = await db.firmClient.findUnique({ where: { id: firmClientId }, select: { lmsClientId: true } });
  if (!fc) return false;
  return (await processingRestrictions(db, { entity: "Client", entityId: fc.lmsClientId })).includes("ai-processing");
}
