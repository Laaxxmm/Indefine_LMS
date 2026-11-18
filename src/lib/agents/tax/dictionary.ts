// ADR-006 (DPDP): names in a Tax run's inputs the anonymizer must mask before any cloud call — the
// taxpayer, other-source payers, TDS deductors (books and Form 26AS), AIS sources and MSME vendors.
// The inputs are already parsed by the input schema.
import type { DictionaryEntry } from "@/lib/ai/types";
import { freeTextNames, narrationNames, partyEntries } from "@/lib/ai/names";
import type { TaxInput } from "./parse";

export function taxDictionaryTerms(input: TaxInput): DictionaryEntry[] {
  const o = input.organiser;
  const taxpayerKind = o.profile.status === "individual" || o.profile.status === "huf" ? "NAME" : "ORG";
  return [
    ...partyEntries([o.profile.name], taxpayerKind),
    ...partyEntries(o.otherSources.map((s) => s.payer)),
    ...partyEntries(o.tdsInBooks.map((t) => t.deductor)),
    ...partyEntries((input.form26as ?? []).map((t) => t.deductor)),
    ...partyEntries((input.ais ?? []).map((a) => a.source)),
    ...(input.ais ?? []).flatMap((a) => narrationNames(a.description)),
    ...partyEntries((input.msme ?? []).map((m) => m.vendor)),
    // Re-audit NEW-1: names in free text — organiser notes, AIS descriptions, capital-gains assets.
    ...freeTextNames([o.profile.notes, ...(input.ais ?? []).map((a) => a.description), ...(input.capitalGains ?? []).map((c) => c.asset)]),
  ];
}
