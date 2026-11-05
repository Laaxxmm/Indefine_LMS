// Shared bits for the /agents pages: JobTask state chips, run status chips, the focus ring and
// the runs table. Colours follow src/components/ui.ts (emerald / amber / rose -50 fills with
// -800 text, AA on white) and the brand theme; nothing here introduces a second palette.
import Link from "next/link";
import type { JobTaskState } from "@prisma/client";
import type { RunRow } from "@/lib/agents/views";

/** Visible keyboard focus (the Firm OS models page's ring). */
export const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

// ink-mute, not the family's ink-faint: ink-faint on white is ~2:1, below the AA the spec requires.
export const eyebrow = "text-[10.5px] font-extrabold tracking-[0.14em] text-ink-mute uppercase";
export const pageTitle = "font-display font-extrabold text-3xl tracking-[-0.03em] mt-1";

/** Section title: ui.ts h2 with ink-mute instead of ink-faint (AA contrast on white). */
export const sectionTitle = "text-[10.5px] font-extrabold tracking-[0.12em] text-ink-mute uppercase mb-3";
export const tableWrap = "overflow-x-auto rounded-2xl bg-card border border-border shadow-lift";
export const thead = "text-[11px] uppercase tracking-wide text-ink-mute text-left";
export const th = "px-4 py-3 font-bold";
export const td = "px-4 py-3";
export const linkText = `font-semibold text-brand-600 hover:text-brand-700 hover:underline rounded ${focusRing}`;

export const chip = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold uppercase tracking-wide whitespace-nowrap";

const STATE_TONE: Record<JobTaskState, string> = {
  DRAFT: "border-border bg-muted text-ink-soft",
  ASSIGNED: "border-sky-200 bg-sky-50 text-sky-800",
  IN_PREP: "border-sky-200 bg-sky-50 text-sky-800",
  AGENT_DONE: "border-brand-200 bg-brand-50 text-brand-700",
  IN_REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  FILED_BY_HUMAN: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CLOSING: "border-emerald-200 bg-emerald-50 text-emerald-800",
  DONE: "border-ink-soft bg-ink text-white",
};

/** JobTask state, shown by its state-machine name. */
export function StateChip({ state }: { state: JobTaskState }) {
  return (
    <span className={`${chip} ${STATE_TONE[state]}`} title={`Job state: ${state}`}>
      {state.replace(/_/g, " ")}
    </span>
  );
}

const RUN_TONE: Record<string, string> = {
  RUNNING: "border-sky-200 bg-sky-50 text-sky-800",
  AGENT_DONE: "border-brand-200 bg-brand-50 text-brand-700",
  FAILED: "border-rose-200 bg-rose-50 text-rose-700",
  CHANGES_REQUESTED: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
};
const RUN_LABEL: Record<string, string> = {
  RUNNING: "Running",
  AGENT_DONE: "Pack ready",
  FAILED: "Failed",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
};

export function RunStatusChip({ status }: { status: string }) {
  return <span className={`${chip} ${RUN_TONE[status] ?? "border-border bg-muted text-ink-soft"}`}>Run: {RUN_LABEL[status] ?? status}</span>;
}

/** Muted gold, used sparingly (DESIGN: "needs partner"). */
export function PartnerChip() {
  return <span className={`${chip} border-amber-300 bg-amber-100 text-amber-900`}>Needs partner</span>;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="text-[13px] text-ink-mute mt-1">{children}</p>}
    </div>
  );
}

export function RunsTable({ runs, showAgent = true }: { runs: RunRow[]; showAgent?: boolean }) {
  return (
    <div className={tableWrap}>
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Agent runs, newest first</caption>
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>Job</th>
            <th scope="col" className={th}>Client</th>
            <th scope="col" className={th}>Period</th>
            {showAgent && <th scope="col" className={th}>Agent</th>}
            <th scope="col" className={th}>Job state</th>
            <th scope="col" className={th}>Run</th>
            <th scope="col" className={`${th} text-right`}>Findings</th>
            <th scope="col" className={th}>Started (IST)</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-t border-border hover:bg-muted/40 h-11">
              <td className={td}>
                <Link href={`/agents/${r.agent}/runs/${r.id}`} className={linkText}>
                  {r.jobTitle}
                </Link>
                <span className="ml-2 text-[11.5px] text-ink-mute">attempt {r.attempt}</span>
              </td>
              <td className={`${td} font-semibold`}>{r.clientCode}</td>
              <td className={`${td} tabular-nums`}>
                {r.period} · FY {r.fy}
              </td>
              {showAgent && <td className={td}>{r.agentTitle}</td>}
              <td className={td}>
                <StateChip state={r.jobState} />
              </td>
              <td className={td}>
                <RunStatusChip status={r.status} />
              </td>
              <td className={`${td} text-right tabular-nums whitespace-nowrap`}>
                <span className={r.blockFails ? "text-rose-700 font-bold" : "text-ink-mute"}>{r.blockFails} block</span>
                <span className="text-ink-mute" aria-hidden="true"> · </span>
                <span className={r.warnFails ? "text-amber-800 font-bold" : "text-ink-mute"}>{r.warnFails} warning</span>
              </td>
              <td className={`${td} text-ink-mute tabular-nums whitespace-nowrap`}>{r.startedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
