// Weekly cycle-time summary per person (Phase 9 task 4). Pure: built on the close loop's cycle-time
// functions (src/lib/close-loop/cycle-time.ts) over the person's jobs that reached DONE this IST
// week, plus their open and past-due counts. Private to the person and their manager (access.ts).
import { formatDate } from "@/lib/agents/core/format";
import { STAGE_LABELS, bottleneck, cycleTimes, formatDuration, formatShare, median, type CycleEvent, type Stage } from "@/lib/close-loop/cycle-time";
import { istDayKey } from "@/lib/ist";

export type SummaryJob = { id: string; events: readonly CycleEvent[] };

export type WeeklySummary = {
  /** Monday of the IST week, "YYYY-MM-DD". */
  weekOf: string;
  done: number;
  /** Median assignment → DONE of the jobs done this week. */
  medianMs: number | null;
  bottleneck: { stage: Stage; label: string; share: number } | null;
  open: number;
  overdue: number;
  message: string;
};

export function weeklySummary(input: { weekStart: Date; done: readonly SummaryJob[]; open: number; overdue: number }): WeeklySummary {
  const times = input.done.map((j) => cycleTimes(j.events)).filter((t) => t.done);
  const totals = times.map((t) => t.assignedToDone).filter((v): v is number => v !== null);
  const medianMs = median(totals);
  const b = bottleneck(times);
  const weekOf = istDayKey(input.weekStart);
  const parts = [
    times.length === 0
      ? `Week of ${formatDate(weekOf)}: no jobs reached DONE.`
      : `Week of ${formatDate(weekOf)}: ${times.length} job${times.length === 1 ? "" : "s"} done; median from assignment to done ${formatDuration(medianMs)}.`,
    b && times.length > 0 ? `Longest stage: ${STAGE_LABELS[b.stage]} (${formatShare(b.share)} of a typical job).` : null,
    `Open: ${input.open}, past internal due: ${input.overdue}.`,
  ];
  return {
    weekOf,
    done: times.length,
    medianMs,
    bottleneck: b ? { stage: b.stage, label: STAGE_LABELS[b.stage], share: b.share } : null,
    open: input.open,
    overdue: input.overdue,
    message: parts.filter(Boolean).join(" "),
  };
}
