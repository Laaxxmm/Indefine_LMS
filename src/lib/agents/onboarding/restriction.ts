// DPDP processing restrictions for onboarding (src/lib/privacy/consent.ts). Before the extractor
// sends a sentence to a model, the service asks whether the onboarding is about an existing LMS
// client whose AI processing is restricted: by the run's Firm OS client, or by an exact PAN, GSTIN
// (and the PAN inside it) or client code in the spec gathered so far or in the sentence itself.
// A brand-new client has no restriction. Answers typed into the form never reach a model, so
// they are not checked here.
import { isAiProcessingRestricted, type RestrictionReadDb } from "@/lib/privacy/consent";

export type OnboardingSubject = {
  firmClientId?: string | null;
  /** The sentence about to be read by the model. */
  text?: string | null;
  spec?: { pan?: string | null; gstins?: readonly string[] | null; clientCode?: string | null } | null;
};

export type SubjectIdentifiers = { firmClientIds: string[]; pans: string[]; gstins: string[]; clientCodes: string[] };

const PAN_IN_TEXT = /(?<![A-Za-z0-9])[A-Za-z]{5}\d{4}[A-Za-z](?![A-Za-z0-9])/g;
const GSTIN_IN_TEXT = /(?<![A-Za-z0-9])\d{2}[A-Za-z]{5}\d{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z](?![A-Za-z0-9])/g;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CODE_RE = /^[A-Z0-9]{3,10}$/;

/** The exact identifiers an onboarding subject names (upper case, de-duplicated). Pure. */
export function subjectIdentifiers(s: OnboardingSubject): SubjectIdentifiers {
  const pans = new Set<string>();
  const gstins = new Set<string>();
  const codes = new Set<string>();
  const addGstin = (g: string) => {
    const v = g.trim().toUpperCase();
    if (!GSTIN_RE.test(v)) return;
    gstins.add(v);
    pans.add(v.slice(2, 12));
  };
  const addPan = (p: string) => {
    const v = p.trim().toUpperCase();
    if (PAN_RE.test(v)) pans.add(v);
  };
  if (s.spec?.pan) addPan(s.spec.pan);
  for (const g of s.spec?.gstins ?? []) addGstin(g);
  const code = s.spec?.clientCode?.trim().toUpperCase();
  if (code && CODE_RE.test(code)) codes.add(code);
  const text = s.text ?? "";
  for (const m of text.matchAll(GSTIN_IN_TEXT)) addGstin(m[0]);
  for (const m of text.matchAll(PAN_IN_TEXT)) addPan(m[0]);
  return { firmClientIds: s.firmClientId ? [s.firmClientId] : [], pans: [...pans], gstins: [...gstins], clientCodes: [...codes] };
}

/** The reads the restriction check makes (the app's Prisma client satisfies it). */
export interface OnboardingRestrictionDb extends RestrictionReadDb {
  firmClient: { findMany(args: { where: { OR: ({ id: { in: string[] } } | { clientCode: { in: string[] } })[] }; select: { lmsClientId: true } }): PromiseLike<{ lmsClientId: string }[]> };
  client: { findMany(args: { where: { OR: ({ pan: { in: string[] } } | { gstin: { in: string[] } })[] }; select: { id: true } }): PromiseLike<{ id: string }[]> };
}

/** True when the subject names an existing LMS client whose AI processing is restricted. */
export async function isOnboardingAiRestricted(db: OnboardingRestrictionDb, s: OnboardingSubject): Promise<boolean> {
  const ids = subjectIdentifiers(s);
  const lms = new Set<string>();
  const fcOr: ({ id: { in: string[] } } | { clientCode: { in: string[] } })[] = [];
  if (ids.firmClientIds.length) fcOr.push({ id: { in: ids.firmClientIds } });
  if (ids.clientCodes.length) fcOr.push({ clientCode: { in: ids.clientCodes } });
  if (fcOr.length) for (const f of await db.firmClient.findMany({ where: { OR: fcOr }, select: { lmsClientId: true } })) lms.add(f.lmsClientId);
  const cOr: ({ pan: { in: string[] } } | { gstin: { in: string[] } })[] = [];
  if (ids.pans.length) cOr.push({ pan: { in: ids.pans } });
  if (ids.gstins.length) cOr.push({ gstin: { in: ids.gstins } });
  if (cOr.length) for (const c of await db.client.findMany({ where: { OR: cOr }, select: { id: true } })) lms.add(c.id);
  for (const lmsClientId of lms) if (await isAiProcessingRestricted(db, { lmsClientId })) return true;
  return false;
}
