"use client";

// One masked client identifier with a "Show" toggle for management (/clients/[id]). The full value
// is fetched only when asked for; each Show is recorded (AuditEvent) by the route.
import { useState } from "react";
import { call } from "@/components/ui";
import { PII_LABELS, type PiiField } from "@/lib/clients/pii";

export function RevealPii({ clientId, field, masked }: { clientId: string; field: PiiField; masked: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = PII_LABELS[field];

  async function show() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/clients/${encodeURIComponent(clientId)}/reveal`, { field });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setValue(typeof r.data.value === "string" ? r.data.value : masked);
  }

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="tabular-nums">{value ?? masked}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => (value ? setValue(null) : void show())}
        aria-label={value ? `Hide the full ${label}` : `Show the full ${label} (recorded)`}
        title={value ? undefined : "Each view is recorded"}
        className="text-[11.5px] font-semibold text-brand-600 hover:underline disabled:opacity-50"
      >
        {value ? "Hide" : busy ? "Showing…" : "Show"}
      </button>
      {error && (
        <span role="alert" className="text-[11.5px] text-rose-600">
          {error}
        </span>
      )}
    </span>
  );
}
