// SharePoint Path A — pure path rules (docs/folder-contract.md). No env, no fetch, no DB.
// Every CL-{Code} URL and library-relative path in the app is built here; nothing else
// may hand-assemble one. FY and period decisions use the IST calendar (src/lib/ist.ts via
// the existing fyFor in src/lib/clients/core.ts), never the server's local clock.
import { fyFor, isValidFy } from "@/lib/clients/core";
import { istMonth } from "@/lib/ist";

export const DEFAULT_TENANT_HOST = "srcaassociate.sharepoint.com";
export const HUB_SITE_NAME = "Indefine-Compliance";
export const CL_SITE_PREFIX = "CL-";
export const COMPLIANCE_LIBRARY = "Compliance";
export const CLIENT_LISTS = ["ClientObligations", "ClientRequests"] as const;
export const CLIENT_UPLOAD_GROUP = "Client Upload";

export const SERVICES = ["GST", "ROC", "IncomeTax", "TDS", "Books", "Audit", "Engagement"] as const;
export type ServiceFolder = (typeof SERVICES)[number];

export const KINDS = ["Working", "Final", "ClientDocs"] as const;
export type DeliverableKind = (typeof KINDS)[number];

export const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
export type Quarter = (typeof QUARTERS)[number];
export type MonthlyPeriod = `${number}-${number}`;
export type Period = MonthlyPeriod | Quarter | "Annual";
export type Frequency = "monthly" | "quarterly" | "annual";
export type FyLabel = `FY${number}-${number}`;

export type PeriodInput =
  | { frequency: "monthly"; year: number; month: number }
  | { frequency: "quarterly"; quarter: number }
  | { frequency: "annual" };

/** Thrown for any input that would produce a path outside the contract. */
export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

// ---------------- client code ----------------

const CODE_RE = /^[A-Z0-9]{3,10}$/;

export function isValidClientCode(code: unknown): code is string {
  return typeof code === "string" && CODE_RE.test(code);
}

/** Returns the code unchanged when valid; throws PathError naming the rule it breaks. */
export function validateClientCode(code: unknown): string {
  if (typeof code !== "string") throw new PathError("Client code must be a string");
  if (code.length < 3 || code.length > 10) throw new PathError(`Client code "${code}" must be 3–10 characters`);
  if (/[a-z]/.test(code)) throw new PathError(`Client code "${code}" must be uppercase`);
  if (!CODE_RE.test(code)) throw new PathError(`Client code "${code}" may contain only A–Z and 0–9`);
  return code;
}

// ---------------- financial year ----------------

/** "FY2026-27" for the IST calendar date of `date`. 31 Mar 23:59 IST → previous FY; 1 Apr 00:00 IST → new FY. */
export function fyLabel(date: Date): FyLabel {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new PathError("fyLabel needs a valid Date");
  return `FY${fyFor(date)}` as FyLabel;
}

/** Accepts a Date, "2026-27" or "FY2026-27"; returns "FY2026-27". */
export function normalizeFy(fy: string | Date): FyLabel {
  if (fy instanceof Date) return fyLabel(fy);
  const bare = fy.startsWith("FY") ? fy.slice(2) : fy;
  if (!isValidFy(bare)) throw new PathError(`FY "${fy}" must look like FY2026-27`);
  return `FY${bare}` as FyLabel;
}

/** 2026 for "FY2026-27". */
export function fyStartYear(fy: string | Date): number {
  return Number(normalizeFy(fy).slice(2, 6));
}

// ---------------- periods ----------------

const MONTHLY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function intIn(n: number, lo: number, hi: number): boolean {
  return Number.isInteger(n) && n >= lo && n <= hi;
}

/** Period folder name: monthly "2026-10", quarterly "Q2", annual "Annual". */
export function periodLabel(input: PeriodInput): Period {
  switch (input.frequency) {
    case "monthly":
      if (!intIn(input.year, 1000, 9999)) throw new PathError(`Year ${input.year} must be a 4-digit integer`);
      if (!intIn(input.month, 1, 12)) throw new PathError(`Month ${input.month} must be 1–12`);
      return `${input.year}-${String(input.month).padStart(2, "0")}` as MonthlyPeriod;
    case "quarterly":
      if (!intIn(input.quarter, 1, 4)) throw new PathError(`Quarter ${input.quarter} must be 1–4`);
      return QUARTERS[input.quarter - 1];
    case "annual":
      return "Annual";
    default:
      throw new PathError(`Unknown frequency "${(input as { frequency: unknown }).frequency}"`);
  }
}

/** The period containing `date` (IST). Quarters are FY quarters: Q1 = Apr–Jun … Q4 = Jan–Mar. */
export function periodFor(frequency: Frequency, date: Date): Period {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new PathError("periodFor needs a valid Date");
  const ym = istMonth(date);
  if (frequency === "monthly") return ym as MonthlyPeriod;
  if (frequency === "quarterly") return QUARTERS[Math.floor(((Number(ym.slice(5, 7)) + 8) % 12) / 3)];
  if (frequency === "annual") return "Annual";
  throw new PathError(`Unknown frequency "${frequency as string}"`);
}

export function isValidPeriod(p: unknown): p is Period {
  return typeof p === "string" && (p === "Annual" || (QUARTERS as readonly string[]).includes(p) || MONTHLY_RE.test(p));
}

export function parsePeriod(p: unknown): Period {
  if (!isValidPeriod(p)) throw new PathError(`Period "${String(p)}" must be YYYY-MM, Q1–Q4 or Annual`);
  return p;
}

/** Monthly periods must fall in Apr(start)…Mar(start+1); quarters and Annual always fit. */
export function periodInFy(period: Period, fy: string | Date): boolean {
  const m = MONTHLY_RE.exec(period);
  if (!m) return true;
  const start = fyStartYear(fy);
  const key = `${m[1]}-${m[2]}`;
  return key >= `${start}-04` && key <= `${start + 1}-03`;
}

/** Periods ensureFyTree creates when the caller does not choose (folder-contract §2). */
export function defaultPeriods(service: ServiceFolder, fy: string | Date): Period[] {
  const start = fyStartYear(fy);
  if (service === "GST" || service === "Books") {
    return Array.from({ length: 12 }, (_, i) => {
      const month = ((i + 3) % 12) + 1; // 4..12, 1..3
      return periodLabel({ frequency: "monthly", year: month >= 4 ? start : start + 1, month });
    });
  }
  if (service === "TDS") return [...QUARTERS];
  return ["Annual"];
}

// ---------------- guards ----------------

export function isServiceFolder(s: unknown): s is ServiceFolder {
  return (SERVICES as readonly unknown[]).includes(s);
}
export function validateService(s: unknown): ServiceFolder {
  if (!isServiceFolder(s)) throw new PathError(`Service "${String(s)}" must be one of ${SERVICES.join(", ")}`);
  return s;
}
export function isDeliverableKind(k: unknown): k is DeliverableKind {
  return (KINDS as readonly unknown[]).includes(k);
}
export function validateKind(k: unknown): DeliverableKind {
  if (!isDeliverableKind(k)) throw new PathError(`Kind "${String(k)}" must be one of ${KINDS.join(", ")}`);
  return k;
}

// ---------------- sites and URLs ----------------

export function clSiteName(code: string): string {
  return `${CL_SITE_PREFIX}${validateClientCode(code)}`;
}
/** "/sites/CL-ACME" */
export function clSitePath(code: string): string {
  return `/sites/${clSiteName(code)}`;
}
/** "https://srcaassociate.sharepoint.com/sites/CL-ACME" */
export function clSiteUrl(code: string, host: string = DEFAULT_TENANT_HOST): string {
  return `https://${host}${clSitePath(code)}`;
}
export function hubSiteUrl(host: string = DEFAULT_TENANT_HOST): string {
  return `https://${host}/sites/${HUB_SITE_NAME}`;
}

export interface CompliancePath {
  siteUrl: string;
  library: typeof COMPLIANCE_LIBRARY;
  /** Folder names below the library root, e.g. ["FY2026-27", "GST", "2026-10", "Final"]. */
  segments: string[];
  /** Library-relative path, e.g. "FY2026-27/GST/2026-10/Final" (Graph drive path). */
  path: string;
  /** "/sites/CL-ACME/Compliance/FY2026-27/GST/2026-10/Final" */
  serverRelativeUrl: string;
  /** Browser link to the folder. */
  webUrl: string;
}

function compliancePath(code: string, segments: string[], host: string): CompliancePath {
  const siteUrl = clSiteUrl(code, host);
  const path = segments.join("/");
  const serverRelativeUrl = `${clSitePath(code)}/${COMPLIANCE_LIBRARY}/${path}`; // segments are never empty
  return { siteUrl, library: COMPLIANCE_LIBRARY, segments, path, serverRelativeUrl, webUrl: `https://${host}${serverRelativeUrl}` };
}

/** The {Service} folder for an FY: ".../Compliance/FY2026-27/GST". */
export function servicePath(code: string, fy: string | Date, service: ServiceFolder, host: string = DEFAULT_TENANT_HOST): CompliancePath {
  return compliancePath(code, [normalizeFy(fy), validateService(service)], host);
}

export interface DeliverablePath extends CompliancePath {
  code: string;
  fy: FyLabel;
  service: ServiceFolder;
  period: Period;
  kind: DeliverableKind;
}

/** CL-{Code}/Compliance/FY{YYYY-YY}/{Service}/{Period}/{Kind}. Throws PathError on any invalid part. */
export function deliverablePath(
  code: string,
  fy: string | Date,
  service: ServiceFolder,
  period: Period | PeriodInput,
  kind: DeliverableKind,
  host: string = DEFAULT_TENANT_HOST,
): DeliverablePath {
  validateClientCode(code);
  const fyL = normalizeFy(fy);
  const svc = validateService(service);
  const per = typeof period === "string" ? parsePeriod(period) : periodLabel(period);
  if (!periodInFy(per, fyL)) throw new PathError(`Period ${per} is outside ${fyL}`);
  const k = validateKind(kind);
  return { ...compliancePath(code, [fyL, svc, per, k], host), code, fy: fyL, service: svc, period: per, kind: k };
}
