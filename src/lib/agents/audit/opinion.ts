// No audit opinion, ever (Phase 7). Deterministic guard over every text the agent writes:
//   - opinionHits(text): which phrases of OPINION_PHRASES (config.ts, data) occur, case- and
//     whitespace-insensitive;
//   - sanitizeText(text): echoed text (client explanations, ledger names, model messages) that
//     contains such wording is replaced by WITHHELD — the source stays in the input file;
//   - assertNoOpinion(sheets): final check on the built working papers; the only exempt cells are
//     the CARO 2020 clause titles (statutory wording). Any hit throws, so the run fails closed.
import type { SheetSpec } from "@/lib/agents/core/templates";
import { OPINION_PHRASES } from "./config";

export const WITHHELD = "[withheld: wording reads as an audit opinion — see the source file]";

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ");

export function opinionHits(text: string, phrases: readonly string[] = OPINION_PHRASES): string[] {
  const t = norm(text);
  return phrases.filter((p) => t.includes(norm(p)));
}

export const sanitizeText = (text: string) => (opinionHits(text).length ? WITHHELD : text);

export type OpinionHit = { sheet: string; row: number; column: string; phrase: string };

/** Exempt cells: sheet name → column keys (CARO clause titles). */
export type Exempt = Record<string, string[]>;

export function findOpinionInSheets(sheets: SheetSpec[], exempt: Exempt = {}): OpinionHit[] {
  const hits: OpinionHit[] = [];
  for (const s of sheets) {
    const skip = new Set(exempt[s.name] ?? []);
    for (const h of opinionHits(s.name)) hits.push({ sheet: s.name, row: 0, column: "(sheet name)", phrase: h });
    for (const c of s.columns) for (const h of opinionHits(c.header)) hits.push({ sheet: s.name, row: 0, column: c.key, phrase: h });
    s.rows.forEach((r, i) => {
      for (const [k, v] of Object.entries(r)) {
        if (skip.has(k) || typeof v !== "string") continue;
        for (const h of opinionHits(v)) hits.push({ sheet: s.name, row: i + 1, column: k, phrase: h });
      }
    });
  }
  return hits;
}

/** Replace every non-exempt text cell that carries opinion wording (echoed input / model text). */
export function sanitizeSheets(sheets: SheetSpec[], exempt: Exempt = {}): SheetSpec[] {
  return sheets.map((s) => {
    const skip = new Set(exempt[s.name] ?? []);
    return { ...s, rows: s.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, !skip.has(k) && typeof v === "string" ? sanitizeText(v) : v]))) };
  });
}

export class OpinionLanguageError extends Error {
  constructor(readonly hits: OpinionHit[]) {
    super(`Audit Assist output contains audit-opinion wording (${hits.map((h) => `"${h.phrase}" in ${h.sheet} row ${h.row}`).join("; ")}); the agent never expresses an opinion`);
    this.name = "OpinionLanguageError";
  }
}

export function assertNoOpinion(sheets: SheetSpec[], exempt: Exempt = {}, title = ""): void {
  const hits = [...findOpinionInSheets(sheets, exempt), ...opinionHits(title).map((p) => ({ sheet: "(title)", row: 0, column: "title", phrase: p }))];
  if (hits.length) throw new OpinionLanguageError(hits);
}
