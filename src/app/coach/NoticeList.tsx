"use client";

// The person's undismissed notices: today's morning board, reminders and escalations (the coach's
// and the close loop's). Each can be dismissed; the job's own page is one link away.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnGhost, btnSm, call, card, errorText } from "@/components/ui";
import { chip, focusRing, linkText } from "@/app/agents/parts";
import type { NoticeView } from "@/lib/agents/coach/views";

const TONE: Record<string, string> = {
  board: "border-brand-200 bg-brand-50 text-brand-700",
  reminder: "border-sky-200 bg-sky-50 text-sky-800",
  escalation: "border-amber-200 bg-amber-50 text-amber-800",
};

export function NoticeList({ notices }: { notices: NoticeView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function dismiss(id: string) {
    setBusy(id);
    setError(null);
    const r = await call(`/api/firm-os/coach/events/${encodeURIComponent(id)}/dismiss`);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <div className={`${card} !p-0`}>
      <ul className="divide-y divide-border">
        {notices.map((n) => (
          <li key={n.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`${chip} ${TONE[n.kind] ?? "border-border bg-muted text-ink-soft"}`}>{n.label}</span>
                <span className="text-[12px] text-ink-mute tabular-nums">{n.at}</span>
              </div>
              <p className="text-[13.5px] text-ink">{n.message}</p>
              {n.link && (
                <Link href={n.link.href} className={`${linkText} text-[13px]`}>
                  {n.link.label}
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              disabled={busy !== null}
              aria-label={`Dismiss ${n.label.toLowerCase()}: ${n.message}`}
              className={`${btnGhost} ${btnSm} ${focusRing} inline-flex items-center gap-1.5 self-start sm:self-center shrink-0`}
            >
              {busy === n.id && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className={`${errorText} px-5 pb-4`}>
          {error}
        </p>
      )}
    </div>
  );
}
