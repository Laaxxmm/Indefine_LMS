"use client";

// Command palette: Ctrl+K (⌘+K on a Mac) anywhere opens a search dialog over the page, backed by
// the same API as /search (/api/firm-os/search). Not mounted by any layout yet — mount
// <CommandPalette /> once, inside <body> in src/app/layout.tsx (it renders nothing until opened).
// A header button can open it with openCommandPalette().
//
// Keyboard: typing searches (a PAN, GSTIN, phone or email only on Enter); Up / Down move through
// the results and wrap; Enter opens the highlighted result; Esc closes; Tab stays inside the dialog;
// focus returns to where it was when the dialog closes.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { field } from "@/components/ui";
import { chip, focusRing, linkText, sectionTitle } from "@/app/agents/parts";
import { requestSearch } from "@/lib/search/client";
import { ENTER_HINT, KEYS_TIP, LOGGED_NOTE, PALETTE_TIP, noResultsText } from "@/lib/search/copy";
import { TYPE_DELAY_MS, isPaletteShortcut, moveActive } from "@/lib/search/keyboard";
import { searchPageLink } from "@/lib/search/links";
import { classifyQuery } from "@/lib/search/query";
import { IDENTIFIER_LABELS, SEARCH_TYPE_SINGULAR, type SearchHit, type SearchResponse } from "@/lib/search/types";

/** Dispatched on window to open the palette from a button (openCommandPalette). */
export const OPEN_PALETTE_EVENT = "firm-os:open-search";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

// The Firm OS panel boxes (OnboardPanel's error box, the run page's notes).
const alertBox = "rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-[13px]";
const noteBox = "rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-[13px]";
const FOCUSABLE = 'input, button, a[href], [tabindex]:not([tabindex="-1"])';

export function CommandPalette({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ids = { title: `${uid}-title`, input: `${uid}-input`, hint: `${uid}-hint`, list: `${uid}-list` };
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const hits: SearchHit[] = result?.groups.flatMap((g) => g.hits) ?? [];

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    stop();
    setOpen(false);
  }, [stop]);

  const show = useCallback(() => {
    if (dialogRef.current) {
      inputRef.current?.focus();
      return;
    }
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  // Ctrl/⌘+K toggles from anywhere; openCommandPalette() opens.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      if (dialogRef.current) close();
      else show();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, show);
    };
  }, [close, show]);

  // Focus the box when it opens; give focus back when it closes.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      return;
    }
    returnTo.current?.focus();
    returnTo.current = null;
  }, [open]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (active >= 0) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, uid]);

  const run = useCallback(async (q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setNotice(null);
    const r = await requestSearch(q, null, ctrl.signal);
    if (ctrl.signal.aborted || (!r.ok && r.aborted)) return;
    setBusy(false);
    setResultFor(q);
    if (r.ok) {
      setResult(r.data);
      setError(null);
      setActive(r.data.total > 0 ? 0 : -1);
    } else {
      setResult(null);
      setError(r.error);
      setActive(-1);
    }
  }, []);

  function onChange(value: string) {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    const c = classifyQuery(value);
    if (c.kind === "text") {
      timerRef.current = setTimeout(() => void run(value), TYPE_DELAY_MS);
      return;
    }
    // Too short, or an identifier waiting for Enter: clear what was shown for the earlier query.
    stop();
    setResult(null);
    setResultFor(null);
    setError(null);
    setNotice(null);
    setActive(-1);
  }

  function openHit(h: SearchHit) {
    close();
    router.push(h.href);
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = moveActive(e.key, active, hits.length, { wrap: true });
      if (next !== null) {
        e.preventDefault();
        setActive(next);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (resultFor === query && active >= 0 && hits[active]) {
        openHit(hits[active]);
        return;
      }
      const c = classifyQuery(query);
      if (c.kind === "invalid") setNotice(c.message);
      else void run(query);
    }
  }

  function onDialogKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (document.activeElement === dialogRef.current) {
      // Focus sits on the dialog itself (after a click on its text): Tab goes to its first or last control.
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  const c = classifyQuery(query);
  const sensitive = c.kind === "identifier" || c.kind === "partial" || c.kind === "unsupported";
  const status = busy ? "Searching" : result ? `${result.total} ${result.total === 1 ? "result" : "results"}` : "";
  let index = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-ink/60" aria-hidden="true" onClick={close} />
      {/* tabIndex -1: a click on the dialog's text keeps focus inside it, so Esc and the Tab trap still work. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        tabIndex={-1}
        onKeyDown={onDialogKey}
        className="relative w-full max-w-xl rounded-2xl bg-card border border-border shadow-lift focus:outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <label id={ids.title} htmlFor={ids.input} className="block text-[11px] font-bold text-ink-mute">
            Search Firm OS
          </label>
          <button type="button" onClick={close} aria-label="Close search" className={`p-1.5 -mr-1.5 text-ink-mute hover:text-ink hover:bg-muted rounded-lg ${focusRing}`}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="px-4 pt-2 pb-3">
          <input
            ref={inputRef}
            id={ids.input}
            type="text"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={ids.list}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && hits[active] ? optionId(active) : undefined}
            aria-describedby={ids.hint}
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onInputKey}
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            className={`${field} ${focusRing}`}
          />
          <p id={ids.hint} className="text-[12px] text-ink-mute mt-2">
            {sensitive ? ENTER_HINT : PALETTE_TIP}
          </p>
        </div>

        <div aria-live="polite" className="sr-only">
          {status}
        </div>
        {error && (
          <div role="alert" className={`${alertBox} mx-4 mb-3`}>
            {error}
          </div>
        )}
        {notice && (
          <p role="status" className={`${noteBox} mx-4 mb-3`}>
            {notice}
          </p>
        )}
        {result && result.total === 0 && (
          <p role="status" className="mx-4 mb-3 text-[13px] text-ink-soft">
            {noResultsText(result, null).title}. {noResultsText(result, null).tip}
          </p>
        )}
        {result?.identifier && result.total > 0 && (
          <p role="status" className="mx-4 mb-3 text-[13px] text-ink-soft">
            Searched by {IDENTIFIER_LABELS[result.identifier.kind]} {result.identifier.masked}. {LOGGED_NOTE}
          </p>
        )}

        <div id={ids.list} role="listbox" aria-label="Search results" className={hits.length ? "max-h-[50vh] overflow-y-auto border-t border-border py-2" : "hidden"}>
          {result?.groups.map((g) => (
            <div key={g.type} role="group" aria-labelledby={`${uid}-group-${g.type}`}>
              <div id={`${uid}-group-${g.type}`} role="presentation" className={`${sectionTitle} px-4 pt-2`}>
                {g.label}
              </div>
              {g.hits.map((h) => {
                const i = index++;
                return (
                  <div
                    key={`${h.type}-${h.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openHit(h)}
                    className={`px-4 py-2 cursor-pointer ${i === active ? "bg-muted ring-2 ring-inset ring-brand-500" : "hover:bg-muted/40"}`}
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-brand-600">{h.label}</span>
                      <span className={`${chip} border-border bg-card text-ink-soft`}>{SEARCH_TYPE_SINGULAR[h.type]}</span>
                    </span>
                    {h.context && <span className="block text-[12.5px] text-ink-mute mt-0.5">{h.context}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-[12px] text-ink-mute">
          <span>{KEYS_TIP}</span>
          {result?.mode === "text" && result.query && (
            <Link href={searchPageLink(result.query).href} onClick={close} className={linkText}>
              See all results
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
