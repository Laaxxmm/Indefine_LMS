// /admin/team saves (security audit finding D). An admin never changes their own access: not
// their role (admin / employee) and not their level — level PARTNER grants partner rights
// across the LMS and Firm OS (approving SOP rule changes, lifting DPDP restrictions, revealing
// client identifiers), so self-promotion must be impossible. Another admin makes such a change.

/** Fields an admin may not set on their own row. */
export const SELF_LOCKED_FIELDS = ["role", "level"] as const;

/**
 * Removes the locked fields from the acting admin's own pending update (other people's rows are
 * untouched). Returns the fields that were dropped, for the caller to report.
 */
export function stripSelfAccessEdits(updates: Map<string, Record<string, unknown>>, actorId: string): string[] {
  const self = updates.get(actorId);
  if (!self) return [];
  const dropped = SELF_LOCKED_FIELDS.filter((f) => f in self);
  for (const f of dropped) delete self[f]; // in-memory form data, not a database row
  return dropped;
}
