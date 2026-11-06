// /admin/firm-os/turia-sync: what the page shows, and the three mapping saves (people, clients,
// rules). Every save is checked here (who may, what is valid) and recorded with logAudit. Routes:
// src/app/api/firm-os/turia-sync/**. Nothing here talks to Turia.
import type { FirmService } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { z } from "zod";
import type { SessionUser } from "@/lib/access";
import { logAudit } from "@/lib/audit/log";
import { formatDateTimeIst } from "@/lib/agents/core/format";
import { canManageTuriaSync } from "@/lib/rbac/policy";
import { firmOsEnabled } from "@/lib/workspace/flag";
import { SERVICE_LABELS } from "../adapter";
import { PULL_LIMITS, turiaPullMode, type PullMode } from "./config";
import { FREQUENCIES } from "./period";
import { ensureSeedRules, loadRules, type PreviewItem, type PullCounts } from "./sync";
import { AGENT_SERVICES, parsePattern, SEED_RULES, type RuleRow } from "./rules";

type Env = Record<string, string | undefined>;

export type TuriaAdminDb = Pick<typeof prisma, "turiaPersonLink" | "turiaClientLink" | "turiaTaskRule" | "turiaPullRun" | "user" | "client" | "jobTask" | "auditEvent">;

export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export const MANAGERS_ONLY = "Only an active admin or partner can change the Turia sync. Ask one of them.";
const PERSON_GONE = "That Turia person wasn't found. Reload the page and try again.";
const USER_GONE = "That person wasn't found or is no longer active. Reload the page and pick someone else.";
const CLIENT_LINK_GONE = "That Turia client wasn't found. Reload the page and try again.";
const CLIENT_GONE = "That client wasn't found in the client list. Reload the page and pick it again.";
const CLIENT_PICK_NEEDED = "Choose the client to link, then save.";
const RULE_GONE = "That rule wasn't found. Reload the page and try again.";
const PATTERN_EMPTY = "Enter at least one word to look for in the Turia task name.";

const SERVICES = Object.keys(SERVICE_LABELS) as [FirmService, ...FirmService[]];

export const personPickZ = z.object({ turiaUserId: z.string().min(1).max(64), userId: z.string().min(1).max(64).nullable() }).strict();
export const clientPickZ = z
  .object({ key: z.string().min(1).max(200), action: z.enum(["link", "ignore", "auto"]), lmsClientId: z.string().min(1).max(64).nullable().optional() })
  .strict();
export const ruleZ = z
  .object({
    id: z.string().min(1).max(64).optional(),
    position: z.number().int().min(1, "Enter an order number of 1 or more.").max(10_000, "Enter an order number up to 10,000."),
    label: z.string().trim().min(1, "Give the rule a name.").max(80, "Keep the rule name to 80 characters."),
    department: z.string().trim().max(200, "Keep the department words to 200 characters.").nullable(),
    namePattern: z.string().trim().min(1, PATTERN_EMPTY).max(300, "Keep the task name words to 300 characters."),
    service: z.enum(SERVICES),
    title: z.string().trim().min(1, "Enter the job title, for example GSTR-3B.").max(80, "Keep the job title to 80 characters."),
    frequency: z.enum(FREQUENCIES as unknown as ["MONTHLY", "QUARTERLY", "ANNUAL"]),
    useAgent: z.boolean(),
    calendarRuleId: z.string().trim().max(40, "Keep the calendar rule to 40 characters.").nullable(),
    active: z.boolean(),
  })
  .strict();

const forbidden = <T,>(): AdminResult<T> => ({ ok: false, status: 403, error: MANAGERS_ONLY });

/** Pick an LMS user for a Turia person (kept over automatic matching), or go back to automatic (userId null). */
export async function savePersonLink(db: TuriaAdminDb, actor: SessionUser, input: z.infer<typeof personPickZ>): Promise<AdminResult<{ turiaUserId: string; userId: string | null }>> {
  if (!canManageTuriaSync(actor) || !actor) return forbidden();
  const link = await db.turiaPersonLink.findUnique({ where: { turiaUserId: input.turiaUserId } });
  if (!link) return { ok: false, status: 404, error: PERSON_GONE };
  if (input.userId) {
    const u = await db.user.findFirst({ where: { id: input.userId, active: true }, select: { id: true } });
    if (!u) return { ok: false, status: 400, error: USER_GONE };
  }
  const saved = await db.turiaPersonLink.update({
    where: { turiaUserId: input.turiaUserId },
    data: { userId: input.userId, matchedBy: input.userId ? "manual" : "none", updatedById: actor.id },
  });
  await logAudit(db, {
    actorId: actor.id,
    action: "turia-pull.person-link",
    entity: "TuriaPersonLink",
    entityId: input.turiaUserId,
    meta: { from: link.userId, to: input.userId, matchedBy: saved.matchedBy },
  });
  return { ok: true, data: { turiaUserId: saved.turiaUserId, userId: saved.userId } };
}

/** Link a Turia client to an LMS client, ignore it, or go back to automatic matching. */
export async function saveClientLink(db: TuriaAdminDb, actor: SessionUser, input: z.infer<typeof clientPickZ>): Promise<AdminResult<{ key: string; status: string }>> {
  if (!canManageTuriaSync(actor) || !actor) return forbidden();
  const link = await db.turiaClientLink.findUnique({ where: { key: input.key } });
  if (!link) return { ok: false, status: 404, error: CLIENT_LINK_GONE };
  let data: { status: string; lmsClientId: string | null; firmClientId: string | null };
  if (input.action === "link") {
    if (!input.lmsClientId) return { ok: false, status: 400, error: CLIENT_PICK_NEEDED };
    const c = await db.client.findUnique({ where: { id: input.lmsClientId }, select: { id: true, firmClient: { select: { id: true } } } });
    if (!c) return { ok: false, status: 400, error: CLIENT_GONE };
    data = { status: "manual", lmsClientId: c.id, firmClientId: c.firmClient?.id ?? null };
  } else if (input.action === "ignore") {
    data = { status: "ignored", lmsClientId: null, firmClientId: null };
  } else {
    data = { status: "unmatched", lmsClientId: null, firmClientId: null };
  }
  const saved = await db.turiaClientLink.update({ where: { key: input.key }, data: { ...data, updatedById: actor.id } });
  await logAudit(db, {
    actorId: actor.id,
    action: "turia-pull.client-link",
    entity: "TuriaClientLink",
    entityId: input.key,
    meta: { action: input.action, from: { status: link.status, lmsClientId: link.lmsClientId }, to: { status: saved.status, lmsClientId: saved.lmsClientId } },
  });
  return { ok: true, data: { key: saved.key, status: saved.status } };
}

/** Add a rule, or change one (switching it off is `active: false`; rules are never removed). */
export async function saveRule(db: TuriaAdminDb, actor: SessionUser, input: z.infer<typeof ruleZ>): Promise<AdminResult<{ id: string }>> {
  if (!canManageTuriaSync(actor) || !actor) return forbidden();
  if (parsePattern(input.namePattern).length === 0) return { ok: false, status: 400, error: PATTERN_EMPTY };
  await ensureSeedRules(db);
  const data = {
    position: input.position,
    label: input.label,
    department: input.department?.trim() ? input.department.trim() : null,
    namePattern: input.namePattern,
    service: input.service,
    title: input.title,
    frequency: input.frequency,
    useAgent: input.useAgent,
    calendarRuleId: input.calendarRuleId?.trim() ? input.calendarRuleId.trim() : null,
    active: input.active,
    updatedById: actor.id,
  };
  let id: string;
  let before: unknown = null;
  if (input.id) {
    const existing = await db.turiaTaskRule.findUnique({ where: { id: input.id } });
    if (!existing) return { ok: false, status: 404, error: RULE_GONE };
    before = { label: existing.label, namePattern: existing.namePattern, department: existing.department, service: existing.service, title: existing.title, frequency: existing.frequency, useAgent: existing.useAgent, active: existing.active, position: existing.position };
    id = (await db.turiaTaskRule.update({ where: { id: input.id }, data, select: { id: true } })).id;
  } else {
    id = (await db.turiaTaskRule.create({ data, select: { id: true } })).id;
  }
  await logAudit(db, {
    actorId: actor.id,
    action: input.id ? "turia-pull.rule-change" : "turia-pull.rule-add",
    entity: "TuriaTaskRule",
    entityId: id,
    meta: { before, after: { label: data.label, namePattern: data.namePattern, department: data.department, service: data.service, title: data.title, frequency: data.frequency, useAgent: data.useAgent, active: data.active, position: data.position } },
  });
  return { ok: true, data: { id } };
}

// ------------------------------------------------------------------ page data

export type RunView = {
  id: string;
  when: string;
  mode: string;
  trigger: string;
  status: string;
  message: string;
  complete: boolean;
  counts: Partial<PullCounts>;
  preview: PreviewItem[];
};

export type TuriaSyncPage = {
  firmOsOn: boolean;
  mode: PullMode;
  modeValid: boolean;
  session: { present: boolean; when: string | null; fresh: boolean };
  lastRun: RunView | null;
  recentRuns: Pick<RunView, "id" | "when" | "mode" | "trigger" | "status">[];
  people: { turiaUserId: string; turiaName: string; turiaEmail: string | null; userId: string | null; userName: string | null; matchedBy: string }[];
  users: { id: string; name: string }[];
  clients: { key: string; turiaName: string; turiaCode: string | null; status: string; lmsClientId: string | null; lmsClientName: string | null; firmOs: boolean }[];
  lmsClients: { id: string; name: string }[];
  rules: (RuleRow & { serviceLabel: string; hasAgent: boolean })[];
  rulesSaved: boolean;
  jobs: { fromTuria: number; flagged: number };
};

const toRunView = (r: { id: string; startedAt: Date; mode: string; trigger: string; status: string; message: string | null; complete: boolean; counts: unknown; preview: unknown }): RunView => ({
  id: r.id,
  when: `${formatDateTimeIst(r.startedAt)} IST`,
  mode: r.mode,
  trigger: r.trigger,
  status: r.status,
  message: r.message ?? "",
  complete: r.complete,
  counts: (r.counts ?? {}) as Partial<PullCounts>,
  preview: Array.isArray(r.preview) ? (r.preview as PreviewItem[]) : [],
});

export async function loadTuriaSyncPage(
  db: TuriaAdminDb,
  session: { present: boolean; updatedAt: Date | null },
  now: Date,
  env: Env = process.env,
): Promise<TuriaSyncPage> {
  const { mode, valid } = turiaPullMode(env);
  const [runs, personLinks, users, clientLinks, lmsClients, savedRules, fromTuria, flagged] = await Promise.all([
    db.turiaPullRun.findMany({ orderBy: { startedAt: "desc" }, take: 6 }),
    db.turiaPersonLink.findMany({ orderBy: { turiaName: "asc" } }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
    db.turiaClientLink.findMany({ orderBy: { turiaName: "asc" } }),
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, firmClient: { select: { id: true } } } }),
    loadRules(db),
    db.jobTask.count({ where: { source: "turia" } }),
    db.jobTask.count({ where: { turiaMissingAt: { not: null } } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const clientName = new Map(lmsClients.map((c) => [c.id, c]));
  const rules: RuleRow[] = savedRules.length ? savedRules : SEED_RULES.map((s) => ({ ...s, active: true }));
  const unmatchedFirst = <T,>(rows: T[], unmatched: (r: T) => boolean) => [...rows.filter(unmatched), ...rows.filter((r) => !unmatched(r))];
  return {
    firmOsOn: firmOsEnabled(env),
    mode,
    modeValid: valid,
    session: {
      present: session.present,
      when: session.updatedAt ? `${formatDateTimeIst(session.updatedAt)} IST` : null,
      fresh: !!session.updatedAt && now.getTime() - session.updatedAt.getTime() <= PULL_LIMITS.freshSessionMs,
    },
    lastRun: runs[0] ? toRunView(runs[0]) : null,
    recentRuns: runs.slice(0, 6).map((r) => {
      const v = toRunView(r);
      return { id: v.id, when: v.when, mode: v.mode, trigger: v.trigger, status: v.status };
    }),
    people: unmatchedFirst(
      personLinks.map((p) => ({ turiaUserId: p.turiaUserId, turiaName: p.turiaName, turiaEmail: p.turiaEmail, userId: p.userId, userName: p.userId ? (userName.get(p.userId) ?? null) : null, matchedBy: p.matchedBy })),
      (p) => !p.userId,
    ),
    users: users.map((u) => ({ id: u.id, name: u.name ?? u.email })),
    clients: unmatchedFirst(
      clientLinks.map((c) => ({
        key: c.key,
        turiaName: c.turiaName,
        turiaCode: c.turiaCode,
        status: c.status,
        lmsClientId: c.lmsClientId,
        lmsClientName: c.lmsClientId ? (clientName.get(c.lmsClientId)?.name ?? null) : null,
        firmOs: !!c.firmClientId || (!!c.lmsClientId && !!clientName.get(c.lmsClientId)?.firmClient),
      })),
      (c) => c.status === "unmatched",
    ),
    lmsClients: lmsClients.map((c) => ({ id: c.id, name: c.name })),
    rules: rules.map((r) => ({ ...r, serviceLabel: SERVICE_LABELS[r.service], hasAgent: r.useAgent && AGENT_SERVICES.includes(r.service) })),
    rulesSaved: savedRules.length > 0,
    jobs: { fromTuria, flagged },
  };
}
