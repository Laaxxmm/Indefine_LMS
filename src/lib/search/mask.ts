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
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const GSTIN_IN_TEXT = /(?<![A-Za-z0-9])\d{2}[A-Za-z]{5}\d{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z](?![A-Za-z0-9])/g;
const PAN_IN_TEXT = /(?<![A-Za-z0-9])[A-Za-z]{5}\d{4}[A-Za-z](?![A-Za-z0-9])/g;
const AADHAAR_IN_TEXT = /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g;
const PHONE_IN_TEXT = /(?<!\d)(?:\+?91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g;

/** Every PAN, GSTIN, Aadhaar number, Indian mobile number and email inside `text`, masked. */
export function maskText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(EMAIL_IN_TEXT, (m) => maskEmail(m))
    .replace(GSTIN_IN_TEXT, (m) => maskGstin(m))
    .replace(PAN_IN_TEXT, (m) => maskPan(m))
    .replace(AADHAAR_IN_TEXT, (m) => maskAadhaar(m))
    .replace(PHONE_IN_TEXT, (m) => maskPhone(m));
}
