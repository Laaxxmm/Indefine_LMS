// Client personal identifiers on /clients/[id] (DPDP, ADR-006 class A). Pure and client-safe.
// Everyone sees them masked — PAN (and Aadhaar) the last 4, phone the last 4 digits, email the
// first letter and the domain, GSTIN the state code and the last 4 (a GSTIN contains the PAN) —
// and management (canRevealClientPii) can press "Show" for one value, which is audited.
import { maskEmail, maskGstin, maskPan, maskPhone } from "@/lib/search/mask";

export const PII_FIELDS = ["pan", "gstin", "phone", "email"] as const;
export type PiiField = (typeof PII_FIELDS)[number];
export const PII_LABELS: Record<PiiField, string> = { pan: "PAN", gstin: "GSTIN", phone: "phone", email: "email" };

/** The masked form a person sees; null when the client has no value. */
export function maskClientPii(field: PiiField, value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (field === "pan") return maskPan(v);
  if (field === "gstin") return maskGstin(v);
  if (field === "phone") return maskPhone(v);
  return maskEmail(v);
}
