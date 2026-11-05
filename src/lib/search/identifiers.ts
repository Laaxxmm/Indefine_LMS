// DPDP-safe lookup by identifier (ADR-006, class A). Server-side.
//
//   findByIdentifier(user, identifier, options?) → Promise<IdentifierLookup>
//
// - Only a full PAN, GSTIN, Indian mobile number or email is accepted, matched exactly after
//   normalisation (query.ts normaliseIdentifier). Part of one is refused with a plain sentence;
//   an Aadhaar number is refused (Firm OS does not keep them).
// - Results are masked: PAN last 4, GSTIN state code + last 4, phone last 4, email first letter +
//   domain. The raw identifier is never returned, logged or stored.
// - Every lookup (including one refused by the rate limit) writes an AuditEvent: who, which entity
//   types were searched, how many results, and the sha256 of the normalised identifier
//   (identifierHash). If the audit write fails the lookup fails, and no results are returned.
// - Rate limited per person (rate-limit.ts; swap in the Phase 11 limiter through deps.limiter).
// - Visibility is the same as text search: clients for canViewClients, onboarding runs for
//   canOnboard. Inactive people find nothing.
//
// For src/lib/privacy (locating a data principal): call findByIdentifier(user, identifier,
// { purpose: "privacy-request" }); use hit.refs.clientId / hit.refs.firmClientId as the
// PrivacyRequest.principalRef, hit.label as principalLabel (already masked) and
// result.identifierHash as PrivacyRequest.identifierHash. Covered: Client.pan / gstin (and a PAN
// inside a GSTIN) / contactPhone / contactEmail, OnboardingRun.spec pan / gstins / contactPhone /
// contactEmail. Not covered: EngagementLetter, CertificateIssue.payload, ClientDocument contents,
// CommsDraft bodies, staff (User) records.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { INACTIVE_MESSAGE, SIGNED_OUT_MESSAGE, canFindClients, canFindOnboarding, canSearch } from "./access";
import type { SearchDb, SearchDeps } from "./db";
import { maskGstin, maskIdentifier } from "./mask";
import { fetchCap, type SearchUser } from "./provider";
import { clientHit, clientSelect } from "./providers/clients";
import { onboardingHit, onboardingSelect, specOf, str } from "./providers/onboarding";
import { classifyQuery, normaliseIdentifier, type NormalisedIdentifier } from "./query";
import { rateLimitMessage } from "./rate-limit";
import { compareHits } from "./rank";
import { IDENTIFIER_LABELS, PER_TYPE_LIMIT, type IdentifierKind, type SearchHit, type SearchType } from "./types";

export type IdentifierContext = { db: SearchDb; user: SearchUser; id: NormalisedIdentifier; limit: number };

/** An entity type that holds identifiers and can be looked up by one exactly. Hits are masked. */
export type IdentifierFinder = { type: SearchType; canUse(user: SessionUser): boolean; find(ctx: IdentifierContext): Promise<SearchHit[]> };

export type IdentifierLookup =
  | { ok: true; kind: IdentifierKind; masked: string; identifierHash: string; searchedTypes: SearchType[]; hits: SearchHit[] }
  | { ok: false; reason: "signed-out" | "inactive" | "invalid" | "partial" | "unsupported" | "rate-limited"; message: string; retryAfterSeconds?: number };

export type FindByIdentifierOptions = {
  /** Defaults to the production dependencies (Prisma, the shared rate limiter). */
  deps?: SearchDeps;
  /** Recorded in the audit event: "search" (default) or e.g. "privacy-request". */
  purpose?: string;
  /** Limit the lookup to these entity types. */
  types?: readonly SearchType[];
};

export const AUDIT_ACTION = "identifier-search";
export const AUDIT_ENTITY = "Search";
export const NOT_AN_IDENTIFIER = "Enter a full PAN, GSTIN, 10-digit mobile number or email address.";

/** sha256 (hex) of the normalised identifier value — what audit and privacy records store. */
export function identifierHash(id: NormalisedIdentifier): string {
  return createHash("sha256").update(id.value, "utf8").digest("hex");
}

/** Hash of a raw identifier after normalisation, or null when it is not a full identifier. */
export function hashIdentifier(raw: string): string | null {
  const id = normaliseIdentifier(raw);
  return id ? identifierHash(id) : null;
}

const phoneDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^(?:91|0)(?=\d{10}$)/, "");
const matchedLabel = (kind: IdentifierKind, masked: string) => `${IDENTIFIER_LABELS[kind]} ${masked}`;

export const clientsFinder: IdentifierFinder = {
  type: "client",
  canUse: canFindClients,
  async find({ db, id, limit }) {
    const where: Prisma.ClientWhereInput =
      id.kind === "pan"
        ? { OR: [{ pan: id.value }, { gstin: { contains: id.value, mode: "insensitive" } }] }
        : id.kind === "gstin"
          ? { gstin: { equals: id.value, mode: "insensitive" } }
          : id.kind === "phone"
            ? { contactPhone: { contains: id.value } }
            : { contactEmail: { equals: id.value, mode: "insensitive" } };
    const rows = await db.client.findMany({
      where,
      select: { ...clientSelect, pan: true, gstin: true, contactPhone: true, contactEmail: true },
      orderBy: { updatedAt: "desc" },
      take: fetchCap(limit),
    });
    const out: SearchHit[] = [];
    for (const r of rows) {
      // The query only narrows; equality on the normalised value decides.
      const gstin = (r.gstin ?? "").toUpperCase();
      let matched: string | null = null;
      if (id.kind === "pan" && (r.pan ?? "").toUpperCase() === id.value) matched = matchedLabel("pan", maskIdentifier("pan", id.value));
      else if (id.kind === "pan" && gstin.slice(2, 12) === id.value) matched = `PAN within GSTIN ${maskGstin(gstin)}`;
      else if (id.kind === "gstin" && gstin === id.value) matched = matchedLabel("gstin", maskIdentifier("gstin", id.value));
      else if (id.kind === "phone" && phoneDigits(r.contactPhone) === id.value) matched = matchedLabel("phone", maskIdentifier("phone", id.value));
      else if (id.kind === "email" && (r.contactEmail ?? "").trim().toLowerCase() === id.value) matched = matchedLabel("email", maskIdentifier("email", id.value));
      if (matched) out.push(clientHit(r, 0, matched));
    }
    return out.slice(0, limit);
  },
};

export const onboardingFinder: IdentifierFinder = {
  type: "onboarding",
  canUse: canFindOnboarding,
  async find({ db, id, limit }) {
    const where: Prisma.OnboardingRunWhereInput =
      id.kind === "pan"
        ? { spec: { path: ["pan"], string_contains: id.value, mode: "insensitive" } }
        : id.kind === "gstin"
          ? { spec: { path: ["gstins"], array_contains: [id.value] } }
          : id.kind === "phone"
            ? { spec: { path: ["contactPhone"], string_contains: id.value } }
            : { spec: { path: ["contactEmail"], string_contains: id.value, mode: "insensitive" } };
    const rows = await db.onboardingRun.findMany({ where, select: onboardingSelect, orderBy: { updatedAt: "desc" }, take: fetchCap(limit) });
    const out: SearchHit[] = [];
    for (const r of rows) {
      const s = specOf(r);
      const gstins = Array.isArray(s.gstins) ? s.gstins.map((g) => String(g).toUpperCase()) : [];
      const equal =
        id.kind === "pan"
          ? (str(s.pan) ?? "").toUpperCase() === id.value
          : id.kind === "gstin"
            ? gstins.includes(id.value)
            : id.kind === "phone"
              ? phoneDigits(str(s.contactPhone)) === id.value
              : (str(s.contactEmail) ?? "").trim().toLowerCase() === id.value;
      if (equal) out.push(onboardingHit(r, 0, matchedLabel(id.kind, maskIdentifier(id.kind, id.value))));
    }
    return out.slice(0, limit);
  },
};

export const IDENTIFIER_FINDERS: readonly IdentifierFinder[] = [clientsFinder, onboardingFinder];

/** The entity types an identifier lookup can return for this person. */
export function identifierTypes(user: SessionUser, finders: readonly IdentifierFinder[] = IDENTIFIER_FINDERS): SearchType[] {
  return finders.filter((f) => f.canUse(user)).map((f) => f.type);
}

async function audit(db: SearchDb, user: SearchUser, id: NormalisedIdentifier, meta: { entityTypes: SearchType[]; resultCount: number; outcome: "ok" | "rate-limited"; purpose: string }) {
  const data: Prisma.AuditEventUncheckedCreateInput = {
    actorId: user.id,
    action: AUDIT_ACTION,
    entity: AUDIT_ENTITY,
    entityId: null,
    meta: { identifierKind: id.kind, queryHash: identifierHash(id), ...meta },
  };
  await db.auditEvent.create({ data, select: { id: true } });
}

/**
 * The lookup for an already-normalised identifier (the service calls this; others call
 * findByIdentifier). Rate limit → finders → audit → masked hits, most recent first.
 */
export async function lookupIdentifier(
  user: SearchUser,
  id: NormalisedIdentifier,
  opts: { deps: SearchDeps; purpose: string; types?: readonly SearchType[]; finders?: readonly IdentifierFinder[] },
): Promise<IdentifierLookup> {
  const { db, limiter, now } = opts.deps;
  const finders = (opts.finders ?? IDENTIFIER_FINDERS).filter((f) => f.canUse(user) && (!opts.types || opts.types.includes(f.type)));
  const searchedTypes = finders.map((f) => f.type);
  const base = { kind: id.kind, masked: maskIdentifier(id.kind, id.value), identifierHash: identifierHash(id), searchedTypes };
  if (!finders.length) return { ok: true, ...base, hits: [] }; // nothing this person may look up here: no search, nothing to log
  const decision = await limiter.hit(`identifier-search:${user.id}`, now());
  if (!decision.ok) {
    await audit(db, user, id, { entityTypes: searchedTypes, resultCount: 0, outcome: "rate-limited", purpose: opts.purpose });
    return { ok: false, reason: "rate-limited", message: rateLimitMessage(decision.retryAfterSeconds), retryAfterSeconds: decision.retryAfterSeconds };
  }
  const found = await Promise.all(finders.map((f) => f.find({ db, user, id, limit: PER_TYPE_LIMIT })));
  const hits = found.flat().sort(compareHits);
  await audit(db, user, id, { entityTypes: searchedTypes, resultCount: hits.length, outcome: "ok", purpose: opts.purpose });
  return { ok: true, ...base, hits };
}

/**
 * Find the clients and onboarding records that hold this exact PAN, GSTIN, phone or email, as the
 * person is allowed to see them. Stable signature for src/lib/privacy (see the header).
 */
export async function findByIdentifier(user: SessionUser, identifier: string, options: FindByIdentifierOptions = {}): Promise<IdentifierLookup> {
  if (!user) return { ok: false, reason: "signed-out", message: SIGNED_OUT_MESSAGE };
  if (!canSearch(user)) return { ok: false, reason: "inactive", message: INACTIVE_MESSAGE };
  const c = classifyQuery(identifier);
  if (c.kind === "invalid" || c.kind === "partial" || c.kind === "unsupported") return { ok: false, reason: c.kind, message: c.message };
  if (c.kind === "text") return { ok: false, reason: "invalid", message: NOT_AN_IDENTIFIER };
  const deps = options.deps ?? (await import("./defaults")).defaultSearchDeps();
  return lookupIdentifier(user, c.id, { deps, purpose: options.purpose ?? "search", types: options.types });
}
