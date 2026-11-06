// The Turia -> Firm OS task sync (ADR-003 amendment, owner decision 06 Nov 2026). One run:
//
//   1. switches   FIRM_OS_ENABLED on and FIRM_OS_TURIA_PULL dry-run or on, else nothing happens
//   2. lock       one run at a time (TuriaPullLock lease; a crashed run frees it when the lease ends)
//   3. sign-in    no Turia sign-in stored -> stop with SESSION_MESSAGE, recorded on the run
//   4. people     Turia users (organizationUserListNew) -> TuriaPersonLink, matched by email / name
//   5. scan       task/list, 100 a page, a pause between pages; each task normalised to the DPDP
//                 minimum and upserted into TuriaTaskMirror by Turia id; an unchanged hash costs
//                 only lastSeenAt. A complete scan marks tasks no longer listed (missingSince)
//   6. plan       per task (plan.ts): create / link / update / record completion / flag / wait
//   7. apply      mode "on" only: JobTask, Engagement, FirmClient, TuriaSync (closeTask, mode PULL).
//                 Mode "dry-run" writes none of these and keeps the plan as the run's preview
//   8. record     TuriaPullRun (counts, preview) and one AuditEvent with counts only
//
// Turia is only read (read-client.ts allowlist). Nothing is deleted. A job's state is never moved
// here (a new job starts ASSIGNED, like onboarding's). DONE stays with the close gate: a completion
// in Turia only adds the closeTask record the gate's "Turia task closed" check reads.
import { randomUUID } from "node:crypto";
import { Prisma, type FirmService } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit/log";
import { formatDate } from "@/lib/agents/core/format";
import { firmOsEnabled, FIRM_OS_OFF_MESSAGE } from "@/lib/workspace/flag";
import { TuriaSessionError } from "@/lib/neo-centra/turia";
import { SERVICE_LABELS } from "../adapter";
import { PULL_LIMITS, pullSortColumn, turiaPullMode, type PullLimits, type PullMode } from "./config";
import { clientCodeFor, matchClient, matchPerson, type LmsClientRow } from "./match";
import { BUSY_MESSAGE, FAILED_MESSAGE, MODE_INVALID_MESSAGE, PULL_OFF_MESSAGE, SESSION_MESSAGE, TIMEOUT_MESSAGE, runResultMessage } from "./messages";
import { mirrorHash, normaliseTask, sortedByUpdateDesc, type MirrorFields, type TuriaPerson } from "./normalise";
import { FREQUENCIES, type Frequency } from "./period";
import { planTask, type ClientState, type JobChange, type JobDraft, type LinkedJob, type Plan, type StatutoryDueFn, type WaitReason } from "./plan";
import type { TuriaReader } from "./read-client";
import { SEED_RULES, type RuleRow } from "./rules";

type Env = Record<string, string | undefined>;

export type PullDb = Pick<
  typeof prisma,
  | "turiaTaskMirror"
  | "turiaPersonLink"
  | "turiaClientLink"
  | "turiaTaskRule"
  | "turiaPullRun"
  | "turiaPullLock"
  | "jobTask"
  | "engagement"
  | "firmClient"
  | "client"
  | "user"
  | "turiaSync"
  | "auditEvent"
>;

export interface PullDeps {
  db: PullDb;
  reader: TuriaReader;
  /** Is a Turia sign-in stored (Neo Centra's NeoTuriaSession)? */
  session: () => Promise<{ present: boolean; updatedAt: Date | null }>;
  env?: Env;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Statutory due date from the calendar (production: the active SopPack calendar). */
  loadStatutoryDue?: () => Promise<StatutoryDueFn>;
  limits?: Partial<PullLimits>;
}

export type PullCounts = {
  pages: number;
  fetched: number;
  unchanged: number;
  new: number;
  changed: number;
  missing: number;
  create: number;
  link: number;
  update: number;
  completed: number;
  completedNoTime: number;
  flagged: number;
  agentless: number;
  waitingClient: number;
  waitingPeople: number;
  closedInTuria: number;
  unmatchedPeople: number;
  unmatchedClients: number;
  errors: number;
};

export type PreviewItem = {
  action: "create" | "link" | "update" | "complete" | "flag" | "unflag" | "wait";
  task: string;
  client: string;
  detail: string;
};

export type PullStatus = "ok" | "partial" | "session" | "failed" | "off" | "busy";

export type PullResult = {
  status: PullStatus;
  mode: PullMode;
  runId: string | null;
  message: string;
  complete: boolean;
  counts: PullCounts;
  preview: PreviewItem[];
};

export const PULL_ACTOR = "system:turia-pull";

const emptyCounts = (): PullCounts => ({
  pages: 0, fetched: 0, unchanged: 0, new: 0, changed: 0, missing: 0, create: 0, link: 0, update: 0, completed: 0, completedNoTime: 0,
  flagged: 0, agentless: 0, waitingClient: 0, waitingPeople: 0, closedInTuria: 0, unmatchedPeople: 0, unmatchedClients: 0, errors: 0,
});

const LINKED_SELECT = {
  id: true,
  state: true,
  assigneeId: true,
  reviewerId: true,
  internalDueOn: true,
  turiaMissingAt: true,
  turiaNote: true,
  turiaTaskId: true,
  firmClientId: true,
} as const;

class PullTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PullTimeout("Turia did not answer in time")), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const people = (v: Prisma.JsonValue): TuriaPerson[] =>
  Array.isArray(v) ? (v as Array<{ id?: unknown; name?: unknown }>).filter((p) => p && typeof p.id === "string").map((p) => ({ id: String(p.id), name: String(p.name ?? "") })) : [];

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Lease-based lock: true when this holder now owns it. */
async function acquireLock(db: PullDb, holder: string, now: Date, leaseMs: number): Promise<boolean> {
  await db.turiaPullLock.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const r = await db.turiaPullLock.updateMany({
    where: { id: 1, OR: [{ holder: null }, { lockUntil: null }, { lockUntil: { lt: now } }] },
    data: { holder, lockUntil: new Date(now.getTime() + leaseMs) },
  });
  return r.count === 1;
}

async function releaseLock(db: PullDb, holder: string): Promise<void> {
  await db.turiaPullLock.updateMany({ where: { id: 1, holder }, data: { holder: null, lockUntil: null } });
}

/** Saves the seed rules once, on a database that has none. */
export async function ensureSeedRules(db: Pick<PullDb, "turiaTaskRule">): Promise<number> {
  if ((await db.turiaTaskRule.count()) > 0) return 0;
  const r = await db.turiaTaskRule.createMany({ data: SEED_RULES.map((s) => ({ ...s, active: true, seeded: true })), skipDuplicates: true });
  return r.count;
}

export async function loadRules(db: Pick<PullDb, "turiaTaskRule">): Promise<RuleRow[]> {
  const rows = await db.turiaTaskRule.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    label: r.label,
    department: r.department,
    namePattern: r.namePattern,
    service: r.service,
    title: r.title,
    frequency: (FREQUENCIES as readonly string[]).includes(r.frequency) ? (r.frequency as Frequency) : "MONTHLY",
    useAgent: r.useAgent,
    calendarRuleId: r.calendarRuleId,
    active: r.active,
  }));
}

const taskLabel = (m: Pick<MirrorFields, "identity" | "id" | "taskName">) => `${m.identity ?? m.id} · ${m.taskName}`;

const WAIT_WORDS: Record<WaitReason, string> = {
  "client-unmatched": "Waiting: the Turia client is not matched to a client in the client list. Pick it in Clients below.",
  "client-ignored": "Skipped: this Turia client is set to ignore.",
  "no-assignee": "Waiting: the task has no assignee in Turia.",
  "assignee-unmatched": "Waiting: the Turia assignee is not matched to one of the firm's users. Pick them in People below.",
  "closed-in-turia": "No job made: Turia already shows this task completed or cancelled.",
};

const AGENTLESS_WORDS: Record<NonNullable<JobDraft["agentlessWhy"]>, string> = {
  "no rule": "no agent (no rule matches)",
  "no period": "no agent (a rule matches but its period is not in the name or due date)",
  "rule without agent": "no agent (the rule says so)",
  "no agent for service": "no agent for this service yet",
};

/**
 * One sync run (see the header). Never throws for Turia or data problems: the result (and the
 * TuriaPullRun row) says what happened in a plain sentence.
 */
export async function runTuriaPull(deps: PullDeps, opts: { trigger: "cron" | "manual"; actorId: string | null }): Promise<PullResult> {
  const env = deps.env ?? process.env;
  const clock = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const L: PullLimits = { ...PULL_LIMITS, ...deps.limits };
  const counts = emptyCounts();
  const preview: PreviewItem[] = [];
  const done = (status: PullStatus, mode: PullMode, message: string, runId: string | null = null, complete = false): PullResult => ({ status, mode, runId, message, complete, counts, preview });

  if (!firmOsEnabled(env)) return done("off", "off", FIRM_OS_OFF_MESSAGE);
  const { mode, valid } = turiaPullMode(env);
  if (!valid) return done("failed", "off", MODE_INVALID_MESSAGE);
  if (mode === "off") return done("off", "off", PULL_OFF_MESSAGE);
  const apply = mode === "on";
  const { db } = deps;
  const runStart = clock();
  const deadline = runStart.getTime() + L.timeoutMs;
  const holder = randomUUID();

  if (!(await acquireLock(db, holder, runStart, L.timeoutMs + 120_000))) return done("busy", mode, BUSY_MESSAGE);

  const run = await db.turiaPullRun.create({ data: { mode, trigger: opts.trigger, startedById: opts.actorId, status: "running", startedAt: runStart }, select: { id: true } });
  const add = (item: PreviewItem) => {
    if (preview.length < L.previewMax) preview.push(item);
  };
  let status: PullStatus = "ok";
  let message = "";
  let complete = false;
  const call = <T,>(p: Promise<T>) => withTimeout(p, L.callTimeoutMs);
  const overTime = () => clock().getTime() > deadline;

  try {
    await ensureSeedRules(db);
    const sessionNow = await deps.session();
    if (!sessionNow.present) throw new TuriaSessionError("No Turia sign-in is stored.");

    // ---------------------------------------------------------------- people
    const activeUsers = await db.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true } });
    const userName = new Map(activeUsers.map((u) => [u.id, u.name ?? u.email]));
    const links = new Map((await db.turiaPersonLink.findMany()).map((l) => [l.turiaUserId, l]));
    const seenPeople = new Map<string, { name: string; email: string | null }>();
    for (const u of await call(deps.reader.orgUsers())) seenPeople.set(u.id, { name: u.name, email: u.email });

    // ---------------------------------------------------------------- scan
    const sort = pullSortColumn(env);
    const lastFull = await db.turiaPullRun.findFirst({ where: { complete: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
    const mayStopEarly = sort === "updatedon" && !!lastFull && runStart.getTime() - lastFull.startedAt.getTime() < L.fullScanEveryMs;
    const seenTasks = new Set<string>();
    let stoppedEarly = false;
    for (let page = 1; page <= L.maxPages; page++) {
      if (overTime()) throw new PullTimeout("over time");
      const rows = await call(deps.reader.taskPage(page, L.perPage, sort));
      counts.pages = page;
      if (rows.length === 0) {
        complete = true;
        break;
      }
      const fields = rows.map(normaliseTask).filter((f): f is MirrorFields => !!f && !seenTasks.has(f.id));
      for (const f of fields) seenTasks.add(f.id);
      counts.fetched += fields.length;
      const known = new Map(
        (await db.turiaTaskMirror.findMany({ where: { id: { in: fields.map((f) => f.id) } }, select: { id: true, hash: true } })).map((r) => [r.id, r.hash]),
      );
      const unchanged: string[] = [];
      for (const f of fields) {
        for (const p of [...f.assignees, ...f.reviewers]) if (!seenPeople.has(p.id)) seenPeople.set(p.id, { name: p.name, email: null });
        const hash = mirrorHash(f);
        const before = known.get(f.id);
        if (before === hash) {
          unchanged.push(f.id);
          continue;
        }
        if (before === undefined) counts.new++;
        else counts.changed++;
        const row = { ...f, assignees: json(f.assignees), reviewers: json(f.reviewers), hash, lastSeenAt: runStart, lastChangedAt: runStart, missingSince: null };
        await db.turiaTaskMirror.upsert({ where: { id: f.id }, create: row, update: row });
      }
      counts.unchanged += unchanged.length;
      if (unchanged.length) await db.turiaTaskMirror.updateMany({ where: { id: { in: unchanged } }, data: { lastSeenAt: runStart, missingSince: null } });
      if (rows.length < L.perPage) {
        complete = true;
        break;
      }
      if (mayStopEarly && unchanged.length === fields.length && sortedByUpdateDesc(rows)) {
        stoppedEarly = true;
        break;
      }
      await sleep(L.pageDelayMs);
    }
    if (complete && !stoppedEarly) {
      const r = await db.turiaTaskMirror.updateMany({ where: { lastSeenAt: { lt: runStart }, missingSince: null }, data: { missingSince: runStart } });
      counts.missing = r.count;
    }

    // ---------------------------------------------------------------- people links
    for (const [id, p] of seenPeople) {
      const link = links.get(id);
      const auto = link?.matchedBy === "manual" ? null : matchPerson(p, activeUsers);
      const next = link?.matchedBy === "manual" ? { userId: link.userId, matchedBy: "manual" } : { userId: auto?.userId ?? null, matchedBy: auto?.matchedBy ?? "none" };
      const email = p.email ?? link?.turiaEmail ?? null;
      const name = p.name || link?.turiaName || "";
      if (link && link.userId === next.userId && link.matchedBy === next.matchedBy && link.turiaName === name && link.turiaEmail === email) continue;
      const saved = await db.turiaPersonLink.upsert({
        where: { turiaUserId: id },
        create: { turiaUserId: id, turiaName: name, turiaEmail: email, userId: next.userId, matchedBy: next.matchedBy, lastSeenAt: runStart },
        update: { turiaName: name, turiaEmail: email, userId: next.userId, matchedBy: next.matchedBy, lastSeenAt: runStart },
      });
      links.set(id, saved);
    }
    const personOf = (turiaUserId: string) => {
      const u = links.get(turiaUserId)?.userId ?? null;
      return u && userName.has(u) ? u : null; // an inactive person is never given a job
    };
    counts.unmatchedPeople = [...links.values()].filter((l) => !l.userId).length;

    // ---------------------------------------------------------------- plan inputs
    const mirrors = await db.turiaTaskMirror.findMany({ where: { OR: [{ jobTaskId: { not: null } }, { lastSeenAt: { gte: runStart } }] }, orderBy: { id: "asc" } });
    const jobs = new Map(
      (await db.jobTask.findMany({ where: { turiaTaskId: { not: null } }, select: LINKED_SELECT })).map((j) => [j.turiaTaskId as string, j]),
    );
    const pullCloses = new Set(
      (await db.turiaSync.findMany({ where: { operation: "closeTask", mode: "PULL", jobTaskId: { not: null } }, select: { jobTaskId: true } })).map((s) => s.jobTaskId as string),
    );
    const rules = await loadRules(db);
    const statutoryDue = deps.loadStatutoryDue ? await deps.loadStatutoryDue().catch(() => undefined) : undefined;

    // ---------------------------------------------------------------- clients
    const clientLinks = new Map((await db.turiaClientLink.findMany()).map((l) => [l.key, l]));
    let lmsClients: LmsClientRow[] | null = null;
    const takenCodes = new Set<string>();
    const clientState = new Map<string, ClientState>();
    const resolveClient = async (m: MirrorFields): Promise<ClientState> => {
      const cached = clientState.get(m.clientKey);
      if (cached) return cached;
      if (!lmsClients) {
        lmsClients = await db.client.findMany({ select: { id: true, name: true, firmClient: { select: { id: true, clientCode: true } } } });
        for (const c of await db.firmClient.findMany({ select: { clientCode: true } })) takenCodes.add(c.clientCode);
      }
      const link = clientLinks.get(m.clientKey);
      let state: ClientState;
      let lmsId: string | null = null;
      let linkStatus: string;
      if (link?.status === "ignored") {
        state = { status: "ignored" };
        linkStatus = "ignored";
      } else {
        const manual = link?.status === "manual" && link.lmsClientId ? lmsClients.find((c) => c.id === link.lmsClientId) ?? null : null;
        const found = manual ?? (m.clientKey ? matchClient({ name: m.clientName, code: m.clientCode }, lmsClients) : null);
        linkStatus = manual ? "manual" : found ? "matched" : "unmatched";
        lmsId = found?.id ?? null;
        if (!found) state = { status: "unmatched" };
        else if (found.firmClient) state = { status: "ready", firmClientId: found.firmClient.id, clientCode: found.firmClient.clientCode };
        else {
          const code = clientCodeFor(found.name, m.clientCode, takenCodes);
          takenCodes.add(code);
          state = { status: "new", lmsClientId: found.id, clientCode: code };
        }
      }
      const firmClientId = state.status === "ready" ? state.firmClientId : null;
      if (m.clientKey && (!link || link.status !== linkStatus || link.lmsClientId !== lmsId || link.firmClientId !== firmClientId || link.turiaName !== m.clientName || link.turiaCode !== m.clientCode)) {
        const data = { turiaName: m.clientName, turiaCode: m.clientCode, lmsClientId: lmsId, firmClientId, status: linkStatus, lastSeenAt: runStart };
        clientLinks.set(m.clientKey, await db.turiaClientLink.upsert({ where: { key: m.clientKey }, create: { key: m.clientKey, ...data }, update: data }));
      }
      clientState.set(m.clientKey, state);
      return state;
    };
    /** Mode "on": a matched LMS client without a FirmClient gets one (code from Turia, else made). */
    const readyClient = async (m: MirrorFields, state: ClientState): Promise<{ firmClientId: string; clientCode: string } | null> => {
      if (state.status === "ready") return state;
      if (state.status !== "new") return null;
      let fc: { id: string; clientCode: string };
      try {
        fc = await db.firmClient.create({ data: { lmsClientId: state.lmsClientId, clientCode: state.clientCode, createdById: opts.actorId }, select: { id: true, clientCode: true } });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        const existing = await db.firmClient.findUnique({ where: { lmsClientId: state.lmsClientId }, select: { id: true, clientCode: true } });
        if (!existing) throw e;
        fc = existing;
      }
      const ready: ClientState = { status: "ready", firmClientId: fc.id, clientCode: fc.clientCode };
      clientState.set(m.clientKey, ready);
      await db.turiaClientLink.update({ where: { key: m.clientKey }, data: { firmClientId: fc.id } });
      return { firmClientId: fc.id, clientCode: fc.clientCode };
    };

    // ---------------------------------------------------------------- plan + apply
    let minuteReads = 0;
    const who = (id: string | null) => (id ? (userName.get(id) ?? "someone") : "nobody");
    const changeWords = (c: JobChange): string => {
      if (c.field === "assigneeId") return `preparer to ${who(c.to)}`;
      if (c.field === "reviewerId") return `reviewer to ${who(c.to)}`;
      if (c.field === "internalDueOn") return `due date to ${formatDate(c.to)}`;
      if (c.field === "flag") return c.to.note;
      return "the Turia flag cleared (the task is back in Turia)";
    };
    const changeData = (changes: JobChange[]): Prisma.JobTaskUpdateInput => {
      const data: Prisma.JobTaskUpdateInput = {};
      for (const c of changes) {
        if (c.field === "assigneeId") data.assigneeId = c.to;
        else if (c.field === "reviewerId") data.reviewerId = c.to;
        else if (c.field === "internalDueOn") data.internalDueOn = c.to;
        else if (c.field === "flag") {
          data.turiaMissingAt = c.to.at;
          data.turiaNote = c.to.note;
        } else {
          data.turiaMissingAt = null;
          data.turiaNote = null;
        }
      }
      return data;
    };

    for (const row of mirrors) {
      if (overTime()) throw new PullTimeout("over time");
      const m: MirrorFields & { missingSince: Date | null } = { ...row, assignees: people(row.assignees), reviewers: people(row.reviewers) };
      const hash = row.hash;
      try {
        const linked = jobs.get(m.id) ?? null;
        const job: LinkedJob | null = linked ? { ...linked, hasPullClose: pullCloses.has(linked.id) } : null;
        const client = job ? ({ status: "ignored" } as ClientState) : await resolveClient(m);
        let plan: Plan = planTask({ mirror: m, client, personOf, rules, job, statutoryDue }, runStart);
        const label = taskLabel(m);

        if (plan.kind === "wait") {
          if (plan.reason === "client-unmatched" || plan.reason === "client-ignored") counts.waitingClient++;
          else if (plan.reason === "closed-in-turia") counts.closedInTuria++;
          else counts.waitingPeople++;
          if (plan.reason !== "closed-in-turia") add({ action: "wait", task: label, client: m.clientName, detail: WAIT_WORDS[plan.reason] });
          continue;
        }

        if (plan.kind === "create") {
          const draft = plan.draft;
          const fcState = client.status === "ready" ? client : null;
          // An existing job for the same client, service, FY, period and title (e.g. from onboarding) is linked, not duplicated.
          const sameKey = fcState
            ? await db.jobTask.findUnique({
                where: { firmClientId_service_fy_period_title: { firmClientId: fcState.firmClientId, service: draft.service, fy: draft.fy, period: draft.period, title: draft.title } },
                select: LINKED_SELECT,
              })
            : null;
          if (sameKey && !sameKey.turiaTaskId) {
            const linkedJob: LinkedJob = { ...sameKey, hasPullClose: pullCloses.has(sameKey.id) };
            const after = planTask({ mirror: m, client, personOf, rules, job: linkedJob, statutoryDue }, runStart);
            counts.link++;
            add({ action: "link", task: label, client: m.clientName, detail: `${apply ? "Linked to" : "Would link to"} the existing job ${SERVICE_LABELS[draft.service]} · ${draft.title} · ${draft.period} FY ${draft.fy}.` });
            if (apply) {
              await db.jobTask.update({ where: { id: sameKey.id }, data: { turiaTaskId: m.id } });
              await db.turiaTaskMirror.update({ where: { id: m.id }, data: { jobTaskId: sameKey.id } });
            }
            plan = after;
            if (plan.kind !== "update") {
              if (apply) await db.turiaTaskMirror.update({ where: { id: m.id }, data: { appliedHash: hash } });
              continue;
            }
          } else {
            const title = sameKey ? `${draft.title} (${m.identity ?? m.id})`.slice(0, 120) : draft.title;
            counts.create++;
            if (draft.agentless) counts.agentless++;
            const reviewer = draft.reviewerId ? `, reviewer ${who(draft.reviewerId)}` : plan.reviewerUnmatched ? ", reviewer not matched yet" : "";
            const due = draft.internalDueOn ? `, due ${formatDate(draft.internalDueOn)}` : "";
            const newClient = client.status === "new" ? ` New Firm OS client code ${client.clientCode}.` : "";
            const agent = draft.agentless ? `, ${AGENTLESS_WORDS[draft.agentlessWhy ?? "no rule"]}` : "";
            add({
              action: "create",
              task: label,
              client: m.clientName,
              detail: `${apply ? "Created" : "Would create"} ${SERVICE_LABELS[draft.service]} · ${title} · ${draft.period} FY ${draft.fy} (period from the ${draft.periodFrom}) for ${who(draft.assigneeId)}${reviewer}${due}${agent}.${newClient}`,
            });
            if (!apply) continue;
            const fc = await readyClient(m, client);
            if (!fc) continue;
            const engagement = draft.agentless
              ? null
              : await db.engagement.upsert({
                  where: { firmClientId_service: { firmClientId: fc.firmClientId, service: draft.service } },
                  create: { firmClientId: fc.firmClientId, service: draft.service, frequency: draft.frequency ?? "MONTHLY", assigneeId: draft.assigneeId, reviewerId: draft.reviewerId },
                  update: {},
                  select: { id: true },
                });
            try {
              const created = await db.jobTask.create({
                data: {
                  firmClientId: fc.firmClientId,
                  engagementId: engagement?.id ?? null,
                  service: draft.service as FirmService,
                  fy: draft.fy,
                  period: draft.period,
                  title,
                  state: "ASSIGNED",
                  assigneeId: draft.assigneeId,
                  reviewerId: draft.reviewerId,
                  statutoryDueOn: draft.statutoryDueOn,
                  internalDueOn: draft.internalDueOn,
                  createdById: opts.actorId,
                  source: "turia",
                  turiaTaskId: m.id,
                  agentless: draft.agentless,
                  events: { create: { fromState: null, toState: "ASSIGNED", actorId: PULL_ACTOR, note: `Created from Turia task ${m.identity ?? m.id}` } },
                },
                select: { id: true },
              });
              await db.turiaTaskMirror.update({ where: { id: m.id }, data: { jobTaskId: created.id, appliedHash: hash } });
            } catch (e) {
              // Another run linked this Turia task first: nothing to do.
              if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
            }
            continue;
          }
        }

        if (plan.kind === "nothing") {
          if (apply && row.appliedHash !== hash) await db.turiaTaskMirror.update({ where: { id: m.id }, data: { appliedHash: hash } });
          continue;
        }

        // update: people, due date, flag; then completion
        const changes = plan.changes.filter((c) => c.field !== "flag" && c.field !== "unflag");
        const flag = plan.changes.find((c) => c.field === "flag" || c.field === "unflag");
        if (changes.length) {
          counts.update++;
          add({ action: "update", task: label, client: m.clientName, detail: `${apply ? "Changed" : "Would change"} ${changes.map(changeWords).join(", ")}.` });
        }
        if (flag) {
          counts.flagged += flag.field === "flag" ? 1 : 0;
          add({ action: flag.field === "flag" ? "flag" : "unflag", task: label, client: m.clientName, detail: changeWords(flag) });
        }
        if (apply && plan.changes.length) await db.jobTask.update({ where: { id: plan.jobId }, data: changeData(plan.changes) });

        if (plan.complete) {
          const recent = row.closeCheckedAt && runStart.getTime() - row.closeCheckedAt.getTime() < L.minuteRecheckMs;
          if (!apply) {
            counts.completed++;
            add({ action: "complete", task: label, client: m.clientName, detail: "Would record that Turia shows this task completed, with the time logged in Turia, for the closing checks." });
          } else if (!recent && minuteReads < L.maxMinuteReads) {
            minuteReads++;
            const minutes = await call(deps.reader.taskMinutes(m.id));
            await db.turiaTaskMirror.update({ where: { id: m.id }, data: { closeCheckedAt: runStart } });
            if (minutes) {
              const linkedRow = jobs.get(m.id);
              await db.turiaSync.create({
                data: {
                  jobTaskId: plan.jobId,
                  firmClientId: linkedRow?.firmClientId ?? null,
                  operation: "closeTask",
                  mode: "PULL",
                  status: "CLOSED",
                  turiaRef: m.identity ?? m.id,
                  minutesLogged: minutes,
                  evidence: json({ key: `turiaPull:closeTask:${plan.jobId}`, source: "turia-pull", turiaTaskId: m.id, completedOn: m.completedOn?.toISOString() ?? null, runId: run.id }),
                },
              });
              pullCloses.add(plan.jobId);
              counts.completed++;
              add({ action: "complete", task: label, client: m.clientName, detail: `Recorded the Turia completion with ${minutes} minutes logged. The job closes once it is filed and its Final file is in SharePoint.` });
            } else {
              counts.completedNoTime++;
              add({ action: "complete", task: label, client: m.clientName, detail: "Turia shows this task completed but has no time logged on it. Record the minutes by hand with Record Turia close." });
            }
          }
        }
        if (apply) await db.turiaTaskMirror.update({ where: { id: m.id }, data: { appliedHash: hash } });
      } catch (e) {
        if (e instanceof TuriaSessionError || e instanceof PullTimeout) throw e;
        counts.errors++;
        console.warn(`[turia-pull] task ${m.id} was not applied`, e instanceof Error ? e.name : "error");
      }
    }
    counts.unmatchedClients = [...clientLinks.values()].filter((l) => l.status === "unmatched").length;
    status = complete || stoppedEarly ? "ok" : "partial";
    message = runResultMessage({ mode, complete, fetched: counts.fetched, changed: counts.new + counts.changed });
  } catch (e) {
    if (e instanceof TuriaSessionError) {
      status = "session";
      message = SESSION_MESSAGE;
    } else if (e instanceof PullTimeout) {
      status = "partial";
      message = TIMEOUT_MESSAGE;
    } else {
      status = "failed";
      message = FAILED_MESSAGE;
      console.warn("[turia-pull] run stopped", e instanceof Error ? e.name : "error");
    }
  } finally {
    await releaseLock(db, holder).catch(() => undefined);
  }

  const finishedAt = clock();
  await db.turiaPullRun.update({ where: { id: run.id }, data: { status, message, complete, counts: json(counts), preview: json(preview), finishedAt } });
  await logAudit(db, {
    actorId: opts.actorId ?? PULL_ACTOR,
    action: "turia-pull.run",
    entity: "TuriaPullRun",
    entityId: run.id,
    meta: { mode, trigger: opts.trigger, status, complete, counts },
  });
  return done(status, mode, message, run.id, complete);
}
