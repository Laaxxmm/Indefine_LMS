// Plan builder (pure): exactly what onboarding will create, shown to a partner/manager before
// anything is written. Stored on OnboardingRun.plan; the saga executes this plan, nothing more.
import type { EntityType, FirmService } from "@prisma/client";
import type { TuriaMode } from "@/lib/integrations/turia/adapter";
import { clSiteUrl } from "@/lib/integrations/sharepoint/paths";
import type { PlannedJob } from "./planner";
import type { ExistingLmsClient } from "./validators";
import { FIRM_SERVICES, type Frequency, type OnboardingSpec, type ServiceLine } from "./spec";

type Env = Record<string, string | undefined>;

/** FIRM_OS_ONBOARD_CONFIRM (default true): a partner/manager must click "Create". false = auto-execute. */
export function isConfirmRequired(env: Env = process.env): boolean {
  const v = (env.FIRM_OS_ONBOARD_CONFIRM ?? "").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(v);
}

export interface PlanJob {
  ruleId: string;
  service: FirmService;
  title: string;
  fy: string;
  period: string;
  statutoryDueOn: string | null; // ISO
  internalDueOn: string | null; // ISO
  dueNote: string | null;
  /** The first period of its series: gets a Turia task at onboarding (later ones when work starts). */
  turiaTaskNow: boolean;
}

export type TuriaPlanOp = { operation: "createClient" } | { operation: "addService"; service: FirmService; frequency: Frequency };

export interface OnboardingPlan {
  version: 1;
  createdAt: string;
  clientCode: string;
  legalName: string;
  entityType: EntityType;
  fy: string;
  lmsClient: { action: "create" } | { action: "link"; existingId: string; existingName: string };
  turia: { mode: TuriaMode; operations: TuriaPlanOp[]; tasksNow: number };
  sharepoint: { siteUrl: string; fy: string; services: FirmService[] };
  engagements: ServiceLine[];
  jobs: PlanJob[];
  people: { assignee: { id: string; name: string }; reviewer: { id: string; name: string } };
  /** Human checks that cannot be automated (e.g. "search Turia for this code first"). */
  checks: string[];
  confirmRequired: boolean;
  /** Some jobs have no dates yet (AGM-relative, no calendar rule …); see each job's dueNote. */
  datesPending: number;
  plannerSource: string;
}

export interface PlanContext {
  jobs: PlannedJob[];
  existingLmsClient: ExistingLmsClient | null;
  turiaMode: TuriaMode;
  checks: string[];
  confirmRequired: boolean;
  plannerSource: string;
  people: { assignee: { id: string; name: string }; reviewer: { id: string; name: string } };
  now: Date;
  tenantHost?: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Mark the earliest period of each (service, title) series. Jobs arrive in period order per series. */
export function markFirstOfSeries(jobs: PlannedJob[]): PlanJob[] {
  const seen = new Set<string>();
  return jobs.map((j) => {
    const key = `${j.service}|${j.title}`;
    const first = !seen.has(key);
    seen.add(key);
    return {
      ruleId: j.ruleId,
      service: j.service,
      title: j.title,
      fy: j.fy,
      period: j.period,
      statutoryDueOn: iso(j.statutoryDueOn),
      internalDueOn: iso(j.internalDueOn),
      dueNote: j.dueNote,
      turiaTaskNow: first,
    };
  });
}

export function buildPlan(spec: OnboardingSpec, ctx: PlanContext): OnboardingPlan {
  const jobs = markFirstOfSeries(ctx.jobs);
  const services = FIRM_SERVICES.filter((s) => s === "Engagement" || spec.services.some((l) => l.service === s));
  return {
    version: 1,
    createdAt: ctx.now.toISOString(),
    clientCode: spec.clientCode,
    legalName: spec.legalName,
    entityType: spec.entityType,
    fy: spec.fy,
    lmsClient: ctx.existingLmsClient
      ? { action: "link", existingId: ctx.existingLmsClient.id, existingName: ctx.existingLmsClient.name }
      : { action: "create" },
    turia: {
      mode: ctx.turiaMode,
      operations: [{ operation: "createClient" }, ...spec.services.map((l) => ({ operation: "addService" as const, service: l.service, frequency: l.frequency }))],
      tasksNow: jobs.filter((j) => j.turiaTaskNow).length,
    },
    sharepoint: { siteUrl: clSiteUrl(spec.clientCode, ctx.tenantHost), fy: spec.fy, services },
    engagements: spec.services,
    jobs,
    people: ctx.people,
    checks: ctx.checks,
    confirmRequired: ctx.confirmRequired,
    datesPending: jobs.filter((j) => !j.statutoryDueOn).length,
    plannerSource: ctx.plannerSource,
  };
}

/** Jobs grouped for the preview card: one row per (service, title) with its periods and next due. */
export function summarizeJobs(jobs: PlanJob[]): Array<{ service: FirmService; title: string; count: number; periods: string[]; firstDue: string | null; note: string | null }> {
  const groups = new Map<string, { service: FirmService; title: string; count: number; periods: string[]; firstDue: string | null; note: string | null }>();
  for (const j of jobs) {
    const key = `${j.service}|${j.title}`;
    const g = groups.get(key) ?? { service: j.service, title: j.title, count: 0, periods: [], firstDue: null, note: null };
    g.count++;
    g.periods.push(j.period);
    if (!g.firstDue && j.statutoryDueOn) g.firstDue = j.statutoryDueOn;
    if (!g.note && j.dueNote) g.note = j.dueNote;
    groups.set(key, g);
  }
  return [...groups.values()];
}
