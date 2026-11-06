// Request schemas for /api/firm-os/privacy/**. Plumbing (signedIn, parse, toJson) is shared with
// the corrections routes (src/lib/corrections/http.ts). Messages are sentences a person can act on.
import { z } from "zod";
import { BREACH_SEVERITIES, REQUEST_KINDS, VERIFY_METHODS } from "./policy";

const optText = (max: number, msg: string) => z.string().max(max, msg).nullable().optional();

export const createRequestZ = z.object({
  kind: z.enum(REQUEST_KINDS, { errorMap: () => ({ message: "Pick the kind of request." }) }),
  identifiers: z
    .object({
      pan: optText(20, "The PAN is too long. Check it and try again."),
      gstin: optText(20, "The GSTIN is too long. Check it and try again."),
      email: optText(200, "The email address is too long. Check it and try again."),
      phone: optText(20, "The phone number is too long. Check it and try again."),
    })
    .transform((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string")) as Record<string, string>),
  principalType: z.enum(["client-person", "client-contact", "staff"]).nullable().optional(),
  receivedOn: optText(10, "Pick the date the request arrived."),
  channel: optText(40, "Keep how the request arrived short, for example email or letter."),
  notes: optText(2000, "Keep the notes to 2,000 characters or fewer."),
});

export const verifyZ = z.object({
  method: z.enum(VERIFY_METHODS, { errorMap: () => ({ message: "Pick how the person's identity was checked." }) }),
  note: optText(500, "Keep the note to 500 characters or fewer."),
});

export const closeZ = z.object({
  outcome: z.enum(["completed", "rejected"], { errorMap: () => ({ message: "Choose whether the request is completed or refused." }) }),
  note: z.string().max(2000, "Keep the reply to 2,000 characters or fewer.").default(""),
});

export const nominationZ = z.object({
  nomineeName: z.string().max(120, "Keep the nominee's name to 120 characters or fewer.").default(""),
  relationship: z.string().max(60, "Keep the relationship short, for example spouse.").default(""),
  nomineeContact: z.string().max(120, "Keep the nominee's contact to 120 characters or fewer.").default(""),
});

export const liftRestrictionZ = z.object({
  reason: z.string().max(500, "Keep the reason to 500 characters or fewer.").default(""),
});

export const erasureConfirmZ = z.object({
  fingerprint: z.string().max(128, "Open the erasure plan again and review it before confirming.").default(""),
});

export const privacyCorrectionZ = z.object({
  entity: z.enum(["Client", "FirmClient"], { errorMap: () => ({ message: "Choose the client record to correct." }) }),
  id: z.string().trim().min(1, "Choose the client record to correct.").max(64),
  field: z.string().trim().min(1, "Choose the field to correct.").max(60),
  newValue: z.union([z.string().max(5000, "The new value is too long. Shorten it and try again."), z.number(), z.null()]),
  reason: z.string().max(500, "Keep the reason to 500 characters or fewer.").default(""),
});

const at = z.string().max(16, "Enter the date and time the notice was sent.");
const breachNote = z.string().max(1000, "Keep the note to 1,000 characters or fewer.");

export const recordBreachZ = z.object({
  detectedAt: z.string().max(16, "Enter when the firm became aware of the breach (date and time, IST).").default(""),
  summary: z.string().max(2000, "Keep the summary to 2,000 characters or fewer.").default(""),
  severity: z.enum(BREACH_SEVERITIES, { errorMap: () => ({ message: "Pick a severity: low, medium or high." }) }),
  affectedCount: z.number().int("Enter the number of people affected as a whole number.").min(0, "The number of people affected can't be negative.").nullable().optional(),
});

export const breachActionZ = z.discriminatedUnion("action", [
  z.object({ action: z.literal("contain"), note: breachNote.default("") }),
  z.object({ action: z.literal("board-notified"), at, note: breachNote.nullable().optional() }),
  z.object({ action: z.literal("principals-notified"), at, note: breachNote.nullable().optional() }),
  z.object({
    action: z.literal("update"),
    severity: z.enum(BREACH_SEVERITIES).nullable().optional(),
    affectedCount: z.number().int("Enter the number of people affected as a whole number.").min(0, "The number of people affected can't be negative.").nullable().optional(),
  }),
  z.object({ action: z.literal("close"), note: breachNote.default("") }),
]);
