// Shared bits for /coach and the dashboard card: the board table and the weekly-summary figures.
// Built from the /agents parts (tableWrap, thead, th, td, StateChip, focusRing) so the coach reads
// like the rest of Firm OS; no score is shown, only the reason for each position (no gamification).
import Link from "next/link";
import { btnGhost } from "@/components/ui";
import { StateChip, focusRing, tableWrap, td, th, thead } from "@/app/agents/parts";
import type { BoardItem } from "@/lib/agents/coach/board";
import { formatDuration } from "@/lib/close-loop/cycle-time";
import type { SummaryView } from "@/lib/agents/coach/views";

const reasonTone = (r: BoardItem) => (r.overdue ? "text-rose-700 font-semibold" : "text-ink-soft");

/** "Open in Waiting for you" / "Review pack" …, the /agents "Waiting for you" action style. */
export function JobLink({ item }: { item: Pick<BoardItem, "link" | "title" | "clientCode"> }) {
  return (
    <Link href={item.link.href} className={`${btnGhost} ${focusRing} inline-flex whitespace-nowrap`} aria-label={`${item.link.label}: ${item.title} for ${item.clientCode}`}>
      {item.link.label}
    </Link>
  );
}

export function BoardTable({ items, caption }: { items: BoardItem[]; caption: string }) {
  return (
    <div className={tableWrap}>
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>Job</th>
            <th scope="col" className={th}>Client</th>
            <th scope="col" className={th}>Period</th>
            <th scope="col" className={th}>Job state</th>
            <th scope="col" className={th}>Why now</th>
            <th scope="col" className={th}>Internal due</th>
            <th scope="col" className={th}>Statutory due</th>
            <th scope="col" className={th}>Your part</th>
            <th scope="col" className={`${th} text-right`}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-t border-border hover:bg-muted/40 h-11">
              <td className={`${td} font-semibold`}>
                {r.title}
                <span className="ml-2 text-[11.5px] text-ink-mute font-normal">{r.service}</span>
              </td>
              <td className={td}>
                <span className="font-semibold">{r.clientCode}</span>
                {r.clientName && <span className="block text-[11.5px] text-ink-mute">{r.clientName}</span>}
              </td>
              <td className={`${td} tabular-nums whitespace-nowrap`}>
                {r.period} · FY {r.fy}
              </td>
              <td className={td}>
                <StateChip state={r.state} />
              </td>
              <td className={`${td} ${reasonTone(r)}`}>{r.reason}</td>
              <td className={`${td} tabular-nums whitespace-nowrap`}>{r.internalDue}</td>
              <td className={`${td} tabular-nums whitespace-nowrap`}>{r.statutoryDue}</td>
              <td className={`${td} whitespace-nowrap`}>{r.part}</td>
              <td className={`${td} text-right`}>
                <JobLink item={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The figures of one weekly summary, for the person's own card and the manager's table. */
export function summaryFigures(s: SummaryView): { label: string; value: string }[] {
  return [
    { label: "Jobs done", value: String(s.done) },
    { label: "Median, assigned to done", value: formatDuration(s.medianMs) },
    { label: "Longest stage", value: s.bottleneck ? s.bottleneck.label : "–" },
    { label: "Open", value: String(s.open) },
    { label: "Past internal due", value: String(s.overdue) },
  ];
}
