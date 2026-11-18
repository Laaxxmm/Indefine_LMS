// The SOP steps the side panel shows for a job, as data. Pure: no Prisma, no clock.
//
// Every Firm OS job follows the JobTask state machine (agents/core/state.ts), so the steps are
// the same seven for every service; only the filing step's wording and the acknowledgement differ.
// The step a person is on comes from what they can do on the job now (the Action below), which
// provider.ts derives from the job state with the same rules as "Waiting for you" on /agents.
//
// Wording is a default for partner review: when SopPack gains per-service steps, stepsFor() is the
// one place to read them from. Nothing here — or anywhere in the companion — files, signs, pays,
// enters an OTP or sends anything; the filing step tells the person to do it themselves.
import type { FirmService } from "@prisma/client";
import type { CompanionStep, StepWhere } from "./types";

/** What the person does on the job now. */
export type Action = "collect" | "prepare" | "check" | "review" | "file" | "close";

type ServiceSop = {
  label: string;
  /** Plain name of the government portal the person files on, or null when nothing is filed. */
  portal: string | null;
  /** Step 5 in the service's words. */
  fileStep: string;
  /** What "Mark filed" asks for (close-loop ackRefFor wording), or null when none is needed. */
  ack: string | null;
};

export const SERVICE_SOP: Readonly<Record<FirmService, ServiceSop>> = {
  GST: {
    label: "GST",
    portal: "GST portal",
    fileStep: "Sign in to the GST portal yourself, enter the figures from the approved pack and file with your DSC or EVC. Firm OS never files.",
    ack: "GST ARN",
  },
  ROC: {
    label: "ROC",
    portal: "MCA portal",
    fileStep: "Sign in to the MCA portal yourself, fill the form from the approved pack, attach the signed documents and file it. Firm OS never files.",
    ack: "MCA SRN",
  },
  IncomeTax: {
    label: "Income tax",
    portal: "Income-tax e-filing portal",
    fileStep: "Sign in to the Income-tax e-filing portal yourself, enter the figures from the approved pack, then file and e-verify. Firm OS never files.",
    ack: "ITR acknowledgement no.",
  },
  TDS: {
    label: "TDS",
    portal: "TDS filing portal",
    fileStep: "Prepare and file the TDS statement yourself from the approved pack, the way the SOP says. Firm OS never files.",
    ack: "TDS acknowledgement no.",
  },
  Books: {
    label: "Books",
    portal: null,
    fileStep: "Hand over the approved month-end pack the way the SOP says. Firm OS sends nothing to the client.",
    ack: null,
  },
  Audit: {
    label: "Audit",
    portal: null,
    fileStep: "Take the approved working papers to the engagement partner for sign-off. Firm OS gives no audit opinion.",
    ack: null,
  },
  Engagement: {
    label: "Engagement",
    portal: null,
    fileStep: "Send the approved engagement letter yourself from your own mailbox. Firm OS only drafts it.",
    ack: null,
  },
};

/** Step number the person is on for each action (1-based, matches stepsFor()). */
export const CURRENT_STEP: Readonly<Record<Action, number>> = { collect: 1, prepare: 2, check: 3, review: 4, file: 5, close: 7 };

export type StepContext = {
  service: FirmService;
  period: string;
  fy: string;
  /** Title of the agent for this service ("GST Prep"), or null when there is none. */
  agentTitle: string | null;
};

/** The seven steps for a job, with `done` and `current` set from the action. */
export function stepsFor(ctx: StepContext, action: Action): CompanionStep[] {
  const sop = SERVICE_SOP[ctx.service];
  const current = CURRENT_STEP[action];
  const defs: Array<[string, StepWhere]> = [
    [`Put the client's documents for ${ctx.period} in the ClientDocs folder.`, "files"],
    [ctx.agentTitle ? `Run the ${ctx.agentTitle} agent in Firm OS, or prepare the working yourself.` : `Prepare the working for ${ctx.period} yourself.`, "firm-os"],
    ["Check every finding in the pack, then submit it for review in Firm OS.", "firm-os"],
    ["The reviewer checks the pack and approves it, or requests changes with a note.", "firm-os"],
    [sop.fileStep, sop.portal ? "portal" : "offline"],
    [sop.ack ? `Mark it filed in Firm OS and enter the ${sop.ack}.` : "Record it as done in Firm OS with Mark filed. No acknowledgement number is needed.", "firm-os"],
    ["Log your minutes and complete the task in Turia, then record the Turia close in Firm OS.", "turia"],
  ];
  return defs.map(([text, where], i) => ({ n: i + 1, text, where, done: i + 1 < current, current: i + 1 === current }));
}

export type ChecklistContext = StepContext & {
  /** Last four characters of the client's GSTIN (GST jobs), for "the right client is open". */
  gstinLast4: string | null;
  blockFails: number;
  warnFails: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A short checklist (at most 5 items) for the step the person is on. */
export function checklistFor(ctx: ChecklistContext, action: Action): string[] {
  const sop = SERVICE_SOP[ctx.service];
  const blocks = ctx.blockFails > 0 ? `${plural(ctx.blockFails, "block finding", "block findings")} on the latest run cleared or explained` : null;
  let items: Array<string | null>;
  switch (action) {
    case "collect":
    case "prepare":
      items = [`Documents for ${ctx.period} are in the client's ClientDocs folder`, `The working covers ${ctx.period}, FY ${ctx.fy}`, blocks];
      break;
    case "check":
      items = [blocks ?? "Every finding in the pack read", ctx.warnFails > 0 ? `${plural(ctx.warnFails, "warning", "warnings")} read and noted` : null, "Figures tie to the client's registers", "Pack submitted for review in Firm OS"];
      break;
    case "review":
      items = ["Evidence opened for each finding", "Figures tie to the client's registers", "Approved, or changes requested with a note"];
      break;
    case "file":
      items = sop.portal
        ? [
            `Signed in to the ${sop.portal} for the right client${ctx.gstinLast4 ? ` (GSTIN ending ${ctx.gstinLast4})` : ""}`,
            `Period selected is ${ctx.period}`,
            "Each figure entered matches the approved pack",
            "You file and sign yourself; Firm OS never files",
            sop.ack ? `${sop.ack} noted for Firm OS` : null,
          ]
        : ["The approved version is the one handed over", "Nothing is sent to the client from Firm OS", "Recorded as done in Firm OS"];
      break;
    case "close":
      items = ["Minutes logged on the Turia task", "Turia task marked complete", "Turia task ref and minutes recorded in Firm OS"];
      break;
  }
  return items.filter((s): s is string => !!s).slice(0, 5);
}

/** One sentence: what the person does next. */
export function nextActionFor(ctx: StepContext, action: Action): string {
  const sop = SERVICE_SOP[ctx.service];
  switch (action) {
    case "collect":
      return "Collect the documents, then run the agent or prepare the working.";
    case "prepare":
      return ctx.agentTitle ? `Run the ${ctx.agentTitle} agent, or prepare the working yourself.` : "Prepare the working yourself, then submit it for review.";
    case "check":
      return "Check the findings in the pack and submit it for review.";
    case "review":
      return "Review the pack: approve it, or request changes with a note.";
    case "file":
      return sop.portal ? `File it on the ${sop.portal} yourself, then mark it filed in Firm OS.` : "Complete the hand-over yourself, then record it as done in Firm OS.";
    case "close":
      return "Close the task in Turia, then record the Turia close in Firm OS.";
  }
}
