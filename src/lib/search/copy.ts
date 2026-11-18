// Words the /search page and the command palette show. Pure and client-safe; one place so both say
// the same thing.
import { SEARCH_TYPE_LABELS, type SearchResponse, type SearchType } from "./types";

export const HELP_TEXT = "Client name or code, job title, period, or file name. For a PAN, GSTIN, phone or email, type the full value and press Enter; those searches are logged.";
export const ENTER_HINT = "Press Enter to search. Searches by PAN, GSTIN, phone or email need the full value and are logged.";
export const START_TIP = "Try a client name or code (ACME01), a job such as GSTR-3B, a period such as 2026-10, or a file name. To find a client by PAN, GSTIN, phone or email, type the full value and press Enter.";
export const PALETTE_TIP = "Type a client name or code, a job, or a file name. For a PAN, GSTIN, phone or email, type the full value and press Enter.";
export const KEYS_TIP = "Use the up and down arrows to move, Enter to open and Esc to close.";
export const LOGGED_NOTE = "Searches by PAN, GSTIN, phone or email are logged.";

/** What to say when nothing matched. */
export function noResultsText(r: SearchResponse, type: SearchType | null): { title: string; tip: string } {
  const title = r.mode === "text" && r.query ? `No results for “${r.query}”` : "No results";
  if (r.message) return { title, tip: r.message };
  return {
    title,
    tip: type ? `Nothing in ${SEARCH_TYPE_LABELS[type].toLowerCase()} matches. Try all types, the client code, or fewer words.` : "Check the spelling, try the client code, or use fewer words.",
  };
}
