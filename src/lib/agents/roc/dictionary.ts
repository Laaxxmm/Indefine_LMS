// ADR-006 (DPDP): names in a ROC run's inputs the anonymizer must mask before any cloud call — the
// company, its directors, shareholders, auditor and MSME vendors. The inputs are already parsed by
// the input schema.
import type { DictionaryEntry } from "@/lib/ai/types";
import { partyEntries } from "@/lib/ai/names";
import type { RocInput } from "./parse";

export function rocDictionaryTerms(input: RocInput): DictionaryEntry[] {
  return [
    ...partyEntries([input.company.name], "ORG"),
    ...partyEntries(input.directors.map((d) => d.name), "NAME"),
    ...partyEntries(input.shareholding.map((h) => h.holder)),
    ...partyEntries([input.auditor.name], input.auditor.type === "individual" ? "NAME" : "ORG"),
    ...partyEntries(input.msme.map((m) => m.vendor)),
  ];
}
