"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnDanger, btnGhost, btnSuccess, call, errorText } from "@/components/ui";
import { focusRing } from "../parts";

type Decision = "approve" | "reject";

/** What confirming will do, shown beside the confirm button. */
export function decisionConsequence(decision: Decision, toVersion: string | null): string {
  return decision === "approve"
    ? `Adds the rule to SOP pack ${toVersion ? `v${toVersion}` : "as a new minor version"}; every run after this uses it.`
    : "The rule is not added. The proposal stays in the log as rejected.";
}

/**
 * Approve (→ new SOP pack minor version) or reject a proposed rule. Partners only (an SOP rule change).
 * Neither can be undone from the screen, so the first click asks for confirmation and says what
 * will happen; the second sends it.
 */
export function MistakeDecision({ id, label, toVersion }: { id: string; label: string; toVersion: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    setBusy(true);
    setError(null);
    const r = await call(`/api/firm-os/agents/mistakes/${encodeURIComponent(id)}/decide`, { decision });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPending(null);
    router.refresh();
  }

  const consequence = pending ? decisionConsequence(pending, toVersion) : "";

  return (
    <span className="inline-flex flex-col items-end gap-1.5">
      {pending ? (
        <span className="inline-flex items-center gap-2 flex-wrap justify-end" role="group" aria-label={`Confirm: ${pending} rule ${label}`}>
          <span className="text-[12px] text-ink-soft max-w-xs text-right">{consequence}</span>
          <button type="button" disabled={busy} onClick={() => setPending(null)} className={`${btnGhost} ${focusRing}`}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(pending)}
            className={`${pending === "approve" ? btnSuccess : btnDanger} ${focusRing} inline-flex items-center gap-1.5`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {busy ? "Saving…" : pending === "approve" ? "Confirm approval" : "Confirm rejection"}
          </button>
        </span>
      ) : (
        <span className="inline-flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setPending("reject")} aria-label={`Reject rule: ${label}`} className={`${btnDanger} ${focusRing}`}>
            Reject
          </button>
          <button type="button" onClick={() => setPending("approve")} aria-label={`Approve rule: ${label}`} className={`${btnSuccess} ${focusRing}`}>
            Approve rule
          </button>
        </span>
      )}
      {error && (
        <span role="alert" className={errorText}>
          {error}
        </span>
      )}
    </span>
  );
}
