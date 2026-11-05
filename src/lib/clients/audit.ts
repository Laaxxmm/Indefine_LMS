// AuditEvents for edits on the LMS client master and its jobs (security audit finding B). Each
// edit records who changed which fields, with before / after masked the way corrections are
// (src/lib/corrections/mask.ts): identifiers to their last 4, names to initials, free text to a
// length and fingerprint. AuditEvent keeps no raw client personal data (ADR-006).
import { logAudit, type AuditDb } from "@/lib/audit/log";
import { maskForAudit, type AuditValue, type PiiKind } from "@/lib/corrections/mask";

type Row = Record<string, unknown>;

/** Client columns that carry personal data, and how each is masked. Others are recorded as they are. */
export const CLIENT_PII: Readonly<Record<string, PiiKind>> = {
  name: "name",
  folderName: "name",
  pan: "pan",
  gstin: "gstin",
  contactName: "name",
  contactPhone: "phone",
  contactEmail: "email",
  referralSource: "text",
  growthNote: "text",
};
/** Job columns that carry personal data (notes are free text). */
export const JOB_PII: Readonly<Record<string, PiiKind>> = { notes: "text" };

export type FieldChange = { field: string; before: AuditValue; after: AuditValue };

const comparable = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined || v === null || v === "" ? null : String(v));

/** The fields `patch` actually changes on `before`, masked for the audit. */
export function maskedChanges(before: Row, patch: Row, pii: Readonly<Record<string, PiiKind>>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [field, next] of Object.entries(patch)) {
    if (next === undefined || comparable(before[field]) === comparable(next)) continue;
    const kind = pii[field];
    const asIs = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) ? String(v) : v); // Prisma.Decimal → "1234.5"
    out.push({ field, before: maskForAudit(kind, asIs(before[field])), after: maskForAudit(kind, asIs(next)) });
  }
  return out;
}

/** One AuditEvent for an edit that changed something (none when nothing changed). */
export async function auditEdit(db: AuditDb, e: { actorId: string; action: string; entity: "Client" | "Job"; entityId: string; changes: FieldChange[] }): Promise<void> {
  if (!e.changes.length) return;
  await logAudit(db, { actorId: e.actorId, action: e.action, entity: e.entity, entityId: e.entityId, meta: { changes: e.changes } });
}
