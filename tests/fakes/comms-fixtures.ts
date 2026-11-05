// Synthetic comms inputs (no real client data): one per template kind, shared by the comms tests.
import type { JobFacts, TemplateInput } from "@/lib/agents/comms/templates";

export const JOB: JobFacts = {
  service: "GST",
  title: "GSTR-3B",
  period: "2026-10",
  fy: "2026-27",
  state: "IN_REVIEW",
  statutoryDueOn: new Date("2026-11-20T00:00:00+05:30"),
  filedAt: null,
  ackRef: null,
};

export const PEOPLE = { clientName: "Acme Traders Private Limited", contactName: "Ravi Kumar", senderName: "Priya Sharma", firmName: "Indefine" };

export const FILED_JOB: JobFacts = { ...JOB, state: "FILED_BY_HUMAN", filedAt: new Date("2026-11-18T15:00:00+05:30"), ackRef: "AA2911260123456" };

export const SAMPLES: Record<"status" | "doc-chase" | "due-reminder" | "filing-completed" | "query-response", TemplateInput> = {
  status: { ...PEOPLE, kind: "status", job: JOB },
  "doc-chase": {
    ...PEOPLE,
    kind: "doc-chase",
    job: JOB,
    replyBy: new Date("2026-11-12T10:00:00+05:30"),
    items: ["Purchase invoice INV-104 dated 03 Oct 2026 from Sharma Steels", "Bank statement for October 2026"],
  },
  "due-reminder": { ...PEOPLE, kind: "due-reminder", job: JOB, ask: "payment", amountInr: 123456, replyBy: new Date("2026-11-18T09:00:00+05:30") },
  "filing-completed": { ...PEOPLE, kind: "filing-completed", job: FILED_JOB, amountInr: 123456 },
  "query-response": {
    ...PEOPLE,
    kind: "query-response",
    topic: "GST on office rent",
    answer: "GST at 18% applies to the rent of ₹50,000.00 a month from October 2026.\n\nYour landlord should show it on the invoice.",
    job: null,
  },
};
