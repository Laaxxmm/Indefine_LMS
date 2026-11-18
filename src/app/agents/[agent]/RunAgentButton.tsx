"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/firm-os";
import { call, errorText } from "@/components/ui";

/** "Run agent" for the assignee: prepares the draft pack and opens the review screen. */
export function RunAgentButton({ agent, jobId, label }: { agent: string; jobId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/firm-os/agents/${encodeURIComponent(agent)}/jobs/${encodeURIComponent(jobId)}/run`);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    // Stays busy until the review screen opens, so a second click cannot start a second run.
    router.push(`/agents/${agent}/runs/${String(r.data.runId)}`);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button onClick={run} busy={busy} busyLabel="Running…" aria-label={label}>
        Run agent
      </Button>
      {error && (
        <span role="alert" className={errorText}>
          {error}
        </span>
      )}
    </span>
  );
}
