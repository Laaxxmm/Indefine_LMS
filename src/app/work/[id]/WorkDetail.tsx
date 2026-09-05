"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkStatus, WorkTaskStatus } from "@prisma/client";
import { WORK_STATUS_LABELS, actionsFor, type TaskAction, type TaskLane, type WorkAction } from "@/lib/work/core";
import { call, errorText, firstName, workActionClass, type CallResult } from "@/components/ui";

export type TaskView = { id: string; title: string; status: WorkTaskStatus; assigneeId: string; assignee: string; lane: TaskLane; awaitsReview: boolean };

type Props = {
  work: { id: string; title: string; why: string | null; status: WorkStatus; owner: string; obsoleteReason: string | null; days: number; stale: boolean; canChange: boolean };
  tasks: TaskView[];
  users: { id: string; name: string }[];
  events: { id: string; line: string; when: string }[];
  isLead: boolean;
  meId: string;
};

const STATUS_CHIP: Record<WorkStatus, string> = {
  INBOX: "bg-muted text-ink-soft",
  ACTIVE: "bg-brand-50 text-brand-700",
  PARKED: "bg-amber-50 text-amber-800",
  DONE: "bg-emerald-50 text-emerald-800",
  OBSOLETE: "bg-rose-50 text-rose-700",
};
const sectionLabel = "text-[10.5px] font-extrabold tracking-[0.12em] text-ink-mute uppercase";
const TodayTag = () => <span className="px-1.5 py-[1px] rounded bg-brand-50 text-brand-700 font-bold text-[10px] uppercase tracking-wide shrink-0">Today</span>;

// One list, not three columns: open tasks first (a Today tag marks the ones promised on
// the Today page), finished and dropped ones below. Timeline beside it.
export function WorkDetail({ work, tasks, users, events, isLead, meId }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(false);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(meId);

  const open = tasks.filter((t) => t.status === "TODO");
  const closed = tasks.filter((t) => t.status !== "TODO");

  async function run(fn: () => Promise<CallResult>): Promise<CallResult> {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
    return r;
  }
  async function workAction(action: WorkAction) {
    let reason: string | undefined;
    if (action === "obsolete") {
      const r = window.prompt(`Why is "${work.title}" obsolete?`);
      if (!r?.trim()) return;
      reason = r.trim();
    }
    setUndo(false);
    await run(() => call(`/api/work/${work.id}`, { action, reason }, "PATCH"));
  }
  async function taskAct(id: string, action: TaskAction) {
    const r = await run(() => call(`/api/work/tasks/${id}`, { action }, "PATCH"));
    if (r.ok && r.data.workDone) setUndo(true);
  }
  async function addTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    const r = await run(() => call(`/api/work/${work.id}/tasks`, { title, assigneeId }));
    if (r.ok) setTitle("");
  }

  return (
    <div>
      <Link href="/work/board" className="text-[12.5px] font-semibold text-ink-mute hover:text-ink">← Board</Link>
      <div className="flex items-start justify-between gap-6 flex-wrap mt-2 mb-6">
        <div className="min-w-0">
          <h1 className="font-display font-extrabold text-[30px] tracking-[-0.03em] leading-none">{work.title}</h1>
          {work.why && <p className="text-ink-mute text-[14px] mt-2">{work.why}</p>}
          <p className="text-[12.5px] text-ink-mute mt-3 flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-[3px] rounded-md font-extrabold uppercase tracking-[0.08em] text-[10px] ${STATUS_CHIP[work.status]}`}>{WORK_STATUS_LABELS[work.status]}</span>
            <span>{firstName(work.owner)}</span>
            <span className="text-ink-faint">·</span>
            <span className="font-semibold text-ink-soft">{open.length} open</span>
            <span className="text-ink-faint">·</span>
            <span>last touched {work.days === 0 ? "today" : `${work.days}d ago`}</span>
            {work.stale && <span className="px-1.5 py-[1px] rounded-md bg-amber-100 text-amber-800 font-bold uppercase text-[9.5px] tracking-wide">Stale</span>}
            {work.obsoleteReason && <span className="text-ink-faint">· {work.obsoleteReason}</span>}
          </p>
        </div>
        {work.canChange && (
          <div className="flex items-center gap-2">
            {actionsFor(work.status).map(([a, label]) => (
              <button key={a} type="button" disabled={busy} onClick={() => workAction(a)} className={`${workActionClass(a)} !h-9 !px-4 !text-[13px]`}>{label}</button>
            ))}
          </div>
        )}
      </div>

      {undo && (
        <div className="mb-5 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] flex items-center justify-between gap-3">
          <span>All tasks finished, so this work is Done.</span>
          <button type="button" disabled={busy} onClick={() => workAction("reopen")} className="text-[12.5px] font-bold text-emerald-800 hover:underline">Undo</button>
        </div>
      )}
      {error && <p className={`mb-5 ${errorText}`}>{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] gap-5 items-start">
        <section className="rounded-[18px] bg-card border border-border shadow-soft">
          <form onSubmit={addTask} className="flex items-center gap-2 p-3 border-b border-border">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              placeholder="Add a task: one clear next step"
              aria-label="Task title"
              className="flex-1 min-w-0 h-10 rounded-lg border border-border bg-page/60 px-3.5 text-[13.5px] placeholder:text-ink-faint"
            />
            {isLead ? (
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Assignee" className="h-10 rounded-lg border border-border bg-page/60 px-3 text-[13px] text-ink-soft">
                {users.map((u) => <option key={u.id} value={u.id}>{firstName(u.name)}</option>)}
              </select>
            ) : (
              <span className="text-[12.5px] text-ink-mute whitespace-nowrap">for you</span>
            )}
            <button type="submit" disabled={busy || !title.trim()} className="h-10 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold shadow-pop transition disabled:opacity-50 disabled:cursor-not-allowed">Add</button>
          </form>

          <div className="px-3 pt-3 pb-1 flex items-center justify-between gap-3">
            <p className={sectionLabel}>Open · {open.length}</p>
            <p className="text-[11.5px] text-ink-faint flex items-center gap-1.5">Promised on the Today page? It carries <TodayTag /></p>
          </div>
          {open.length === 0 ? (
            <p className="px-3 pb-4 text-[13px] text-ink-mute">No open tasks. Add one above.</p>
          ) : (
            <ul className="divide-y divide-border">
              {open.map((t) => {
                const mine = t.assigneeId === meId;
                return (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-page/60">
                    {mine || isLead ? (
                      <input type="checkbox" checked={false} disabled={busy} onChange={() => taskAct(t.id, "done")} className="w-[18px] h-[18px] rounded-[5px] accent-brand-500 shrink-0" aria-label={`Finish ${t.title}`} />
                    ) : (
                      <span className="w-[18px] h-[18px] shrink-0" />
                    )}
                    <span className="flex-1 min-w-0 text-[14px] font-medium text-ink leading-snug">{t.title}</span>
                    {t.lane === "TODAY" && <TodayTag />}
                    <span className="text-[11.5px] text-ink-faint w-20 text-right shrink-0">{firstName(t.assignee)}</span>
                    {isLead && <button type="button" disabled={busy} onClick={() => taskAct(t.id, "drop")} className="text-[11.5px] font-bold text-ink-faint hover:text-rose-600 w-10 text-right shrink-0">Drop</button>}
                  </li>
                );
              })}
            </ul>
          )}

          {closed.length > 0 && (
            <>
              <div className="px-3 pt-4 pb-1"><p className={sectionLabel}>Done · {closed.length}</p></div>
              <ul className="divide-y divide-border">
                {closed.map((t) => {
                  const mine = t.assigneeId === meId;
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-ink-faint">
                      {t.status === "DONE" ? (
                        <span className="w-[18px] h-[18px] rounded-[5px] bg-emerald-500 text-white text-[11px] flex items-center justify-center font-black shrink-0">✓</span>
                      ) : (
                        <span className="w-[18px] h-[18px] rounded-[5px] border border-ink-faint text-[10px] flex items-center justify-center shrink-0">–</span>
                      )}
                      <span className="flex-1 min-w-0 text-[13.5px] line-through">{t.title}</span>
                      {t.status === "DROPPED" && <span className="text-[10px] uppercase tracking-wide shrink-0">dropped</span>}
                      {t.awaitsReview && (isLead ? (
                        <button type="button" disabled={busy} onClick={() => taskAct(t.id, "review")} className="h-7 px-2.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-[11.5px] font-bold shrink-0">Check</button>
                      ) : (
                        <span className="px-1.5 py-[1px] rounded bg-amber-50 text-amber-800 font-bold text-[10px] uppercase tracking-wide shrink-0">Waiting for check</span>
                      ))}
                      <span className="text-[11.5px] w-20 text-right shrink-0">{firstName(t.assignee)}</span>
                      {(mine || isLead) && <button type="button" disabled={busy} onClick={() => taskAct(t.id, "reopen")} className="text-[11.5px] font-bold text-ink-faint hover:text-ink w-10 text-right shrink-0">Reopen</button>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="h-2" />
        </section>

        <aside className="rounded-[18px] bg-card border border-border shadow-soft p-4">
          <p className={`${sectionLabel} mb-3`}>Timeline</p>
          {events.length === 0 ? (
            <p className="text-ink-mute text-[13px]">Nothing yet.</p>
          ) : (
            <ol className="relative border-l border-border ml-2 space-y-3">
              {events.map((e, i) => (
                <li key={e.id} className="pl-4 relative">
                  <span className={`absolute -left-[5px] top-[6px] w-2 h-2 rounded-full ${i === 0 ? "bg-brand-400" : "bg-border"}`} />
                  <p className="text-[12.5px] text-ink-soft leading-snug">{e.line}</p>
                  <p className="text-[11px] text-ink-faint mt-0.5">{e.when}</p>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
