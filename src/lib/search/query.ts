// What kind of search a query is. Pure and client-safe: the /search panel and the command palette
// use it to decide whether a query may go in the page address (text) or must be sent in a request
// body and only on Enter (identifiers); the service uses it to route the search.
//
// DPDP (ADR-006, class A): PAN, GSTIN, phone and email are searched only as an exact match of the
// full, normalised value. Anything that looks like part of one is refused with a plain sentence,
// so nobody can enumerate identifiers by typing prefixes.
import type { IdentifierKind } from "./types";

// Same patterns as PAN_RE / GSTIN_RE in src/lib/clients/core.ts (kept local so client bundles do
// not pull in zod; query.test.ts fails if the two drift apart).
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[^\s@.]{2,}$/;
/** "2026-27" (FY) and "2026-10" (period) are ordinary searches, not phone numbers. */
const FY_OR_PERIOD = /^\d{4}-\d{2}$/;

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;

export const QUERY_MESSAGES = {
  tooShort: `Type at least ${MIN_QUERY} characters to search.`,
  tooLong: `Searches can be up to ${MAX_QUERY} characters. Shorten the search and try again.`,
  partial: {
    pan: "Search by PAN needs the full 10-character PAN.",
    gstin: "Search by GSTIN needs the full 15-character GSTIN.",
    phone: "Search by phone needs the full 10-digit mobile number.",
    email: "Search by email needs the full email address, for example name@example.com.",
  } satisfies Record<IdentifierKind, string>,
  aadhaar: "Firm OS does not keep Aadhaar numbers, so it cannot search by Aadhaar. Search by the client's name, PAN or phone instead.",
} as const;

export type NormalisedIdentifier = { kind: IdentifierKind; value: string };

export type QueryClass =
  | { kind: "text"; q: string }
  | { kind: "identifier"; q: string; id: NormalisedIdentifier }
  | { kind: "partial"; q: string; idKind: IdentifierKind; message: string }
  | { kind: "unsupported"; q: string; message: string }
  | { kind: "invalid"; q: string; message: string };

/** Unicode-normalised, trimmed, inner whitespace collapsed. */
export function normaliseQuery(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The normalised form of a full PAN, GSTIN, Indian mobile number or email, or null when `raw` is
 * not one. PAN/GSTIN: upper case, spaces removed. Phone: the 10 digits (a +91, 91 or 0 prefix and
 * spaces, dashes, dots and brackets dropped). Email: lower case. These are the values hashed into
 * AuditEvent.meta.queryHash and PrivacyRequest.identifierHash.
 */
export function normaliseIdentifier(raw: string): NormalisedIdentifier | null {
  const q = normaliseQuery(raw);
  if (!q) return null;
  if (q.includes("@")) {
    const email = q.toLowerCase();
    return !/\s/.test(email) && EMAIL_PATTERN.test(email) ? { kind: "email", value: email } : null;
  }
  const compact = q.replace(/\s+/g, "").toUpperCase();
  if (PAN_PATTERN.test(compact)) return { kind: "pan", value: compact };
  if (GSTIN_PATTERN.test(compact)) return { kind: "gstin", value: compact };
  if (/^\+?[\d\s().-]+$/.test(q)) {
    const digits = q.replace(/\D/g, "");
    const explicitCountry = q.startsWith("+");
    if (explicitCountry && digits.length === 12 && digits.startsWith("91")) return { kind: "phone", value: digits.slice(2) };
    if (explicitCountry) return null;
    if (digits.length === 10) return { kind: "phone", value: digits };
    if (digits.length === 11 && digits.startsWith("0")) return { kind: "phone", value: digits.slice(1) };
    // 12 digits written as one block and starting 91 is a mobile number with the country code;
    // 12 digits grouped 4-4-4 (or not starting 91) is treated as an Aadhaar number (classifyQuery).
    if (digits.length === 12 && digits.startsWith("91") && /^\d{12}$/.test(q)) return { kind: "phone", value: digits.slice(2) };
  }
  return null;
}

// Character classes of each GSTIN / PAN position, to recognise a prefix of one.
const GSTIN_SHAPE: RegExp[] = [/\d/, /\d/, /[A-Z]/, /[A-Z]/, /[A-Z]/, /[A-Z]/, /[A-Z]/, /\d/, /\d/, /\d/, /\d/, /[A-Z]/, /[1-9A-Z]/, /Z/, /[0-9A-Z]/];
const PAN_SHAPE: RegExp[] = [/[A-Z]/, /[A-Z]/, /[A-Z]/, /[A-Z]/, /[A-Z]/, /\d/, /\d/, /\d/, /\d/, /[A-Z]/];
const fitsShape = (s: string, shape: RegExp[]) => s.length <= shape.length && [...s].every((ch, i) => shape[i].test(ch));

/**
 * Part of a GSTIN: the state code and the five PAN letters at least (7–14 characters). Shorter
 * strings such as "26AS" are ordinary searches.
 */
export function isPartialGstin(compact: string): boolean {
  return compact.length >= 7 && compact.length < 15 && fitsShape(compact, GSTIN_SHAPE);
}

/** Part of a PAN: the five letters and at least one digit (6–9 characters). "ACME" or "AUDIT" alone is a word. */
export function isPartialPan(compact: string): boolean {
  return compact.length >= 6 && compact.length < 10 && fitsShape(compact, PAN_SHAPE);
}

export function classifyQuery(raw: string): QueryClass {
  const q = normaliseQuery(raw);
  if (q.length < MIN_QUERY) return { kind: "invalid", q, message: QUERY_MESSAGES.tooShort };
  if (q.length > MAX_QUERY) return { kind: "invalid", q, message: QUERY_MESSAGES.tooLong };
  const id = normaliseIdentifier(q);
  if (id) return { kind: "identifier", q, id };
  if (q.includes("@")) return { kind: "partial", q, idKind: "email", message: QUERY_MESSAGES.partial.email };
  if (/^\+?[\d\s().-]+$/.test(q) && !FY_OR_PERIOD.test(q)) {
    const digits = q.replace(/\D/g, "");
    if (digits.length === 12) return { kind: "unsupported", q, message: QUERY_MESSAGES.aadhaar };
    if (digits.length >= 5) return { kind: "partial", q, idKind: "phone", message: QUERY_MESSAGES.partial.phone };
  }
  const compact = q.replace(/[\s-]+/g, "").toUpperCase();
  if (isPartialGstin(compact)) return { kind: "partial", q, idKind: "gstin", message: QUERY_MESSAGES.partial.gstin };
  if (isPartialPan(compact)) return { kind: "partial", q, idKind: "pan", message: QUERY_MESSAGES.partial.pan };
  return { kind: "text", q };
}

/**
 * True when the query is (or looks like part of) a PAN, GSTIN, phone, email or Aadhaar number.
 * Such queries are never put in the page address or a GET URL (browser history, proxy logs) and
 * are only sent when the person presses Enter.
 */
export function isSensitiveQuery(raw: string): boolean {
  const c = classifyQuery(raw);
  return c.kind === "identifier" || c.kind === "partial" || c.kind === "unsupported";
}
