// Consent withdrawal (DPDP Act s.6(4)) as processing restrictions. A restriction is an AuditEvent
// { action: "restrict-processing", entity: "Client" | "User", entityId, meta.restrictions,
// meta.privacyRequestId } — no column changes, nothing removed. What each restriction stops is
// listed in policy.ts RESTRICTIONS. Erasure legal holds record the same events (erasure.ts).
//
// Lifting is another AuditEvent { action: "lift-restriction", same entity and entityId,
// meta.restrictions, meta.privacyRequestId, meta.reason }: partner only (canLiftRestriction),
// with a reason. A record is restricted while any request's restriction on it is not lifted;
// processingRestrictions() replays the events in order.
//
// Enforcement (docs/dpdp/consent-purpose.md "Security integration"): before any model call the
// agent runner (and the agent service before a change request or re-run), onboarding extraction
// and comms drafting call isAiProcessingRestricted() for the client involved and refuse with
// AI_RESTRICTED_MESSAGE, writing nothing; comms drafting also honours "comms-drafts". For staff,
// withdrawal also switches off break nudges in CoachPreference, so no activity heartbeats are
// collected.
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { Refusal, fail, ok, type ServiceResult } from "@/lib/corrections/result";
import { scrubFreeText } from "@/lib/corrections/mask";
import { LIFT_NOT_ALLOWED, canLiftRestriction } from "./access";
import type { PrivacyReadDb } from "./inventory";
import { RESTRICTIONS, WITHDRAWAL_LIMITS, type RestrictionKey } from "./policy";
import { NOT_RESOLVED, guardRegister, loadMatches, loadOpen, principalOf, requireVerified, writeAudit, type PrivacyDeps, type Tx } from "./register";

/** What a person sees when work would send a restricted client's data to a model. */
export const AI_RESTRICTED_MESSAGE = "This client has restricted AI processing. Prepare this by hand or ask a partner to lift the restriction.";
/** What a person sees when a draft is asked for a client who withdrew consent to new drafts. */
export const COMMS_RESTRICTED_MESSAGE = "This client has asked for no new message drafts. Write to them by hand or ask a partner to lift the restriction.";

export const RESTRICT_ACTION = "restrict-processing";
export const LIFT_ACTION = "lift-restriction";

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
      // Only the one person the request is linked to; several matching records must be resolved first.
      const matches = await principalOf(tx, id);
      if (!matches.length) {
        if ((await loadMatches(tx, id)).length > 1) throw new Refusal(409, NOT_RESOLVED);
        throw new Refusal(409, "No records were found for this person, so there is nothing to restrict. Refuse the request with that reply instead.");
      }
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

// ------------------------------------------------------------------ reading restrictions

type RestrictionEventRow = { meta: Prisma.JsonValue | null; createdAt: Date };
type SubjectWhere = { action: string; entity: string; entityId: string };

/** The one read restrictions need (PrismaClient, a transaction, the app client and test fakes satisfy it). */
export interface RestrictionReadDb {
  auditEvent: { findMany(args: { where: SubjectWhere; select: { meta: true; createdAt: true } }): PromiseLike<RestrictionEventRow[]> };
}
/** Resolving a Firm OS client to its LMS client. */
export interface FirmClientReadDb {
  firmClient: { findUnique(args: { where: { id: string }; select: { lmsClientId: true } }): PromiseLike<{ lmsClientId: string } | null> };
}

export type Subject = { entity: "Client" | "User"; entityId: string };

const isKey = (k: unknown): k is RestrictionKey => RESTRICTIONS.some((r) => r.key === k);
const metaOf = (m: Prisma.JsonValue | null) => (m && typeof m === "object" && !Array.isArray(m) ? (m as Prisma.JsonObject) : {});
const keysIn = (m: Prisma.JsonObject) => (Array.isArray(m.restrictions) ? m.restrictions.filter(isKey) : []);

/**
 * Restrictions in force per privacy request for one LMS client or user: the restrict events
 * replayed in time order, each lift removing the keys it names for its request. Keys keep the
 * order they were first recorded.
 */
export async function restrictionsByRequest(db: RestrictionReadDb, q: Subject): Promise<Map<string, RestrictionKey[]>> {
  const select = { meta: true, createdAt: true } as const;
  const [restricts, lifts] = await Promise.all([
    db.auditEvent.findMany({ where: { action: RESTRICT_ACTION, entity: q.entity, entityId: q.entityId }, select }),
    db.auditEvent.findMany({ where: { action: LIFT_ACTION, entity: q.entity, entityId: q.entityId }, select }),
  ]);
  const events = [...restricts.map((e) => ({ ...e, lift: false })), ...lifts.map((e) => ({ ...e, lift: true }))].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || Number(a.lift) - Number(b.lift),
  );
  const byRequest = new Map<string, RestrictionKey[]>();
  for (const e of events) {
    const m = metaOf(e.meta);
    const request = typeof m.privacyRequestId === "string" ? m.privacyRequestId : "";
    const current = byRequest.get(request) ?? [];
    const keys = keysIn(m);
    byRequest.set(request, e.lift ? current.filter((k) => !keys.includes(k)) : [...current, ...keys.filter((k) => !current.includes(k))]);
  }
  for (const [request, keys] of byRequest) if (!keys.length) byRequest.delete(request); // in-memory bookkeeping only
  return byRequest;
}

/** Restrictions in force for an LMS client or a user (empty when none or all lifted). */
export async function processingRestrictions(db: RestrictionReadDb, q: Subject): Promise<RestrictionKey[]> {
  const out: RestrictionKey[] = [];
  for (const keys of (await restrictionsByRequest(db, q)).values()) for (const k of keys) if (!out.includes(k)) out.push(k);
  return out;
}

async function lmsClientIdOf(db: Partial<FirmClientReadDb>, client: string | { lmsClientId: string }): Promise<string | null> {
  if (typeof client !== "string") return client.lmsClientId || null;
  if (!db.firmClient) throw new Error("isAiProcessingRestricted: a Firm OS client id needs a database with firmClient");
  return (await db.firmClient.findUnique({ where: { id: client }, select: { lmsClientId: true } }))?.lmsClientId ?? null;
}

/**
 * For the agent runner, ModelRouter callers and comms: may this client's data go to an AI model?
 * Takes a Firm OS client id (FirmClient.id), or the LMS client id when the caller already has it.
 */
export async function isAiProcessingRestricted(db: RestrictionReadDb & FirmClientReadDb, firmClientId: string): Promise<boolean>;
export async function isAiProcessingRestricted(db: RestrictionReadDb, client: { lmsClientId: string }): Promise<boolean>;
export async function isAiProcessingRestricted(db: RestrictionReadDb & Partial<FirmClientReadDb>, client: string | { lmsClientId: string }): Promise<boolean> {
  const lmsClientId = await lmsClientIdOf(db, client);
  if (!lmsClientId) return false;
  return (await processingRestrictions(db, { entity: "Client", entityId: lmsClientId })).includes("ai-processing");
}

/** For comms drafting: did this client withdraw consent to new message drafts? */
export async function isCommsDraftingRestricted(db: RestrictionReadDb & FirmClientReadDb, firmClientId: string): Promise<boolean> {
  const lmsClientId = await lmsClientIdOf(db, firmClientId);
  if (!lmsClientId) return false;
  return (await processingRestrictions(db, { entity: "Client", entityId: lmsClientId })).includes("comms-drafts");
}

// ------------------------------------------------------------------ lifting a restriction

export type ActiveRestriction = Subject & { keys: RestrictionKey[]; labels: string[] };

/** The restrictions this request recorded that are still in force (what "Lift restriction" would lift). */
export async function activeRestrictionsOf(db: Pick<PrivacyReadDb, "auditEvent">, requestId: string): Promise<ActiveRestriction[]> {
  const recorded = await db.auditEvent.findMany({ where: { action: RESTRICT_ACTION, entity: { in: ["Client", "User"] } }, select: { entity: true, entityId: true, meta: true } });
  const subjects = new Map<string, Subject>();
  for (const e of recorded) {
    if (metaOf(e.meta).privacyRequestId !== requestId || !e.entityId) continue;
    subjects.set(`${e.entity}:${e.entityId}`, { entity: e.entity as Subject["entity"], entityId: e.entityId });
  }
  const out: ActiveRestriction[] = [];
  for (const s of subjects.values()) {
    const keys = (await restrictionsByRequest(db, s)).get(requestId) ?? [];
    if (keys.length) out.push({ ...s, keys, labels: keys.map(labelOf) });
  }
  return out;
}

export const LIFT_REASON_MESSAGE = "Write why the restriction can be lifted (at least 10 characters), for example the person's written consent and its date.";

/**
 * "Lift restriction" on a consent-withdrawal or erasure request: partner only, with a reason.
 * Writes one lift-restriction AuditEvent per restricted record (same entity and id as the
 * restriction) and one on the request; changes no column and removes nothing. Break nudges a
 * withdrawal switched off stay off until the person turns them on again.
 */
export async function liftRestriction(user: SessionUser, id: string, input: { reason: string }, deps: PrivacyDeps): Promise<ServiceResult<{ lifted: number; restrictions: string[] }>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  if (!canLiftRestriction(user)) return fail(403, LIFT_NOT_ALLOWED);
  const reason = scrubFreeText(input.reason?.trim() ?? "").slice(0, 500);
  if (reason.length < 10) return fail(400, LIFT_REASON_MESSAGE);
  const actorId = user!.id;
  try {
    const out = await deps.db.$transaction(async (tx: Tx) => {
      const r = await tx.privacyRequest.findUnique({ where: { id }, select: { id: true, kind: true } });
      if (!r) throw new Refusal(404, "That privacy request wasn't found. Go back to the register and open it again.");
      if (r.kind !== "consent-withdrawal" && r.kind !== "erasure") throw new Refusal(409, "Only a consent withdrawal or an erasure hold restricts processing, so there is nothing to lift on this request.");
      const active = await activeRestrictionsOf(tx, id);
      if (!active.length) throw new Refusal(409, "No restriction from this request is in force, so there is nothing to lift. Reload the page to see the current state.");
      for (const a of active) {
        await writeAudit(tx, { actorId, action: LIFT_ACTION, entity: a.entity, entityId: a.entityId, meta: { restrictions: [...a.keys], privacyRequestId: id, reason } });
      }
      const keys = [...new Set(active.flatMap((a) => a.keys))];
      await writeAudit(tx, { actorId, action: LIFT_ACTION, entity: "PrivacyRequest", entityId: id, meta: { records: active.length, restrictions: keys, reason } });
      return { lifted: active.length, restrictions: keys.map(labelOf) };
    });
    return ok(out);
  } catch (e) {
    if (e instanceof Refusal) return fail(e.status, e.message);
    throw e;
  }
}
