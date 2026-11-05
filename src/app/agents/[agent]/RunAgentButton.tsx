"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnGhost, call, errorText } from "@/components/ui";
import { focusRing } from "../parts";

/** "Run agent" for the assignee: prepares the draft pack and opens the review screen. */
export function RunAgentButton({ agent, jobId, label }: { agent: string; jobId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/firm-os/agents/${encodeURIComponent(agent)}/jobs/${encodeURIComponent(jobId)}/run`);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/agents/${agent}/runs/${String(r.data.runId)}`);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={run} disabled={busy} aria-label={label} className={`${btnGhost} ${focusRing} inline-flex items-center gap-1.5`}>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        {busy ? "Running…" : "Run agent"}
      </button>
      {error && (
        <span role="alert" className={errorText}>
          {error}
        </span>
      )}
    </span>
  );
}
