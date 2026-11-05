// In-process response cache for the ModelRouter (docs/qa/efficiency-report.md). An identical
// model request inside one client scope reuses the earlier validated answer instead of calling a
// provider again: the same call twice in a run, and a re-run of the same job on unchanged inputs
// (after "Request changes" with no note for that call, or after a run failed on SharePoint).
//
//   key    sha256 of: scope, task@version (+ #2 for an agreement re-ask), forced tier, privacy,
//          difficulty, output token cap, the output JSON schema, the MASKED messages, and the
//          sha256 of the raw messages — so two requests share an entry only when the text sent
//          is byte-identical and the expected answer has the same shape. The router passes the
//          scope: the JobTask of the run (one client), else the run itself. Never across clients.
//   value  the schema-valid output the router returned with status "ok" (never needs-review,
//          queued or failed results), with the provider / model / confidence it came from. The
//          router re-validates a hit (schema + validators) before using it; a hit that fails is
//          dropped and the call is made.
//   bounds LRU, at most `maxEntries` entries and `maxChars` characters of JSON, each kept for
//          `ttlMs` (default 12 h). Process memory only: nothing is written to the database, no
//          prompt text is kept (only hashes as keys), and a restart empties it.
//
// ADR-002 / ADR-006: no raw prompt is stored anywhere; outputs are kept only in process memory,
// like any other value of the run, and only within one job's scope. A hit makes no provider call,
// so it writes no ModelCall row and costs nothing; the budget guard applies to calls only.
import { createHash } from "node:crypto";
import type { Msg, ProviderId } from "./types";

export type CachedResponse = {
  output: unknown;
  provider: ProviderId;
  model: string;
  confidence: number;
  escalated: boolean;
  anonymized: boolean;
  needsPartnerReview: boolean;
};

export interface ResponseCache {
  get(key: string): CachedResponse | undefined;
  set(key: string, value: CachedResponse): void;
  /** Forget one entry (a hit that no longer validates). */
  delete(key: string): void;
  readonly size: number;
}

export type ResponseCacheOptions = {
  /** Entry cap (default 500). */
  maxEntries?: number;
  /** Total JSON characters kept (default 4 MB of text). */
  maxChars?: number;
  /** Lifetime of an entry in ms (default 12 hours). */
  ttlMs?: number;
  now?: () => number;
};

export const RESPONSE_CACHE_DEFAULTS = { maxEntries: 500, maxChars: 4_000_000, ttlMs: 12 * 60 * 60 * 1000 } as const;

type Entry = { value: CachedResponse; chars: number; expires: number };

export function createResponseCache(opts: ResponseCacheOptions = {}): ResponseCache {
  const maxEntries = Math.max(1, opts.maxEntries ?? RESPONSE_CACHE_DEFAULTS.maxEntries);
  const maxChars = Math.max(1, opts.maxChars ?? RESPONSE_CACHE_DEFAULTS.maxChars);
  const ttlMs = Math.max(1, opts.ttlMs ?? RESPONSE_CACHE_DEFAULTS.ttlMs);
  const now = opts.now ?? Date.now;
  const map = new Map<string, Entry>(); // insertion order = least recently used first
  let chars = 0;

  const drop = (key: string) => {
    const e = map.get(key);
    if (!e) return;
    chars -= e.chars;
    map.delete(key);
  };

  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (e.expires <= now()) {
        drop(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, e); // most recently used
      return { ...e.value, output: structuredClone(e.value.output) };
    },
    set(key, value) {
      drop(key);
      const size = JSON.stringify(value.output ?? null).length;
      if (size > maxChars) return; // one answer larger than the whole budget: not kept
      map.set(key, { value: { ...value, output: structuredClone(value.output) }, chars: size, expires: now() + ttlMs });
      chars += size;
      for (const k of map.keys()) {
        if (map.size <= maxEntries && chars <= maxChars) break;
        drop(k);
      }
    },
    delete: drop,
    get size() {
      return map.size;
    },
  };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export type CacheKeyParts = {
  scope: string;
  /** ModelCall.task form: `<task>@<v>` (+ `#2`). */
  task: string;
  forceTier: string | null;
  privacy: string;
  difficulty: string;
  maxTokens: number;
  jsonSchema: unknown;
  maskedMessages: readonly Msg[];
  rawMessages: readonly Msg[];
};

/** sha256 over everything that decides the answer (see the header). */
export function responseCacheKey(p: CacheKeyParts): string {
  return sha(
    JSON.stringify([
      "router-cache/1",
      p.scope,
      p.task,
      p.forceTier,
      p.privacy,
      p.difficulty,
      p.maxTokens,
      sha(JSON.stringify(p.jsonSchema)),
      sha(JSON.stringify(p.maskedMessages)),
      sha(JSON.stringify(p.rawMessages)),
    ]),
  );
}
