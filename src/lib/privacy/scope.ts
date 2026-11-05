// Loading what Firm OS holds about the principals a request matched, and working out which
// retention duties (policy.ts) are still in force for them. Read-only.
import { fyFor } from "@/lib/clients/core";
import type { ClientScope, PrivacyReadDb, Row, Scope, StaffScope } from "./inventory";
import { DUTY_SERVICES, RETENTION_DUTIES, addMonthsIst, fyEnd, type DutyId, type PrincipalType } from "./policy";

export type MatchRef = { principalType: PrincipalType; ref: string };

export async function loadScopes(db: PrivacyReadDb, matches: readonly MatchRef[]): Promise<Scope[]> {
  const scopes: Scope[] = [];
  for (const m of matches) {
    if (m.principalType === "staff") {
      const user = await db.user.findUnique({ where: { id: m.ref } });
      if (user) scopes.push({ kind: "staff", user } satisfies StaffScope);
      continue;
    }
    const client = await db.client.findUnique({ where: { id: m.ref } });
    if (!client) continue;
    const firmClient = await db.firmClient.findFirst({ where: { lmsClientId: client.id } });
    const jobTasks = firmClient ? await db.jobTask.findMany({ where: { firmClientId: firmClient.id }, orderBy: { createdAt: "asc" } }) : [];
    const engagements = firmClient ? await db.engagement.findMany({ where: { firmClientId: firmClient.id }, orderBy: { createdAt: "asc" } }) : [];
    const jobs = await db.job.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } });
    scopes.push({ kind: "client", principalType: m.principalType, client, firmClient, jobTasks, jobs, engagements } satisfies ClientScope);
  }
  return scopes;
}

export interface DutyInForce {
  id: DutyId;
  label: string;
  /** Null: no fixed end (held while the engagement runs or the person is employed). */
  holdUntil: Date | null;
  rule: string;
  verify: string;
}

const OPEN_LEGACY_JOB = new Set(["NOT_STARTED", "IN_PROGRESS"]);
const COMPANY_TYPES = new Set(["PVT_LTD", "PUBLIC_LTD", "LLP"]);

const latestFy = (fys: string[]) => fys.filter((x) => /^\d{4}-\d{2}$/.test(x)).sort().at(-1) ?? null;

function duty(id: DutyId, holdUntil: Date | null): DutyInForce {
  const d = RETENTION_DUTIES[id];
  return { id, label: d.label, holdUntil, rule: d.rule, verify: d.verify };
}

/** Duties still in force at `now` for a client, given its work and attest records. */
export function clientDuties(s: ClientScope, now: Date, attestDates: readonly Date[] = []): DutyInForce[] {
  const out: DutyInForce[] = [];
  const active =
    s.client.active !== false &&
    (s.engagements.some((e) => e.active !== false) || s.jobTasks.some((j) => j.state !== "DONE") || s.jobs.some((j) => OPEN_LEGACY_JOB.has(String(j.status))));
  if (active) out.push(duty("active-engagement", null));

  const until = (id: DutyId, fy: string | null) => {
    const months = RETENTION_DUTIES[id].months;
    const end = fy ? fyEnd(fy) : null;
    if (!end || months === null) return;
    const holdUntil = addMonthsIst(end, months);
    if (holdUntil.getTime() > now.getTime()) out.push(duty(id, holdUntil));
  };
  for (const id of ["income-tax", "gst", "companies-act"] as const) {
    if (id === "companies-act" && !COMPANY_TYPES.has(String(s.client.entityType))) continue;
    const services = DUTY_SERVICES[id] ?? [];
    until(id, latestFy(s.jobTasks.filter((j) => services.includes(String(j.service))).map((j) => String(j.fy))));
  }
  const engagementFys = [...s.jobTasks.map((j) => String(j.fy)), ...s.jobs.map((j) => String(j.fy)), ...attestDates.map((d) => fyFor(d))];
  until("icai", latestFy(engagementFys));
  return out;
}

export function staffDuties(s: StaffScope, now: Date): DutyInForce[] {
  if (s.user.active !== false) return [duty("staff-records", null)];
  const left = (s.user.deactivatedAt as Date | null) ?? (s.user.createdAt as Date);
  const holdUntil = addMonthsIst(left, RETENTION_DUTIES["staff-records"].months ?? 0);
  return holdUntil.getTime() > now.getTime() ? [duty("staff-records", holdUntil)] : [];
}

/** Created-at dates of certificates and engagement letters issued for the client (ICAI records). */
export async function attestDatesFor(db: PrivacyReadDb, client: Row): Promise<Date[]> {
  const name = String(client.name);
  const certs = await db.certificateIssue.findMany({ where: { clientName: name }, select: { createdAt: true } });
  const letters = await db.engagementLetter.findMany({ where: { clientName: name }, select: { createdAt: true } });
  return [...certs, ...letters].map((r) => r.createdAt);
}

export async function dutiesForScope(db: PrivacyReadDb, s: Scope, now: Date): Promise<DutyInForce[]> {
  return s.kind === "staff" ? staffDuties(s, now) : clientDuties(s, now, await attestDatesFor(db, s.client));
}
