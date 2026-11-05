// DPDP Act 2023 data-principal rights: request kinds, response timelines, statutory retention
// duties and breach-notification clocks — all as data, each with the note a partner or lawyer
// must check. Nothing here is settled law: the firm's own targets are marked as policy, and every
// statutory figure carries a "verify" note. Pure module: no I/O. Dates go through src/lib/ist.ts.
import { IST_OFFSET_MS, istDayKey, istDayStart, addDays } from "@/lib/ist";

// ------------------------------------------------------------------ request kinds and states

export const REQUEST_KINDS = ["access", "correction", "erasure", "grievance", "nomination", "consent-withdrawal"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const isRequestKind = (k: unknown): k is RequestKind => typeof k === "string" && (REQUEST_KINDS as readonly string[]).includes(k);

export const KIND_LABELS: Record<RequestKind, string> = {
  access: "Access to personal data",
  correction: "Correction",
  erasure: "Erasure",
  grievance: "Grievance",
  nomination: "Nomination",
  "consent-withdrawal": "Consent withdrawal",
};

/** DPDP Act 2023 section behind each right (sections of the Act; the Rules add the procedure). */
export const KIND_SECTIONS: Record<RequestKind, string> = {
  access: "s.11",
  correction: "s.12",
  erasure: "s.12",
  grievance: "s.13",
  nomination: "s.14",
  "consent-withdrawal": "s.6(4)",
};

export const PRINCIPAL_TYPES = ["client-person", "client-contact", "staff"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];
export const PRINCIPAL_LABELS: Record<PrincipalType, string> = {
  "client-person": "Client (individual, proprietor or HUF karta)",
  "client-contact": "Contact person of a client",
  staff: "Staff member",
};

export const REQUEST_STATUSES = ["RECEIVED", "VERIFYING", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "REJECTED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const STATUS_LABELS: Record<RequestStatus, string> = {
  RECEIVED: "Received",
  VERIFYING: "Verifying identity",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On legal hold",
  COMPLETED: "Completed",
  REJECTED: "Refused",
};
export const OPEN_STATUSES: readonly RequestStatus[] = ["RECEIVED", "VERIFYING", "IN_PROGRESS"];

// ------------------------------------------------------------------ response timelines

export interface Timeline {
  /** Calendar days from receipt to the firm's target reply date. */
  days: number;
  basis: string;
  verify: string;
}

const RULES_VERIFY =
  "Partner/legal to verify against the DPDP Rules 2025 as notified: the Rules ask each Data Fiduciary to publish its response period for rights and grievances, with an outer limit we understand to be 90 days, and they phase in the rights provisions after notification.";

/** Firm targets (policy), kept well inside the outer limit the Rules set. */
export const RESPONSE_TIMELINES: Record<RequestKind, Timeline> = {
  access: { days: 30, basis: "Firm policy: reply within 30 days of receipt.", verify: RULES_VERIFY },
  correction: { days: 30, basis: "Firm policy: correct or explain within 30 days of receipt.", verify: RULES_VERIFY },
  erasure: { days: 30, basis: "Firm policy: erase, or explain the legal hold, within 30 days of receipt.", verify: RULES_VERIFY },
  grievance: { days: 30, basis: "Firm policy: respond within 30 days of receipt.", verify: RULES_VERIFY },
  nomination: { days: 30, basis: "Firm policy: record the nominee within 30 days of receipt.", verify: RULES_VERIFY },
  "consent-withdrawal": {
    days: 7,
    basis: "Firm policy: stop the processing within 7 days of receipt (the Act asks for it within a reasonable time).",
    verify: `${RULES_VERIFY} Also confirm what a "reasonable time" to stop processing is for the firm.`,
  },
};

/** Outer limit we understand the Rules to set; shown next to the firm target. Legal to verify. */
export const OUTER_LIMIT_DAYS = 90;

/** End (23:59:59.999 IST) of the IST day `days` calendar days after receipt. */
export function dueDateFor(kind: RequestKind, receivedAt: Date): Date {
  return new Date(addDays(istDayStart(receivedAt), RESPONSE_TIMELINES[kind].days + 1).getTime() - 1);
}

export function outerLimitFor(receivedAt: Date): Date {
  return new Date(addDays(istDayStart(receivedAt), OUTER_LIMIT_DAYS + 1).getTime() - 1);
}

export const isOverdue = (dueAt: Date, status: string, now: Date) => (OPEN_STATUSES as readonly string[]).includes(status) && now.getTime() > dueAt.getTime();

// ------------------------------------------------------------------ retention duties

export type DutyId = "active-engagement" | "income-tax" | "gst" | "companies-act" | "icai" | "staff-records";

export interface RetentionDuty {
  id: DutyId;
  label: string;
  /** What must be kept and for how long, in words. */
  rule: string;
  /** Months after the anchor (end of the client's latest financial year with work, or the date staff left). Null: no fixed end. */
  months: number | null;
  verify: string;
}

export const RETENTION_DUTIES: Record<DutyId, RetentionDuty> = {
  "active-engagement": {
    id: "active-engagement",
    label: "Active engagement",
    rule: "The client still has open work with the firm, so the data is needed to perform the service the client engaged us for (DPDP Act s.8(7) and s.12(3)). Held until the engagement ends.",
    months: null,
    verify: "Partner to confirm the engagement is still running and decide whether to end it.",
  },
  "income-tax": {
    id: "income-tax",
    label: "Income-tax Act record keeping",
    rule: "Books of account and documents behind income-tax, TDS, audit and books work: kept for six years from the end of the relevant assessment year (Income-tax Act 1961 s.44AA with rule 6F; the Income-tax Act 2025 equivalent from tax year 2026-27). Counted here as 84 months from the end of the financial year.",
    months: 84,
    verify:
      "Partner/legal to verify: the six-year period and its start, whether the firm's copy as preparer falls under it, longer holds while an assessment, appeal or reopening is pending (reopening can reach back up to ten years), and the matching section of the Income-tax Act 2025.",
  },
  gst: {
    id: "gst",
    label: "GST record keeping",
    rule: "Accounts and records behind GST work: kept for 72 months from the due date of the annual return for the year (CGST Act 2017 s.36). Counted here as 81 months from the end of the financial year (annual return due 31 December).",
    months: 81,
    verify:
      "Partner/legal to verify: the 72-month period and the annual-return due date used, whether the firm's copy as preparer falls under s.36, and the longer hold while an appeal, revision or investigation is pending.",
  },
  "companies-act": {
    id: "companies-act",
    label: "Companies Act / LLP Act books",
    rule: "Books of account of a company or LLP: kept for eight financial years (Companies Act 2013 s.128(5); LLP Rules 2009 rule 24). Counted here as 96 months from the end of the financial year.",
    months: 96,
    verify: "Partner/legal to verify: the eight-year period, whether it binds the firm's copy or only the company's own books, and any longer period ordered for an investigation.",
  },
  icai: {
    id: "icai",
    label: "ICAI working papers",
    rule: "Engagement documentation, working papers, KYC and certificates the firm issues: kept for at least seven years from the date of the report (ICAI SQC 1 and SA 230). Counted here as 96 months from the end of the financial year, assuming the report is signed within a year.",
    months: 96,
    verify: "Partner to verify the period the firm's quality-control policy sets under SQC 1 / SA 230 and whether it covers non-audit engagements and certificates.",
  },
  "staff-records": {
    id: "staff-records",
    label: "Employment records",
    rule: "Attendance, performance and salary-related records of staff: kept for eight years after the person leaves (firm policy, covering Income-tax TDS on salary and labour-law registers). LMS user data is never deleted, only marked inactive.",
    months: 96,
    verify: "Partner/legal to verify the period each labour law and the Income-tax Act require for staff records, and the firm's HR policy.",
  },
};

/** Firm services each statutory duty follows (Firm OS JobTask.service; legacy Jobs count as engagements for ICAI). */
export const DUTY_SERVICES: Partial<Record<DutyId, readonly string[]>> = {
  "income-tax": ["IncomeTax", "TDS", "Audit", "Books"],
  gst: ["GST"],
  "companies-act": ["ROC", "Audit", "Books"],
};

/** 00:00 IST on 1 April after the financial year "2026-27" ends (1 Apr 2027). */
export function fyEnd(fy: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]) + 1, 3, 1) - IST_OFFSET_MS);
}

/** `anchor` plus whole months, on the IST calendar (anchors are 00:00 IST on the 1st). */
export function addMonthsIst(anchor: Date, months: number): Date {
  const key = istDayKey(anchor);
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + months, d) - IST_OFFSET_MS);
}

// ------------------------------------------------------------------ consent withdrawal

export const RESTRICTIONS = [
  { key: "ai-processing", label: "No new AI processing", detail: "No agent run or ModelRouter call may use this person's data (agents check isAiProcessingRestricted() before a run)." },
  { key: "comms-drafts", label: "No new message drafts", detail: "No new client-comms drafts are prepared for this person." },
  { key: "marketing", label: "No growth or marketing use", detail: "Growth goals, referral notes and similar client-development data are not used." },
  { key: "coach-activity", label: "No break-nudge activity (staff)", detail: "For staff: break nudges are switched off, so no activity heartbeats are collected." },
] as const;
export type RestrictionKey = (typeof RESTRICTIONS)[number]["key"];

/**
 * What a withdrawal does NOT stop: work the person engaged the firm for and records the law makes
 * the firm keep rest on other grounds (DPDP Act s.7 legitimate uses, s.8(7) retention for
 * compliance with law). A partner decides whether the engagement itself continues.
 */
export const WITHDRAWAL_LIMITS =
  "Withdrawal does not undo processing already done, and it does not stop work the person engaged the firm for or records the law makes the firm keep. A partner decides whether the engagement itself continues.";

// ------------------------------------------------------------------ identity verification

export const VERIFY_METHODS = [
  "Reply from the email address on record",
  "Call back to the phone number on record",
  "Photo ID seen in person",
  "Signed letter matching the records",
  "Other (explain in the note)",
] as const;

// ------------------------------------------------------------------ breach notification

export const BREACH_SEVERITIES = ["low", "medium", "high"] as const;
export type BreachSeverity = (typeof BREACH_SEVERITIES)[number];
export const BREACH_STATUSES = ["OPEN", "CONTAINED", "NOTIFIED", "CLOSED"] as const;
export type BreachStatus = (typeof BREACH_STATUSES)[number];
export const BREACH_STATUS_LABELS: Record<BreachStatus, string> = { OPEN: "Open", CONTAINED: "Contained", NOTIFIED: "Notified", CLOSED: "Closed" };

export const BREACH_CLOCKS = {
  board: {
    hours: 72,
    label: "Report to the Data Protection Board",
    basis: "DPDP Rules 2025 (rule 7): tell the Board without delay on becoming aware, and send the detailed report within 72 hours.",
    verify: "Legal to verify: the 72-hour period, what starts it, whether the Board can extend it, and the form of the report. Do not treat this as settled law.",
  },
  principals: {
    hours: 72,
    label: "Tell each affected person",
    basis: "DPDP Rules 2025 (rule 7): tell each affected Data Principal without delay. Firm target: within 72 hours, the same clock as the Board.",
    verify: "Legal to verify what 'without delay' requires and what the notice must contain.",
  },
} as const;

/** Where the breach runbook lives (written and kept by the hardening work, not here). */
export const BREACH_RUNBOOK_PATH = "docs/runbooks/breach.md";
export const BREACH_RUNBOOK_URL = "https://github.com/Laaxxmm/Indefine_LMS/blob/main/docs/runbooks/breach.md";
