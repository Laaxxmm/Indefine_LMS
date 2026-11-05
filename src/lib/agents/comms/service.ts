// Client comms drafts service (Phase 10): who may draft for which client or job, building and
// storing a CommsDraft, the /comms list and draft views, and "Open in Outlook draft". Access is
// scoped exactly as /agents is (src/lib/agents/access.ts): staff draft for clients and jobs they
// prepare or review; managers, partners and admins for every client. Drafts are only ever drafts:
// there is no send here, and the Outlook step creates a draft in the person's OWN mailbox.
// Every create writes an AuditEvent (no message text in it). DB and Graph are injected.
import { randomUUID } from "node:crypto";
import type { FirmService, JobTaskState, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { SessionUser } from "@/lib/access";
import { canSeeAllRuns, canUseAgents, canViewJob, jobScopeWhere } from "@/lib/agents/access";
import { canViewCommsDraft, commsDraftScopeWhere } from "@/lib/rbac/policy";
import { logAudit } from "@/lib/audit/log";
import { AI_RESTRICTED_MESSAGE, COMMS_RESTRICTED_MESSAGE, isAiProcessingRestricted, isCommsDraftingRestricted } from "@/lib/privacy/consent";
import { formatDateTimeIst } from "@/lib/agents/core/format";
import { addDays, istDayKey, istDayStart, parseDayKey } from "@/lib/ist";
import type { OutlookDraft, OutlookDraftInput } from "@/lib/integrations/outlook/drafts";
import { draftMessage, splitBilingual, type DraftRequest } from "./compose";
import { docChaseSuggestions } from "./doc-chase";
import type { CommsRouter } from "./drafting";
import { CommsInputError, periodLabel, type JobFacts, type TemplateInput } from "./templates";
import { COMMS_KINDS, COMMS_LANGUAGES, FIRM_NAME, FIRM_SERVICES, KIND_LABELS, LANGUAGE_LABELS, LIMITS, REMINDER_ASKS, isCommsLanguage, type CommsKind, type CommsLanguage } from "./types";

export type CommsDb = Pick<PrismaClient, "firmClient" | "jobTask" | "agentRun" | "commsDraft" | "auditEvent" | "user">;

export type CommsResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 403 | 404 | 409 | 412 | 502; error: string; connect?: string };
const fail = (status: 400 | 403 | 404 | 409 | 412 | 502, error: string, connect?: string) => ({ ok: false as const, status, error, ...(connect ? { connect } : {}) });
const ok = <T>(data: T) => ({ ok: true as const, data });

/** AuditEvent actions written by this module. */
export const COMMS_AUDIT = { create: "comms-draft-create", outlook: "comms-outlook-draft" } as const;
/** Per-draft model budget (₹): a polish and a translation with escalations stay far below it. */
export const DRAFT_MAX_COST_INR = 10;

const CLIENT_SELECT = { id: true, clientCode: true, preferredLanguage: true, client: { select: { name: true, contactName: true, contactEmail: true, primaryHandlerId: true } } } as const;
const JOB_SELECT = {
  id: true,
  service: true,
  title: true,
  period: true,
  fy: true,
  state: true,
  statutoryDueOn: true,
  filedAt: true,
  ackRef: true,
  assigneeId: true,
  reviewerId: true,
  firmClientId: true,
  firmClient: { select: CLIENT_SELECT },
} as const;

type ClientRow = { id: string; clientCode: string; preferredLanguage: string; client: { name: string; contactName: string | null; contactEmail: string | null; primaryHandlerId?: string | null } };
type JobRow = {
  id: string;
  service: FirmService;
  title: string;
  period: string;
  fy: string;
  state: JobTaskState;
  statutoryDueOn: Date | null;
  filedAt: Date | null;
  ackRef: string | null;
  assigneeId: string | null;
  reviewerId: string | null;
  firmClientId: string;
  firmClient: ClientRow;
};

const isEmail = (s: string | null | undefined): s is string => typeof s === "string" && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s.trim());
const jobFacts = (j: JobRow): JobFacts => ({ service: j.service, title: j.title, period: j.period, fy: j.fy, state: j.state, statutoryDueOn: j.statutoryDueOn, filedAt: j.filedAt, ackRef: j.ackRef });
export const jobLabel = (j: Pick<JobRow, "title" | "period" | "fy">) => `${j.title} · ${periodLabel(j.period, j.fy)}`;

// ------------------------------------------------------------------ access

/** The person may see this client: a manager / partner / admin, or on one of its jobs. */
export async function canSeeClient(db: CommsDb, user: SessionUser, firmClientId: string): Promise<boolean> {
  if (!user || !canUseAgents(user)) return false;
  if (canSeeAllRuns(user)) return true;
  return (await db.jobTask.count({ where: { AND: [jobScopeWhere(user), { firmClientId }] } })) > 0;
}

type DraftRow = { id: string; firmClientId: string; jobTaskId: string | null; kind: string; language: string; subject: string; body: string; createdById: string; outlookDraftId: string | null; createdAt: Date };

/**
 * The central rule (src/lib/rbac/policy.ts canViewCommsDraft): the author; a draft about a job
 * follows the job; a client-level draft (no job) only the client's primary handler; managers,
 * partners and admins all. A draft whose job row is gone stays with the author and managers.
 */
function canSeeDraft(user: SessionUser, d: DraftRow, job: JobRow | null, client: ClientRow | null): boolean {
  return canViewCommsDraft(user, {
    createdById: d.createdById,
    job: d.jobTaskId ? (job ?? { assigneeId: null, reviewerId: null }) : null,
    client: d.jobTaskId ? null : { primaryHandlerId: client?.client.primaryHandlerId ?? null },
  });
}

/** Firm OS clients whose LMS client the person is primary handler of (client-level drafts they may see). */
async function handledFirmClientIds(db: CommsDb, user: NonNullable<SessionUser>): Promise<string[]> {
  const rows = await db.firmClient.findMany({ where: { client: { primaryHandlerId: user.id } }, select: { id: true }, take: 5000 });
  return rows.map((r) => r.id);
}

// ------------------------------------------------------------------ the draft panel (/comms/new)

export type JobOption = { id: string; label: string; service: FirmService; state: JobTaskState; due: string | null; filed: boolean; hasAck: boolean };
export type ClientOption = { code: string; name: string };
export type DraftContext = {
  client: { id: string; code: string; name: string; contactName: string | null; contactEmail: string | null; preferredLanguage: CommsLanguage };
  job: JobOption | null;
  jobs: JobOption[];
  run: { id: string; agent: string } | null;
  suggestions: string[];
  defaults: { replyBy: string; kind: CommsKind };
};

const jobOption = (j: Pick<JobRow, "id" | "title" | "period" | "fy" | "service" | "state" | "statutoryDueOn" | "filedAt" | "ackRef">): JobOption => ({
  id: j.id,
  label: jobLabel(j),
  service: j.service,
  state: j.state,
  due: j.statutoryDueOn ? istDayKey(j.statutoryDueOn) : null,
  filed: !!j.filedAt,
  hasAck: !!j.ackRef,
});

const clientView = (c: ClientRow): DraftContext["client"] => ({
  id: c.id,
  code: c.clientCode,
  name: c.client.name,
  contactName: c.client.contactName,
  contactEmail: isEmail(c.client.contactEmail) ? c.client.contactEmail.trim() : null,
  preferredLanguage: isCommsLanguage(c.preferredLanguage) ? c.preferredLanguage : "en",
});

/** Clients the person may draft for (the /comms/new picker and the /comms filter). */
export async function listClientOptions(db: CommsDb, user: SessionUser): Promise<ClientOption[]> {
  if (!user || !canUseAgents(user)) return [];
  const rows = await db.firmClient.findMany({
    where: canSeeAllRuns(user) ? {} : { jobTasks: { some: jobScopeWhere(user) } },
    orderBy: { clientCode: "asc" },
    take: 1000,
    select: { clientCode: true, client: { select: { name: true } } },
  });
  return rows.map((r) => ({ code: r.clientCode, name: r.client.name }));
}

/** Context for the draft panel from ?run=, ?job= or ?client= (null when none is given). */
export async function loadDraftContext(db: CommsDb, user: SessionUser, q: { run?: string; job?: string; client?: string }, now: Date): Promise<CommsResult<DraftContext | null>> {
  if (!user || !canUseAgents(user)) return fail(403, "No access");
  let jobId = q.job;
  let run: DraftContext["run"] = null;
  let suggestions: string[] = [];
  if (q.run) {
    const r = await db.agentRun.findUnique({ where: { id: q.run }, select: { id: true, agent: true, jobTaskId: true, checklist: { select: { ruleId: true, status: true, message: true, evidence: true } } } });
    if (!r) return fail(404, "Agent run not found");
    jobId = r.jobTaskId;
    run = { id: r.id, agent: r.agent };
    suggestions = docChaseSuggestions(r.checklist);
  }
  let job: JobRow | null = null;
  let client: ClientRow | null = null;
  if (jobId) {
    job = (await db.jobTask.findUnique({ where: { id: jobId }, select: JOB_SELECT })) as JobRow | null;
    if (!job) return fail(404, "Job not found");
    if (!canViewJob(user, job)) return fail(403, "You can draft messages only for jobs you prepare or review");
    client = job.firmClient;
  } else if (q.client) {
    client = (await db.firmClient.findUnique({ where: { clientCode: q.client }, select: CLIENT_SELECT })) as ClientRow | null;
    if (!client) return fail(404, "Client not found");
    if (!(await canSeeClient(db, user, client.id))) return fail(403, "You can draft messages only for clients whose jobs you prepare or review");
  } else return ok(null);

  const jobs = (await db.jobTask.findMany({
    where: { AND: [jobScopeWhere(user), { firmClientId: client.id }] },
    orderBy: [{ statutoryDueOn: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { id: true, title: true, period: true, fy: true, service: true, state: true, statutoryDueOn: true, filedAt: true, ackRef: true },
  })) as Pick<JobRow, "id" | "title" | "period" | "fy" | "service" | "state" | "statutoryDueOn" | "filedAt" | "ackRef">[];
  const kind: CommsKind = suggestions.length ? "doc-chase" : job?.filedAt && job.ackRef ? "filing-completed" : job ? "status" : "query-response";
  return ok({
    client: clientView(client),
    job: job ? jobOption(job) : null,
    jobs: jobs.map(jobOption),
    run,
    suggestions,
    defaults: { replyBy: istDayKey(addDays(now, 3)), kind },
  });
}

// ------------------------------------------------------------------ create

const idZ = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");

export const CreateDraftBodyZ = z.object({
  kind: z.enum(COMMS_KINDS, { errorMap: () => ({ message: "Pick what the message is for" }) }),
  clientCode: z.string().regex(/^[A-Z0-9]{3,10}$/, "Invalid client code").optional(),
  jobId: idZ.optional(),
  runId: idZ.optional(),
  department: z.enum(FIRM_SERVICES as [FirmService, ...FirmService[]]).optional(),
  language: z.enum(COMMS_LANGUAGES).optional(),
  replyBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Reply-by date must be YYYY-MM-DD").optional(),
  items: z.array(z.string().max(LIMITS.itemChars, `Each document at most ${LIMITS.itemChars} characters`)).max(LIMITS.maxItems, `At most ${LIMITS.maxItems} documents per message`).optional(),
  ask: z.enum(REMINDER_ASKS).optional(),
  amountInr: z.number().positive("The amount must be above ₹0").max(1e12).optional(),
  topic: z.string().max(LIMITS.topicChars).optional(),
  answer: z.string().max(2000).optional(),
  clientRequestedIds: z.boolean().optional(),
});
export type CreateDraftBody = z.infer<typeof CreateDraftBodyZ>;

export type CreateDeps = { router: CommsRouter; now: Date };

function replyByOf(body: CreateDraftBody, now: Date, due: Date | null): Date | CommsResult<never> {
  const d = parseDayKey(body.replyBy);
  if (!d) return fail(400, "Give the date you need the reply by");
  if (d < istDayStart(now)) return fail(400, "The reply-by date is in the past");
  if (due && d > due) return fail(400, "The reply-by date is after the due date");
  return d;
}

export async function createDraft(db: CommsDb, user: SessionUser, raw: unknown, deps: CreateDeps): Promise<CommsResult<{ id: string; href: string }>> {
  if (!user || !canUseAgents(user)) return fail(403, "No access");
  const parsed = CreateDraftBodyZ.safeParse(raw);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const body = parsed.data;

  let jobId = body.jobId;
  let agentRunId: string | null = null;
  if (body.runId) {
    const r = await db.agentRun.findUnique({ where: { id: body.runId }, select: { id: true, jobTaskId: true } });
    if (!r) return fail(404, "Agent run not found");
    if (jobId && jobId !== r.jobTaskId) return fail(400, "The run belongs to another job");
    jobId = r.jobTaskId;
    agentRunId = r.id;
  }
  let job: JobRow | null = null;
  let client: ClientRow | null = null;
  if (jobId) {
    job = (await db.jobTask.findUnique({ where: { id: jobId }, select: JOB_SELECT })) as JobRow | null;
    if (!job) return fail(404, "Job not found");
    if (!canViewJob(user, job)) return fail(403, "You can draft messages only for jobs you prepare or review");
    client = job.firmClient;
    if (body.clientCode && body.clientCode !== client.clientCode) return fail(400, "The job belongs to another client");
  } else {
    if (body.kind !== "query-response") return fail(400, "Pick the job this message is about");
    if (!body.clientCode) return fail(400, "Pick the client");
    client = (await db.firmClient.findUnique({ where: { clientCode: body.clientCode }, select: CLIENT_SELECT })) as ClientRow | null;
    if (!client) return fail(404, "Client not found");
    if (!(await canSeeClient(db, user, client.id))) return fail(403, "You can draft messages only for clients whose jobs you prepare or review");
  }
  const department = job?.service ?? body.department;
  if (!department) return fail(400, "Pick the department this answer is about");
  // DPDP (src/lib/privacy/consent.ts): no model call and no new draft for a client who withdrew
  // consent or is under an erasure hold. Refused before anything is drafted or stored.
  if (await isAiProcessingRestricted(db, client.id)) return fail(409, AI_RESTRICTED_MESSAGE);
  if (await isCommsDraftingRestricted(db, client.id)) return fail(409, COMMS_RESTRICTED_MESSAGE);

  const people = { clientName: client.client.name, contactName: client.client.contactName, senderName: user.name ?? user.email ?? "", firmName: FIRM_NAME };
  let input: TemplateInput;
  if (body.kind === "query-response") {
    input = { ...people, kind: "query-response", topic: body.topic ?? "", answer: body.answer ?? "", job: job ? jobFacts(job) : null };
  } else {
    const jf = jobFacts(job!);
    if (body.kind === "status") input = { ...people, kind: "status", job: jf };
    else if (body.kind === "filing-completed") input = { ...people, kind: "filing-completed", job: jf, amountInr: body.amountInr ?? null };
    else {
      const by = replyByOf(body, deps.now, body.kind === "due-reminder" ? jf.statutoryDueOn : null);
      if (!(by instanceof Date)) return by;
      if (body.kind === "doc-chase") input = { ...people, kind: "doc-chase", job: jf, items: body.items ?? [], replyBy: by };
      else {
        if (!body.ask) return fail(400, "Pick what the reminder asks the client to do");
        input = { ...people, kind: "due-reminder", job: jf, ask: body.ask, replyBy: by, amountInr: body.amountInr ?? null };
      }
    }
  }
  const language: CommsLanguage = body.language ?? (isCommsLanguage(client.preferredLanguage) ? client.preferredLanguage : "en");
  const request = { ...input, department, language, clientRequestedIds: body.clientRequestedIds === true } as DraftRequest;

  const modelRunId = `comms:${randomUUID()}`;
  let result;
  try {
    result = await draftMessage(request, { router: deps.router, runId: modelRunId, maxCostInr: DRAFT_MAX_COST_INR });
  } catch (e) {
    if (e instanceof CommsInputError) return fail(e.status, e.message);
    throw e;
  }

  const draft = await db.commsDraft.create({
    data: { firmClientId: client.id, jobTaskId: job?.id ?? null, kind: body.kind, language: result.language, subject: result.stored.subject, body: result.stored.body, createdById: user.id },
    select: { id: true },
  });
  const meta: Record<string, unknown> = {
    kind: body.kind,
    language: result.language,
    requestedLanguage: result.requestedLanguage,
    department,
    firmClientId: client.id,
    jobTaskId: job?.id ?? null,
    agentRunId,
    wording: result.sources.wording,
    translation: result.sources.translation,
    notes: result.notes,
    tone: result.tone.map((t) => t.message),
    identifiers: result.identifiers.length,
    modelRunId,
    modelCalls: result.stats.modelCalls,
  };
  await logAudit(db, { actorId: user.id, action: COMMS_AUDIT.create, entity: "CommsDraft", entityId: draft.id, meta });
  return ok({ id: draft.id, href: `/comms/${draft.id}` });
}

// ------------------------------------------------------------------ list + view

export type DraftListRow = { id: string; href: string; createdAt: string; clientCode: string; clientName: string; job: string; kind: string; language: string; subject: string; inOutlook: boolean; by: string };

export async function listDrafts(db: CommsDb, user: SessionUser, filter: { client?: string; job?: string } = {}): Promise<DraftListRow[]> {
  if (!user || !canUseAgents(user)) return [];
  const and: Prisma.CommsDraftWhereInput[] = [];
  if (!canSeeAllRuns(user)) {
    const jobs = await db.jobTask.findMany({ where: jobScopeWhere(user), select: { id: true }, take: 5000 });
    and.push(commsDraftScopeWhere(user, jobs.map((j) => j.id), await handledFirmClientIds(db, user)));
  }
  if (filter.client) {
    const c = await db.firmClient.findUnique({ where: { clientCode: filter.client }, select: { id: true } });
    if (!c) return [];
    and.push({ firmClientId: c.id });
  }
  if (filter.job) and.push({ jobTaskId: filter.job });
  const drafts = (await db.commsDraft.findMany({ where: { AND: and }, orderBy: { createdAt: "desc" }, take: 200 })) as DraftRow[];
  if (!drafts.length) return [];
  const [clients, jobs, users] = await Promise.all([
    db.firmClient.findMany({ where: { id: { in: [...new Set(drafts.map((d) => d.firmClientId))] } }, select: { id: true, clientCode: true, client: { select: { name: true } } } }),
    db.jobTask.findMany({ where: { id: { in: [...new Set(drafts.map((d) => d.jobTaskId).filter((x): x is string => !!x))] } }, select: { id: true, title: true, period: true, fy: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(drafts.map((d) => d.createdById))] } }, select: { id: true, name: true, email: true } }),
  ]);
  const clientOf = new Map(clients.map((c) => [c.id, c]));
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  return drafts.map((d) => {
    const c = clientOf.get(d.firmClientId);
    const j = d.jobTaskId ? jobOf.get(d.jobTaskId) : undefined;
    return {
      id: d.id,
      href: `/comms/${d.id}`,
      createdAt: formatDateTimeIst(d.createdAt),
      clientCode: c?.clientCode ?? "—",
      clientName: c?.client.name ?? "—",
      job: j ? jobLabel(j) : "—",
      kind: KIND_LABELS[d.kind as CommsKind] ?? d.kind,
      language: LANGUAGE_LABELS[d.language as CommsLanguage] ?? d.language,
      subject: d.subject,
      inOutlook: !!d.outlookDraftId,
      by: nameOf.get(d.createdById) ?? "—",
    };
  });
}

export type DraftView = {
  id: string;
  kind: string;
  language: CommsLanguage;
  languageLabel: string;
  subject: string;
  body: string;
  translated: string | null;
  english: string;
  client: { code: string; name: string; contactEmail: string | null };
  job: { id: string; label: string } | null;
  createdAt: string;
  by: string;
  inOutlook: boolean;
  notes: string[];
  tone: string[];
};

async function loadRow(db: CommsDb, user: SessionUser, id: string): Promise<CommsResult<{ d: DraftRow; job: JobRow | null; client: ClientRow | null }>> {
  if (!user || !canUseAgents(user)) return fail(403, "No access");
  const d = (await db.commsDraft.findUnique({ where: { id } })) as DraftRow | null;
  if (!d) return fail(404, "Draft not found");
  const job = d.jobTaskId ? ((await db.jobTask.findUnique({ where: { id: d.jobTaskId }, select: JOB_SELECT })) as JobRow | null) : null;
  const client = job?.firmClient ?? ((await db.firmClient.findUnique({ where: { id: d.firmClientId }, select: CLIENT_SELECT })) as ClientRow | null);
  if (!canSeeDraft(user, d, job, client)) {
    return fail(403, "You can open a draft only if you wrote it, work on its job, or handle the client. Ask the author or a manager to share it.");
  }
  return ok({ d, job, client });
}

export async function loadDraft(db: CommsDb, user: SessionUser, id: string): Promise<CommsResult<DraftView>> {
  const r = await loadRow(db, user, id);
  if (!r.ok) return r;
  const { d, job, client } = r.data;
  const [audit, author] = await Promise.all([
    db.auditEvent.findFirst({ where: { entity: "CommsDraft", entityId: d.id, action: COMMS_AUDIT.create }, orderBy: { createdAt: "desc" }, select: { meta: true } }),
    db.user.findUnique({ where: { id: d.createdById }, select: { name: true, email: true } }),
  ]);
  const meta = (audit?.meta ?? {}) as { notes?: unknown; tone?: unknown };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const split = splitBilingual(d.body);
  const language = isCommsLanguage(d.language) ? d.language : "en";
  return ok({
    id: d.id,
    kind: KIND_LABELS[d.kind as CommsKind] ?? d.kind,
    language,
    languageLabel: LANGUAGE_LABELS[language],
    subject: d.subject,
    body: d.body,
    translated: split.translated,
    english: split.english,
    client: { code: client?.clientCode ?? "—", name: client?.client.name ?? "—", contactEmail: client && isEmail(client.client.contactEmail) ? client.client.contactEmail.trim() : null },
    job: job ? { id: job.id, label: jobLabel(job) } : null,
    createdAt: formatDateTimeIst(d.createdAt),
    by: author?.name ?? author?.email ?? "—",
    inOutlook: !!d.outlookDraftId,
    notes: strings(meta.notes),
    tone: strings(meta.tone),
  });
}

// ------------------------------------------------------------------ Outlook

export type OutlookPort = {
  create(token: string, input: OutlookDraftInput): Promise<OutlookDraft>;
  find(token: string, id: string): Promise<{ id: string; isDraft: boolean; webLink: string | null } | null>;
};

/**
 * "Open in Outlook draft": the draft's Outlook copy in the person's own mailbox — the existing one
 * while it is still a draft there, else a new one (recipient: the client's contact e-mail). Never sends.
 */
export async function openInOutlook(
  db: CommsDb,
  user: SessionUser,
  id: string,
  deps: { token: () => Promise<string | null>; outlook: OutlookPort },
): Promise<CommsResult<{ webLink: string | null; created: boolean }>> {
  const r = await loadRow(db, user, id);
  if (!r.ok) return r;
  const token = await deps.token();
  if (!token) return fail(412, "Connect your Microsoft 365 mailbox first, then open the draft again", "/connect?mail=1");
  const { d, client } = r.data;
  try {
    if (d.outlookDraftId) {
      const found = await deps.outlook.find(token, d.outlookDraftId);
      if (found?.isDraft) return ok({ webLink: found.webLink, created: false });
    }
    const to = client && isEmail(client.client.contactEmail) ? [client.client.contactEmail.trim()] : [];
    const created = await deps.outlook.create(token, { to, subject: d.subject, body: d.body, bodyType: "Text" });
    await db.commsDraft.update({ where: { id: d.id }, data: { outlookDraftId: created.id } });
    await logAudit(db, { actorId: user!.id, action: COMMS_AUDIT.outlook, entity: "CommsDraft", entityId: d.id, meta: { created: true, recipients: to.length } });
    return ok({ webLink: created.webLink, created: true });
  } catch (e) {
    const status = (e as { status?: number }).status;
    console.error("comms Outlook draft failed:", e instanceof Error ? e.message : e);
    if (status === 401 || status === 403) return fail(412, "Outlook refused the draft: reconnect your Microsoft 365 mailbox, then try again", "/connect?mail=1");
    return fail(502, "Outlook could not create the draft. Try again in a minute.");
  }
}
