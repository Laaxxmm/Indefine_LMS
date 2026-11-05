"use client";

// The one primary action of /focus and /workspace/[jobId]. Every kind links to the existing screen
// where the action is taken (the pack review screen holds Submit, Review, Mark filed and Record
// Turia close), except "Run agent", which calls the same route as RunAgentButton on /agents
// (POST /api/firm-os/agents/[agent]/jobs/[jobId]/run) and then opens the review screen. Nothing
// here decides who may act: the action comes from the server, and the routes check again.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnPrimary, call, errorText } from "@/components/ui";
import { focusRing } from "@/app/agents/parts";
import type { NextTaskAction } from "@/lib/workspace/contract";

const primary = `${btnPrimary} ${focusRing} inline-flex items-center gap-1.5`;

export function NextActionButton({ action, jobId, context }: { action: NextTaskAction; jobId: string; context: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (action.kind !== "run-agent" || !action.agent) {
    return (
      <Link href={action.href} className={primary} aria-label={`${action.label}: ${context}`}>
        {action.label}
      </Link>
    );
  }
  const agent = action.agent;

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
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={run} disabled={busy} aria-label={`${action.label}: ${context}`} className={primary}>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        {busy ? "Running…" : action.label}
      </button>
      {error && (
        <span role="alert" className={errorText}>
          {error}
        </span>
      )}
    </span>
  );
}
