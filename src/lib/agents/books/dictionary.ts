// ADR-006 (DPDP): names in a Books run's inputs the anonymizer must mask before any cloud call —
// payees / payers in bank-statement and bank-ledger narrations ("NEFT-RAJESH KUMAR SHARMA-SAL") and
// TDS deductees. Harvested deterministically from the same parse extract() uses
// (parseBooksFilesOnce: one parse per run's input object, shared by the hook and extract).
import type { DictionaryEntry } from "@/lib/ai/types";
import { narrationNames, partyEntries } from "@/lib/ai/names";
import { parseBooksFiles, type BooksInput, type ParsedBooks } from "./inputs";

const parsed = new WeakMap<BooksInput, Promise<ParsedBooks>>();

/** parseBooksFiles, memoised per input object: the dictionary hook and extract parse once. */
export function parseBooksFilesOnce(input: BooksInput): Promise<ParsedBooks> {
  let p = parsed.get(input);
  if (!p) parsed.set(input, (p = parseBooksFiles(input)));
  return p;
}

export async function booksDictionaryTerms(input: BooksInput): Promise<DictionaryEntry[]> {
  const p = await parseBooksFilesOnce(input);
  const lines = [...(p.statement?.lines ?? []), ...(p.ledger?.lines ?? [])];
  return [...lines.flatMap((l) => narrationNames(l.narration)), ...partyEntries((p.tdsDeducted ?? []).map((t) => t.party))];
}
