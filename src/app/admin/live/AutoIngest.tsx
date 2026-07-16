"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Fires the ingest sweep once when the admin opens Live sessions, then refreshes
// so freshly-pulled recordings / generated quizzes show. Makes ingestion happen
// automatically without depending on the external GitHub Actions cron.
export function AutoIngest() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    fetch("/api/admin/live/ingest-due", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        // Only refresh if something actually progressed, to avoid a refresh loop.
        const changed = (d?.results ?? []).some(
          (x: { status?: string }) => x.status === "ingested"
        );
        if (changed) router.refresh();
      })
      .catch(() => {});
  }, [router]);

  return null;
}
