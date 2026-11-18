// Loading what Firm OS holds about the principals a request matched, and working out which
// retention duties (policy.ts) are still in force for them. Read-only.
import { fyFor } from "@/lib/clients/core";
import { normName } from "@/lib/integrations/turia/pull/normalise";
import { liveText, type ClientScope, type PrivacyReadDb, type Row, type Scope, type StaffScope, type TuriaClientRefs, type TuriaStaffRefs } from "./inventory";
import { DUTY_SERVICES, RETENTION_DUTIES, addMonthsIst, fyEnd, type DutyId, type PrincipalType } from "./policy";

export type MatchRef = { principalType: PrincipalType; ref: string };

export interface ScopeOptions {
  /** Key of the erased Turia keys (the privacy register's hash key; production: AUTH_SECRET). */
  hashKey?: string;
}

export async function loadScopes(db: PrivacyReadDb, matches: readonly MatchRef[], opts: ScopeOptions = {}): Promise<Scope[]> {
  const scopes: Scope[] = [];
  for (const m of matches) {
    if (m.principalType === "staff") {
      const user = await db.user.findUnique({ where: { id: m.ref } });
      if (user) scopes.push({ kind: "staff", user, turia: await turiaStaffRefs(db, user), hashKey: opts.hashKey } satisfies StaffScope);
      continue;
    }
    const client = await db.client.findUnique({ where: { id: m.ref } });
    if (!client) continue;
    const firmClient = await db.firmClient.findFirst({ where: { lmsClientId: client.id } });
    const jobTasks = firmClient ? await db.jobTask.findMany({ where: { firmClientId: firmClient.id }, orderBy: { createdAt: "asc" } }) : [];
    const engagements = firmClient ? await db.engagement.findMany({ where: { firmClientId: firmClient.id }, orderBy: { createdAt: "asc" } }) : [];
    const jobs = await db.job.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } });
    // A company's contact person is not in Turia's task list (it names the company): nothing there is theirs.
    const turia = m.principalType === "client-person" ? await turiaClientRefs(db, client, firmClient) : { keys: [], names: [] };
    scopes.push({ kind: "client", principalType: m.principalType, client, firmClient, jobTasks, jobs, engagements, turia, hashKey: opts.hashKey } satisfies ClientScope);
  }
  return scopes;
}

/**
 * The Turia client keys that are this client's (inventory.ts TuriaClientRefs), the way the pull
 * matches (src/lib/integrations/turia/pull/match.ts): a link to the client record; else Turia's
 * client code equal to the FirmClient code; else the exact normalised name, only when no other client
 * has it. A key whose link points at another client, or that an admin set to ignore, is never taken
 * (the single-principal rule).
 */
export async function turiaClientRefs(db: PrivacyReadDb, client: Row, firmClient: Row | null): Promise<TuriaClientRefs> {
  const linked = await db.turiaClientLink.findMany({ where: { lmsClientId: String(client.id) } });
  const candidates = new Set<string>();
  const code = typeof firmClient?.clientCode === "string" ? firmClient.clientCode : null;
  if (code) for (const r of await db.turiaTaskMirror.findMany({ where: { clientCode: code }, select: { clientKey: true } })) candidates.add(r.clientKey);
  const name = liveText(client.name);
  const key = name ? normName(name) : "";
  if (key) {
    const others = (await db.client.findMany({ where: { id: { not: String(client.id) } }, select: { name: true } })).some((c) => normName(c.name) === key);
    if (!others) candidates.add(key);
  }
  const ownKeys = new Set(linked.map((l) => l.key));
  const open = [...candidates].filter((k) => k && !ownKeys.has(k));
  const theirLinks = open.length ? await db.turiaClientLink.findMany({ where: { key: { in: open } } }) : [];
  const taken = new Set(theirLinks.filter((l) => (l.lmsClientId && l.lmsClientId !== client.id) || (!l.lmsClientId && l.status === "ignored")).map((l) => l.key));
  // Only keys the pull actually holds something under (a link or a mirrored task).
  const held = new Set(theirLinks.map((l) => l.key));
  const unheld = open.filter((k) => !held.has(k));
  if (unheld.length) for (const r of await db.turiaTaskMirror.findMany({ where: { clientKey: { in: unheld } }, select: { clientKey: true } })) held.add(r.clientKey);
  const keys = [...ownKeys, ...open.filter((k) => held.has(k) && !taken.has(k))].sort();
  const names = new Set<string>();
  for (const l of [...linked, ...theirLinks]) if (keys.includes(l.key) && liveText(l.turiaName)) names.add(l.turiaName.trim());
  if (keys.length) for (const r of await db.turiaTaskMirror.findMany({ where: { clientKey: { in: keys } }, select: { clientName: true } })) if (liveText(r.clientName)) names.add(r.clientName.trim());
  return { keys, names: [...names].sort() };
}

/** The person's Turia users, and the Turia names and emails no other person's link shares. */
export async function turiaStaffRefs(db: PrivacyReadDb, user: Row): Promise<TuriaStaffRefs> {
  const links = await db.turiaPersonLink.findMany({ where: { userId: String(user.id) }, orderBy: { turiaUserId: "asc" } });
  const names = [...new Set(links.map((l) => liveText(l.turiaName)).filter((n): n is string => !!n))];
  const sharing = names.length ? await db.turiaPersonLink.findMany({ where: { OR: names.map((n) => ({ turiaName: { equals: n, mode: "insensitive" as const } })) }, select: { turiaName: true, userId: true } }) : [];
  const shared = new Set(sharing.filter((l) => l.userId !== user.id).map((l) => l.turiaName.trim().toLowerCase()));
  const lmsName = liveText(user.name);
  const nameShared = lmsName ? (await db.user.findMany({ where: { id: { not: String(user.id) }, name: { equals: lmsName, mode: "insensitive" } }, select: { id: true }, take: 1 })).length > 0 : false;
  return {
    ids: links.map((l) => l.turiaUserId),
    names: names.filter((n) => !shared.has(n.toLowerCase())),
    emails: [...new Set(links.map((l) => liveText(l.turiaEmail)).filter((e): e is string => !!e))],
    nameShared,
  };
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

/**
 * Created-at dates of certificates and engagement letters issued for the client (ICAI records),
 * linked by the client record id (re-audit NEW-8: never by the typed name, which another entity
 * can share; name-only records are a manual check in the erasure plan).
 */
export async function attestDatesFor(db: PrivacyReadDb, client: Row): Promise<Date[]> {
  const clientId = String(client.id);
  const certs = await db.certificateIssue.findMany({ where: { clientId }, select: { createdAt: true } });
  const letters = await db.engagementLetter.findMany({ where: { clientId }, select: { createdAt: true } });
  return [...certs, ...letters].map((r) => r.createdAt);
}

export async function dutiesForScope(db: PrivacyReadDb, s: Scope, now: Date): Promise<DutyInForce[]> {
  return s.kind === "staff" ? staffDuties(s, now) : clientDuties(s, now, await attestDatesFor(db, s.client));
}
