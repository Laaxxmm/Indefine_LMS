// NextTaskView: the JSON shape of "the one thing this person should do now". Served by
// GET /api/firm-os/workspace/next-task, rendered by /focus and the guided workspace, and the shape
// the companion side-panel extension switches to. Self-contained on purpose (zod only, no app
// imports) so the extension can copy this file as it is. Version bumps only on a breaking change;
// new optional fields do not bump it.
//
// Nothing here files, submits or sends: every `href` opens a Firm OS page where a person acts.
// Portal filing is done by a person in their own browser; there are no portal links.
import { z } from "zod";

export const NEXT_TASK_CONTRACT_VERSION = 1 as const;

export const JOB_STATES = ["DRAFT", "ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING", "DONE"] as const;

/** The one primary action, by kind; `label` is the button text. */
export const NEXT_ACTION_KINDS = ["run-agent", "prepare-by-hand", "submit", "review", "mark-filed", "turia-close"] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

const SopStepZ = z.object({
  number: z.number().int().min(1),
  title: z.string(),
  detail: z.string(),
  /** Exactly one step is "current" while the job is open; none once DONE or before assignment. */
  status: z.enum(["done", "current", "todo"]),
});

const OpenQuestionZ = z.object({
  ruleId: z.string(),
  kind: z.enum(["insufficient-evidence", "model-disagreement", "out-of-scope"]),
  question: z.string(),
  location: z.string().nullable(),
  /** True when the answer is a document to ask the client for. */
  clientRequest: z.boolean(),
});

export const NextTaskZ = z.object({
  job: z.object({
    id: z.string(),
    title: z.string(),
    service: z.string(),
    period: z.string(),
    fy: z.string(),
    clientCode: z.string(),
    clientName: z.string(),
    /** "DD MMM YYYY" (IST calendar day), or null when not set. */
    internalDue: z.string().nullable(),
    statutoryDue: z.string().nullable(),
    overdue: z.boolean(),
    part: z.enum(["Preparer", "Reviewer", "Preparer and reviewer"]),
  }),
  state: z.enum(JOB_STATES),
  action: z.object({
    kind: z.enum(NEXT_ACTION_KINDS),
    label: z.string(),
    /** The existing Firm OS screen where the action is taken (relative URL). */
    href: z.string().startsWith("/"),
    agent: z.string().nullable(),
    runId: z.string().nullable(),
  }),
  /** One or two plain sentences: what this is and why it is next. */
  why: z.string(),
  /** The guided workspace for this job (relative URL). */
  href: z.string().startsWith("/"),
  sopSteps: z.array(SopStepZ),
  /** What must be true before moving on from the current step. */
  checklist: z.array(z.string()),
  openQuestions: z.array(OpenQuestionZ),
  /** Shown when the job is filed on a government portal by a person; null otherwise. */
  portalNote: z.string().nullable(),
});

export const NextTaskViewZ = z.object({
  version: z.literal(NEXT_TASK_CONTRACT_VERSION),
  /** "clear" = nothing is waiting for this person; task is then null. */
  status: z.enum(["task", "clear"]),
  /** ISO 8601 (UTC) time the view was built. */
  generatedAt: z.string(),
  /** Other jobs waiting for this person after this one. */
  remaining: z.number().int().min(0),
  task: NextTaskZ.nullable(),
});

export type SopStep = z.infer<typeof SopStepZ>;
export type NextTask = z.infer<typeof NextTaskZ>;
export type NextTaskView = z.infer<typeof NextTaskViewZ>;
export type NextTaskAction = NextTask["action"];
