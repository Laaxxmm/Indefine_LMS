"use client";

// The guided workspace's right-hand viewer: one tab strip (role="tablist"), one panel shown at a
// time. Arrow keys, Home and End move between tabs; the panels are server-rendered and passed in.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { focusRing } from "@/app/agents/parts";

export type WorkspaceTab = { id: string; label: string; count?: number; content: ReactNode };

const tabClass = `shrink-0 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold transition ${focusRing}`;
// NavLink's active style (brand-50 fill, brand-600 text): the selected tab reads as the current section.
const selectedClass = "bg-brand-50 text-brand-600";
const idleClass = "text-ink-mute hover:text-ink hover:bg-muted";

export function WorkspaceTabs({ tabs, initial, label }: { tabs: WorkspaceTab[]; initial?: string; label: string }) {
  const base = useId();
  const [active, setActive] = useState(initial && tabs.some((t) => t.id === initial) ? initial : tabs[0]?.id);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = tabs.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to === null) return;
    e.preventDefault();
    setActive(tabs[to].id);
    refs.current[to]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex items-center gap-1 mb-4 max-w-full overflow-x-auto">
        {tabs.map((t, i) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`${tabClass} ${on ? selectedClass : idleClass}`}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 tabular-nums text-[12px] font-bold">{t.count}</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={t.id !== active} tabIndex={0} className={`rounded-2xl ${focusRing}`}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
