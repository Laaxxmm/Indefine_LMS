// Client personal identifiers on /clients/[id] (DPDP, ADR-006 class A). Pure and client-safe.
// Everyone sees them masked — PAN (and Aadhaar) the last 4, phone the last 4 digits, email the
// first letter and the domain, GSTIN the state code and the last 4 (a GSTIN contains the PAN) —
// and management (canRevealClientPii) can press "Show" for one value, which is audited.
import { maskEmail, maskGstin, maskPan, maskPhone } from "@/lib/search/mask";

export const PII_FIELDS = ["pan", "gstin", "phone", "email"] as const;
export type PiiField = (typeof PII_FIELDS)[number];
export const PII_LABELS: Record<PiiField, string> = { pan: "PAN", gstin: "GSTIN", phone: "phone", email: "email" };

/**
 * The client form fields that hold personal data. The page never sends their full values to the
 * browser; the edit form loads them when it is opened, through the audited reveal route
 * ({ purpose: "edit" }, one AuditEvent per opening).
 */
export const EDIT_PRIVATE_FIELDS = ["pan", "gstin", "contactPhone", "contactEmail", "contactName", "referralSource", "growthNote"] as const;
export type EditPrivateField = (typeof EDIT_PRIVATE_FIELDS)[number];

/** A person's name as initials, "Kiran Kumar" → "K. K." (same form as src/lib/corrections/mask.ts). */
export function maskName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join(" ");
}

/** The masked form a person sees; null when the client has no value. */
export function maskClientPii(field: PiiField, value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (field === "pan") return maskPan(v);
  if (field === "gstin") return maskGstin(v);
  if (field === "phone") return maskPhone(v);
  return maskEmail(v);
}
