// Masking for search results (ADR-006, class A). Pure. A result never shows a full identifier:
// PAN and Aadhaar keep the last 4 characters, phone the last 4 digits, email the first letter and
// the domain, GSTIN the state code and the last 4.
//
// maskText() runs over every label and context line, and matching is done against the masked
// text (rank.ts), so a search can only match what the person will see. Typing the first letters of
// a PAN that appears inside a file name therefore finds nothing.
import type { IdentifierKind } from "./types";

export function maskPan(pan: string): string {
  return `XXXXXX${pan.slice(-4).toUpperCase()}`;
}

export function maskAadhaar(digits: string): string {
  return `XXXX XXXX ${digits.replace(/\D/g, "").slice(-4)}`;
}

export function maskPhone(phone: string): string {
  return `XXXXXX${phone.replace(/\D/g, "").slice(-4)}`;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0].toLowerCase()}***@${email.slice(at + 1).toLowerCase()}`;
}

export function maskGstin(gstin: string): string {
  const g = gstin.toUpperCase();
  return `${g.slice(0, 2)}${"X".repeat(9)}${g.slice(-4)}`;
}

export function maskIdentifier(kind: IdentifierKind, value: string): string {
  switch (kind) {
    case "pan":
      return maskPan(value);
    case "gstin":
      return maskGstin(value);
    case "phone":
      return maskPhone(value);
    case "email":
      return maskEmail(value);
  }
}

// Boundaries are "not a letter or digit" rather than \b, so "AAAPA1234A_PAN.pdf" is still caught.
// Every quantifier is bounded and anchored by a lookbehind (re-audit NEW-13: the e-mail pattern was
// `[…]+@`, which rescanned a long run without "@" from every position — 100 KB took 12 s).
const GSTIN_IN_TEXT = /(?<![A-Za-z0-9])\d{2}[A-Za-z]{5}\d{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z](?![A-Za-z0-9])/g;
const PAN_IN_TEXT = /(?<![A-Za-z0-9])[A-Za-z]{5}\d{4}[A-Za-z](?![A-Za-z0-9])/g;
const AADHAAR_IN_TEXT = /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g;
const PHONE_IN_TEXT = /(?<!\d)(?:\+?91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g;

/** Longest text maskText reads; the rest is cut (labels and context lines are far shorter). */
export const MASK_TEXT_MAX_CHARS = 200_000;

const isLocal = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 95 || c === 37 || c === 43 || c === 45;
const isDomain = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 46;

/** E-mail addresses masked in one pass: each "@" looks at most 64 characters back and 255 forward. */
function maskEmails(text: string): string {
  let out = "";
  let pos = 0;
  for (let at = text.indexOf("@"); at >= 0; at = text.indexOf("@", at + 1)) {
    let s = at;
    while (s > pos && at - s < 64 && isLocal(text.charCodeAt(s - 1))) s--;
    if (s === at) continue;
    let e = at + 1;
    while (e < text.length && e - at <= 255 && isDomain(text.charCodeAt(e))) e++;
    while (e > at + 1 && (text[e - 1] === "." || text[e - 1] === "-")) e--;
    const domain = text.slice(at + 1, e);
    if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(domain)) continue;
    out += text.slice(pos, s) + maskEmail(text.slice(s, e));
    pos = e;
    at = e - 1;
  }
  return out + text.slice(pos);
}

/** Every PAN, GSTIN, Aadhaar number, Indian mobile number and email inside `text`, masked. Linear in the text length. */
export function maskText(text: string | null | undefined): string {
  if (!text) return "";
  const capped = text.length > MASK_TEXT_MAX_CHARS ? `${text.slice(0, MASK_TEXT_MAX_CHARS)}…` : text;
  return maskEmails(capped)
    .replace(GSTIN_IN_TEXT, (m) => maskGstin(m))
    .replace(PAN_IN_TEXT, (m) => maskPan(m))
    .replace(AADHAAR_IN_TEXT, (m) => maskAadhaar(m))
    .replace(PHONE_IN_TEXT, (m) => maskPhone(m));
}
