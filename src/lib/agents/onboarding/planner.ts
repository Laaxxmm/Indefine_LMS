// JobPlanner — the seam between onboarding and the statutory calendar engine
// (src/lib/agents/core/calendar.ts). Onboarding needs one answer from it: "for this client's
// services in this FY, which JobTasks, with which dates?".
//
//   JobPlanner.planJobs(input) → PlannedJob[]
//
// The job catalog below decides WHICH jobs (GSTR-1/3B per month, 24Q/26Q per quarter, AOC-4/MGT-7
// per year …). A DueDateResolver supplies the dates:
//   - createCalendarPlanner({ loadPack }) — production: packDueDates() over the active SopPack
//     calendar (merged over DEFAULT_CALENDAR, see ./db.ts loadCalendarPack).
//   - createCatalogPlanner({ dueDates }) — the injection seam tests use with a fake resolver.
// Engine errors are returned, not thrown: NOT_APPLICABLE drops the job (nothing is due);
// any other error (AGM date unknown, state not in a QRMP group) keeps the job with null dates and
// the engine's reason as `dueNote`, which the plan preview shows.
import type { EntityType, FirmService } from "@prisma/client";
import { packDueDates, type CalendarPack, type DueContext } from "@/lib/agents/core";
import { COMPANY_TYPES, type Frequency, type ServiceLine } from "./spec";

export interface PlannedJob {
  /** Calendar rule id (calendar-defaults.ts) — the join key to the statutory calendar. */
  ruleId: string;
  service: FirmService;
  title: string;
  fy: string; // "2026-27"
  period: string; // "2026-11" | "Q3" | "Annual" (folder contract periods)
  statutoryDueOn: Date | null;
  internalDueOn: Date | null;
  /** Why the dates are missing, or a note from the calendar (statutory day is a holiday …). */
  dueNote: string | null;
}

export interface JobPlanInput {
  entityType: EntityType;
  services: ServiceLine[];
  fy: string;
  /** First month handled, "YYYY-MM". Absent when every service is annual. */
  firstPeriod?: string | null;
  /** GST state code of the (first) GSTIN — QRMP GSTR-3B due dates depend on it. */
  gstStateCode?: string | null;
  /** GST under QRMP (quarterly). */
  qrmp: boolean;
  /** Not known at onboarding; AGM-relative ROC dates stay pending until it is. */
  agmDate?: Date | null;
}

export interface JobPlanner {
  /** Shown on the plan: where the dates come from. */
  readonly source: string;
  planJobs(input: JobPlanInput): Promise<PlannedJob[]>;
}

export type DueOutcome =
  | { kind: "due"; statutoryDue: Date; internalDue: Date; note?: string | null }
  | { kind: "pending"; reason: string }
  | { kind: "not-applicable"; reason: string };

export type DueDateResolver = (
  job: Pick<PlannedJob, "ruleId" | "service" | "title" | "fy" | "period">,
  ctx: DueContext,
) => DueOutcome | Promise<DueOutcome>;

// ---------------------------------------------------------------- job catalog

export interface JobTemplate {
  ruleId: string;
  service: FirmService;
  title: string;
  cadence: Frequency;
  /** Only for these service frequencies (default: any). */
  frequencies?: Frequency[];
  /** Only for these entity types (default: any). */
  entityTypes?: EntityType[];
  /** Excluded for these entity types. */
  notFor?: EntityType[];
  /** Calendar rule category for this client (e.g. ITR audit / non-audit). */
  category?: (input: JobPlanInput) => string;
}

const COMPANY = [...COMPANY_TYPES];

/** Tax audit / company audit cases file ITR by the audit due date. */
export function itrCategory(input: JobPlanInput): string {
  const audited = COMPANY.includes(input.entityType) || input.services.some((s) => s.service === "Audit");
  return audited ? "audit" : "non-audit";
}

export const JOB_CATALOG: JobTemplate[] = [
  { ruleId: "gstr-1", service: "GST", title: "GSTR-1", cadence: "MONTHLY", frequencies: ["MONTHLY"] },
  { ruleId: "gstr-3b", service: "GST", title: "GSTR-3B", cadence: "MONTHLY", frequencies: ["MONTHLY"] },
  { ruleId: "gstr-1", service: "GST", title: "GSTR-1 (QRMP)", cadence: "QUARTERLY", frequencies: ["QUARTERLY"] },
  { ruleId: "gstr-3b", service: "GST", title: "GSTR-3B (QRMP)", cadence: "QUARTERLY", frequencies: ["QUARTERLY"] },
  { ruleId: "gstr-9", service: "GST", title: "GSTR-9", cadence: "ANNUAL" },
  { ruleId: "tds-24q", service: "TDS", title: "TDS 24Q", cadence: "QUARTERLY" },
  { ruleId: "tds-26q", service: "TDS", title: "TDS 26Q", cadence: "QUARTERLY" },
  { ruleId: "advance-tax", service: "IncomeTax", title: "Advance tax", cadence: "QUARTERLY", category: () => "regular" },
  { ruleId: "itr", service: "IncomeTax", title: "ITR", cadence: "ANNUAL", category: itrCategory },
  { ruleId: "aoc-4", service: "ROC", title: "AOC-4", cadence: "ANNUAL", entityTypes: COMPANY },
  { ruleId: "mgt-7", service: "ROC", title: "MGT-7", cadence: "ANNUAL", entityTypes: COMPANY },
  { ruleId: "adt-1", service: "ROC", title: "ADT-1", cadence: "ANNUAL", entityTypes: COMPANY },
  { ruleId: "dir-3-kyc", service: "ROC", title: "DIR-3 KYC", cadence: "ANNUAL", entityTypes: COMPANY },
  { ruleId: "llp-form-11", service: "ROC", title: "LLP Form 11", cadence: "ANNUAL", entityTypes: ["LLP"] },
  { ruleId: "llp-form-8", service: "ROC", title: "LLP Form 8", cadence: "ANNUAL", entityTypes: ["LLP"] },
  { ruleId: "roc-annual", service: "ROC", title: "ROC annual filing", cadence: "ANNUAL", notFor: [...COMPANY, "LLP"] },
  { ruleId: "books-close", service: "Books", title: "Books close", cadence: "MONTHLY", frequencies: ["MONTHLY"] },
  { ruleId: "books-close", service: "Books", title: "Books close", cadence: "QUARTERLY", frequencies: ["QUARTERLY"] },
  { ruleId: "books-close", service: "Books", title: "Books close", cadence: "ANNUAL", frequencies: ["ANNUAL"] },
  { ruleId: "audit", service: "Audit", title: "Audit", cadence: "ANNUAL" },
  { ruleId: "engagement", service: "Engagement", title: "Engagement letter", cadence: "ANNUAL" },
];

// ---------------------------------------------------------------- periods

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

/** FY quarter of a month: Apr–Jun = Q1 … Jan–Mar = Q4. */
export function quarterOf(month: string): (typeof QUARTERS)[number] {
  const m = Number(month.slice(5, 7));
  return QUARTERS[Math.floor(((m + 8) % 12) / 3)];
}

/** Months from `first` (default April) to March of the FY, as "YYYY-MM". */
export function monthsFrom(fy: string, first?: string | null): string[] {
  const start = Number(fy.slice(0, 4));
  const all = Array.from({ length: 12 }, (_, i) => {
    const month = ((i + 3) % 12) + 1;
    return `${month >= 4 ? start : start + 1}-${String(month).padStart(2, "0")}`;
  });
  return first ? all.filter((m) => m >= first) : all;
}

export function quartersFrom(first?: string | null): string[] {
  if (!first) return [...QUARTERS];
  return QUARTERS.slice(QUARTERS.indexOf(quarterOf(first)));
}

export function periodsFor(cadence: Frequency, fy: string, first?: string | null): string[] {
  if (cadence === "MONTHLY") return monthsFrom(fy, first);
  if (cadence === "QUARTERLY") return quartersFrom(first);
  return ["Annual"];
}

export function templatesFor(line: ServiceLine, entityType: EntityType): JobTemplate[] {
  return JOB_CATALOG.filter(
    (t) =>
      t.service === line.service &&
      (!t.frequencies || t.frequencies.includes(line.frequency)) &&
      (!t.entityTypes || t.entityTypes.includes(entityType)) &&
      !(t.notFor ?? []).includes(entityType),
  );
}

// ---------------------------------------------------------------- planners

export interface CatalogPlannerOptions {
  dueDates: DueDateResolver;
  source: string;
}

/** The catalog decides the jobs; `dueDates` decides the dates (injected — tests use a fake). */
export function createCatalogPlanner(opts: CatalogPlannerOptions): JobPlanner {
  return {
    source: opts.source,
    async planJobs(input) {
      const jobs: PlannedJob[] = [];
      for (const line of input.services) {
        for (const t of templatesFor(line, input.entityType)) {
          for (const period of periodsFor(t.cadence, input.fy, input.firstPeriod)) {
            const job = { ruleId: t.ruleId, service: t.service, title: t.title, fy: input.fy, period };
            const ctx: DueContext = {
              fy: input.fy,
              period,
              qrmp: input.qrmp,
              ...(input.agmDate ? { agmDate: input.agmDate } : {}),
              ...(input.gstStateCode ? { state: input.gstStateCode } : {}),
              ...(t.category ? { category: t.category(input) } : {}),
            };
            const due = await opts.dueDates(job, ctx);
            if (due.kind === "not-applicable") continue;
            jobs.push(
              due.kind === "due"
                ? { ...job, statutoryDueOn: due.statutoryDue, internalDueOn: due.internalDue, dueNote: due.note ?? null }
                : { ...job, statutoryDueOn: null, internalDueOn: null, dueNote: due.reason },
            );
          }
        }
      }
      return jobs;
    },
  };
}

export const NO_CALENDAR_RULE = "No statutory calendar rule for this job yet; set the due date by hand.";

/** Resolve dates from a calendar pack (production: the active SopPack calendar over the defaults). */
export function calendarResolver(pack: CalendarPack): DueDateResolver {
  return (job, ctx) => {
    if (!pack.rules.some((r) => r.id === job.ruleId)) return { kind: "pending", reason: NO_CALENDAR_RULE };
    const r = packDueDates(pack, job.ruleId, ctx);
    if (!r.ok) return r.code === "NOT_APPLICABLE" ? { kind: "not-applicable", reason: r.message } : { kind: "pending", reason: r.message };
    return {
      kind: "due",
      statutoryDue: r.statutoryDueAt,
      internalDue: r.internalDueAt,
      note: r.statutoryOnNonWorkingDay ? "The statutory date falls on a non-working day." : null,
    };
  };
}

export interface CalendarPlannerOptions {
  /** Loads the calendar to use (production: ./db.ts loadCalendarPack). */
  loadPack: () => Promise<{ pack: CalendarPack; source: string }>;
}

/** Production planner: catalog jobs + statutory calendar dates. The pack is loaded once per plan. */
export function createCalendarPlanner(opts: CalendarPlannerOptions): JobPlanner {
  let source = "Statutory calendar";
  return {
    get source() {
      return source;
    },
    async planJobs(input) {
      const loaded = await opts.loadPack();
      source = loaded.source;
      return createCatalogPlanner({ source, dueDates: calendarResolver(loaded.pack) }).planJobs(input);
    },
  };
}
