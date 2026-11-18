// Browser side of search, for the /search panel and the command palette. A text query goes as a
// GET with the query in the URL; a PAN, GSTIN, phone or email (or part of one) goes in a POST body,
// so it never lands in browser history, proxy logs or a Referer header.
import { isSensitiveQuery } from "./query";
import type { SearchResponse, SearchType } from "./types";

export type ClientSearchResult = { ok: true; data: SearchResponse } | { ok: false; error: string; aborted?: boolean };

const OFFLINE = "Search could not reach the server. Check your connection and try again.";
const FAILED = "Search did not work this time. Try again in a minute.";

export async function requestSearch(q: string, type: SearchType | null, signal?: AbortSignal): Promise<ClientSearchResult> {
  let res: Response;
  try {
    if (isSensitiveQuery(q)) {
      res = await fetch("/api/firm-os/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q, type }), signal, cache: "no-store" });
    } else {
      const params = new URLSearchParams({ q });
      if (type) params.set("type", type);
      res = await fetch(`/api/firm-os/search?${params.toString()}`, { signal, cache: "no-store" });
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, error: "", aborted: true };
    return { ok: false, error: OFFLINE };
  }
  const data = (await res.json().catch(() => null)) as (SearchResponse & { error?: string }) | null;
  if (!res.ok || !data) return { ok: false, error: data?.error || FAILED };
  return { ok: true, data };
}
