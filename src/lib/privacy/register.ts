// The DPDP request register (PrivacyRequest): log a request, find the person, verify identity,
// and close it with a recorded outcome. The kind-specific work lives next door: export.ts
// (access), the corrections service (correction), erasure.ts (erasure), consent.ts (consent
// withdrawal); grievance and nomination close here.
//
// Every step writes an AuditEvent on entity "PrivacyRequest" (actions: create, locate,
// verify-identity, complete, reject, nominate, export, ...). Identifiers typed by staff are never
// stored raw: the register keeps a keyed hash and a masked label, and free text is scrubbed.
// AuditEvent rows are written through logAudit() (src/lib/audit/log.ts).
//
// One request, one person: resolutionOf() decides what a request is linked to — one record, or
// (no record matched) the rows of a person known only by identifiers — for export, erasure and
// close alike. Separation of duties (duties.ts): the person who logs a request does not verify it.
import type { Prisma } from "@prisma/client";
import { isActive, type SessionUser } from "@/lib/access";
import { logAudit } from "@/lib/audit/log";
import { formatDate, formatDateTimeIst } from "@/lib/agents/core/format";
import { maskName, scrubFreeText } from "@/lib/corrections/mask";
import { Refusal, fail, ok, type ServiceResult } from "@/lib/corrections/result";
import { istDayKey, parseDayKey, DAY_MS } from "@/lib/ist";
import { PRIVACY_NOT_ALLOWED, SIGN_IN, canUsePrivacyRegister } from "./access";
import { assertNotCreator, verificationNoteProblem } from "./duties";
import { identifierOnlyRows } from "./identifier-only";
import type { PrivacyDb, Row } from "./inventory";
import { IDENTIFIER_HINTS, IDENTIFIER_KINDS, identifierHash, identifierPrincipalLocator, normaliseIdentifier, type Identifier, type PrincipalLocator } from "./locator";
import { memoryRateLimiter, type SearchRateLimiter } from "@/lib/search/rate-limit";
import {
  KIND_LABELS,
  OPEN_STATUSES,
  PRINCIPAL_TYPES,
  RESPONSE_TIMELINES,
  STATUS_LABELS,
  VERIFY_METHODS,
  dueDateFor,
  isOverdue,
  isRequestKind,
  outerLimitFor,
  type PrincipalType,
  type RequestKind,
  type RequestStatus,
} from "./policy";
import type { MatchRef } from "./scope";

export interface PrivacyDeps {
  db: PrivacyDb;
  now: () => Date;
  /** Default: identifierPrincipalLocator (findByIdentifier, purpose "privacy-request") for the acting person. */
  locator?: PrincipalLocator;
  /** Identifier-search limiter for the default locator (production: the shared database limiter; tests: in memory). */
  searchLimiter?: SearchRateLimiter;
  /** HMAC key for identifierHash (production: AUTH_SECRET). */
  hashKey?: string;
}

export type Tx = Parameters<Parameters<PrivacyDb["$transaction"]>[0]>[0];
type AuditDb = Pick<PrivacyDb, "auditEvent">;

export async function writeAudit(db: AuditDb | Tx, e: { actorId: string; action: string; entity: string; entityId: string; meta?: Prisma.InputJsonObject }): Promise<void> {
  await logAudit(db, { actorId: e.actorId, action: e.action, entity: e.entity, entityId: e.entityId, meta: e.meta ?? {} });
}

/** Signed in, active, admin or partner — else the refusal to return. */
export function guardRegister(user: SessionUser): { ok: false; status: 401 | 403; error: string } | null {
  if (!user || !isActive(user)) return fail(401, SIGN_IN) as { ok: false; status: 401; error: string };
  if (!canUsePrivacyRegister(user)) return fail(403, PRIVACY_NOT_ALLOWED) as { ok: false; status: 403; error: string };
  return null;
}

const NOT_FOUND = "That privacy request wasn't found. Go back to the register and open it again.";
const CLOSED = "This request is already closed, so nothing more can be done on it. Log a new request if the person asks again.";

/** principalLabel of a request whose identifiers matched several records (shown in the register list). */
export const needsResolutionLabel = (n: number) => `Needs manual resolution: ${n} records match these identifiers`;
/** Told to the person logging such a request. */
export const NEEDS_RESOLUTION_NOTE = (n: number) =>
  `These identifiers match ${n} different records, so the request is not linked to anyone yet. Open the request and choose the one it is about before anything is shared, changed or erased.`;
/** Refusal for any step that would read, change or erase the person's data before one record is chosen. */
export const NOT_RESOLVED =
  "This request is not linked to one person yet, so nobody's data can be shared, changed or erased from it. Choose the record it is about in Step 1 first.";
/** Refusal for completing a request (or confirming an erasure) when no record matched at all. */
export const NOTHING_MATCHED =
  "No record in Firm OS is linked to this person, so the request can't be completed as done: their data may still be held somewhere the search does not reach. Log the request again with another identifier, or refuse it with the reason.";

// ------------------------------------------------------------------ create

export interface CreateRequestInput {
  kind: string;
  identifiers: Partial<Record<(typeof IDENTIFIER_KINDS)[number], string>>;
  principalType?: string | null;
  /** "YYYY-MM-DD" (IST day the request arrived); default today. */
  receivedOn?: string | null;
  channel?: string | null;
  notes?: string | null;
}

export async function createRequest(user: SessionUser, input: CreateRequestInput, deps: PrivacyDeps): Promise<ServiceResult<{ id: string; matches: number; notes: string[] }>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  if (!isRequestKind(input.kind)) return fail(400, "Pick the kind of request.");
  const kind: RequestKind = input.kind;

  const identifiers: Identifier[] = [];
  for (const k of IDENTIFIER_KINDS) {
    const raw = input.identifiers?.[k]?.trim();
    if (!raw) continue;
    if (!normaliseIdentifier(k, raw)) return fail(400, IDENTIFIER_HINTS[k]);
    identifiers.push({ kind: k, value: raw });
  }
  if (!identifiers.length && kind !== "grievance") {
    return fail(400, "Enter at least one identifier (PAN, GSTIN, email or phone), so the person's records can be found.");
  }

  const now = deps.now();
  let receivedAt = now;
  if (input.receivedOn) {
    const d = parseDayKey(input.receivedOn);
    if (!d) return fail(400, "Pick the date the request arrived.");
    if (istDayKey(d) > istDayKey(now)) return fail(400, "The date received can't be in the future. Pick the day the request arrived.");
    receivedAt = istDayKey(d) === istDayKey(now) ? now : d;
  }
  const typed = PRINCIPAL_TYPES.find((t) => t === input.principalType) ?? null;

  const locator = deps.locator ?? identifierPrincipalLocator(user, { db: deps.db, limiter: deps.searchLimiter ?? memoryRateLimiter(), now: deps.now });
  let located: Awaited<ReturnType<PrincipalLocator["locate"]>>;
  try {
    located = identifiers.length ? await locator.locate(identifiers) : { matches: [], notes: [] };
  } catch (e) {
    if (e instanceof Refusal) return fail(e.status, e.message); // e.g. too many identifier searches: nothing is logged
    throw e;
  }
  // One request, one person. Identifiers that match several records (a shared office email or
  // phone, a family's common number) never pick one: the request is parked until a person chooses,
  // so no export, correction, restriction or erasure can reach someone else's data.
  const only = located.matches.length === 1 ? located.matches[0] : null;
  const ambiguous = located.matches.length > 1;
  const principalType: PrincipalType = only?.principalType ?? typed ?? "client-contact";
  const label = only
    ? only.label
    : ambiguous
      ? needsResolutionLabel(located.matches.length)
      : identifiers.length
        ? "No matching records in Firm OS"
        : "Not identified";
  const locatedNotes = ambiguous ? [...located.notes, NEEDS_RESOLUTION_NOTE(located.matches.length)] : located.notes;
  const channel = input.channel?.trim() ? `Received by ${input.channel.trim().slice(0, 40)}.` : "";
  const notes = [channel, input.notes?.trim() ? scrubFreeText(input.notes).slice(0, 2000) : ""].filter(Boolean).join(" ");
  const actorId = user!.id;

  const created = await deps.db.$transaction(async (tx) => {
    const r = await tx.privacyRequest.create({
      data: {
        kind,
        principalType,
        principalRef: only?.ref ?? null,
        principalLabel: label.slice(0, 500),
        identifierHash: identifierHash(identifiers, deps.hashKey),
        receivedAt,
        dueAt: dueDateFor(kind, receivedAt),
        status: "RECEIVED",
        createdById: actorId,
        notes: notes || null,
      },
      select: { id: true },
    });
    await writeAudit(tx, { actorId, action: "create", entity: "PrivacyRequest", entityId: r.id, meta: { kind } });
    await writeAudit(tx, {
      actorId,
      action: "locate",
      entity: "PrivacyRequest",
      entityId: r.id,
      // Candidates with their masked labels (initials, code, last 4), for choosing when several match.
      meta: { matches: located.matches.map((m) => ({ principalType: m.principalType, ref: m.ref, matchedOn: m.matchedOn, label: m.label })), searched: identifiers.map((i) => i.kind), resolved: !!only },
    });
    return r;
  });
  return ok({ id: created.id, matches: located.matches.length, notes: locatedNotes });
}

// ------------------------------------------------------------------ list / detail

export interface RequestRow {
  id: string;
  kind: RequestKind;
  kindLabel: string;
  principalType: string;
  principalLabel: string;
  status: RequestStatus;
  statusLabel: string;
  receivedLabel: string;
  dueLabel: string;
  overdue: boolean;
  /** Whole days until the due date (negative when overdue); null once closed. */
  daysLeft: number | null;
  legalHold: string | null;
}

type RequestRecord = {
  id: string;
  kind: string;
  principalType: string;
  principalLabel: string;
  status: string;
  receivedAt: Date;
  dueAt: Date;
  legalHold: string | null;
};

export function toRow(r: RequestRecord, now: Date): RequestRow {
  const kind = (isRequestKind(r.kind) ? r.kind : "grievance") as RequestKind;
  const status = (r.status in STATUS_LABELS ? r.status : "RECEIVED") as RequestStatus;
  const open = (OPEN_STATUSES as readonly string[]).includes(status);
  return {
    id: r.id,
    kind,
    kindLabel: KIND_LABELS[kind],
    principalType: r.principalType,
    principalLabel: r.principalLabel,
    status,
    statusLabel: STATUS_LABELS[status],
    receivedLabel: formatDate(r.receivedAt),
    dueLabel: formatDate(r.dueAt),
    overdue: isOverdue(r.dueAt, status, now),
    daysLeft: open ? Math.floor((r.dueAt.getTime() - now.getTime()) / DAY_MS) : null,
    legalHold: r.legalHold,
  };
}

export interface RequestFilters {
  status?: string | null;
  kind?: string | null;
  overdue?: boolean;
}

export async function listRequests(db: PrivacyDb, filters: RequestFilters, now: Date) {
  const where: Prisma.PrivacyRequestWhereInput = {};
  if (filters.status === "open") where.status = { in: [...OPEN_STATUSES] };
  else if (filters.status && filters.status in STATUS_LABELS) where.status = filters.status;
  if (filters.kind && isRequestKind(filters.kind)) where.kind = filters.kind;
  const all = await db.privacyRequest.findMany({ where, orderBy: { dueAt: "asc" }, take: 500 });
  let rows = all.map((r) => toRow(r, now));
  if (filters.overdue) rows = rows.filter((r) => r.overdue);
  const every = (await db.privacyRequest.findMany({ select: { id: true, kind: true, principalType: true, principalLabel: true, status: true, receivedAt: true, dueAt: true, legalHold: true }, take: 2000 })).map((r) =>
    toRow(r, now),
  );
  const counts = {
    open: every.filter((r) => r.daysLeft !== null).length,
    overdue: every.filter((r) => r.overdue).length,
    dueSoon: every.filter((r) => r.daysLeft !== null && !r.overdue && r.daysLeft <= 7).length,
    onHold: every.filter((r) => r.status === "ON_HOLD").length,
  };
  return { rows, counts };
}

export interface TimelineEvent {
  id: string;
  action: string;
  label: string;
  atLabel: string;
  actorName: string;
  detail: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  create: "Request logged",
  locate: "Records searched",
  "verify-identity": "Identity verified",
  export: "Access export downloaded",
  correct: "Field corrected",
  "erasure-confirmed": "Erasure carried out",
  "restrict-processing": "Processing restricted",
  "lift-restriction": "Restriction lifted by a partner",
  "resolve-principal": "Linked to one record",
  nominate: "Nominee recorded",
  complete: "Request completed",
  reject: "Request refused",
};

function eventDetail(action: string, meta: Prisma.JsonObject): string | null {
  if (action === "locate") {
    const n = Array.isArray(meta.matches) ? meta.matches.length : 0;
    return n ? `${n} matching record${n === 1 ? "" : "s"} found.` : "No matching records found.";
  }
  if (action === "verify-identity") return [meta.method, meta.note].filter(Boolean).join(" — ");
  if (action === "complete" || action === "reject") return typeof meta.note === "string" ? meta.note : null;
  if (action === "erasure-confirmed") return `${String(meta.anonymised ?? 0)} anonymised, ${String(meta.held ?? 0)} on legal hold, ${String(meta.kept ?? 0)} kept as they are.`;
  if (action === "nominate") return typeof meta.nominee === "string" ? `Nominee ${meta.nominee}` : null;
  if (action === "lift-restriction") return typeof meta.reason === "string" ? `Reason: ${meta.reason}` : null;
  return null;
}

export type Candidate = MatchRef & { label: string };

/**
 * Every record the identifiers matched when the request was logged (the "locate" event): the
 * candidates to choose from. Never use this to scope data — use principalOf().
 */
export async function loadMatches(db: Pick<PrivacyDb, "auditEvent">, requestId: string): Promise<Candidate[]> {
  const ev = await db.auditEvent.findFirst({ where: { entity: "PrivacyRequest", entityId: requestId, action: "locate" }, orderBy: { createdAt: "desc" }, select: { meta: true } });
  const raw = ((ev?.meta ?? {}) as Prisma.JsonObject).matches;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => m as Prisma.JsonObject)
    .filter((m) => typeof m.ref === "string" && PRINCIPAL_TYPES.includes(m.principalType as PrincipalType))
    .map((m) => ({ principalType: m.principalType as PrincipalType, ref: String(m.ref), label: typeof m.label === "string" ? m.label : "A matching record" }));
}

/**
 * The one person a request is about (PrivacyRequest.principalRef), as the only scope any export,
 * correction, restriction or erasure may use; empty until exactly one record is linked.
 */
export async function principalOf(db: Pick<PrivacyDb, "privacyRequest">, requestId: string): Promise<MatchRef[]> {
  const r = await db.privacyRequest.findUnique({ where: { id: requestId }, select: { principalRef: true, principalType: true } });
  if (!r?.principalRef || !PRINCIPAL_TYPES.includes(r.principalType as PrincipalType)) return [];
  return [{ principalType: r.principalType as PrincipalType, ref: r.principalRef }];
}

/**
 * What a request is linked to (the single-principal rule, shared by export, erasure and close):
 *
 *   principal        exactly one client or staff record is linked (principalRef)
 *   identifier-only  no record matched, but rows that never reached a client record (an abandoned
 *                    onboarding) hold exactly the identifiers the request was logged with
 *                    (identifier-only.ts): the person is known only by those identifiers
 *   parked           several records matched: a person chooses the one it is about first
 *   nothing          nothing matched anywhere
 *
 * Only the first two are resolved. Names never resolve a request.
 */
export type Resolution =
  | { kind: "principal"; principal: MatchRef }
  | { kind: "identifier-only"; rows: Row[] }
  | { kind: "parked"; candidates: number }
  | { kind: "nothing" };
export type Resolved = Extract<Resolution, { kind: "principal" | "identifier-only" }>;

type ResolutionDb = Pick<PrivacyDb, "privacyRequest" | "auditEvent" | "onboardingRun">;

export async function resolutionOf(db: ResolutionDb, requestId: string, hashKey?: string): Promise<Resolution> {
  const [principal] = await principalOf(db, requestId);
  if (principal) return { kind: "principal", principal };
  const candidates = (await loadMatches(db, requestId)).length;
  if (candidates > 1) return { kind: "parked", candidates };
  const r = await db.privacyRequest.findUnique({ where: { id: requestId }, select: { identifierHash: true } });
  const rows = await identifierOnlyRows(db, r?.identifierHash, hashKey);
  return rows.length ? { kind: "identifier-only", rows } : { kind: "nothing" };
}

/** Refuse a data step unless the request is resolved: NOT_RESOLVED when several matched, NOTHING_MATCHED when nothing did. */
export async function requireResolved(tx: Tx, id: string, hashKey?: string): Promise<Resolved> {
  const r = await resolutionOf(tx, id, hashKey);
  if (r.kind === "parked") throw new Refusal(409, NOT_RESOLVED);
  if (r.kind === "nothing") throw new Refusal(409, NOTHING_MATCHED);
  return r;
}

/** Refusal for a step that needs a client or staff record when the person is known only by identifiers. */
export const IDENTIFIER_ONLY_NO_RECORD =
  "This person has no client or staff record in Firm OS, only an onboarding that never became a client record, so there is nothing here to correct or restrict. Erase that onboarding if they ask, or close the request with that reply.";

/** Like requireResolved(), for steps that act on the person's own record (correction, restriction). */
export async function requirePrincipal(tx: Tx, id: string, hashKey?: string): Promise<MatchRef> {
  const r = await requireResolved(tx, id, hashKey);
  if (r.kind !== "principal") throw new Refusal(409, IDENTIFIER_ONLY_NO_RECORD);
  return r.principal;
}

/**
 * "This request is about this record": links a request whose identifiers matched several records
 * to the one chosen. Only one of the records found when it was logged can be chosen; nothing else
 * changes, and the choice is recorded (resolve-principal).
 */
export async function resolvePrincipal(user: SessionUser, id: string, input: { ref: string }, deps: PrivacyDeps): Promise<ServiceResult<{ id: string; principalLabel: string }>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  return step(deps, async (tx) => {
    await loadOpen(tx, id);
    const r = await tx.privacyRequest.findUnique({ where: { id }, select: { principalRef: true } });
    if (r?.principalRef) throw new Refusal(409, "This request is already linked to one person. Log a new request if it is about someone else.");
    const chosen = (await loadMatches(tx, id)).find((m) => m.ref === input.ref);
    if (!chosen) throw new Refusal(400, "Choose one of the records found for this request.");
    await tx.privacyRequest.update({ where: { id }, data: { principalRef: chosen.ref, principalType: chosen.principalType, principalLabel: chosen.label.slice(0, 500), handledById: user!.id } });
    await writeAudit(tx, { actorId: user!.id, action: "resolve-principal", entity: "PrivacyRequest", entityId: id, meta: { principalType: chosen.principalType, ref: chosen.ref } });
    return { id, principalLabel: chosen.label };
  });
}

export async function isVerified(db: Pick<PrivacyDb, "auditEvent">, requestId: string): Promise<boolean> {
  return (await db.auditEvent.count({ where: { entity: "PrivacyRequest", entityId: requestId, action: "verify-identity" } })) > 0;
}

export async function getRequest(db: PrivacyDb, id: string, now: Date) {
  const r = await db.privacyRequest.findUnique({ where: { id } });
  if (!r) return null;
  const all = await db.auditEvent.findMany({ where: { entity: "PrivacyRequest", entityId: id }, orderBy: { createdAt: "asc" }, select: { id: true, action: true, actorId: true, createdAt: true, meta: true } });
  const events = all;
  const actorIds = [...new Set(all.map((e) => e.actorId).filter((x): x is string => !!x))];
  const people = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(people.map((p) => [p.id, p.name ?? p.email]));
  const timeline: TimelineEvent[] = all.map((e) => {
    const meta = (e.meta ?? {}) as Prisma.JsonObject;
    return {
      id: e.id,
      action: e.action,
      label: e.action === "correct" ? `Corrected ${String(meta.label ?? "a field")}` : (ACTION_LABELS[e.action] ?? e.action),
      atLabel: formatDateTimeIst(e.createdAt),
      actorName: (e.actorId && names.get(e.actorId)) || "(unknown)",
      detail: e.action === "correct" ? `${String(meta.before ?? "(empty)")} → ${String(meta.after ?? "(empty)")}` : eventDetail(e.action, meta),
    };
  });
  const kind = (isRequestKind(r.kind) ? r.kind : "grievance") as RequestKind;
  return {
    ...toRow(r, now),
    receivedAt: r.receivedAt,
    dueAt: r.dueAt,
    outerLimitLabel: formatDate(outerLimitFor(r.receivedAt)),
    timelineBasis: RESPONSE_TIMELINES[kind],
    notes: r.notes,
    outcome: r.outcome,
    /** The one person this request is about (null until exactly one record is linked). */
    principalRef: r.principalRef,
    /** Records found when the request was logged: the choices while principalRef is null. */
    matches: await loadMatches(db, id),
    verified: events.some((e) => e.action === "verify-identity"),
    timeline,
  };
}
export type RequestDetail = NonNullable<Awaited<ReturnType<typeof getRequest>>>;

// ------------------------------------------------------------------ steps

type Loaded = { id: string; kind: RequestKind; status: string };

/** Load the request inside a transaction and refuse when it is closed or of the wrong kind. */
export async function loadOpen(tx: Tx, id: string, kinds?: readonly RequestKind[]): Promise<Loaded> {
  const r = await tx.privacyRequest.findUnique({ where: { id }, select: { id: true, kind: true, status: true } });
  if (!r) throw new Refusal(404, NOT_FOUND);
  if (r.status === "COMPLETED" || r.status === "REJECTED") throw new Refusal(409, CLOSED);
  const kind = r.kind as RequestKind;
  if (kinds && !kinds.includes(kind)) throw new Refusal(409, `This is a ${KIND_LABELS[kind].toLowerCase()} request, so this step does not apply to it.`);
  return { id: r.id, kind, status: r.status };
}

export async function requireVerified(tx: Tx, id: string): Promise<void> {
  const n = await tx.auditEvent.count({ where: { entity: "PrivacyRequest", entityId: id, action: "verify-identity" } });
  if (!n) throw new Refusal(409, "Verify the person's identity first, so their data goes only to them.");
}

/** Run a step in one transaction, turning a Refusal into a plain-sentence failure. */
export async function step<T>(deps: PrivacyDeps, fn: (tx: Tx) => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return ok(await deps.db.$transaction(fn));
  } catch (e) {
    if (e instanceof Refusal) return fail(e.status, e.message);
    throw e;
  }
}

export async function verifyIdentity(user: SessionUser, id: string, input: { method: string; note?: string | null }, deps: PrivacyDeps): Promise<ServiceResult<{ id: string }>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  if (!(VERIFY_METHODS as readonly string[]).includes(input.method)) return fail(400, "Pick how the person's identity was checked.");
  const note = input.note?.trim() ?? "";
  const noteProblem = verificationNoteProblem(input.method, input.note); // "Other" needs a real note (duties.ts)
  if (noteProblem) return fail(400, noteProblem);
  return step(deps, async (tx) => {
    await loadOpen(tx, id);
    await assertNotCreator(tx, id, user); // separation of duties: not the person who logged it
    if ((await tx.auditEvent.count({ where: { entity: "PrivacyRequest", entityId: id, action: "verify-identity" } })) > 0) {
      throw new Refusal(409, "This person's identity is already verified for this request. Go on to the next step.");
    }
    await tx.privacyRequest.update({ where: { id }, data: { status: "IN_PROGRESS", handledById: user!.id } });
    await writeAudit(tx, { actorId: user!.id, action: "verify-identity", entity: "PrivacyRequest", entityId: id, meta: { method: input.method, ...(note ? { note: scrubFreeText(note).slice(0, 500) } : {}) } });
    return { id };
  });
}

const CLOSE_ELSEWHERE: Partial<Record<RequestKind, string>> = {
  erasure: "Complete an erasure request from its erasure plan, so the outcome of each item is recorded. You can still refuse it here.",
  "consent-withdrawal": "Complete a consent withdrawal with its Restrict processing step, so the restriction is recorded. You can still refuse it here.",
  nomination: "Complete a nomination by recording the nominee. You can still refuse it here.",
};

export async function closeRequest(
  user: SessionUser,
  id: string,
  input: { outcome: "completed" | "rejected"; note: string },
  deps: PrivacyDeps,
): Promise<ServiceResult<{ id: string; status: RequestStatus }>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  const note = input.note?.trim() ?? "";
  if (note.length < 10) {
    return fail(400, input.outcome === "rejected" ? "Write the reason for refusing (at least 10 characters); the person is told this reason." : "Write the reply sent to the person (at least 10 characters).");
  }
  return step(deps, async (tx) => {
    const r = await loadOpen(tx, id);
    if (input.outcome === "completed") {
      const elsewhere = CLOSE_ELSEWHERE[r.kind];
      if (elsewhere) throw new Refusal(409, elsewhere);
      if (r.kind !== "grievance") {
        await requireVerified(tx, id);
        await requireResolved(tx, id, deps.hashKey); // never "done" for nobody, or for several people at once
      }
    }
    const status: RequestStatus = input.outcome === "completed" ? "COMPLETED" : "REJECTED";
    const scrubbed = scrubFreeText(note).slice(0, 2000);
    await tx.privacyRequest.update({ where: { id }, data: { status, outcome: scrubbed, handledById: user!.id } });
    await writeAudit(tx, { actorId: user!.id, action: input.outcome === "completed" ? "complete" : "reject", entity: "PrivacyRequest", entityId: id, meta: { note: scrubbed.slice(0, 500) } });
    return { id, status };
  });
}

export async function recordNomination(
  user: SessionUser,
  id: string,
  input: { nomineeName: string; relationship: string; nomineeContact: string },
  deps: PrivacyDeps,
): Promise<ServiceResult<{ id: string }>> {
  const denied = guardRegister(user);
  if (denied) return denied;
  const name = input.nomineeName?.trim() ?? "";
  const relationship = input.relationship?.trim() ?? "";
  const contact = input.nomineeContact?.trim() ?? "";
  if (name.length < 2) return fail(400, "Enter the nominee's full name.");
  if (relationship.length < 2) return fail(400, "Enter how the nominee is related to the person (for example spouse or son).");
  if (contact.length < 5) return fail(400, "Enter a phone number or email for the nominee.");
  return step(deps, async (tx) => {
    await loadOpen(tx, id, ["nomination"]);
    await requireVerified(tx, id);
    await requireResolved(tx, id, deps.hashKey); // like erasure and close: never a nominee for nobody, or for several people at once
    const r = await tx.privacyRequest.findUnique({ where: { id }, select: { notes: true } });
    // The register itself keeps the nominee's details (that is the point of a nomination); the
    // audit row keeps initials only.
    const line = `Nominee: ${name.slice(0, 120)} (${relationship.slice(0, 60)}), contact ${contact.slice(0, 120)}.`;
    await tx.privacyRequest.update({
      where: { id },
      data: { status: "COMPLETED", handledById: user!.id, notes: [r?.notes, line].filter(Boolean).join("\n"), outcome: `Nominee recorded: ${maskName(name)} (${relationship.slice(0, 60)}).` },
    });
    await writeAudit(tx, { actorId: user!.id, action: "nominate", entity: "PrivacyRequest", entityId: id, meta: { nominee: maskName(name), relationship: relationship.slice(0, 60) } });
    return { id };
  });
}
