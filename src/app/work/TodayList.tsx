"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DayPickOutcome, WorkTaskStatus } from "@prisma/client";
import { btnGhost, call, card, errorText } from "./ui";

export type TodayPick = { taskId: string; title: string; status: WorkTaskStatus; outcome: DayPickOutcome | null; workId: string; workTitle: string };

// Today's promises with tick boxes. Finishing the last task of a work finishes the work;
// the banner offers Undo, which reopens it.
export function TodayList({ picks }: { picks: TodayPick[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ workId: string; title: string } | null>(null);

  async function done(p: TodayPick) {
    setBusy(p.taskId);
    setError(null);
    const r = await call(`/api/work/tasks/${p.taskId}`, { action: "done" }, "PATCH");
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (r.data.workDone) setUndo({ workId: p.workId, title: p.workTitle });
    router.refresh();
  }

  async function reopenWork() {
    if (!undo) return;
    const r = await call(`/api/work/${undo.workId}`, { action: "reopen" }, "PATCH");
    if (!r.ok) setError(r.error);
    setUndo(null);
    router.refresh();
  }

  return (
    <div className={card}>
      <ul className="space-y-3">
        {picks.map((p) => {
          const finished = p.status !== "TODO";
          return (
            <li key={p.taskId} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={finished}
                disabled={finished || busy === p.taskId}
                onChange={() => done(p)}
                className="w-5 h-5"
                aria-label={`Finish ${p.title}`}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-[15px] font-semibold ${finished ? "line-through text-ink-faint" : ""}`}>{p.title}</p>
                <Link href={`/work/${p.workId}`} className="text-[12px] text-ink-mute hover:text-brand-600">{p.workTitle}</Link>
                <Link href={`/work/${p.workId}`} className="ml-2 text-[12px] text-brand-600 hover:underline">+ add task</Link>
              </div>
              {p.outcome === "CARRIED" && <span className="text-[10.5px] uppercase tracking-wide text-amber-700">carried</span>}
            </li>
          );
        })}
      </ul>
      {undo && (
        <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] flex items-center justify-between gap-3">
          <span>&ldquo;{undo.title}&rdquo; is Done, all its tasks are finished.</span>
          <button type="button" onClick={reopenWork} className={btnGhost}>Undo</button>
        </div>
      )}
      {error && <p className={`mt-3 ${errorText}`}>{error}</p>}
    </div>
  );
}
