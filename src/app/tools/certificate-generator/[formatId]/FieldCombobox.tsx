"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, X, Check } from "lucide-react";

export interface FieldOption {
  id: string;
  value: string;
}

// An editable dropdown: pick a saved (firm-wide) value, type a new one, or remove stale
// ones. New values are remembered when the certificate is issued; the ＋ row saves now.
export function FieldCombobox({
  label,
  help,
  required,
  value,
  onChange,
  options,
  onAdd,
  onDelete,
}: {
  label: string;
  help?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: FieldOption[];
  onAdd: (value: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = value.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.value.toLowerCase().includes(q)) : options;
  const exact = options.some((o) => o.value.toLowerCase() === q);
  const canSave = q.length > 0 && !exact;

  return (
    <div className="block" ref={ref}>
      <span className="block text-[12.5px] font-bold text-ink-soft mb-1">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      <div className="relative">
        <input
          className="w-full rounded-lg border border-border bg-page/60 pl-3 pr-9 py-2 text-[13.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-ink-faint hover:text-ink transition"
          aria-label="Toggle saved values"
        >
          <ChevronDown className={`w-4 h-4 transition ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (filtered.length > 0 || canSave) && (
          <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-lg shadow-lift max-h-56 overflow-auto py-1 animate-fade-in">
            {canSave && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onAdd(value.trim());
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] font-semibold text-brand-600 hover:bg-brand-50 transition text-left"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" /> Save &ldquo;{value.trim()}&rdquo; to the list
              </button>
            )}
            {filtered.map((o) => {
              const selected = o.value === value;
              return (
                <div key={o.id} className="group flex items-center gap-1 px-1.5">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className="flex-1 flex items-center gap-2 px-1.5 py-1.5 text-[13px] text-ink-soft hover:bg-muted rounded transition text-left"
                  >
                    <Check className={`w-3.5 h-3.5 shrink-0 ${selected ? "text-brand-500" : "text-transparent"}`} />
                    <span className="truncate">{o.value}</span>
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onDelete(o.id)}
                    className="shrink-0 p-1 rounded text-ink-faint opacity-0 group-hover:opacity-100 hover:text-rose-500 hover:bg-rose-50 transition"
                    aria-label={`Remove ${o.value}`}
                    title="Remove from list"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {help && <span className="block text-[11px] text-ink-faint mt-1">{help}</span>}
    </div>
  );
}
