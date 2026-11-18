// OnboardingSpec — everything Firm OS needs to onboard one client from a plain-English sentence
// (orchestrator Phase 3). Pure module: Zod schemas, field rules and normalizers; no I/O.
//
// Lifecycle: the extractor returns an ExtractedSpec (model output, lenient strings), which is
// normalized into a PartialSpec (stored on OnboardingRun.spec). The clarifier asks for what is
// missing; validators check what is present. Only a spec that parses as OnboardingSpec and
// passes the validators can be planned.
import { z } from "zod";
import type { EntityType, FirmService, GrowthGoal } from "@prisma/client";
import { ENTITY_TYPES, GROWTH_GOALS, PAN_RE, isValidFy, keysOf } from "@/lib/clients/core";

export const FIRM_SERVICES = ["GST", "ROC", "IncomeTax", "TDS", "Books", "Audit", "Engagement"] as const satisfies readonly FirmService[];
export const FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const BOOKS_SOFTWARE = ["Tally", "Zoho", "Other"] as const;
export type BooksSoftware = (typeof BOOKS_SOFTWARE)[number];

/** Frequencies each service can run at. The first is the default when a prompt does not say. */
export const SERVICE_FREQUENCIES: Record<FirmService, readonly Frequency[]> = {
  GST: ["MONTHLY", "QUARTERLY"],
  ROC: ["ANNUAL"],
  IncomeTax: ["ANNUAL"],
  TDS: ["QUARTERLY"],
  Books: ["MONTHLY", "QUARTERLY", "ANNUAL"],
  Audit: ["ANNUAL"],
  Engagement: ["ANNUAL"],
};

export const COMPANY_TYPES: readonly EntityType[] = ["PVT_LTD", "PUBLIC_LTD"];

export const CLIENT_CODE_RE = /^[A-Z0-9]{3,10}$/;
export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const PHONE_RE = /^\d{10}$/;

export const serviceLineZ = z.object({
  service: z.enum(FIRM_SERVICES),
  frequency: z.enum(FREQUENCIES),
});
export type ServiceLine = z.infer<typeof serviceLineZ>;

const entityTypeZ = z.enum(keysOf(ENTITY_TYPES));
const growthGoalZ = z.enum(keysOf(GROWTH_GOALS));

/** The shape of a complete spec (conditional requirements are checked by requiredFields()). */
export const specShapeZ = z.object({
  legalName: z.string().trim().min(2, "Legal name is required").max(120),
  entityType: entityTypeZ,
  services: z.array(serviceLineZ).min(1, "Pick at least one service"),
  clientCode: z.string().regex(CLIENT_CODE_RE, "Client code must be 3–10 characters, A–Z and 0–9 only"),
  fy: z.string().refine(isValidFy, "FY must look like 2026-27"),
  assigneeId: z.string().min(1, "Pick an assignee"),
  assigneeName: z.string().optional(),
  reviewerId: z.string().min(1, "Pick a reviewer"),
  reviewerName: z.string().optional(),
  pan: z.string().regex(PAN_RE, "PAN must look like AAAAA9999A"),
  gstins: z.array(z.string()).default([]),
  cin: z.string().optional(),
  firstPeriod: z.string().regex(MONTH_RE, "First period must be a month, e.g. 2026-11").optional(),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().email("Invalid email"),
  contactPhone: z.string().regex(PHONE_RE, "Phone must be 10 digits"),
  turnoverInr: z.number().min(0, "Turnover cannot be negative"),
  billing: z.string().trim().min(2).max(300),
  dscHolder: z.string().trim().max(120).optional(),
  booksSoftware: z.enum(BOOKS_SOFTWARE).optional(),
  booksSoftwareOther: z.string().trim().max(60).optional(),
  growthGoal: growthGoalZ.optional(),
});

export type OnboardingSpecData = z.infer<typeof specShapeZ>;
/** Stored while the conversation is in progress. */
export const partialSpecZ = specShapeZ.partial();
export type PartialSpec = z.infer<typeof partialSpecZ>;
export type SpecField = keyof OnboardingSpecData;

/** The complete spec, conditional requirements included. */
export const OnboardingSpec = specShapeZ.superRefine((spec, ctx) => {
  for (const field of requiredFields(spec)) {
    if (isMissing(spec, field)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${FIELD_LABELS[field]} is required` });
  }
});
export type OnboardingSpec = OnboardingSpecData;

/** What the extractor model returns: every field optional and lenient (validators judge values). */
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
export const ExtractedSpec = z.object({
  legalName: opt(z.string()),
  entityType: opt(entityTypeZ),
  services: opt(z.array(z.object({ service: z.enum(FIRM_SERVICES), frequency: opt(z.enum(FREQUENCIES)) }))),
  clientCode: opt(z.string()),
  fy: opt(z.string()),
  assigneeName: opt(z.string()),
  reviewerName: opt(z.string()),
  pan: opt(z.string()),
  gstins: opt(z.array(z.string())),
  cin: opt(z.string()),
  firstPeriod: opt(z.string()),
  contactName: opt(z.string()),
  contactEmail: opt(z.string()),
  contactPhone: opt(z.string()),
  turnoverInr: opt(z.number()),
  billing: opt(z.string()),
  dscHolder: opt(z.string()),
  booksSoftware: opt(z.enum(BOOKS_SOFTWARE)),
});
export type ExtractedSpec = z.infer<typeof ExtractedSpec>;

// ---------------------------------------------------------------- labels

export const FIELD_LABELS: Record<SpecField, string> = {
  legalName: "Legal name",
  entityType: "Entity type",
  services: "Services",
  clientCode: "Client code",
  fy: "First financial year (FY start)",
  assigneeId: "Assignee",
  assigneeName: "Assignee",
  reviewerId: "Reviewer",
  reviewerName: "Reviewer",
  pan: "PAN",
  gstins: "GSTIN(s)",
  cin: "CIN / LLPIN",
  firstPeriod: "First period",
  contactName: "Primary contact name",
  contactEmail: "Primary contact email",
  contactPhone: "Primary contact phone",
  turnoverInr: "Annual turnover (₹)",
  billing: "Billing",
  dscHolder: "DSC holder",
  booksSoftware: "Books software",
  booksSoftwareOther: "Books software (other)",
  growthGoal: "Growth goal",
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

export const FREQUENCY_LABELS: Record<Frequency, string> = { MONTHLY: "monthly", QUARTERLY: "quarterly", ANNUAL: "annual" };

export function serviceLineLabel(line: ServiceLine): string {
  const q = line.service === "GST" && line.frequency === "QUARTERLY" ? "quarterly, QRMP" : FREQUENCY_LABELS[line.frequency];
  return `${SERVICE_LABELS[line.service]} (${q})`;
}

export { ENTITY_TYPES, GROWTH_GOALS };

// ---------------------------------------------------------------- requirement rules

/**
 * Required fields for this spec, in the clarifier's fixed priority order. Conditional rules:
 * GSTIN when GST is a service; CIN/LLPIN for companies and LLPs; first period when any service
 * is monthly or quarterly; books software when Books or GST is a service (registers export);
 * DSC holder for companies, LLPs and ROC work. Annual turnover is required because the LMS
 * Client record (src/lib/clients) stores it NOT NULL and never defaults it to 0.
 */
export function requiredFields(spec: PartialSpec): SpecField[] {
  const services = spec.services ?? [];
  const has = (s: FirmService) => services.some((l) => l.service === s);
  const companyOrLlp = !!spec.entityType && (COMPANY_TYPES.includes(spec.entityType) || spec.entityType === "LLP");
  const periodic = services.some((l) => l.frequency !== "ANNUAL");
  const fields: Array<[SpecField, boolean]> = [
    ["legalName", true],
    ["entityType", true],
    ["services", true],
    ["clientCode", true],
    ["fy", true],
    ["assigneeId", true],
    ["reviewerId", true],
    ["pan", true],
    ["gstins", has("GST")],
    ["cin", companyOrLlp],
    ["firstPeriod", periodic],
    ["contactName", true],
    ["contactEmail", true],
    ["contactPhone", true],
    ["turnoverInr", true],
    ["billing", true],
    ["dscHolder", companyOrLlp || has("ROC")],
    ["booksSoftware", has("Books") || has("GST")],
    ["booksSoftwareOther", spec.booksSoftware === "Other"],
  ];
  return fields.filter(([, req]) => req).map(([f]) => f);
}

export function isMissing(spec: PartialSpec, field: SpecField): boolean {
  const v = spec[field];
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

export function missingFields(spec: PartialSpec): SpecField[] {
  return requiredFields(spec).filter((f) => isMissing(spec, f));
}

// ---------------------------------------------------------------- normalizers (pure)

const upper = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** "+91 98765-43210" → "9876543210"; anything that is not 10 digits after cleanup is returned as typed. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length === 10 ? digits : raw.trim();
}

/** "FY 2026-27", "2026-27", "FY2026-2027", "2026/27" → "2026-27"; unknown shapes are returned trimmed. */
export function normalizeFyInput(raw: string): string {
  const m = /(\d{4})\s*[-/–]\s*(\d{2,4})/.exec(raw);
  if (!m) return raw.trim();
  const start = Number(m[1]);
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * First period as a month "YYYY-MM". Accepts "2026-11", "Nov 2026", "November 2026" and FY
 * quarters "Q3" (needs the FY: Q1 = Apr … Q4 = Jan).
 */
export function normalizePeriod(raw: string, fy?: string): string {
  const s = raw.trim();
  const ym = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (ym) return `${ym[1]}-${ym[2].padStart(2, "0")}`;
  const named = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(s);
  if (named) {
    const i = MONTHS.indexOf(named[1].toLowerCase());
    if (i >= 0) return `${named[2]}-${String(i + 1).padStart(2, "0")}`;
  }
  const q = /^Q([1-4])$/i.exec(s);
  if (q && fy && isValidFy(fy)) {
    const start = Number(fy.slice(0, 4));
    const month = ((Number(q[1]) - 1) * 3 + 3) % 12 + 1; // Q1→4, Q2→7, Q3→10, Q4→1
    return `${month >= 4 ? start : start + 1}-${String(month).padStart(2, "0")}`;
  }
  return s;
}

function cleanText(v: string | null | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
}

/** De-duplicate services (last mention wins) and fill frequencies a prompt left out. */
export function normalizeServices(lines: Array<{ service: FirmService; frequency?: Frequency | null }>): ServiceLine[] {
  const byService = new Map<FirmService, Frequency>();
  for (const l of lines) byService.set(l.service, l.frequency ?? SERVICE_FREQUENCIES[l.service][0]);
  return FIRM_SERVICES.filter((s) => byService.has(s)).map((service) => ({ service, frequency: byService.get(service)! }));
}

/** Model output → stored partial spec (people names kept; ids are resolved separately). */
export function normalizeExtracted(x: ExtractedSpec): PartialSpec {
  const out: PartialSpec = {};
  const legalName = cleanText(x.legalName);
  if (legalName) out.legalName = legalName;
  if (x.entityType) out.entityType = x.entityType;
  if (x.services?.length) out.services = normalizeServices(x.services);
  const code = cleanText(x.clientCode);
  if (code) out.clientCode = upper(code);
  const fy = cleanText(x.fy);
  if (fy) out.fy = normalizeFyInput(fy);
  const assignee = cleanText(x.assigneeName);
  if (assignee) out.assigneeName = assignee;
  const reviewer = cleanText(x.reviewerName);
  if (reviewer) out.reviewerName = reviewer;
  const pan = cleanText(x.pan);
  if (pan) out.pan = upper(pan);
  const gstins = (x.gstins ?? []).map((g) => upper(g)).filter(Boolean);
  if (gstins.length) out.gstins = [...new Set(gstins)];
  const cin = cleanText(x.cin);
  if (cin) out.cin = upper(cin);
  const period = cleanText(x.firstPeriod);
  if (period) out.firstPeriod = normalizePeriod(period, out.fy);
  const contactName = cleanText(x.contactName);
  if (contactName) out.contactName = contactName;
  const email = cleanText(x.contactEmail);
  if (email) out.contactEmail = email.toLowerCase();
  const phone = cleanText(x.contactPhone);
  if (phone) out.contactPhone = normalizePhone(phone);
  if (typeof x.turnoverInr === "number" && Number.isFinite(x.turnoverInr)) out.turnoverInr = x.turnoverInr;
  const billing = cleanText(x.billing);
  if (billing) out.billing = billing;
  const dsc = cleanText(x.dscHolder);
  if (dsc) out.dscHolder = dsc;
  if (x.booksSoftware) out.booksSoftware = x.booksSoftware;
  return out;
}

/**
 * Overlay `patch` on `base`. Present values in the patch win; a person name that changes clears
 * the resolved id so it is resolved again.
 */
export function mergeSpec(base: PartialSpec, patch: PartialSpec): PartialSpec {
  const out: PartialSpec = { ...base };
  for (const [k, v] of Object.entries(patch) as Array<[SpecField, unknown]>) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    (out as Record<string, unknown>)[k] = v;
  }
  if (patch.assigneeName && patch.assigneeName !== base.assigneeName && !patch.assigneeId) out.assigneeId = undefined;
  if (patch.reviewerName && patch.reviewerName !== base.reviewerName && !patch.reviewerId) out.reviewerId = undefined;
  return out;
}

export type { EntityType, FirmService, GrowthGoal };
