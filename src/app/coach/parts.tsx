// Shared bits for /coach and the dashboard card: the board table and the weekly-summary figures.
// Built from the shared Firm OS pieces (DataTable, StateChip, the ui.ts row and cell strings) so the coach reads
// like the rest of Firm OS; no score is shown, only the reason for each position (no gamification).
import Link from "next/link";
import { btnGhost, td, tr } from "@/components/ui";
import { DataTable, StateChip } from "@/components/firm-os";
import type { BoardItem } from "@/lib/agents/coach/board";
import { formatDuration } from "@/lib/close-loop/cycle-time";
import type { SummaryView } from "@/lib/agents/coach/views";

const reasonTone = (r: BoardItem) => (r.overdue ? "text-rose-700 font-semibold" : "text-ink-soft");

/** "Open in Waiting for you" / "Review pack" …, the /agents "Waiting for you" action style. */
export function JobLink({ item }: { item: Pick<BoardItem, "link" | "title" | "clientCode"> }) {
  return (
    <Link href={item.link.href} className={`${btnGhost} whitespace-nowrap`} aria-label={`${item.link.label}: ${item.title} for ${item.clientCode}`}>
      {item.link.label}
    </Link>
  );
}

export function BoardTable({ items, caption }: { items: BoardItem[]; caption: string }) {
  return (
    <DataTable
      caption={caption}
      columns={[{ label: "Job" }, { label: "Client" }, { label: "Period" }, { label: "Job state" }, { label: "Why now" }, { label: "Internal due" }, { label: "Statutory due" }, { label: "Your part" }, { label: "Action", align: "right", srOnly: true }]}
    >
      {items.map((r) => (
        <tr key={r.id} className={tr}>
          <td className={`${td} font-semibold`}>
            {r.title}
            <span className="ml-2 text-[12px] text-ink-mute font-normal">{r.service}</span>
          </td>
          <td className={td}>
            <span className="font-semibold">{r.clientCode}</span>
            {r.clientName && <span className="block text-[12px] text-ink-mute">{r.clientName}</span>}
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
    </DataTable>
  );
}

/** The figures of one weekly summary, for the person's own card and the manager's table. */
export function summaryFigures(s: SummaryView): { label: string; value: string }[] {
  return [
    { label: "Jobs done", value: String(s.done) },
    // "—" for none, as the board writes a missing date.
    { label: "Median, assigned to done", value: s.medianMs === null ? "—" : formatDuration(s.medianMs) },
    { label: "Longest stage", value: s.bottleneck ? s.bottleneck.label : "—" },
    { label: "Open", value: String(s.open) },
    { label: "Past internal due", value: String(s.overdue) },
  ];
}
