// Client onboarding — pure helpers. No DB, no Graph. Everything here is covered by
// scripts/verify-clients.ts.
import { z } from "zod";
import type { Session } from "next-auth";
import type { ClientDocType, Department, EntityType, GrowthGoal, JobStatus, TurnoverBand } from "@prisma/client";
import { isActive, isAdmin, isManagement } from "@/lib/access";

export const keysOf = <T extends string>(o: Record<T, string>) => Object.keys(o) as [T, ...T[]];

export const ENTITY_TYPES: Record<EntityType, string> = {
  INDIVIDUAL: "Individual",
  HUF: "HUF",
  PROPRIETORSHIP: "Proprietorship",
  PARTNERSHIP: "Partnership firm",
  LLP: "LLP",
  PVT_LTD: "Private limited",
  PUBLIC_LTD: "Public limited",
  TRUST_SOCIETY: "Trust / Society",
  OTHER: "Other",
};

export const TURNOVER_BANDS: Record<TurnoverBand, string> = {
  UNDER_40L: "Under ₹40 L",
  L40_TO_1CR: "₹40 L – 1 Cr",
  CR1_TO_5CR: "₹1 – 5 Cr",
  CR5_TO_20CR: "₹5 – 20 Cr",
  ABOVE_20CR: "Above ₹20 Cr",
};

export const GROWTH_GOALS: Record<GrowthGoal, string> = {
  EXPAND_LOCATIONS: "Expand locations",
  RAISE_FUNDING: "Raise funding",
  CONVERT_ENTITY: "Convert entity (e.g. Prop → Pvt Ltd)",
  EXPORT: "Start / grow exports",
  COMPLIANCE_CLEANUP: "Compliance clean-up",
  COST_REDUCTION: "Cost reduction",
  EXIT_SALE: "Exit / sale",
  MAINTAIN: "Maintain as is",
  OTHER: "Other",
};

export const JOB_STATUSES: Record<JobStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  DELIVERED: "Filed / Delivered",
  CLOSED: "Closed",
};

export const KYC_DOC_TYPES = {
  PAN: "PAN",
  AADHAAR_DIN: "Aadhaar - DIN",
  INCORPORATION_DEED: "Incorporation cert - Deed",
  GST_CERT: "GST certificate",
  MOA_AOA: "MOA - AOA",
  BANK: "Bank details",
  ENGAGEMENT_LETTER: "Engagement letter",
  OTHER_KYC: "Other KYC",
} as const;

export const JOB_DOC_TYPES = {
  SOURCE_DATA: "Source data",
  WORKING_PAPERS: "Working papers",
  FILED_RETURN: "Filed return - report",
  ACKNOWLEDGEMENT: "Acknowledgement",
  SIGN_OFF: "Client sign-off",
  OTHER_JOB: "Other",
} as const;

export const DOC_TYPES: Record<ClientDocType, string> = { ...KYC_DOC_TYPES, ...JOB_DOC_TYPES };

export function isKycDocType(t: ClientDocType): boolean {
  return t in KYC_DOC_TYPES;
}

// Approved seed list (spec §Seed service list). Admins extend it in the UI.
export const SEED_SERVICES: Array<[Department, string[]]> = [
  ["AUDIT", ["Statutory Audit", "Tax Audit", "Internal Audit", "Stock Audit", "Certification"]],
  ["TAX", ["ITR filing", "GST registration", "GST monthly/quarterly returns", "GST annual return", "TDS returns", "Advance tax", "Scrutiny/Notice reply", "Appeals"]],
  ["ACCOUNTS", ["Bookkeeping", "MIS", "Payroll", "Finalisation"]],
  ["ROC", ["Incorporation", "Annual filing (AOC-4/MGT-7)", "Director changes", "Share transfer", "Strike-off", "LLP filing"]],
  ["TECH", ["Tally setup", "Software implementation"]],
  ["ADMIN", ["Registrations (MSME, IEC, PF/ESI, Shop Act)"]],
];

const LAKH = 100_000;
const CRORE = 10_000_000;

export function turnoverBand(rupees: number): TurnoverBand {
  if (rupees < 40 * LAKH) return "UNDER_40L";
  if (rupees < 1 * CRORE) return "L40_TO_1CR";
  if (rupees < 5 * CRORE) return "CR1_TO_5CR";
  if (rupees < 20 * CRORE) return "CR5_TO_20CR";
  return "ABOVE_20CR";
}

// Safe for a SharePoint file or folder name.
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

export function folderName(s: string): string {
  return safeName(s).slice(0, 80).trim();
}

// Indian financial year, April–March, based on the IST calendar date (folders/reports
// are all IST-facing; using the server's local date would shift the FY boundary on a
// UTC host). fyFor(2 Sep 2026) = "2026-27".
export function fyFor(d: Date): string {
  const [y, m] = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).split("-").map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  return `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
}

export function fyOptions(now = new Date()): string[] {
  const cur = Number(fyFor(now).slice(0, 4));
  return [0, 1, 2, 3].map((i) => {
    const y = cur - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

export function isValidFy(s: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Form fields arrive as strings. For optional/nullable columns, "" means "clear this
// field" (-> null; Prisma writes null and skips undefined, so an absent key still
// leaves the column untouched on PATCH). turnover is NOT NULL in the schema, so it
// can't be cleared this way: blank turnover maps to undefined instead, which fails
// as required on create and simply isn't sent on PATCH (never silently becomes 0).
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const upperBlankToNull = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : v);
const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optText = z.preprocess(blankToNull, z.string().trim().max(200).nullable().optional());

export const clientBodyZ = z.object({
  name: z.string().trim().min(2, "Client name is required").max(120),
  entityType: z.enum(keysOf(ENTITY_TYPES)),
  pan: z.preprocess(upperBlankToNull, z.string().regex(PAN_RE, "PAN must look like AAAAA9999A").nullable().optional()),
  gstin: z.preprocess(upperBlankToNull, z.string().regex(GSTIN_RE, "GSTIN must be 15 characters, e.g. 33AAAAA9999A1Z5").nullable().optional()),
  cin: z.preprocess(upperBlankToNull, z.string().max(30).nullable().optional()),
  industry: optText,
  city: optText,
  contactName: optText,
  contactPhone: z.preprocess(blankToNull, z.string().regex(/^\d{10}$/, "Phone must be 10 digits").nullable().optional()),
  contactEmail: z.preprocess(blankToNull, z.string().email("Invalid email").nullable().optional()),
  referralSource: optText,
  turnover: z.preprocess(blankToUndef, z.coerce.number().min(0, "Turnover cannot be negative")),
  growthGoal: z.enum(keysOf(GROWTH_GOALS)),
  growthNote: z.preprocess(blankToNull, z.string().trim().max(1000).nullable().optional()),
  onboardedOn: z.coerce.date(),
  primaryHandlerId: z.string().min(1, "Pick a handler"),
});

export const jobBodyZ = z.object({
  serviceTypeId: z.string().min(1, "Pick a service"),
  fy: z.string().refine(isValidFy, "FY must look like 2026-27"),
  handlerId: z.string().min(1, "Pick a handler"),
  status: z.enum(keysOf(JOB_STATUSES)).default("NOT_STARTED"),
  dueOn: z.preprocess(blankToNull, z.coerce.date().nullable().optional()),
  fees: z.preprocess(blankToNull, z.coerce.number().min(0).nullable().optional()),
  notes: z.preprocess(blankToNull, z.string().trim().max(2000).nullable().optional()),
});

export const createClientBodyZ = z.object({ client: clientBodyZ, job: jobBodyZ });

// Inline edits on the client page. Service and FY are fixed once the folder exists.
export const jobPatchZ = jobBodyZ.pick({ handlerId: true, status: true, dueOn: true, fees: true, notes: true }).partial();

export type ClientBody = z.infer<typeof clientBodyZ>;
export type JobBody = z.infer<typeof jobBodyZ>;

type U = Session["user"] | null | undefined;

export function canViewClients(user: U): boolean {
  return isActive(user);
}

export function canManageClients(user: U): boolean {
  return canViewClients(user) && isManagement(user);
}

export function isClientsAdmin(user: U): boolean {
  return canViewClients(user) && isAdmin(user);
}
