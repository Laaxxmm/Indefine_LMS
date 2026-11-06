"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmPanel } from "@/components/firm-os";
import { call, errorText } from "@/components/ui";

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
 * will happen (the shared confirm step); the second sends it.
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

  return (
    <span className="inline-flex flex-col items-end gap-2">
      {pending ? (
        <ConfirmPanel
          label={`${pending} rule ${label}`}
          consequence={decisionConsequence(pending, toVersion)}
          confirmLabel={pending === "approve" ? "Confirm approval" : "Confirm rejection"}
          confirmVariant={pending === "approve" ? "success" : "danger"}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => decide(pending)}
        />
      ) : (
        <span className="inline-flex items-center gap-2 flex-wrap">
          <Button variant="danger" onClick={() => setPending("reject")} aria-label={`Reject rule: ${label}`}>
            Reject
          </Button>
          <Button variant="success" onClick={() => setPending("approve")} aria-label={`Approve rule: ${label}`}>
            Approve rule
          </Button>
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
