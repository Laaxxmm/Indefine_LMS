// ADR-006 (DPDP): names in a Books run's inputs the anonymizer must mask before any cloud call —
// payees / payers in bank-statement and bank-ledger narrations ("NEFT-RAJESH KUMAR SHARMA-SAL") and
// TDS deductees. Harvested deterministically from the same parse extract() uses.
import type { DictionaryEntry } from "@/lib/ai/types";
import { narrationNames, partyEntries } from "@/lib/ai/names";
import { parseBooksFiles, type BooksInput } from "./inputs";

export async function booksDictionaryTerms(input: BooksInput): Promise<DictionaryEntry[]> {
  const p = await parseBooksFiles(input);
  const lines = [...(p.statement?.lines ?? []), ...(p.ledger?.lines ?? [])];
  return [...lines.flatMap((l) => narrationNames(l.narration)), ...partyEntries((p.tdsDeducted ?? []).map((t) => t.party))];
}
