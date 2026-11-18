"use client";

// "Help" for the page you are on: a button in the header that opens a side panel with that page's
// help from the registry (src/lib/help/pages.ts) — what the page is for, how to use it, what the
// words and statuses mean, what to do if you're stuck, and who to ask. Pages without an entry show
// no button. The panel is a modal dialog named by its heading: Escape or Close shuts it, Tab stays
// inside it, focus goes back to the Help button, and it closes when the page changes.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { CircleHelp, X } from "lucide-react";
import { StateChip } from "@/components/firm-os/StatusChip";
import { body, cardTitle, cx, eyebrow, focusRing, sectionTitle } from "@/components/ui";
import { trapTab } from "@/lib/help/focus-trap";
import { findHelp, type HelpEntry } from "@/lib/help/pages";

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * `className`: the header's pill (navIcon). `labelClassName`: how the word "Help" beside the icon
 * shows — `sr-only lg:not-sr-only` keeps the icon alone on a phone while the button keeps its name.
 */
export function HelpButton({ className, labelClassName = "" }: { className: string; labelClassName?: string }) {
  const pathname = usePathname();
  const entry = findHelp(pathname);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => setOpen(false), [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  if (!entry) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`Help for ${entry.title}`}
        onClick={() => setOpen(true)}
        className={cx(className, "inline-flex items-center gap-2")}
      >
        <CircleHelp className="w-4 h-4" aria-hidden="true" />
        <span className={labelClassName}>Help</span>
      </button>
      {/* Into <body>: the headers have backdrop-blur, and a backdrop filter makes the header the box a
          fixed element is placed in, so in place the panel would be clipped to the header's 64 px. */}
      {open && createPortal(<HelpPanel id={panelId} entry={entry} onClose={close} />, document.body)}
    </>
  );
}

/** The side panel for one entry. Exported for the render tests. */
export function HelpPanel({ id, entry, onClose }: { id?: string; entry: HelpEntry; onClose: () => void }) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const target = trapTab(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
    if (target === null) return;
    e.preventDefault();
    items[target].focus();
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" aria-hidden="true" onClick={onClose} />
      {/* tabIndex -1: a click on the panel's text keeps focus inside it, so Escape and the Tab trap still work. */}
      <div
        ref={dialog}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKey}
        className="absolute inset-y-0 right-0 w-full max-w-[480px] overflow-y-auto bg-card border-l border-border shadow-lift focus:outline-none"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-card border-b border-border px-6 py-4">
          <div className="min-w-0">
            <p className={`${eyebrow} mb-1`}>Help</p>
            <h2 id={titleId} className={`${cardTitle} text-ink break-words`}>
              {entry.title}
            </h2>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close help" className={`p-2 -mr-2 rounded-lg text-ink-mute hover:text-ink hover:bg-muted ${focusRing}`}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className={`${body} px-6 py-6 space-y-8 text-ink-soft`}>
          <HelpSection title="What this page is for">
            <p>{entry.purpose}</p>
          </HelpSection>

          <HelpSection title="How to use it">
            <ol className="list-decimal pl-5 space-y-2">
              {entry.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </HelpSection>

          {entry.terms.length > 0 && (
            <HelpSection title="What the words and statuses mean">
              <dl className="space-y-4">
                {entry.terms.map((t) => (
                  <div key={"state" in t ? t.state : t.term}>
                    <dt className="font-bold text-ink">{"state" in t ? <StateChip state={t.state} /> : t.term}</dt>
                    <dd className="mt-1">{t.meaning}</dd>
                  </div>
                ))}
              </dl>
            </HelpSection>
          )}

          {entry.stuck.length > 0 && (
            <HelpSection title="If you're stuck">
              <dl className="space-y-4">
                {entry.stuck.map((s) => (
                  <div key={s.problem}>
                    <dt className="font-bold text-ink">{s.problem}</dt>
                    <dd className="mt-1">{s.fix}</dd>
                  </div>
                ))}
              </dl>
            </HelpSection>
          )}

          <HelpSection title="Who to ask">
            <p>{entry.ask}</p>
          </HelpSection>
        </div>
      </div>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className={sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}
