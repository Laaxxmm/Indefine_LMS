// Masking for identifiers the side panel shows (ADR-006 DPDP data classes). PAN and Aadhaar are
// never sent in full: only the last four characters, for checking that the right client is open.
// A value goes out in full only where the firm's SOP has staff paste it (see values.ts).

/** "ABCDE1234F" → "••••••234F". Fewer than 5 characters → all masked (nothing to recognise safely). */
export function maskLast4(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!v) return null;
  if (v.length < 5) return "•".repeat(v.length);
  return "•".repeat(v.length - 4) + v.slice(-4);
}

/** Last four characters only ("234F"), for sentences such as "GSTIN ending 1Z5". */
export function last4(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return v.length >= 5 ? v.slice(-4) : null;
}

const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const AADHAAR_RE = /\b[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\b/g;

/** Masks any PAN or Aadhaar number that appears inside free text (job titles, labels). */
export function maskIdentifiersInText(text: string): string {
  return text.replace(PAN_RE, (m) => maskLast4(m) ?? m).replace(AADHAAR_RE, (m) => maskLast4(m) ?? m);
}
