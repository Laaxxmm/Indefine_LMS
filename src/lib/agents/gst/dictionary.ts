// ADR-006 (DPDP): names in a GST run's inputs the anonymizer must mask before any cloud call —
// the registered legal name, customers (sales register), suppliers (purchase register, payables)
// and GSTR-2B trade names. Harvested deterministically from the same parse extract() uses
// (loadGstDataOnce: one parse per run's input object, shared by the hook and extract).
import type { DictionaryEntry } from "@/lib/ai/types";
import { fileNameText, freeTextNames, partyEntries } from "@/lib/ai/names";
import type { JobContext } from "@/lib/agents/core/runner";
import { loadGstData } from "./input";
import type { GstExtract, GstInput } from "./types";

const parsed = new WeakMap<GstInput, Map<string, Promise<GstExtract>>>();

/** loadGstData, memoised per input object (and period): the dictionary hook and extract parse once. */
export function loadGstDataOnce(input: GstInput, job: Pick<JobContext, "period" | "fy">): Promise<GstExtract> {
  const key = `${job.fy}|${job.period}`;
  let byJob = parsed.get(input);
  if (!byJob) parsed.set(input, (byJob = new Map()));
  let p = byJob.get(key);
  if (!p) byJob.set(key, (p = loadGstData(input, job)));
  return p;
}

export async function gstDictionaryTerms(input: GstInput, job: Pick<JobContext, "period" | "fy">): Promise<DictionaryEntry[]> {
  const d = await loadGstDataOnce(input, job);
  return [
    ...partyEntries([d.profile.legalName]),
    ...partyEntries(d.sales.map((s) => s.party)),
    ...partyEntries(d.purchases.map((p) => p.supplier)),
    ...partyEntries(d.payables.map((p) => p.supplier)),
    ...partyEntries(d.gstr2b.map((b) => b.tradeName)),
    // Re-audit NEW-1: names typed in free-text columns ("Rent - Ravindra Hegde", "Consultancy by …").
    ...freeTextNames([
      ...d.purchases.map((p) => p.ledger),
      ...d.purchases.flatMap((p) => p.lines.map((l) => l.description)),
      ...d.sales.flatMap((s) => s.lines.map((l) => l.description)),
      ...d.gstr2b.map((b) => b.reason),
      ...input.files.map((f) => fileNameText(f.name)),
    ]),
  ];
}
