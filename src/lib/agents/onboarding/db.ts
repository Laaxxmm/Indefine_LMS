// Prisma side of onboarding: the run store, the saga store, the validation lookups and the
// calendar loader. Every write is create-if-missing or an update; nothing here removes a row.
import { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit/log";
import type { prisma } from "@/lib/prisma";
import { CalendarPackSchema, DEFAULT_CALENDAR, parseCalendarPack, type CalendarPack } from "@/lib/agents/core";
import { clientBodyZ } from "@/lib/clients/core";
import { createClientRecord, findDuplicateClient } from "@/lib/clients/service";
import type { Person } from "./people";
import type { OnboardingPlan } from "./plan";
import type { RunRecord, RunStatus, SagaStep, SagaStore } from "./saga";
import type { RunStore } from "./service";
import type { OnboardingSpec } from "./spec";
import type { ValidationPorts } from "./validators";

type Db = typeof prisma;
const json = (v: unknown) => v as Prisma.InputJsonValue;

type RunRow = Prisma.OnboardingRunGetPayload<object>;

export function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    createdById: row.createdById,
    status: row.status as RunStatus,
    spec: (row.spec ?? {}) as OnboardingSpec,
    plan: (row.plan ?? null) as OnboardingPlan | null,
    steps: (row.steps ?? null) as SagaStep[] | null,
    firmClientId: row.firmClientId,
    error: row.error,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------- people

/** Active, real people (shared mailboxes excluded) — same rule as the /clients handler picker. */
export async function listPeople(db: Db): Promise<Person[]> {
  const users = await db.user.findMany({ where: { active: true, excludedFromScoring: false }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email }));
}

// ---------------------------------------------------------------- runs

export function prismaRunStore(db: Db): RunStore {
  return {
    async create(input) {
      return toRunRecord(await db.onboardingRun.create({ data: { createdById: input.createdById, prompt: input.prompt, spec: json(input.spec), status: "DRAFT" } }));
    },
    async get(id) {
      const row = await db.onboardingRun.findUnique({ where: { id } });
      return row ? toRunRecord(row) : null;
    },
    async update(id, patch) {
      const data: Prisma.OnboardingRunUpdateInput = {};
      if (patch.spec !== undefined) data.spec = json(patch.spec);
      if (patch.plan !== undefined) data.plan = patch.plan === null ? Prisma.DbNull : json(patch.plan);
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.steps !== undefined) data.steps = json(patch.steps);
      return toRunRecord(await db.onboardingRun.update({ where: { id }, data }));
    },
  };
}

// ---------------------------------------------------------------- validation lookups

export function prismaValidationPorts(db: Db, turia: ValidationPorts["turia"]): ValidationPorts {
  return {
    async findFirmClientByCode(code) {
      const fc = await db.firmClient.findUnique({ where: { clientCode: code }, select: { lmsClientId: true, client: { select: { name: true } } } });
      return fc ? { lmsClientId: fc.lmsClientId, legalName: fc.client.name } : null;
    },
    async findLmsClient(q) {
      const or: Prisma.ClientWhereInput[] = [];
      if (q.name) or.push({ name: { equals: q.name, mode: "insensitive" } });
      if (q.pan) or.push({ pan: q.pan });
      if (!or.length) return null;
      const c = await db.client.findFirst({ where: { OR: or }, select: { id: true, name: true, firmClient: { select: { clientCode: true } } } });
      return c ? { id: c.id, name: c.name, clientCode: c.firmClient?.clientCode ?? null } : null;
    },
    async findActiveUser(id) {
      const u = await db.user.findFirst({ where: { id, active: true, excludedFromScoring: false }, select: { id: true, name: true, email: true } });
      return u ? { id: u.id, name: u.name ?? u.email } : null;
    },
    turia,
  };
}

// ---------------------------------------------------------------- saga store

/** LMS Client body for an onboarding spec, validated by the /clients schema (clientBodyZ). */
export function clientBodyFromSpec(spec: OnboardingSpec, onboardedOn: Date) {
  return clientBodyZ.parse({
    name: spec.legalName,
    entityType: spec.entityType,
    pan: spec.pan,
    gstin: spec.gstins[0] ?? "",
    cin: spec.cin ?? "",
    contactName: spec.contactName,
    contactPhone: spec.contactPhone,
    contactEmail: spec.contactEmail,
    turnover: spec.turnoverInr,
    growthGoal: spec.growthGoal ?? "MAINTAIN",
    growthNote: "Onboarded through Firm OS (/onboard).",
    onboardedOn,
    primaryHandlerId: spec.assigneeId,
  });
}

export function prismaSagaStore(db: Db, now: () => Date = () => new Date()): SagaStore {
  return {
    async getRun(id) {
      const row = await db.onboardingRun.findUnique({ where: { id } });
      return row ? toRunRecord(row) : null;
    },
    async claimRun(id, staleBefore) {
      const r = await db.onboardingRun.updateMany({
        where: { id, OR: [{ status: { in: ["CONFIRMED", "FAILED", "BLOCKED", "DONE"] } }, { status: "RUNNING", updatedAt: { lt: staleBefore } }] },
        data: { status: "RUNNING" },
      });
      return r.count === 1;
    },
    async saveRun(id, patch) {
      const data: Prisma.OnboardingRunUpdateInput = {};
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.steps !== undefined) data.steps = json(patch.steps);
      if (patch.error !== undefined) data.error = patch.error;
      if (patch.firmClientId !== undefined) data.firmClientId = patch.firmClientId;
      await db.onboardingRun.update({ where: { id }, data });
    },
    async createOrLinkClient({ spec, plan, actorId }) {
      return db.$transaction(async (tx) => {
        const existing = await tx.firmClient.findUnique({ where: { clientCode: spec.clientCode }, include: { client: { select: { name: true, pan: true } } } });
        if (existing) {
          const same = existing.client.name.toLowerCase() === spec.legalName.toLowerCase() || (!!spec.pan && existing.client.pan === spec.pan);
          if (!same) throw new Error(`Client code ${spec.clientCode} is already used by ${existing.client.name}`);
          return { lmsClientId: existing.lmsClientId, firmClientId: existing.id, linked: true };
        }
        let lmsClientId: string | null = plan.lmsClient.action === "link" ? plan.lmsClient.existingId : null;
        let linked = !!lmsClientId;
        if (!lmsClientId) {
          const dup = await findDuplicateClient(tx, { name: spec.legalName, pan: spec.pan });
          if (dup) {
            lmsClientId = dup.id;
            linked = true;
          } else {
            lmsClientId = (await createClientRecord(tx, { client: clientBodyFromSpec(spec, now()), createdById: actorId })).id;
          }
        }
        const taken = await tx.firmClient.findUnique({ where: { lmsClientId } });
        if (taken) throw new Error(`That LMS client is already linked to Firm OS as ${taken.clientCode}`);
        const fc = await tx.firmClient.create({ data: { lmsClientId, clientCode: spec.clientCode, createdById: actorId } });
        return { lmsClientId, firmClientId: fc.id, linked };
      });
    },
    async setClientSite(firmClientId, siteUrl) {
      await db.firmClient.update({ where: { id: firmClientId }, data: { clSiteUrl: siteUrl } });
    },
    async ensureEngagements({ firmClientId, lines, people, firstPeriod }) {
      const ids: Partial<Record<(typeof lines)[number]["service"], string>> = {};
      for (const l of lines) {
        const e = await db.engagement.upsert({
          where: { firmClientId_service: { firmClientId, service: l.service } },
          create: { firmClientId, service: l.service, frequency: l.frequency, assigneeId: people.assignee.id, reviewerId: people.reviewer.id, firstPeriod },
          update: {},
        });
        ids[l.service] = e.id;
      }
      return ids;
    },
    async ensureJobTasks({ firmClientId, engagementIds, jobs, people, actorId }) {
      let created = 0;
      let existing = 0;
      for (const j of jobs) {
        const key = { firmClientId, service: j.service, fy: j.fy, period: j.period, title: j.title };
        const found = await db.jobTask.findUnique({ where: { firmClientId_service_fy_period_title: key }, select: { id: true } });
        if (found) {
          existing++;
          continue;
        }
        try {
          await db.jobTask.create({
            data: {
              ...key,
              engagementId: engagementIds[j.service] ?? null,
              state: "ASSIGNED",
              assigneeId: people.assignee.id,
              reviewerId: people.reviewer.id,
              statutoryDueOn: j.statutoryDueOn ? new Date(j.statutoryDueOn) : null,
              internalDueOn: j.internalDueOn ? new Date(j.internalDueOn) : null,
              createdById: actorId,
              events: { create: { fromState: null, toState: "ASSIGNED", actorId, note: "Created by onboarding" } },
            },
          });
          created++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") existing++;
          else throw e;
        }
      }
      return { created, existing };
    },
    async listJobTasks(firmClientId) {
      return db.jobTask.findMany({
        where: { firmClientId },
        orderBy: [{ service: "asc" }, { period: "asc" }],
        select: { id: true, service: true, title: true, fy: true, period: true, internalDueOn: true, statutoryDueOn: true },
      });
    },
    async activeUser(id) {
      const u = await db.user.findFirst({ where: { id, active: true }, select: { id: true, name: true, email: true } });
      return u ? { id: u.id, name: u.name ?? u.email } : null;
    },
    async audit(event) {
      await logAudit(db, event);
    },
  };
}

// ---------------------------------------------------------------- calendar

/**
 * The calendar used for due dates: rules from active SopPack calendars (highest version per key)
 * override DEFAULT_CALENDAR rule by rule. An invalid pack is skipped (and named in `source`)
 * rather than failing an onboarding.
 */
export async function loadCalendarPack(db: Db): Promise<{ pack: CalendarPack; source: string }> {
  const packs = await db.sopPack.findMany({
    where: { active: true, NOT: { calendar: { equals: Prisma.AnyNull } } },
    orderBy: [{ key: "asc" }, { major: "desc" }, { minor: "desc" }, { patch: "desc" }],
    select: { key: true, version: true, calendar: true, bufferDays: true },
  });
  const seen = new Set<string>();
  const rules = new Map(DEFAULT_CALENDAR.rules.map((r) => [r.id, r]));
  let stateGroups = { ...DEFAULT_CALENDAR.stateGroups };
  let bufferDays = DEFAULT_CALENDAR.bufferDays;
  const used: string[] = [];
  const skipped: string[] = [];
  for (const p of packs) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const parsed = parseCalendarPack(p.calendar);
    if (!parsed.ok) {
      skipped.push(`${p.key} ${p.version}`);
      continue;
    }
    for (const r of parsed.pack.rules) rules.set(r.id, r);
    stateGroups = { ...stateGroups, ...parsed.pack.stateGroups };
    bufferDays = p.bufferDays;
    used.push(`${p.key} ${p.version}`);
  }
  const merged = CalendarPackSchema.safeParse({ schemaVersion: 1, bufferDays, stateGroups, rules: [...rules.values()] });
  if (!merged.success) return { pack: DEFAULT_CALENDAR, source: `Statutory calendar: defaults (SopPack calendars ${used.join(", ")} conflict with each other)` };
  const pack = merged.data;
  const source = [
    used.length ? `Statutory calendar: SopPack ${used.join(", ")} over the defaults` : "Statutory calendar: defaults (no SopPack calendar yet)",
    skipped.length ? `skipped invalid ${skipped.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return { pack, source };
}

/** Store the Turia client ref a person confirmed on the FirmClient link. */
export async function setTuriaClientRef(db: Db, firmClientId: string, ref: string): Promise<void> {
  await db.firmClient.update({ where: { id: firmClientId }, data: { turiaClientRef: ref } });
}
