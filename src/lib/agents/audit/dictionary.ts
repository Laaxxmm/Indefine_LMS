// ADR-006 (DPDP): names in an Audit run's inputs the anonymizer must mask before any cloud call —
// the entity and the parties of every ledger-detail population (party / customer / vendor /
// narration columns). Harvested deterministically from the same parse extract() uses
// (parseAuditFilesOnce: one parse per run's input object, shared by the hook and extract).
import type { DictionaryEntry } from "@/lib/ai/types";
import { narrationNames, partyEntries } from "@/lib/ai/names";
import type { JobContext } from "@/lib/agents/core/runner";
import { parseAuditFiles, type AuditExtract, type AuditInput } from "./inputs";

const parsed = new WeakMap<AuditInput, Map<string, Promise<AuditExtract>>>();

/** parseAuditFiles, memoised per input object (and job): the dictionary hook and extract parse once. */
export function parseAuditFilesOnce(input: AuditInput, job: Pick<JobContext, "clientCode" | "fy">): Promise<AuditExtract> {
  const key = `${job.clientCode}|${job.fy}`;
  let byJob = parsed.get(input);
  if (!byJob) parsed.set(input, (byJob = new Map()));
  let p = byJob.get(key);
  if (!p) byJob.set(key, (p = parseAuditFiles(input, job)));
  return p;
}

export async function auditDictionaryTerms(input: AuditInput, job: Pick<JobContext, "clientCode" | "fy">): Promise<DictionaryEntry[]> {
  const x = await parseAuditFilesOnce(input, job);
  const parties = x.populations.flatMap((p) => p.items.map((i) => i.party));
  return [...partyEntries([x.profile?.name], "ORG"), ...partyEntries(parties), ...parties.flatMap((p) => narrationNames(p))];
}
