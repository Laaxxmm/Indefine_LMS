// Status chips. JobTask states are shown by their exact state-machine names (DRAFT … DONE), as
// DESIGN asks; every other status uses Chip with a tone from ui.ts chipTone (-50 fill, -800 text).
import type { JobTaskState } from "@prisma/client";
import { chip, chipTone, cx, type ChipTone } from "@/components/ui";

export function Chip({ tone = "neutral", title, className = "", children }: { tone?: ChipTone; title?: string; className?: string; children: React.ReactNode }) {
  return (
    <span className={cx(chip, chipTone[tone], className)} title={title}>
      {children}
    </span>
  );
}

/** Tone per JobTask state: preparation sky, the agent's pack brand, review amber, approved to closing green, DONE ink. */
export const STATE_TONE: Record<JobTaskState, ChipTone> = {
  DRAFT: "neutral",
  ASSIGNED: "info",
  IN_PREP: "info",
  AGENT_DONE: "brand",
  IN_REVIEW: "warning",
  APPROVED: "success",
  FILED_BY_HUMAN: "success",
  CLOSING: "success",
  DONE: "done",
};

/** JobTask state, shown by its exact state-machine name (IN_PREP, AGENT_DONE, …). */
export function StateChip({ state }: { state: JobTaskState }) {
  return (
    <Chip tone={STATE_TONE[state]} title={`Job state: ${state}`}>
      {state}
    </Chip>
  );
}

const RUN_TONE: Record<string, ChipTone> = { RUNNING: "info", AGENT_DONE: "brand", FAILED: "danger", CHANGES_REQUESTED: "warning", APPROVED: "success" };
const RUN_LABEL: Record<string, string> = { RUNNING: "Running", AGENT_DONE: "Pack ready", FAILED: "Failed", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved" };

/** An agent run's status ("Run: Pack ready"). */
export function RunStatusChip({ status }: { status: string }) {
  return <Chip tone={RUN_TONE[status] ?? "neutral"}>Run: {RUN_LABEL[status] ?? status}</Chip>;
}

/** Muted gold, used sparingly (DESIGN: "needs partner"). */
export function PartnerChip() {
  return <Chip tone="partner">Needs partner</Chip>;
}
