// SOP steps and the "before you move on" checklist for a job, from its state, its service and the
// agent that prepares it (title, required inputs, active SOP pack version). Pure; the wording is
// the firm's pipeline (ADR-005): prepare → submit → review → a person files → Turia close → DONE.
// No portal links anywhere: the person files in their own browser.
import type { FirmService, JobTaskState } from "@prisma/client";
import type { SopStep } from "./contract";

export type StepKey = "prepare" | "submit" | "review" | "file" | "close" | "done";
const ORDER: readonly StepKey[] = ["prepare", "submit", "review", "file", "close", "done"];

/** The step a job in this state is on; null before assignment (DRAFT). */
export const STEP_OF_STATE: Readonly<Record<JobTaskState, StepKey | null>> = {
  DRAFT: null,
  ASSIGNED: "prepare",
  IN_PREP: "prepare",
  AGENT_DONE: "submit",
  IN_REVIEW: "review",
  APPROVED: "file",
  FILED_BY_HUMAN: "close",
  CLOSING: "close",
  DONE: "done",
};

export type SopContext = {
  service: FirmService;
  /** The agent that prepares this service, or null when none exists yet. */
  agentTitle: string | null;
  /** Input files the agent needs in ClientDocs. */
  requiredInputs: readonly string[];
  /** Active SOP pack version and rule count, when known. */
  packVersion: string | null;
  ruleCount: number | null;
  /** Latest run's failures and open questions. */
  blockFails: number;
  warnFails: number;
  openQuestions: number;
  /** "GST ARN", "MCA SRN", …, and whether filing needs it. */
  ack: { required: boolean; label: string };
  reviewNotes?: string | null;
};

const PORTAL_FILED: Readonly<Record<FirmService, string | null>> = {
  GST: "the GST portal",
  ROC: "the MCA portal",
  IncomeTax: "the income-tax portal",
  TDS: "the TDS portal",
  Books: null,
  Audit: null,
  Engagement: null,
};

const HAND_OVER: Readonly<Record<FirmService, string>> = {
  GST: "",
  ROC: "",
  IncomeTax: "",
  TDS: "",
  Books: "Hand over the approved month-end pack as your SOP says",
  Audit: "Give the approved draft to the engagement partner",
  Engagement: "Complete the engagement step as your SOP says",
};

/** The plain note shown beside portal-filed jobs (no portal links, no embedding). */
export const PORTAL_NOTE = "Do the filing on the portal in your browser. Keep this page open beside it; the companion side panel can show these steps next to the portal.";

export function portalNoteFor(service: FirmService): string | null {
  return PORTAL_FILED[service] ? PORTAL_NOTE : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const inputsText = (inputs: readonly string[]) => inputs.join(", ");

function stepText(key: StepKey, c: SopContext): { title: string; detail: string } {
  switch (key) {
    case "prepare": {
      if (!c.agentTitle) return { title: "Prepare the work by hand", detail: `There is no agent for ${c.service} yet. Prepare the work in the job's Working folder, then ask your manager to send it for review.` };
      const pack = c.packVersion ? ` against SOP pack v${c.packVersion}${c.ruleCount ? ` (${plural(c.ruleCount, "check")})` : ""}` : "";
      const inputs = c.requiredInputs.length ? ` (${inputsText(c.requiredInputs)})` : "";
      return {
        title: `Run ${c.agentTitle}`,
        detail: `Check the documents are in the job's ClientDocs folder${inputs}, then run the agent. It writes a draft pack to Working${pack} and never files anything.`,
      };
    }
    case "submit":
      return { title: "Check the findings and submit for review", detail: "Read every block finding and warning. Submit the pack, or re-run the agent with a note if something is wrong." };
    case "review":
      return { title: "Review and approve", detail: "The reviewer checks the pack and approves it or requests changes. Only a partner can approve over a block finding, with a note." };
    case "file": {
      const portal = PORTAL_FILED[c.service];
      const ack = c.ack.required ? ` with the ${c.ack.label}` : "";
      return portal
        ? { title: "File it yourself, then mark filed", detail: `File it on ${portal} yourself (DSC, OTP and payment stay with you), then mark the job filed${ack}.` }
        : { title: "Hand over, then mark filed", detail: `${HAND_OVER[c.service]}, then mark the job filed. No acknowledgement number is needed.` };
    }
    case "close":
      return { title: "Record the Turia close", detail: "Close the Turia task with the minutes spent, then record its reference and minutes here." };
    case "done":
      return { title: "Job closes", detail: "Firm OS checks the Final file in SharePoint and the Turia close, then marks the job DONE." };
  }
}

/** Numbered steps with the current one marked. */
export function sopSteps(state: JobTaskState, c: SopContext): SopStep[] {
  const current = STEP_OF_STATE[state];
  const at = current ? ORDER.indexOf(current) : -1;
  return ORDER.map((key, i) => ({
    number: i + 1,
    ...stepText(key, c),
    status: state === "DONE" ? "done" : i < at ? "done" : i === at ? "current" : "todo",
  }));
}

/** What must be true before moving on from the current step. */
export function stepChecklist(state: JobTaskState, c: SopContext): string[] {
  const step = STEP_OF_STATE[state];
  switch (step) {
    case null:
      return ["A manager assigns the job before work starts."];
    case "prepare": {
      const out = c.agentTitle
        ? [c.requiredInputs.length ? `The documents the agent needs are in ClientDocs: ${inputsText(c.requiredInputs)}.` : "The client's documents for this period are in ClientDocs."]
        : ["The work is prepared in the job's Working folder."];
      if (c.reviewNotes?.trim()) out.push(`The notes from the last review are dealt with: ${c.reviewNotes.trim()}`);
      out.push("The period and client on the job match the documents.");
      return out;
    }
    case "submit": {
      const out = [`Every block finding is read and explained (${plural(c.blockFails, "block finding")} on this run).`, `Every warning is read (${plural(c.warnFails, "warning")}).`];
      if (c.openQuestions > 0) out.push(`Open questions are answered or listed for the client (${plural(c.openQuestions, "question")}).`);
      out.push("If anything is wrong, re-run the agent with a note instead of submitting.");
      return out;
    }
    case "review":
      return [
        "You did not prepare this job. A preparer cannot approve their own work, except a partner.",
        c.blockFails > 0 ? `${plural(c.blockFails, "block finding")} remain: only a partner can approve over them, with a note.` : "No block findings remain on the latest run.",
        "The figures agree with the working papers and the client's documents.",
      ];
    case "file": {
      const out = ["The approved files are in the Final folder in SharePoint."];
      out.push(PORTAL_FILED[c.service] ? "You file it on the portal yourself. Firm OS never files, signs or pays." : "The work is handed over as your SOP says.");
      if (c.ack.required) out.push(`You have the ${c.ack.label} to type in.`);
      return out;
    }
    case "close":
      return ["The Turia task is closed with the minutes you spent.", "You have the Turia task reference.", "The Final file stays in SharePoint, where it was copied."];
    case "done":
      return ["Nothing more to do on this job."];
  }
}
