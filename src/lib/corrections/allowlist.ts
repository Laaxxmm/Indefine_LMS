// The correction allow-list: exactly which fields of which records a person may correct after a
// wrong entry, who may do it, and how the new value is checked. Anything not listed here is refused
// with a plain sentence (NOT_CORRECTABLE explains the usual suspects). Pure module: no I/O.
//
// Validation is reused, not rewritten: LMS client master fields parse with the /clients schema
// (src/lib/clients/core.ts clientBodyZ) and then pass the onboarding validators (PAN holder status,
// GSTIN state code + checksum + embedded PAN, CIN / LLPIN shape); periods use the SharePoint folder
// contract (src/lib/integrations/sharepoint/paths.ts); engagement frequencies use the onboarding spec.
import type { z } from "zod";
import type { EntityType, FirmService, JobTaskState } from "@prisma/client";
import { ENTITY_TYPES, GROWTH_GOALS, clientBodyZ } from "@/lib/clients/core";
import { validateCin, validateClientCodeShape, validateGstin, validatePan } from "@/lib/agents/onboarding/validators";
import { FREQUENCIES, SERVICE_FREQUENCIES, SERVICE_LABELS } from "@/lib/agents/onboarding/spec";
import { formatDate } from "@/lib/agents/core/format";
import { isValidPeriod, periodInFy } from "@/lib/integrations/sharepoint/paths";
import { istDayKey, parseDayKey } from "@/lib/ist";
import { maskLast4, type PiiKind } from "./mask";

export const CORRECTION_ENTITIES = ["FirmClient", "Client", "JobTask", "Engagement", "CommsDraft"] as const;
export type CorrectionEntity = (typeof CORRECTION_ENTITIES)[number];

export const isCorrectionEntity = (e: unknown): e is CorrectionEntity =>
  typeof e === "string" && (CORRECTION_ENTITIES as readonly string[]).includes(e);

/** Prisma delegate behind each entity. */
export const ENTITY_MODEL = {
  FirmClient: "firmClient",
  Client: "client",
  JobTask: "jobTask",
  Engagement: "engagement",
  CommsDraft: "commsDraft",
} as const satisfies Record<CorrectionEntity, string>;

/** How the record is named in sentences ("this client", "this job"). */
export const ENTITY_NOUN: Record<CorrectionEntity, string> = {
  FirmClient: "client",
  Client: "client",
  JobTask: "job",
  Engagement: "engagement",
  CommsDraft: "draft",
};

/**
 * management   admins and partners (canManageClients, the /clients edit rule)
 * job-manager  a partner, or the line manager (User.managerId) of the record's current assignee
 * creator      the person who created the record
 */
export type Who = "management" | "job-manager" | "creator";
export type InputKind = "text" | "textarea" | "date" | "number" | "select" | "user";
export type Row = Record<string, unknown>;

/** A refusal from a rule: 400 = the value is wrong, 409 = the record's situation forbids it. */
export type Problem = { status: 400 | 409; error: string };
export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

export interface FieldSpec {
  label: string;
  who: Who;
  input: InputKind;
  options?: readonly { value: string; label: string }[];
  /** Masking used for this field's before / after in the audit (ADR-006 class A). */
  pii?: PiiKind;
  /** The new value as typed → the column value, or a sentence saying what is wrong. */
  parse(raw: unknown): Parsed;
  /** Rules that need the record (not the database). */
  check?(value: unknown, record: Row): Problem | null;
  /** Told to the person after a successful correction (a follow-up outside Firm OS). */
  afterNote?: string;
}

const bad = (error: string): Problem => ({ status: 400, error });
const conflict = (error: string): Problem => ({ status: 409, error });
const endSentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const invalid = (label: string, msg: string | undefined) =>
  `The new ${label} isn't valid: ${endSentence(msg ?? "it is not in the expected format")} Check it and try again.`;
const blank = (raw: unknown) => raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");

// ------------------------------------------------------------------ parsers

/** Reuse a /clients field schema (clientBodyZ.shape.x). `required` fields cannot be cleared. */
function fromClientSchema(schema: z.ZodTypeAny, label: string, required = false): FieldSpec["parse"] {
  return (raw) => {
    if (required && blank(raw)) return { ok: false, error: `Enter a value for ${label}. It can't be left empty.` };
    const r = schema.safeParse(raw);
    if (!r.success) return { ok: false, error: invalid(label, r.error.issues[0]?.message) };
    return { ok: true, value: r.data ?? null };
  };
}

function select(label: string, options: readonly { value: string; label: string }[]): FieldSpec["parse"] {
  return (raw) =>
    typeof raw === "string" && options.some((o) => o.value === raw)
      ? { ok: true, value: raw }
      : { ok: false, error: `Pick one of the listed options for ${label}.` };
}

function text(label: string, min: number, max: number, opts: { nullable?: boolean; upper?: boolean } = {}): FieldSpec["parse"] {
  return (raw) => {
    if (blank(raw)) return opts.nullable ? { ok: true, value: null } : { ok: false, error: `Enter a value for ${label}. It can't be left empty.` };
    if (typeof raw !== "string") return { ok: false, error: `Enter ${label} as text.` };
    const v = opts.upper ? raw.trim().toUpperCase() : raw.trim();
    if (v.length < min) return { ok: false, error: `${label} must be at least ${min} characters. Add the missing part and try again.` };
    if (v.length > max) return { ok: false, error: `${label} can be at most ${max} characters. Shorten it and try again.` };
    return { ok: true, value: v };
  };
}

/** "YYYY-MM-DD" from a date input → 00:00 IST that day (how Firm OS stores job dates). */
function istDate(label: string): FieldSpec["parse"] {
  return (raw) => {
    const d = typeof raw === "string" ? parseDayKey(raw.trim().slice(0, 10)) : null;
    return d ? { ok: true, value: d } : { ok: false, error: `Pick a date for ${label}.` };
  };
}

function person(label: string): FieldSpec["parse"] {
  return (raw) =>
    typeof raw === "string" && raw.trim().length > 0 && raw.trim().length <= 64
      ? { ok: true, value: raw.trim() }
      : { ok: false, error: `Pick a person from the list for ${label}.` };
}

const enumOptions = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

// ------------------------------------------------------------------ shared checks

function differentFrom(otherField: "assigneeId" | "reviewerId"): FieldSpec["check"] {
  return (value, record) =>
    value && value === record[otherField] ? bad("The assignee and the reviewer must be different people. Pick someone else.") : null;
}

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "kn", label: "Kannada" },
  { value: "ta", label: "Tamil" },
  { value: "hi", label: "Hindi" },
] as const;

const PREP_STARTED: ReadonlySet<JobTaskState> = new Set<JobTaskState>(["IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING", "DONE"]);

/** Shown when a client code would change after its CL-{Code} site exists. */
export const SITE_EXISTS_MESSAGE =
  "This client already has a SharePoint site, so its code can't be changed here. The site address and every folder path use the code (CL-{Code}), so changing it would point Firm OS at folders that don't exist. Ask IT to rename the site first, then a partner can correct the code.";

// ------------------------------------------------------------------ the allow-list

const C = clientBodyZ.shape;

export const ALLOW_LIST: Record<CorrectionEntity, Record<string, FieldSpec>> = {
  FirmClient: {
    clientCode: {
      label: "client code",
      who: "management",
      input: "text",
      parse: (raw) => {
        const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
        const err = validateClientCodeShape(v);
        return err ? { ok: false, error: invalid("client code", err) } : { ok: true, value: v };
      },
      check: (_v, record) => (record.clSiteUrl ? conflict(SITE_EXISTS_MESSAGE) : null),
      afterNote: "Change the client code in Turia as well, so both systems use the same code.",
    },
    turiaClientRef: { label: "Turia client reference", who: "management", input: "text", parse: text("Turia client reference", 1, 100, { nullable: true }) },
    preferredLanguage: { label: "preferred language", who: "management", input: "select", options: LANGUAGES, parse: select("preferred language", LANGUAGES) },
  },
  Client: {
    entityType: {
      label: "entity type",
      who: "management",
      input: "select",
      options: enumOptions(ENTITY_TYPES),
      parse: select("entity type", enumOptions(ENTITY_TYPES)),
      check: (value, record) => {
        const pan = typeof record.pan === "string" ? record.pan : null;
        if (!pan || !validatePan(pan, value as EntityType)) return null;
        return bad(
          `The PAN on record (${maskLast4(pan)}) is not a ${ENTITY_TYPES[value as EntityType].toLowerCase()} PAN. Correct the PAN first, or pick the entity type that matches it.`,
        );
      },
    },
    pan: {
      label: "PAN",
      who: "management",
      input: "text",
      pii: "pan",
      parse: fromClientSchema(C.pan, "PAN"),
      check: (value, record) => {
        if (!value) return null;
        const err = validatePan(String(value), record.entityType as EntityType);
        return err ? bad(invalid("PAN", err)) : null;
      },
    },
    gstin: {
      label: "GSTIN",
      who: "management",
      input: "text",
      pii: "gstin",
      parse: fromClientSchema(C.gstin, "GSTIN"),
      check: (value, record) => {
        if (!value) return null;
        const issues = validateGstin(String(value), typeof record.pan === "string" ? record.pan : null);
        return issues.length ? bad(invalid("GSTIN", issues[0])) : null;
      },
    },
    cin: {
      label: "CIN / LLPIN",
      who: "management",
      input: "text",
      parse: fromClientSchema(C.cin, "CIN / LLPIN"),
      check: (value, record) => {
        if (!value) return null;
        const err = validateCin(String(value), record.entityType as EntityType);
        return err ? bad(invalid("CIN / LLPIN", err)) : null;
      },
    },
    industry: { label: "industry", who: "management", input: "text", parse: fromClientSchema(C.industry, "industry") },
    city: { label: "city", who: "management", input: "text", parse: fromClientSchema(C.city, "city") },
    contactName: { label: "contact name", who: "management", input: "text", pii: "name", parse: fromClientSchema(C.contactName, "contact name") },
    contactPhone: { label: "contact phone", who: "management", input: "text", pii: "phone", parse: fromClientSchema(C.contactPhone, "contact phone") },
    contactEmail: { label: "contact email", who: "management", input: "text", pii: "email", parse: fromClientSchema(C.contactEmail, "contact email") },
    referralSource: { label: "referral source", who: "management", input: "text", pii: "text", parse: fromClientSchema(C.referralSource, "referral source") },
    turnover: { label: "turnover", who: "management", input: "number", parse: fromClientSchema(C.turnover, "turnover", true) },
    growthGoal: { label: "growth goal", who: "management", input: "select", options: enumOptions(GROWTH_GOALS), parse: select("growth goal", enumOptions(GROWTH_GOALS)) },
    growthNote: { label: "growth note", who: "management", input: "textarea", pii: "text", parse: fromClientSchema(C.growthNote, "growth note") },
    onboardedOn: { label: "onboarded on", who: "management", input: "date", parse: fromClientSchema(C.onboardedOn, "onboarded on", true) },
    primaryHandlerId: { label: "primary handler", who: "management", input: "user", parse: person("primary handler") },
  },
  JobTask: {
    internalDueOn: {
      label: "internal due date",
      who: "job-manager",
      input: "date",
      parse: istDate("internal due date"),
      check: (value, record) => {
        const statutory = record.statutoryDueOn instanceof Date ? record.statutoryDueOn : null;
        if (!statutory || !(value instanceof Date) || istDayKey(value) <= istDayKey(statutory)) return null;
        return bad(`The internal due date can't be after the statutory due date (${formatDate(statutory)}). Pick an earlier date.`);
      },
    },
    assigneeId: { label: "assignee", who: "job-manager", input: "user", parse: person("assignee"), check: differentFrom("reviewerId") },
    reviewerId: { label: "reviewer", who: "job-manager", input: "user", parse: person("reviewer"), check: differentFrom("assigneeId") },
    title: { label: "title", who: "job-manager", input: "text", parse: text("title", 2, 120) },
    period: {
      label: "period",
      who: "job-manager",
      input: "text",
      parse: (raw) => {
        const v = typeof raw === "string" ? raw.trim() : "";
        return isValidPeriod(v) ? { ok: true, value: v } : { ok: false, error: "Enter the period as a month like 2026-10, a quarter Q1 to Q4, or Annual." };
      },
      check: (value, record) => {
        const state = record.state as JobTaskState;
        if (PREP_STARTED.has(state)) {
          return conflict(
            `This job's period is fixed once preparation starts (the job is ${state}), because its SharePoint folder follows the period. Ask a partner if the period is really wrong.`,
          );
        }
        const fy = String(record.fy);
        if (!periodInFy(value as never, fy)) {
          const start = Number(fy.slice(0, 4));
          return bad(`Period ${String(value)} is outside FY ${fy}. Pick a month from April ${start} to March ${start + 1}.`);
        }
        return null;
      },
    },
  },
  Engagement: {
    frequency: {
      label: "frequency",
      who: "job-manager",
      input: "select",
      options: FREQUENCIES.map((f) => ({ value: f, label: f[0] + f.slice(1).toLowerCase() })),
      parse: select("frequency", FREQUENCIES.map((f) => ({ value: f, label: f }))),
      check: (value, record) => {
        const service = record.service as FirmService;
        const allowed = SERVICE_FREQUENCIES[service] ?? [];
        if (allowed.includes(value as (typeof FREQUENCIES)[number])) return null;
        return bad(`A ${SERVICE_LABELS[service] ?? service} engagement can be ${allowed.map((f) => f.toLowerCase()).join(" or ")}, not ${String(value).toLowerCase()}. Pick one of those.`);
      },
    },
    assigneeId: { label: "assignee", who: "job-manager", input: "user", parse: person("assignee"), check: differentFrom("reviewerId") },
    reviewerId: { label: "reviewer", who: "job-manager", input: "user", parse: person("reviewer"), check: differentFrom("assigneeId") },
  },
  CommsDraft: {
    subject: { label: "subject", who: "creator", input: "text", pii: "text", parse: text("subject", 1, 200) },
    body: { label: "message", who: "creator", input: "textarea", pii: "text", parse: text("message", 1, 5000) },
  },
};

/** Rules that apply to every field of a record (checked after the person's permission). */
export const RECORD_GUARDS: Record<CorrectionEntity, (record: Row) => Problem | null> = {
  FirmClient: () => null,
  Client: () => null,
  JobTask: (r) =>
    r.state === "DONE"
      ? conflict("This job is DONE, so its details are closed and can't be corrected. If something is wrong, add a note on the job and tell a partner.")
      : null,
  Engagement: (r) =>
    r.active === false ? conflict("This engagement is archived, so it can't be corrected. Ask a partner to restore it first if the details matter.") : null,
  CommsDraft: (r) =>
    r.outlookDraftId
      ? conflict("This draft has already been opened in Outlook, so correct it in Outlook. Changes here would not reach the Outlook draft.")
      : null,
};

/** Why well-known fields that are not on the allow-list are refused, and what to do instead. */
export const NOT_CORRECTABLE: Partial<Record<CorrectionEntity, Record<string, string>>> = {
  FirmClient: {
    lmsClientId: "The link to the LMS client can't be changed as a correction. Ask a partner if it points to the wrong client.",
    clSiteUrl: "The SharePoint site address is recorded when the site is created and can't be corrected here. Ask IT if it is wrong.",
  },
  Client: {
    name: "A client's name is changed on the client page, because its SharePoint folder is renamed with it. Open the client and use Edit there.",
    active: "Archiving or restoring a client is done on the client page, not as a correction.",
    folderName: "SharePoint folder details are managed by the system and can't be corrected by hand.",
    graphFolderId: "SharePoint folder details are managed by the system and can't be corrected by hand.",
  },
  JobTask: {
    ackRef:
      "An acknowledgement reference (ARN, SRN or ack no.) is corrected by retracting the filing confirmation and confirming again, so the history keeps both references. Ask a manager or partner to retract the filing on the job page.",
    state: "A job's state changes only through its own steps (submit, approve, mark filed and so on), so the history stays complete. Use the buttons on the job page.",
    statutoryDueOn: "Statutory due dates come from the SOP pack calendar. Ask a partner to correct the calendar, so every job gets the right date.",
    fy: "A job's client, service and financial year can't be changed. Ask a partner to set up the right job instead.",
    service: "A job's client, service and financial year can't be changed. Ask a partner to set up the right job instead.",
    firmClientId: "A job's client, service and financial year can't be changed. Ask a partner to set up the right job instead.",
  },
};

/** The sentence refusing `field` on `entity` (allow-listed fields return null). */
export function refusalFor(entity: CorrectionEntity, field: string): string | null {
  if (Object.prototype.hasOwnProperty.call(ALLOW_LIST[entity], field)) return null;
  const known = NOT_CORRECTABLE[entity]?.[field];
  if (known) return known;
  const labels = Object.values(ALLOW_LIST[entity]).map((s) => s.label);
  return `That field can't be corrected here. On a ${ENTITY_NOUN[entity]} you can correct: ${labels.join(", ")}.`;
}

export const UNKNOWN_ENTITY_MESSAGE = "That kind of record can't be corrected here. Corrections cover clients, jobs, engagements and comms drafts.";
