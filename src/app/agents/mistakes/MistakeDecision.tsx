"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnDanger, btnSuccess, call, errorText } from "@/components/ui";
import { focusRing } from "../parts";

/** Approve (→ new SOP pack minor version) or reject a proposed rule. Partners and managers only. */
export function MistakeDecision({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    const r = await call(`/api/firm-os/agents/mistakes/${encodeURIComponent(id)}/decide`, { decision });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button type="button" disabled={busy} onClick={() => decide("reject")} aria-label={`Reject rule: ${label}`} className={`${btnDanger} ${focusRing}`}>
        Reject
      </button>
      <button type="button" disabled={busy} onClick={() => decide("approve")} aria-label={`Approve rule: ${label}`} className={`${btnSuccess} ${focusRing}`}>
        Approve rule
      </button>
      {error && (
        <span role="alert" className={errorText}>
          {error}
        </span>
      )}
    </span>
  );
}
