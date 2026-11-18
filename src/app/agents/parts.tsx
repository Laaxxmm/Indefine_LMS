// Bits for the /agents pages: the runs-list label and the runs table. The shared Firm OS pieces
// (chips, back link, empty state, focus ring, type and table class strings) live in
// src/components/firm-os and src/components/ui.ts; they are re-exported here so older imports keep
// working. New code imports them from there.
import Link from "next/link";
import type { RunRow } from "@/lib/agents/views";
import { DataTable, RunStatusChip, StateChip } from "@/components/firm-os";
import { linkText, td, tdNum, tr } from "@/components/ui";

export { focusRing, eyebrow, pageTitle, sectionTitle, tableWrap, thead, th, td, linkText, chip } from "@/components/ui";
export { BackLink, EmptyState, PartnerChip, RunStatusChip, StateChip } from "@/components/firm-os";

/**
 * Title of /agents, used verbatim by its nav link (src/lib/workspace/nav.ts AGENTS_LABEL) and by
 * every back link to it, so they always agree. Who sees which runs is said by the page's lead.
 */
export { AGENTS_LABEL } from "@/lib/workspace/nav";

export function RunsTable({ runs, showAgent = true }: { runs: RunRow[]; showAgent?: boolean }) {
  return (
    <DataTable
      caption="Agent runs, newest first"
      columns={[
        { label: "Job" },
        { label: "Client" },
        { label: "Period" },
        ...(showAgent ? [{ label: "Agent" }] : []),
        { label: "Job state" },
        { label: "Run" },
        { label: "Findings", align: "right" as const },
        { label: "Started (IST)" },
      ]}
    >
      {runs.map((r) => (
        <tr key={r.id} className={tr}>
          <td className={`${td} min-w-[12rem]`}>
            <Link href={`/agents/${r.agent}/runs/${r.id}`} className={linkText}>
              {r.jobTitle}
            </Link>
            <span className="ml-2 text-[12px] text-ink-mute">attempt {r.attempt}</span>
          </td>
          <td className={`${td} font-semibold`}>{r.clientCode}</td>
          <td className={`${td} tabular-nums whitespace-nowrap`}>
            {r.period} · FY {r.fy}
          </td>
          {showAgent && <td className={td}>{r.agentTitle}</td>}
          <td className={td}>
            <StateChip state={r.jobState} />
          </td>
          <td className={td}>
            <RunStatusChip status={r.status} />
          </td>
          <td className={tdNum}>
            <span className={r.blockFails ? "text-rose-700 font-bold" : "text-ink-mute"}>{r.blockFails} block</span>
            <span className="text-ink-mute" aria-hidden="true">
              {" "}
              ·{" "}
            </span>
            <span className={r.warnFails ? "text-amber-800 font-bold" : "text-ink-mute"}>{r.warnFails} warning</span>
          </td>
          <td className={`${td} text-ink-mute tabular-nums whitespace-nowrap`}>{r.startedAt}</td>
        </tr>
      ))}
    </DataTable>
  );
}
