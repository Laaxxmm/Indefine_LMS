"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkStatus, WorkTaskStatus } from "@prisma/client";
import { WORK_STATUS_LABELS, actionsFor, type TaskAction, type TaskLane, type WorkAction } from "@/lib/work/core";
import { btnDanger, btnGhost, btnPrimary, btnSm, btnSuccess, call, card, errorText, field, firstName, h2, workActionClass, type CallResult } from "@/components/ui";

export type TaskView = { id: string; title: string; status: WorkTaskStatus; assigneeId: string; assignee: string; lane: TaskLane; awaitsReview: boolean };

type Props = {
  work: { id: string; title: string; why: string | null; status: WorkStatus; owner: string; obsoleteReason: string | null; days: number; stale: boolean; canChange: boolean };
  tasks: TaskView[];
  users: { id: string; name: string }[];
  events: { id: string; line: string; when: string }[];
  isLead: boolean;
  meId: string;
};

const LANES: Array<[TaskLane, string, string]> = [
  ["TODO", "To do", "Open tasks. Tick when finished."],
  ["TODAY", "Today", "Promised for today on the Today page."],
  ["DONE", "Done", "Finished or dropped."],
];

export function WorkDetail({ work, tasks, users, events, isLead, meId }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(false);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(meId);

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
    <div className="space-y-6">
      <div>
        <Link href="/work/board" className="text-[12.5px] font-semibold text-ink-mute hover:text-ink">← Board</Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-2">
          <div>
            <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em]">{work.title}</h1>
            {work.why && <p className="text-ink-mute text-[14px] mt-1">{work.why}</p>}
            <p className="text-[12px] text-ink-faint mt-2 flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-muted font-bold uppercase tracking-wide text-[10.5px] text-ink">{WORK_STATUS_LABELS[work.status]}</span>
              <span>{firstName(work.owner)} · {tasks.filter((t) => t.status === "TODO").length} open · last touched {work.days === 0 ? "today" : `${work.days}d ago`}</span>
              {work.stale && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold uppercase text-[10px]">Stale</span>}
              {work.obsoleteReason && <span>· {work.obsoleteReason}</span>}
            </p>
          </div>
          {work.canChange && (
            <div className="flex flex-wrap gap-1.5">
              {actionsFor(work.status).map(([a, label]) => (
                <button key={a} type="button" disabled={busy} onClick={() => workAction(a)} className={workActionClass(a)}>{label}</button>
              ))}
            </div>
          )}
        </div>
        {undo && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] flex items-center justify-between gap-3">
            <span>All tasks finished, so this work is Done.</span>
            <button type="button" disabled={busy} onClick={() => workAction("reopen")} className={btnGhost}>Undo</button>
          </div>
        )}
        {error && <p className={`mt-3 ${errorText}`}>{error}</p>}
      </div>

      <form onSubmit={addTask} className={`${card} !py-4`}>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <span className={`${h2} !mb-0 sm:w-24 shrink-0`}>Add a task</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="One clear next step" className={field} aria-label="Task title" />
          {isLead ? (
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={`${field} sm:w-44`} aria-label="Assignee">
              {users.map((u) => <option key={u.id} value={u.id}>{firstName(u.name)}</option>)}
            </select>
          ) : (
            <span className="text-[12.5px] text-ink-mute self-center whitespace-nowrap">for you</span>
          )}
          <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>Add</button>
        </div>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {LANES.map(([lane, label, hint]) => (
          <div key={lane} className="rounded-2xl bg-muted/40 border border-border p-2.5 min-h-[120px]">
            <p className={`${h2} !mb-0.5`}>{label} · {tasks.filter((t) => t.lane === lane).length}</p>
            <p className="text-[11px] text-ink-faint mb-2.5">{hint}</p>
            <ul className="space-y-1.5">
              {tasks.filter((t) => t.lane === lane).map((t) => {
                const mine = t.assigneeId === meId;
                const open = t.status === "TODO";
                return (
                  <li key={t.id} className="rounded-lg bg-card border border-border px-2.5 py-2 flex items-start gap-2.5">
                    {open && (mine || isLead) ? (
                      <input type="checkbox" checked={false} disabled={busy} onChange={() => taskAct(t.id, "done")} className="w-4 h-4 mt-[3px] shrink-0" aria-label={`Finish ${t.title}`} />
                    ) : (
                      <span className="w-4 h-4 mt-[3px] inline-block shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13.5px] font-semibold leading-snug ${t.status === "DROPPED" ? "line-through text-ink-faint" : ""}`}>
                        {t.title}
                        <span className="ml-1.5 text-[11px] font-medium text-ink-faint">{firstName(t.assignee)}{t.status === "DROPPED" && " · dropped"}</span>
                      </p>
                      {(t.awaitsReview || (open && isLead) || (!open && (mine || isLead))) && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {t.awaitsReview && (isLead ? (
                            <button type="button" disabled={busy} onClick={() => taskAct(t.id, "review")} className={`${btnSuccess} ${btnSm}`}>Check</button>
                          ) : (
                            <span className="text-[10.5px] uppercase tracking-wide text-amber-700 self-center">waiting for check</span>
                          ))}
                          {open && isLead && <button type="button" disabled={busy} onClick={() => taskAct(t.id, "drop")} className={`${btnDanger} ${btnSm}`}>Drop</button>}
                          {!open && (mine || isLead) && <button type="button" disabled={busy} onClick={() => taskAct(t.id, "reopen")} className={`${btnGhost} ${btnSm}`}>Reopen</button>}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className={card}>
        <p className={h2}>Timeline</p>
        {events.length === 0 ? (
          <p className="text-ink-mute text-[13px]">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-[12.5px]">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3"><span className="text-ink-faint w-14 shrink-0 tabular-nums">{e.when}</span><span className="text-ink-mute">{e.line}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
