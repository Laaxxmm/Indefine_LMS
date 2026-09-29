// Engagement letter workflow — pure, shared by the API routes and the register buttons.
//   Save (DRAFT) → upload unsigned draft → email draft for approval → client approves
//   → upload Indefine-signed PDF → email signed letter → upload client's countersigned copy.
// Saving an edit restarts the flow at DRAFT (earlier files stay in SharePoint's history).
import type { EngagementLetterStatus as S } from "@prisma/client";

export type Step = "uploadDraft" | "sendDraft" | "approve" | "uploadSigned" | "sendSigned" | "uploadClient";

export const ALLOWED: Record<Step, S[]> = {
  uploadDraft: ["DRAFT", "DRAFT_UPLOADED", "SENT_FOR_APPROVAL"],
  sendDraft: ["DRAFT_UPLOADED", "SENT_FOR_APPROVAL"],
  approve: ["DRAFT_UPLOADED", "SENT_FOR_APPROVAL"],
  uploadSigned: ["APPROVED", "SIGNED", "SENT"],
  sendSigned: ["SIGNED", "SENT"],
  uploadClient: ["SIGNED", "SENT", "CLIENT_SIGNED"],
};

export const can = (step: Step, status: S) => ALLOWED[step].includes(status);

export const STATUS_LABEL: Record<S, string> = {
  DRAFT: "Draft",
  DRAFT_UPLOADED: "Draft PDF ready",
  SENT_FOR_APPROVAL: "Awaiting client approval",
  APPROVED: "Approved, to sign",
  SIGNED: "Signed, not sent",
  SENT: "Signed letter sent",
  CLIENT_SIGNED: "Client signed",
};

/** Why a step is not available yet, for the button tooltip / hint. */
export const WAITING: Record<Step, string> = {
  uploadDraft: "Save an edit to start a new draft",
  sendDraft: "Upload the draft PDF first",
  approve: "Upload and send the draft first",
  uploadSigned: "Sign only after the client approves the draft",
  sendSigned: "Upload the signed PDF first",
  uploadClient: "Send the signed letter first",
};
