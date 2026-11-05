// Plain-language labels for search context lines. Server-side. Dates are DD MMM YYYY on the IST
// calendar day (src/lib/agents/core/format.ts); states are words, not state-machine names.
import type { FirmService, JobTaskState } from "@prisma/client";
import { formatDate } from "@/lib/agents/core/format";

export const day = (d: Date | null | undefined): string => (d ? formatDate(d) : "");

/** " · "-joined, empties skipped. */
export const line = (...parts: Array<string | null | undefined | false>): string => parts.filter((p): p is string => !!p && p.trim() !== "").join(" · ");

/** "GSTR-3B — Acme Traders", or the title alone. */
export const titled = (title: string, of: string | null | undefined): string => (of && of.trim() ? `${title} — ${of}` : title);

export const JOB_STATE_LABELS: Record<JobTaskState, string> = {
  DRAFT: "Draft",
  ASSIGNED: "Assigned",
  IN_PREP: "In preparation",
  AGENT_DONE: "Agent done, waiting to be submitted",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  FILED_BY_HUMAN: "Filed",
  CLOSING: "Closing",
  DONE: "Done",
};

export const SERVICE_LABELS: Record<FirmService, string> = {
  GST: "GST",
  ROC: "ROC",
  IncomeTax: "Income tax",
  TDS: "TDS",
  Books: "Books",
  Audit: "Audit",
  Engagement: "Engagement",
};

/** FirmService values whose name or label contains the word (e.g. "income" → IncomeTax). */
export function servicesMatching(term: string): FirmService[] {
  const t = term.toLowerCase();
  return (Object.keys(SERVICE_LABELS) as FirmService[]).filter((s) => s.toLowerCase().includes(t) || SERVICE_LABELS[s].toLowerCase().includes(t));
}

/** AgentRun.status → words (the /agents run chip labels). */
export const RUN_STATUS_LABELS: Record<string, string> = {
  RUNNING: "Running",
  AGENT_DONE: "Pack ready",
  FAILED: "Failed",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
};

export const ONBOARDING_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Being described",
  CONFIRMED: "Plan confirmed",
  RUNNING: "Creating",
  FAILED: "Stopped before finishing",
  DONE: "Onboarded",
};

export const DRAFT_KIND_LABELS: Record<string, string> = {
  status: "Status update",
  "doc-chase": "Document request",
  "due-reminder": "Due-date reminder",
  "filing-completed": "Filing completed",
  "query-response": "Reply to a query",
};

export const LANGUAGE_LABELS: Record<string, string> = { en: "English", kn: "Kannada", ta: "Tamil", hi: "Hindi" };

/** Last three folders of a SharePoint path ("…/GST/2026-10/Final"), for a context line. */
export function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const folders = parts.length > 1 ? parts.slice(0, -1) : parts;
  return folders.length > 3 ? `…/${folders.slice(-3).join("/")}` : folders.join("/");
}
