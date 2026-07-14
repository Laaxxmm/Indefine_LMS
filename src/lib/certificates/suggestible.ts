// Text fields whose values are reused across certificates (the signing block). These get
// the firm-wide "pick / add / remove" dropdown, and are auto-remembered on issue.
// Keys are stable across all 12 templates.
export const SUGGESTIBLE_FIELD_KEYS = [
  "firmName",
  "firmRegistrationNumber",
  "memberName",
  "designation",
  "membershipNo",
  "placeOfSignature",
] as const;

const set = new Set<string>(SUGGESTIBLE_FIELD_KEYS);
export function isSuggestible(fieldKey: string): boolean {
  return set.has(fieldKey);
}
