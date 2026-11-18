// Firm OS search: one call for the API, the /search page and the command palette.
//
//   search(user, { q, type? }, deps) → SearchOutcome
//
// 1. The query is classified (query.ts). Too short / too long → a plain sentence (400).
// 2. A full PAN, GSTIN, phone or email → the exact, masked, audited, rate-limited identifier lookup
//    (identifiers.ts). Part of one → codes and ids only, plus a sentence saying what to type. An
//    Aadhaar number → refused with a sentence.
// 3. Otherwise every provider the person may use runs in parallel (providers/*.ts). Each applies
//    the visibility rule of the entity's own page in its query, reads at most 4 × its limit with
//    Postgres ILIKE, matches and ranks in memory against the masked text, and returns at most 10
//    (25 when one type is chosen). At most 50 results overall.
//
// No index is added for this (no schema change). ILIKE '%…%' scans are fine at the firm's size;
// see the search design note for the trigram indexes to add if the tables grow.
import type { SessionUser } from "@/lib/access";
import { INACTIVE_MESSAGE, SIGNED_OUT_MESSAGE, canSearch } from "./access";
import type { SearchDeps } from "./db";
import { identifierTypes, lookupIdentifier } from "./identifiers";
import type { SearchProvider } from "./provider";
import { PROVIDERS } from "./providers";
import { classifyQuery } from "./query";
import { arrangeGroups, queryTerms } from "./rank";
import { IDENTIFIER_LABELS, PER_TYPE_LIMIT, SEARCH_TYPE_LABELS, SINGLE_TYPE_LIMIT, TOTAL_LIMIT, type SearchHit, type SearchResponse, type SearchType } from "./types";

export type SearchInput = { q: string; type?: SearchType | null };

export type SearchOutcome = { ok: true; data: SearchResponse } | { ok: false; status: 400 | 401 | 403 | 429; error: string; retryAfterSeconds?: number };

/** The types this person may search (one filter chip each), in display order. */
export function searchableTypes(user: SessionUser, providers: readonly SearchProvider[] = PROVIDERS): SearchType[] {
  return canSearch(user) ? providers.filter((p) => p.canUse(user)).map((p) => p.type) : [];
}

const fail = (status: 400 | 401 | 403 | 429, error: string, retryAfterSeconds?: number): SearchOutcome => ({ ok: false, status, error, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });

function byType(hits: SearchHit[], limit: number): Array<{ type: SearchType; hits: SearchHit[]; more: boolean }> {
  const map = new Map<SearchType, SearchHit[]>();
  for (const h of hits) map.set(h.type, [...(map.get(h.type) ?? []), h]);
  return [...map].map(([type, list]) => ({ type, hits: list.slice(0, limit), more: list.length > limit }));
}

export async function search(user: SessionUser, input: SearchInput, deps: SearchDeps, providers: readonly SearchProvider[] = PROVIDERS): Promise<SearchOutcome> {
  if (!user) return fail(401, SIGNED_OUT_MESSAGE);
  if (!canSearch(user)) return fail(403, INACTIVE_MESSAGE);
  const c = classifyQuery(input.q);
  if (c.kind === "invalid") return fail(400, c.message);

  const type = input.type ?? null;
  const types = searchableTypes(user, providers);
  const limit = type ? SINGLE_TYPE_LIMIT : PER_TYPE_LIMIT;
  // The response never repeats an identifier or part of one: `query` is the text searched, the
  // masked identifier, or empty.
  const echo = c.kind === "text" ? c.q : "";
  const empty = { query: echo, identifier: null, groups: [], total: 0, types };
  if (type && !types.includes(type)) {
    return { ok: true, data: { ...empty, mode: "text", message: `You do not have access to ${SEARCH_TYPE_LABELS[type].toLowerCase()}. Search all types instead.` } };
  }
  if (c.kind === "unsupported") return { ok: true, data: { ...empty, mode: "unsupported", message: c.message } };

  if (c.kind === "identifier") {
    const r = await lookupIdentifier(user, c.id, { deps, purpose: "search", types: type ? [type] : undefined });
    if (!r.ok) return fail(429, r.message, r.retryAfterSeconds);
    const groups = arrangeGroups(byType(r.hits, limit), TOTAL_LIMIT);
    const total = groups.reduce((n, g) => n + g.hits.length, 0);
    const where = identifierTypes(user).map((t) => (t === "onboarding" ? "onboarding records" : SEARCH_TYPE_LABELS[t].toLowerCase()));
    let message: string | null = null;
    if (!r.searchedTypes.length) message = `Search by PAN, GSTIN, phone or email finds ${where.join(" and ") || "clients"} only. Search all types instead.`;
    else if (!total) message = `Nothing you can open has this ${IDENTIFIER_LABELS[c.id.kind]}. Check it and try again, or search by the client's name or code.`;
    return { ok: true, data: { query: r.masked, mode: "identifier", identifier: { kind: r.kind, masked: r.masked }, groups, total, message, types } };
  }

  const exactOnly = c.kind === "partial";
  const chosen = providers.filter((p) => types.includes(p.type) && (!type || p.type === type));
  const ctxBase = { db: deps.db, user, q: c.q, terms: queryTerms(c.q), limit, exactOnly, clPaths: deps.clPaths };
  const results = await Promise.all(chosen.map(async (p) => ({ type: p.type, ...(await p.search(ctxBase)) })));
  const groups = arrangeGroups(results, TOTAL_LIMIT);
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  const message = c.kind === "partial" && total === 0 ? c.message : null;
  return { ok: true, data: { query: echo, mode: c.kind === "partial" ? "partial" : "text", identifier: null, groups, total, message, types } };
}
