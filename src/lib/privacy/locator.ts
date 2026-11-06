// Finding the data principal a request is about: exact matches on a normalised PAN, GSTIN, email
// or phone. The request register stores only a keyed hash of what was searched and a masked label.
//
// PrincipalLocator is deliberately narrow; the register depends only on it. The production
// locator is identifierPrincipalLocator(): an adapter over src/lib/search/identifiers.ts
// findByIdentifier(user, identifier, { purpose: "privacy-request" }) — the same exact, masked,
// rate-limited and audited lookup Firm OS search uses (each lookup writes an "identifier-search"
// AuditEvent with the identifier's hash and the purpose). Client records come from it; staff are
// matched by their LMS email here, because findByIdentifier does not cover User records.
// prismaPrincipalLocator() (direct Prisma lookups) is kept for comparison tests only.
import { createHmac } from "node:crypto";
import type { SessionUser } from "@/lib/access";
import { maskLast4, maskName } from "@/lib/corrections/mask";
import { Refusal } from "@/lib/corrections/result";
import { findByIdentifier } from "@/lib/search/identifiers";
import type { SearchDb } from "@/lib/search/db";
import type { SearchRateLimiter } from "@/lib/search/rate-limit";
import type { PrivacyDb, Row } from "./inventory";
import type { PrincipalType } from "./policy";

export const IDENTIFIER_KINDS = ["pan", "gstin", "email", "phone"] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];
export type Identifier = { kind: IdentifierKind; value: string };

export interface PrincipalMatch {
  principalType: PrincipalType;
  /** Client.id for client principals, User.id for staff. */
  ref: string;
  /** Masked: initials, client code and the last four characters of what matched. */
  label: string;
  matchedOn: IdentifierKind[];
}

export interface LocateResult {
  matches: PrincipalMatch[];
  /** Plain sentences for the person handling the request (e.g. "this PAN belongs to a company"). */
  notes: string[];
}

export interface PrincipalLocator {
  locate(identifiers: readonly Identifier[]): Promise<LocateResult>;
}

/** Entity types whose PAN / GSTIN / contact details are an individual's own. */
const INDIVIDUAL_ENTITIES: ReadonlySet<string> = new Set(["INDIVIDUAL", "PROPRIETORSHIP", "HUF"]);

/** Upper-case PAN / GSTIN, lower-case email, last ten digits of a phone number. Null when unusable. */
export function normaliseIdentifier(kind: IdentifierKind, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (kind === "pan") return /^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(v) ? v.toUpperCase() : null;
  if (kind === "gstin") return /^\d{2}[A-Za-z]{5}\d{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z]$/.test(v) ? v.toUpperCase() : null;
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export const IDENTIFIER_HINTS: Record<IdentifierKind, string> = {
  pan: "Enter the PAN as 10 characters, like AAAAA9999A.",
  gstin: "Enter the GSTIN as 15 characters, like 29AAAAA9999A1Z5.",
  email: "Enter a full email address, like name@example.com.",
  phone: "Enter a 10-digit mobile number.",
};

/**
 * Keyed SHA-256 of the normalised identifiers, so a later request from the same person can be
 * linked without storing the identifiers again. Keyed with AUTH_SECRET so the hash cannot be
 * reversed by trying every PAN.
 */
export function identifierHash(identifiers: readonly Identifier[], key = process.env.AUTH_SECRET ?? "firm-os-privacy"): string | null {
  const parts = identifiers.map((i) => `${i.kind}:${normaliseIdentifier(i.kind, i.value) ?? ""}`).filter((p) => !p.endsWith(":"));
  if (!parts.length) return null;
  return createHmac("sha256", key).update(parts.sort().join("|")).digest("hex");
}

function clientLabel(c: Row, code: string | null, kinds: IdentifierKind[], values: Map<IdentifierKind, string>): string {
  const what = kinds.map((k) => `${k === "pan" || k === "gstin" ? k.toUpperCase() : k} ${maskLast4(values.get(k) ?? "")}`).join(", ");
  return [maskName(String(c.name ?? "")), code, what].filter(Boolean).join(" · ");
}

export type IdentifierLocatorDeps = {
  /** The app's client (the register's own database). */
  db: Pick<PrivacyDb, "client" | "firmClient" | "user"> & Partial<PrivacyDb>;
  /** Identifier-search limiter (production: the shared database limiter, search/rate-limit.ts). */
  limiter: SearchRateLimiter;
  now: () => Date;
};

/**
 * The production locator: every identifier goes through findByIdentifier (purpose
 * "privacy-request", clients only), so a privacy lookup is exact, rate-limited and audited exactly
 * like a search. Hits are read back by Client.id to classify the person (an individual's own PAN,
 * a company contact, a company PAN that is not a person) and to build the register's masked label.
 * A refused lookup (rate limit) stops the request with a sentence instead of logging "no match".
 */
export function identifierPrincipalLocator(user: SessionUser, deps: IdentifierLocatorDeps): PrincipalLocator {
  const searchDeps = { db: deps.db as unknown as SearchDb, limiter: deps.limiter, clPaths: false, now: deps.now };
  return {
    async locate(identifiers) {
      const values = new Map<IdentifierKind, string>();
      for (const i of identifiers) {
        const n = normaliseIdentifier(i.kind, i.value);
        if (n) values.set(i.kind, n);
      }
      const notes: string[] = [];
      const hitKinds = new Map<string, Set<IdentifierKind>>();
      for (const [kind, value] of values) {
        const r = await findByIdentifier(user, value, { purpose: "privacy-request", types: ["client"], deps: searchDeps });
        if (!r.ok) {
          if (r.reason === "rate-limited") throw new Refusal(429, r.message);
          notes.push(`The ${kind === "pan" || kind === "gstin" ? kind.toUpperCase() : kind} could not be searched: ${r.message}`);
          continue;
        }
        for (const h of r.hits) {
          const id = h.refs?.clientId ?? h.id;
          hitKinds.set(id, (hitKinds.get(id) ?? new Set<IdentifierKind>()).add(kind));
        }
      }

      const found = new Map<string, { type: PrincipalType; row: Row; kinds: IdentifierKind[]; staff: boolean }>();
      const ids = [...hitKinds.keys()];
      const rows = ids.length ? await deps.db.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, entityType: true } }) : [];
      for (const c of rows) {
        const individual = INDIVIDUAL_ENTITIES.has(String(c.entityType));
        const kinds = IDENTIFIER_KINDS.filter((k) => hitKinds.get(String(c.id))?.has(k));
        // A company's PAN or GSTIN is not a person's: say so, and match it only through a contact's email or phone.
        for (const k of kinds.filter((x) => (x === "pan" || x === "gstin") && !individual)) {
          notes.push(`The ${k.toUpperCase()} ${maskLast4(values.get(k) ?? "")} belongs to a company or firm (${maskName(String(c.name))}), which is not a person under the DPDP Act. Search by the person's own email or phone instead.`);
        }
        const personal = individual ? kinds : kinds.filter((k) => k === "email" || k === "phone");
        if (personal.length) found.set(`c:${String(c.id)}`, { type: individual ? "client-person" : "client-contact", row: c, kinds: personal, staff: false });
      }
      const email = values.get("email");
      if (email) {
        const users = await deps.db.user.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, name: true, email: true } });
        for (const u of users) found.set(`u:${u.id}`, { type: "staff", row: u, kinds: ["email"], staff: true });
      }
      return { matches: await toMatches(deps.db, found, values), notes };
    },
  };
}

/** The register's masked matches: initials, client code and the last four characters of what matched. */
async function toMatches(
  db: Pick<PrivacyDb, "firmClient">,
  found: Map<string, { type: PrincipalType; row: Row; kinds: Iterable<IdentifierKind>; staff: boolean }>,
  values: Map<IdentifierKind, string>,
): Promise<PrincipalMatch[]> {
  const clientIds = [...found.values()].filter((h) => !h.staff).map((h) => String(h.row.id));
  const codes = new Map<string, string>();
  if (clientIds.length) {
    for (const fc of await db.firmClient.findMany({ where: { lmsClientId: { in: clientIds } }, select: { lmsClientId: true, clientCode: true } })) codes.set(fc.lmsClientId, fc.clientCode);
  }
  return [...found.values()].map((h) => {
    const kinds = IDENTIFIER_KINDS.filter((k) => [...h.kinds].includes(k));
    const label = h.staff
      ? `Staff ${maskName(String(h.row.name ?? h.row.email ?? ""))} · email ${maskLast4(String(h.row.email ?? ""))}`
      : clientLabel(h.row, codes.get(String(h.row.id)) ?? null, kinds, values);
    return { principalType: h.type, ref: String(h.row.id), label, matchedOn: kinds };
  });
}

/** Exact-match lookups with Prisma: Client (PAN, GSTIN, contact email / phone) and User (email). Comparison tests only; production uses identifierPrincipalLocator. */
export function prismaPrincipalLocator(db: Pick<PrivacyDb, "client" | "firmClient" | "user">): PrincipalLocator {
  return {
    async locate(identifiers) {
      const values = new Map<IdentifierKind, string>();
      for (const i of identifiers) {
        const n = normaliseIdentifier(i.kind, i.value);
        if (n) values.set(i.kind, n);
      }
      const notes: string[] = [];
      const found = new Map<string, { type: PrincipalType; row: Row; kinds: Set<IdentifierKind>; staff: boolean }>();
      const add = (type: PrincipalType, row: Row, kind: IdentifierKind, staff = false) => {
        const key = `${staff ? "u" : "c"}:${String(row.id)}`;
        const hit = found.get(key) ?? { type, row, kinds: new Set<IdentifierKind>(), staff };
        if (type === "client-person") hit.type = "client-person";
        hit.kinds.add(kind);
        found.set(key, hit);
      };
      const clientSelect = { id: true, name: true, entityType: true };

      for (const kind of ["pan", "gstin"] as const) {
        const v = values.get(kind);
        if (!v) continue;
        const rows = await db.client.findMany({ where: kind === "pan" ? { pan: v } : { gstin: v }, select: clientSelect });
        for (const c of rows) {
          if (INDIVIDUAL_ENTITIES.has(String(c.entityType))) add("client-person", c, kind);
          else notes.push(`The ${kind.toUpperCase()} ${maskLast4(v)} belongs to a company or firm (${maskName(String(c.name))}), which is not a person under the DPDP Act. Search by the person's own email or phone instead.`);
        }
      }
      const email = values.get("email");
      const phone = values.get("phone");
      const contactWhere = [...(email ? [{ contactEmail: { equals: email, mode: "insensitive" as const } }] : []), ...(phone ? [{ contactPhone: phone }] : [])];
      if (contactWhere.length) {
        const rows = await db.client.findMany({ where: { OR: contactWhere }, select: { ...clientSelect, contactEmail: true, contactPhone: true } });
        for (const c of rows) {
          const type: PrincipalType = INDIVIDUAL_ENTITIES.has(String(c.entityType)) ? "client-person" : "client-contact";
          if (email && String(c.contactEmail ?? "").toLowerCase() === email) add(type, c, "email");
          if (phone && c.contactPhone === phone) add(type, c, "phone");
        }
      }
      if (email) {
        const users = await db.user.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, name: true, email: true } });
        for (const u of users) add("staff", u, "email", true);
      }

      const clientIds = [...found.values()].filter((h) => !h.staff).map((h) => String(h.row.id));
      const codes = new Map<string, string>();
      if (clientIds.length) {
        for (const fc of await db.firmClient.findMany({ where: { lmsClientId: { in: clientIds } }, select: { lmsClientId: true, clientCode: true } })) codes.set(fc.lmsClientId, fc.clientCode);
      }
      const matches: PrincipalMatch[] = [...found.values()].map((h) => {
        const kinds = IDENTIFIER_KINDS.filter((k) => h.kinds.has(k));
        const label = h.staff
          ? `Staff ${maskName(String(h.row.name ?? h.row.email ?? ""))} · email ${maskLast4(String(h.row.email ?? ""))}`
          : clientLabel(h.row, codes.get(String(h.row.id)) ?? null, kinds, values);
        return { principalType: h.type, ref: String(h.row.id), label, matchedOn: kinds };
      });
      return { matches, notes };
    },
  };
}
