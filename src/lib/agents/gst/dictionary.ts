// ADR-006 (DPDP): names in a GST run's inputs the anonymizer must mask before any cloud call —
// the registered legal name, customers (sales register), suppliers (purchase register, payables)
// and GSTR-2B trade names. Harvested deterministically from the same parse extract() uses.
import type { DictionaryEntry } from "@/lib/ai/types";
import { partyEntries } from "@/lib/ai/names";
import type { JobContext } from "@/lib/agents/core/runner";
import { loadGstData } from "./input";
import type { GstInput } from "./types";

export async function gstDictionaryTerms(input: GstInput, job: Pick<JobContext, "period" | "fy">): Promise<DictionaryEntry[]> {
  const d = await loadGstData(input, job);
  return [
    ...partyEntries([d.profile.legalName]),
    ...partyEntries(d.sales.map((s) => s.party)),
    ...partyEntries(d.purchases.map((p) => p.supplier)),
    ...partyEntries(d.payables.map((p) => p.supplier)),
    ...partyEntries(d.gstr2b.map((b) => b.tradeName)),
  ];
}
