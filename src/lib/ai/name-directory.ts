// Client-master and staff names for the anonymizer dictionary (ADR-006: names of individuals are
// class A, staff names class B — neither may reach a cloud model unmasked).
//
//   prismaNameDirectory(db).forJob(job)  one Firm OS job: the client's legal name and contact,
//                                        names recorded on its onboarding runs (legal / trade
//                                        name, contact, directors / partners / proprietor), and
//                                        every active staff member (runner deps.names)
//   loadFirmNameDictionary(db)           every active client's name and contact plus staff: the
//                                        dictionary for the legacy Gemini paths (SOP Builder,
//                                        live-session transcripts)
//
// Reads only; the database client is passed in (production: src/lib/prisma).
import type { PrismaClient } from "@prisma/client";
import type { DictionaryEntry, DictionaryKind } from "./types";
import { dedupeDictionary, partyEntry, type NameDirectory } from "./names";

type Db = Pick<PrismaClient, "firmClient" | "onboardingRun" | "user" | "client">;

/** Spec fields that hold names (OnboardingRun.spec is JSON; anything else is ignored). */
const SPEC_NAME_FIELDS: [string, DictionaryKind | undefined][] = [
  ["legalName", undefined],
  ["tradeName", "ORG"],
  ["contactName", "NAME"],
  ["proprietor", "NAME"],
  ["proprietorName", "NAME"],
];
const SPEC_NAME_LISTS = ["directors", "partners", "signatories", "designatedPartners", "trustees", "members"];

/** Names recorded on an onboarding spec. */
export function specNames(spec: unknown): DictionaryEntry[] {
  if (!spec || typeof spec !== "object") return [];
  const s = spec as Record<string, unknown>;
  const out: (DictionaryEntry | null)[] = [];
  for (const [key, kind] of SPEC_NAME_FIELDS) if (typeof s[key] === "string") out.push(partyEntry(s[key] as string, kind));
  for (const key of SPEC_NAME_LISTS) {
    const list = s[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const name = typeof item === "string" ? item : item && typeof item === "object" ? (item as { name?: unknown }).name : null;
      if (typeof name === "string") out.push(partyEntry(name, "NAME"));
    }
  }
  return out.filter((e): e is DictionaryEntry => e !== null);
}

/** Staff full names (class B) as NAME entries. */
export function staffEntries(names: readonly (string | null)[]): DictionaryEntry[] {
  return names.flatMap((n) => {
    const v = (n ?? "").replace(/\s+/g, " ").trim();
    return v.length >= 3 && /\p{L}/u.test(v) ? [{ value: v, kind: "NAME" as const }] : [];
  });
}

const clientEntries = (c: { name: string; contactName: string | null } | null | undefined): DictionaryEntry[] => {
  if (!c) return [];
  const out: (DictionaryEntry | null)[] = [partyEntry(c.name) ?? (c.name.trim().length >= 2 ? { value: c.name.trim(), kind: "ORG" } : null), partyEntry(c.contactName, "NAME")];
  return out.filter((e): e is DictionaryEntry => e !== null);
};

export function prismaNameDirectory(db: Db): NameDirectory {
  return {
    async forJob(job) {
      const fc = await db.firmClient.findUnique({ where: { clientCode: job.clientCode }, select: { id: true, client: { select: { name: true, contactName: true } } } });
      const [runs, staff] = await Promise.all([
        fc ? db.onboardingRun.findMany({ where: { firmClientId: fc.id }, select: { spec: true }, orderBy: { createdAt: "desc" }, take: 5 }) : Promise.resolve([] as { spec: unknown }[]),
        db.user.findMany({ where: { active: true }, select: { name: true } }),
      ]);
      return dedupeDictionary([...clientEntries(fc?.client), ...runs.flatMap((r) => specNames(r.spec)), ...staffEntries(staff.map((u) => u.name))]);
    },
  };
}

export async function loadFirmNameDictionary(db: Db): Promise<DictionaryEntry[]> {
  const [clients, staff] = await Promise.all([
    db.client.findMany({ where: { active: true }, select: { name: true, contactName: true } }),
    db.user.findMany({ where: { active: true }, select: { name: true } }),
  ]);
  return dedupeDictionary([...clients.flatMap((c) => clientEntries(c)), ...staffEntries(staff.map((u) => u.name))]);
}
