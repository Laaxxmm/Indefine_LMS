// The provider contract. One provider per entity type (providers/*.ts); the service runs those the
// person may use, in parallel. A provider applies the visibility rule of the entity's own page
// (access.ts) inside its database query, ranks in memory (rank.ts) and returns at most `limit`.
import type { Session } from "next-auth";
import type { SessionUser } from "@/lib/access";
import type { SearchDb } from "./db";
import type { SearchHit, SearchType } from "./types";

export type SearchUser = Session["user"];

export type ProviderContext = {
  db: SearchDb;
  user: SearchUser;
  /** Normalised query. */
  q: string;
  /** Its words, lower case (every word must match some field). */
  terms: string[];
  limit: number;
  /** Part of an identifier was typed: match codes and ids exactly, nothing else. */
  exactOnly: boolean;
  clPaths: boolean;
};

export type ProviderResult = { hits: SearchHit[]; more: boolean };

export type SearchProvider = {
  type: SearchType;
  /** Whether the person may open this kind of entity at all. */
  canUse(user: SessionUser): boolean;
  search(ctx: ProviderContext): Promise<ProviderResult>;
};

/**
 * A provider whose search() also checks canUse() itself, so a caller that forgets to filter
 * providers still gets nothing for a person who may not open the entity type.
 */
export function defineProvider(p: SearchProvider): SearchProvider {
  return {
    type: p.type,
    canUse: p.canUse,
    search: async (ctx) => (p.canUse(ctx.user) ? p.search(ctx) : { hits: [], more: false }),
  };
}

/** Candidates read from the database per provider, before in-memory matching and ranking. */
export const fetchCap = (limit: number) => limit * 4;

/** Codes and ids are single tokens; the exact-match query runs only for those. */
export const isSingleToken = (q: string) => /^\S+$/.test(q);

/** Exact-only mode keeps rank-0 hits (code / id / name equal to the query). */
export function exactOnlyFilter<T extends { rank: number }>(hits: Array<T | null>, exactOnly: boolean): Array<T | null> {
  return exactOnly ? hits.filter((h) => h?.rank === 0) : hits;
}
