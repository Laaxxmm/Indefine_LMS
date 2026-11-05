// Masking for values that go into AuditEvent.meta. ADR-006 keeps AuditEvent forever on the promise
// that it holds no raw client personal data, so a correction records class A values (PAN, Aadhaar,
// phone, email, GSTIN tied to a person, names, free text) only in a masked form:
//
//   pan / aadhaar / phone / email / gstin   "****" + last 4 characters      ABCDE1234F → ****234F
//   name                                     initials                        Priya Raman → P. R.
//   text                                     length and a short fingerprint  [text, 42 characters, #a1b2c3]
//
// A fixed "****" prefix (not one star per character) so the mask does not leak the length.
// Free-text reasons pass through the Phase 2 anonymizer (src/lib/ai/anonymizer.ts), whose token
// map is thrown away: the audit keeps ⟨PAN_1⟩, never the PAN. Pure module: no I/O.
import { createHash } from "node:crypto";
import { mask as anonymize } from "@/lib/ai/anonymizer";

export type PiiKind = "pan" | "aadhaar" | "phone" | "email" | "gstin" | "name" | "text";

/** What a before / after value looks like in the audit meta and the history view. */
export type AuditValue = string | number | boolean | null;

const LAST4_KINDS: ReadonlySet<PiiKind> = new Set(["pan", "aadhaar", "phone", "email", "gstin"]);

/** "****" + the last four characters ("****" alone when the value is four characters or fewer). */
export function maskLast4(value: string): string {
  const v = value.trim();
  return v.length <= 4 ? "****" : `****${v.slice(-4)}`;
}

/** "Priya Raman" → "P. R."; "" → "". */
export function maskName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join(" ");
}

/** Free text: its length and a 6-character fingerprint, so two different texts look different. */
export function maskText(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 6);
  return `[text, ${value.length} characters, #${digest}]`;
}

/** A column value as it may be written to AuditEvent.meta. Dates become ISO strings. */
export function maskForAudit(kind: PiiKind | undefined, value: unknown): AuditValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return kind ? maskLast4(String(value)) : value;
  const s = String(value);
  if (s.trim() === "") return null;
  if (!kind) return s.length > 200 ? `${s.slice(0, 197)}...` : s;
  if (LAST4_KINDS.has(kind)) return maskLast4(s);
  if (kind === "name") return maskName(s);
  return maskText(s);
}

/** A reason or note typed by staff, with PAN / GSTIN / Aadhaar / phone / email / account numbers replaced by tokens. */
export function scrubFreeText(text: string): string {
  return anonymize(text.trim()).masked;
}
