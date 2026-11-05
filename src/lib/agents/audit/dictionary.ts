// ADR-006 (DPDP): names in an Audit run's inputs the anonymizer must mask before any cloud call —
// the entity and the parties of every ledger-detail population (party / customer / vendor /
// narration columns). Harvested deterministically from the same parse extract() uses.
import type { DictionaryEntry } from "@/lib/ai/types";
import { narrationNames, partyEntries } from "@/lib/ai/names";
import type { JobContext } from "@/lib/agents/core/runner";
import { parseAuditFiles, type AuditInput } from "./inputs";

export async function auditDictionaryTerms(input: AuditInput, job: Pick<JobContext, "clientCode" | "fy">): Promise<DictionaryEntry[]> {
  const x = await parseAuditFiles(input, job);
  const parties = x.populations.flatMap((p) => p.items.map((i) => i.party));
  return [...partyEntries([x.profile?.name], "ORG"), ...partyEntries(parties), ...parties.flatMap((p) => narrationNames(p))];
}
