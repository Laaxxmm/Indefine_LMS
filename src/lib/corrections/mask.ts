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
import type { DictionaryEntry } from "@/lib/ai/types";

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

/**
 * A reason, note or comment typed by staff, as it may be stored: PAN / GSTIN / Aadhaar / phone /
 * email / account numbers replaced by tokens, and — when a dictionary is given — the client's names
 * too (⟨ORG_1⟩, ⟨NAME_1⟩). The token map is thrown away, so the stored text never holds the value.
 */
export function scrubFreeText(text: string, dictionary: readonly DictionaryEntry[] = []): string {
  return anonymize(text.trim(), dictionary.length ? { dictionary: [...dictionary] } : {}).masked;
}

type ClientNames = { name?: string | null; contactName?: string | null; entityType?: string | null };

/** "Kiran Kumar" → ["Kiran", "Kumar"]: parts of three letters or more of a name of two words or more. */
function nameParts(value: string): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length < 2 ? [] : words.filter((w) => /^\p{L}{3,}$/u.test(w));
}

/**
 * Masking dictionary for notes about one client (ADR-006 class A): the client's name (a company
 * as ORG, an individual as NAME, with the parts of the name), the contact person's full name and its
 * parts. Pass the result to scrubFreeText(). Null-safe: no client, no entries.
 */
export function clientDictionary(...clients: (ClientNames | null | undefined)[]): DictionaryEntry[] {
  const out: DictionaryEntry[] = [];
  for (const c of clients) {
    if (!c) continue;
    const name = c.name?.trim();
    const contact = c.contactName?.trim();
    const individual = c.entityType === "INDIVIDUAL";
    if (name) out.push({ value: name, kind: individual ? "NAME" : "ORG" }, ...(individual ? nameParts(name) : []).map((v) => ({ value: v, kind: "NAME" as const })));
    if (contact) out.push({ value: contact, kind: "NAME" }, ...nameParts(contact).map((v) => ({ value: v, kind: "NAME" as const })));
  }
  return out.filter((e) => e.value.length >= 3 && !e.value.startsWith("[erased]"));
}
