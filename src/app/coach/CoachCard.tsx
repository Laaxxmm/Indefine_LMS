// "My day" on /dashboard: the top of the person's morning board (rank.ts), shown only to people
// with open Firm OS jobs. Laid out like the dashboard's own sections (display heading, rounded
// card with divided rows); Firm OS text colours (ink-mute, AA on white) instead of ink-faint.
import Link from "next/link";
import { eyebrow, linkText, StateChip } from "@/app/agents/parts";
import { hasOpenJobs, loadBoard, type BoardItem } from "@/lib/agents/coach/board";
import { calendarFromEnv } from "@/lib/agents/coach/config";
import { coachDb } from "@/lib/agents/coach/defaults";
import { JobLink } from "./parts";

function Rows({ title, items }: { title: string; items: BoardItem[] }) {
  return (
    <div>
      <p className={`${eyebrow} px-5 pt-4`}>{title}</p>
      <ul className="divide-y divide-border">
        {items.map((r) => (
          <li key={r.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold">
                  {r.title} <span className="text-ink-mute font-normal tabular-nums">{r.period}</span>
                </p>
                <StateChip state={r.state} />
              </div>
              <p className="text-[13px] text-ink-mute mt-0.5">
                <span className="font-semibold text-ink-soft">{r.clientCode}</span> · <span className={r.overdue ? "text-rose-700 font-semibold" : ""}>{r.reason}</span> · {r.part}
              </p>
            </div>
            <span className="shrink-0">
              <JobLink item={r} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function CoachCard({ userId, now = new Date() }: { userId: string; now?: Date }) {
  const board = await loadBoard(coachDb(), userId, now, { calendar: calendarFromEnv() });
  if (!hasOpenJobs(board)) return null;
  const c = board.counts;
  return (
    <section aria-labelledby="my-day">
      <div className="flex items-baseline justify-between gap-3 mb-3.5">
        <div id="my-day" className="font-display font-extrabold text-2xl tracking-[-0.02em]">
          My day
        </div>
        <Link href="/coach" className={`${linkText} text-[13px]`}>
          Open My day
        </Link>
      </div>
      <div className="rounded-[20px] bg-card border border-border overflow-hidden divide-y divide-border">
        {board.mustToday.length > 0 && <Rows title={`Must today · ${c.mustToday}`} items={board.mustToday} />}
        {board.mustToday.length === 0 && board.thisWeek.length > 0 && <Rows title={`This week · ${c.thisWeek}`} items={board.thisWeek} />}
        <p className="px-5 py-3.5 text-[13px] text-ink-mute tabular-nums">
          {board.mustToday.length === 0 && board.thisWeek.length === 0 ? "Nothing due this week. " : ""}
          {c.open} open job{c.open === 1 ? "" : "s"}
          {board.mustToday.length > 0 ? `, ${c.thisWeek} more this week` : ""}
          {board.filed.length > 0 ? `, ${board.filed.length} filed and waiting to close` : ""}.
        </p>
      </div>
    </section>
  );
}
