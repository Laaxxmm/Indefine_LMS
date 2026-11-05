// Response contract of GET /api/firm-os/companion/next-task — what the side panel renders.
// Kept flat and display-ready (dates already DD MMM YYYY, amounts already ₹ with Indian grouping)
// so the extension does no formatting and needs no knowledge of Firm OS internals.
//
// Mapping to the shared NextTaskView (src/lib/workspace/contract.ts, being built in parallel):
// see RankedJob in provider.ts — the only thing the shared getNextTask has to supply. Everything
// below that is companion-specific (steps, checklist, copy values, link) is built from the chosen
// job by provider.ts and does not change when the selection switches to getNextTask.
import type { FirmService, JobTaskState } from "@prisma/client";

export type JobPart = "Preparer" | "Reviewer" | "Preparer and reviewer";

/**
 * Where a step happens. "portal" and "offline" steps are always done by the person — on a
 * government portal, or outside Firm OS (a hand-over, a sign-off) — never by Firm OS.
 */
export type StepWhere = "files" | "firm-os" | "portal" | "offline" | "turia";

export type CompanionStep = {
  n: number;
  text: string;
  where: StepWhere;
  /** Already behind this job, judged from its state in Firm OS. */
  done: boolean;
  /** The step the person is on now (exactly one per task). */
  current: boolean;
};

export type CompanionValue = {
  key: string;
  label: string;
  /** What the copy button puts on the clipboard (plain: no ₹, no grouping). Null when not copyable. */
  copy: string | null;
  /** What the panel shows. */
  display: string;
  /** Short plain note, e.g. "Last 4 only — for checking the right client is open." */
  note?: string;
};

export type CompanionTask = {
  jobId: string;
  job: {
    title: string;
    service: FirmService;
    serviceLabel: string;
    period: string;
    fy: string;
    state: JobTaskState;
    clientName: string;
    clientCode: string;
  };
  part: JobPart;
  /** One or two plain sentences: why this job is first. */
  why: string;
  /** What the person does next, in one sentence. */
  nextAction: string;
  due: { internal: string | null; statutory: string | null; overdue: boolean };
  steps: CompanionStep[];
  currentStep: number;
  /** Short checklist for the current step (at most 5 items). */
  checklist: string[];
  values: CompanionValue[];
  /** Path on the Firm OS origin (never an absolute URL); the panel joins it to its own LMS origin. */
  link: { path: string; label: string };
};

export type CompanionQueueItem = {
  jobId: string;
  title: string;
  clientName: string;
  period: string;
  due: string | null;
  overdue: boolean;
};

export type CompanionNextTaskResponse =
  | { status: "task"; generatedAt: string; task: CompanionTask; later: CompanionQueueItem[]; counts: { open: number; overdue: number } }
  | { status: "none"; generatedAt: string; message: string; counts: { open: 0; overdue: 0 } };

/** Error body for every non-200 answer: one plain sentence. */
export type CompanionErrorBody = { error: string };
