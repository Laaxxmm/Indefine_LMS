// Identifier-only data principals: a person no client or staff record matches, whose data Firm OS
// still holds in a record that never reached a client — today an onboarding run that failed or was
// abandoned before the client was created (OnboardingRun.firmClientId null).
//
// The register stores only a keyed hash of the identifiers a request was logged with
// (PrivacyRequest.identifierHash, locator.ts identifierHash), never the identifiers. So these rows
// are found by hashing combinations of the identifiers each row holds (PAN, GSTIN, email, phone in
// its prompt and extracted details) and comparing with the request's hash: a row matches only when
// it holds every identifier the request was logged with. Names never match.
//
// Used by the single-principal rule (register.ts resolutionOf): such a request is "resolved" to
// those rows, so it can be exported, erased and closed; a request that matches nothing anywhere
// is not. Reads only.
import type { PrivacyReadDb, Row } from "./inventory";
import { IDENTIFIER_KINDS, identifierHash, normaliseIdentifier, type Identifier, type IdentifierKind } from "./locator";

/** Unlinked onboarding runs read per lookup (they are few: one per failed or abandoned onboarding). */
export const IDENTIFIER_ONLY_SCAN_LIMIT = 5000;
const COMBINATIONS_MAX = 256;

/** Identifier candidates in an onboarding run: its extracted details and anything shaped like one in its text. */
export function runIdentifiers(r: Row): Map<IdentifierKind, Set<string>> {
  const spec = (r.spec ?? {}) as Row;
  const text = [String(r.prompt ?? ""), JSON.stringify(r.spec ?? null)].join(" ");
  const out = new Map<IdentifierKind, Set<string>>(IDENTIFIER_KINDS.map((k) => [k, new Set<string>()]));
  const add = (kind: IdentifierKind, raw: unknown) => {
    const n = typeof raw === "string" ? normaliseIdentifier(kind, raw) : null;
    if (n) out.get(kind)!.add(n);
  };
  add("pan", spec.pan);
  for (const g of Array.isArray(spec.gstins) ? spec.gstins : [spec.gstin]) add("gstin", g);
  add("email", spec.contactEmail);
  add("phone", spec.contactPhone);
  for (const m of text.matchAll(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g)) add("pan", m[0]);
  for (const m of text.matchAll(/\b\d{2}[A-Za-z]{5}\d{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z]\b/g)) add("gstin", m[0]);
  for (const m of text.matchAll(/[^\s@"',;:<>()]+@[^\s@"',;:<>()]+\.[A-Za-z]{2,}/g)) add("email", m[0]);
  for (const m of text.matchAll(/(?<!\d)[6-9](?:[\s-]?\d){9}(?!\d)/g)) add("phone", m[0]);
  return out;
}

/** The combination of the row's identifiers that is exactly what the request was logged with (the person's own), or null. */
export function matchingIdentifiers(r: Row, hash: string, hashKey?: string): Identifier[] | null {
  let combos: Identifier[][] = [[]];
  for (const [kind, values] of runIdentifiers(r)) {
    const next: Identifier[][] = [];
    for (const c of combos) {
      next.push(c);
      for (const v of values) next.push([...c, { kind, value: v }]);
    }
    combos = next.slice(0, COMBINATIONS_MAX);
  }
  return combos.find((c) => c.length > 0 && identifierHash(c, hashKey) === hash) ?? null;
}

/** Whether some combination of the row's identifiers is exactly what the request was logged with. */
export function matchesIdentifierHash(r: Row, hash: string, hashKey?: string): boolean {
  return matchingIdentifiers(r, hash, hashKey) !== null;
}

/**
 * Onboarding runs never linked to a client whose identifiers are the ones the request was logged
 * with. Erased or retention-cleared runs hold no identifiers any more, so they never match.
 */
export async function identifierOnlyRows(db: Pick<PrivacyReadDb, "onboardingRun">, hash: string | null | undefined, hashKey?: string): Promise<Row[]> {
  if (!hash) return [];
  const unlinked = await db.onboardingRun.findMany({ where: { firmClientId: null }, orderBy: { createdAt: "asc" }, take: IDENTIFIER_ONLY_SCAN_LIMIT });
  return (unlinked as Row[]).filter((r) => matchesIdentifierHash(r, hash, hashKey));
}
