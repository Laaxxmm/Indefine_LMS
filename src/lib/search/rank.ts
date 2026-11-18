// Ranking. Pure. Exact code / ID / name first, then "starts with", then "contains"; the most
// recently changed entity first on equal rank. Matching is checked here, in memory, against the
// masked text the person will see (mask.ts) — the database query (ILIKE) only narrows candidates.
import { maskText } from "./mask";
import type { MatchRank, SearchGroup, SearchHit, SearchType } from "./types";
import { SEARCH_TYPES, SEARCH_TYPE_LABELS } from "./types";

type Text = string | null | undefined;

export type MatchFields = {
  /** Matched only exactly and case-sensitively (cuid ids). */
  ids?: Text[];
  /** Client codes, agent keys, acknowledgement numbers: exact, prefix or contains, case-insensitive. */
  codes?: Text[];
  /** Names, titles, subjects, paths: masked first, then exact, prefix or contains, case-insensitive. */
  text?: Text[];
};

/** Words of a query (at most 6), lower case. Every word must appear in some field. */
export function queryTerms(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
}

/** The rank of an entity for query `q`, or null when it does not match what the person can see. */
export function rankMatch(q: string, f: MatchFields): MatchRank | null {
  if ((f.ids ?? []).some((v) => v === q)) return 0;
  const ql = q.toLowerCase();
  const hay = [...(f.codes ?? []).map((v) => (v ?? "").toLowerCase()), ...(f.text ?? []).map((v) => maskText(v).toLowerCase())].filter(Boolean);
  if (hay.some((v) => v === ql)) return 0;
  if (hay.some((v) => v.startsWith(ql))) return 1;
  const terms = queryTerms(q);
  if (terms.length && terms.every((t) => hay.some((v) => v.includes(t)))) return 2;
  return null;
}

/** Rank first, then most recent, then label (stable output). */
export function compareHits(a: SearchHit, b: SearchHit): number {
  return a.rank - b.rank || b.at.localeCompare(a.at) || a.label.localeCompare(b.label);
}

/** One provider's candidates → its hits: unmatched dropped, duplicates merged, ranked, capped. */
export function finalise(candidates: Array<SearchHit | null>, limit: number): { hits: SearchHit[]; more: boolean } {
  const best = new Map<string, SearchHit>();
  for (const h of candidates) {
    if (!h) continue;
    const seen = best.get(h.id);
    if (!seen || h.rank < seen.rank) best.set(h.id, h);
  }
  const sorted = [...best.values()].sort(compareHits);
  return { hits: sorted.slice(0, limit), more: sorted.length > limit };
}

/**
 * Groups in display order (best rank first, then the SEARCH_TYPES order), with at most `total`
 * hits overall: the lowest-ranked hits are dropped first and their group is marked `more`.
 */
export function arrangeGroups(results: Array<{ type: SearchType; hits: SearchHit[]; more: boolean }>, total: number): SearchGroup[] {
  const all = results.flatMap((r) => r.hits).sort(compareHits);
  const keep = new Set(all.slice(0, total));
  const groups = results
    .map((r) => {
      const hits = r.hits.filter((h) => keep.has(h));
      return { type: r.type, label: SEARCH_TYPE_LABELS[r.type], hits, more: r.more || hits.length < r.hits.length };
    })
    .filter((g) => g.hits.length > 0);
  const order = (t: SearchType) => SEARCH_TYPES.indexOf(t);
  return groups.sort((a, b) => a.hits[0].rank - b.hits[0].rank || order(a.type) - order(b.type));
}
