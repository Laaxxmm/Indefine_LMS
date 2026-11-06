"use client";

// The person's undismissed notices: today's morning board, reminders and escalations (the coach's
// and the close loop's). Each can be dismissed; the job's own page is one link away. Rendered
// inside the Notices card on /coach.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { call, errorText, linkText, type ChipTone } from "@/components/ui";
import type { NoticeView } from "@/lib/agents/coach/views";
import { Button, Chip } from "@/components/firm-os";
import { DEFAULT_MESSAGE } from "@/lib/errors";

const TONE: Record<string, ChipTone> = { board: "brand", reminder: "info", escalation: "warning" };

export function NoticeList({ notices }: { notices: NoticeView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);

  async function dismiss(id: string) {
    setBusy(id);
    setError(null);
    const r = await call(`/api/firm-os/coach/events/${encodeURIComponent(id)}/dismiss`);
    setBusy(null);
    if (!r.ok) return setError({ id, text: r.error ?? DEFAULT_MESSAGE });
    router.refresh();
  }

  return (
    <ul className="divide-y divide-border -mx-6 -mb-6">
      {notices.map((n) => (
        <li key={n.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Chip tone={TONE[n.kind] ?? "neutral"}>{n.label}</Chip>
              <span className="text-[12px] text-ink-mute tabular-nums">{n.at}</span>
            </div>
            <p className="text-[13px] text-ink">{n.message}</p>
            {n.link && (
              <Link href={n.link.href} className={`${linkText} text-[13px]`}>
                {n.link.label}
              </Link>
            )}
          </div>
          <span className="inline-flex flex-col items-start sm:items-end gap-1 shrink-0">
            <Button onClick={() => dismiss(n.id)} busy={busy === n.id} disabled={busy !== null} aria-label={`Dismiss ${n.label.toLowerCase()}: ${n.message}`}>
              Dismiss
            </Button>
            {error?.id === n.id && (
              <span role="alert" className={errorText}>
                {error.text}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
