"use client";

// The /search panel: the search box, type filters and grouped results. Text searches run as the
// person types and are kept in the address (?q=); a PAN, GSTIN, phone or email runs only on Enter,
// is sent in the request body and never goes in the address. Keyboard: Down from the box moves into
// the results, Up / Down / Home / End move between them, Up from the first or Escape goes back to
// the box, Enter opens; Escape in the box clears it.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { btn, btnGhost, btnPrimary, card, chip, field, focusRing, sectionTitle } from "@/components/ui";
import { Alert, EmptyState } from "@/components/firm-os";
import { requestSearch } from "@/lib/search/client";
import { ENTER_HINT, HELP_TEXT, LOGGED_NOTE, START_TIP, noResultsText } from "@/lib/search/copy";
import { TYPE_DELAY_MS, moveActive } from "@/lib/search/keyboard";
import { searchPageLink } from "@/lib/search/links";
import { classifyQuery, isSensitiveQuery } from "@/lib/search/query";
import { IDENTIFIER_LABELS, SEARCH_TYPE_LABELS, SEARCH_TYPE_SINGULAR, type SearchResponse, type SearchType } from "@/lib/search/types";

// Pressed toggle: the run page's sheet tabs (bg-muted, text-ink) built on ui.ts `btn` instead of on
// btnGhost, so the pressed colours do not depend on CSS order; the darker border keeps the pressed
// state visible beside the white unpressed chips.
const pressed = `${btn} border border-ink-soft bg-muted text-ink`;
const listWrap = "rounded-2xl bg-card border border-border shadow-lift";

type Props = { types: SearchType[]; initialQuery: string; initialType: SearchType | null; initial: SearchResponse | null; initialNotice: string | null };

export function SearchPanel({ types, initialQuery, initialType, initial, initialNotice }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchType | null>(initialType);
  const [result, setResult] = useState<SearchResponse | null>(initial);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunRef = useRef<string>(initial ? initialQuery : "");

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const keepAddress = useCallback((q: string, t: SearchType | null) => {
    window.history.replaceState(null, "", searchPageLink(isSensitiveQuery(q) ? "" : q.trim(), t).href);
  }, []);

  const run = useCallback(
    async (q: string, t: SearchType | null) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      lastRunRef.current = q;
      setBusy(true);
      setNotice(null);
      const r = await requestSearch(q, t, ctrl.signal);
      if (ctrl.signal.aborted || (!r.ok && r.aborted)) return;
      setBusy(false);
      if (r.ok) {
        setResult(r.data);
        setError(null);
      } else {
        setResult(null);
        setError(r.error);
      }
      keepAddress(q, t);
    },
    [keepAddress],
  );

  function onChange(value: string) {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    const c = classifyQuery(value);
    if (c.kind === "text") {
      timerRef.current = setTimeout(() => void run(value, type), TYPE_DELAY_MS);
      return;
    }
    // Too short, or a PAN, GSTIN, phone or email waiting for Enter: stop any search in flight and
    // clear what was shown for the earlier query, and take the old query out of the address.
    abortRef.current?.abort();
    lastRunRef.current = "";
    setBusy(false);
    setResult(null);
    setError(null);
    setNotice(null);
    keepAddress("", type);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const c = classifyQuery(query);
    if (c.kind === "invalid") {
      setResult(null);
      setError(null);
      setNotice(c.message);
      return;
    }
    void run(query, type);
  }

  function chooseType(t: SearchType | null) {
    setType(t);
    const c = classifyQuery(query);
    // Re-run a text search at once; an identifier only if the person already pressed Enter on it.
    if (c.kind === "text" || (c.kind !== "invalid" && lastRunRef.current === query)) void run(query, t);
    else keepAddress(query, t);
  }

  const links = () => Array.from(resultsRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-result]") ?? []);

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      const first = links()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      onChange("");
    }
  }

  function onResultsKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = links();
    const at = all.indexOf(e.target as HTMLAnchorElement);
    if (at < 0) return;
    if (e.key === "Escape") {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }
    const next = moveActive(e.key, at, all.length, { wrap: false });
    if (next === null) return;
    e.preventDefault();
    if (next < 0) inputRef.current?.focus();
    else all[next]?.focus();
  }

  const c = classifyQuery(query);
  const sensitive = c.kind === "identifier" || c.kind === "partial" || c.kind === "unsupported";
  const status = busy ? "Searching" : result ? `${result.total} ${result.total === 1 ? "result" : "results"}` : "";
  let index = 0;

  return (
    <div>
      {/* No action: without JavaScript the form submits to /search itself (GET), as the /clients filter does. */}
      <form role="search" aria-label="Search Firm OS" onSubmit={onSubmit} className={`${card} mb-6`}>
        <label htmlFor="search-q" className="block text-[11px] font-bold text-ink-mute mb-1">
          Search
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="search-q"
            name="q"
            type="search"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onInputKey}
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            aria-describedby="search-help"
            className={`${field} ${focusRing}`}
          />
          {type && <input type="hidden" name="type" value={type} />}
          <button type="submit" className={`${btnPrimary} shrink-0`}>
            Search
          </button>
        </div>
        <p id="search-help" className="text-[12px] text-ink-mute mt-2">
          {sensitive ? ENTER_HINT : HELP_TEXT}
        </p>
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2 mt-3">
          <button type="button" aria-pressed={type === null} onClick={() => chooseType(null)} className={`${type === null ? pressed : btnGhost} ${focusRing}`}>
            All types
          </button>
          {types.map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => chooseType(t)} className={`${type === t ? pressed : btnGhost} ${focusRing}`}>
              {SEARCH_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </form>

      <div aria-live="polite" className="sr-only">
        {status}
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="warning" className="mb-4">
          {notice}
        </Alert>
      )}

      {!result && !error && !notice && <EmptyState title="Search for anything you work on">{START_TIP}</EmptyState>}

      {result && result.identifier && result.total > 0 && (
        <p role="status" className="text-[13px] text-ink-soft mb-4">
          Searched by {IDENTIFIER_LABELS[result.identifier.kind]} {result.identifier.masked}. {LOGGED_NOTE}
        </p>
      )}

      {result && result.total === 0 && (
        <EmptyState title={noResultsText(result, type).title}>
          {noResultsText(result, type).tip}
          {type && result.mode === "text" && (
            <>
              {" "}
              <button type="button" onClick={() => chooseType(null)} className={`font-semibold text-brand-600 hover:text-brand-700 hover:underline rounded ${focusRing}`}>
                Search all types
              </button>
            </>
          )}
        </EmptyState>
      )}

      {result && result.total > 0 && (
        <div ref={resultsRef} onKeyDown={onResultsKey}>
          {result.groups.map((g) => (
            <section key={g.type} aria-labelledby={`results-${g.type}`} className="mb-8">
              <h2 id={`results-${g.type}`} className={sectionTitle}>
                {g.label} · {g.hits.length}
                {g.more ? "+" : ""}
              </h2>
              <ul className={listWrap}>
                {g.hits.map((h) => {
                  const i = index++;
                  return (
                    <li key={h.id} className="border-t border-border first:border-t-0 first:rounded-t-2xl last:rounded-b-2xl">
                      <Link href={h.href} data-result={i} className={`block px-4 py-3 rounded-[inherit] hover:bg-muted/40 transition ${focusRing}`}>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold text-brand-600">{h.label}</span>
                          <span className={`${chip} border-border bg-muted text-ink-soft`}>{SEARCH_TYPE_SINGULAR[h.type]}</span>
                        </span>
                        {h.context && <span className="block text-[12px] text-ink-mute mt-1">{h.context}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {g.more && (
                <p className="text-[12px] text-ink-mute mt-2">
                  Showing the first {g.hits.length}.{" "}
                  {type === g.type ? (
                    "Add a word to narrow the search."
                  ) : (
                    <button type="button" onClick={() => chooseType(g.type)} className={`font-semibold text-brand-600 hover:text-brand-700 hover:underline rounded ${focusRing}`}>
                      Show only {g.label.toLowerCase()}
                    </button>
                  )}
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
