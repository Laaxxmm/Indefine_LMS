"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CloudUpload, Loader2 } from "lucide-react";
import { userMessage } from "@/lib/errors";

// "Save to OneDrive" for a version whose Word file never reached the SOP's OneDrive folder.
export function OneDriveRetry({ sopId, versionId }: { sopId: string; versionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tools/sop-builder/sops/${sopId}/versions/${versionId}/onedrive`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(data.error || "OneDrive did not take the file. Try again in a minute.");
      else router.refresh();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={retry} disabled={busy} className="inline-flex items-center gap-1 font-bold text-brand-700 hover:underline disabled:text-ink-faint">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />} Save to OneDrive
      </button>
      {error && (
        <span role="alert" className="inline-flex items-center gap-1 text-rose-600">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </span>
      )}
    </>
  );
}
