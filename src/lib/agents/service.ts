// Agent framework service: the one lib call behind each /api/firm-os/agents route. Every function
// takes the signed-in user, checks access (access.ts + the state machine), and returns a
// ServiceResult the route maps to JSON. Production dependencies are built lazily by
// defaultAgentDeps(); tests pass their own (memory db, recorded router, fake SharePoint).
//
// Transition hooks: after each JobTask transition this service makes (submit, request changes,
// re-run, approve) it calls `deps.afterTransition` when one is injected. The close loop
// (src/lib/close-loop) imports this module, so this module never imports the close loop: the
// routes inject the close-loop dispatcher with withCloseLoopHook() from close-loop/defaults.ts,
// the same afterTransition the /api/firm-os/jobs/[id]/state route runs. A hook only adds work;
// its failure never undoes or fails the transition.
import { randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/access";
import { actorOf, canDecideMistakes, canViewJob, reviewActions } from "@/lib/agents/access";
import { decideMistake, proposeMistake, type Decision } from "@/lib/agents/core/mistakes";
import { previewWorkbook, type WorkbookPreview } from "@/lib/agents/core/preview";
import { jobFolder, runAgent, type AnyAgent, type FirmDb, type RunOutcome, type RunnerDeps } from "@/lib/agents/core/runner";
import { transitionJobTask, type TransitionResult } from "@/lib/agents/core/state-db";
import { DOCX_MIME, XLSX_MIME } from "@/lib/agents/core/templates";
import { AGENTS, getAgent } from "@/lib/agents/registry";
import { logAudit } from "@/lib/audit/log";
import { clientDictionary, scrubFreeText } from "@/lib/corrections/mask";
import { AI_RESTRICTED_MESSAGE, isAiProcessingRestricted } from "@/lib/privacy/consent";
import { auditRead } from "@/lib/audit/reads";
import { agentRunBusyMessage, agentRunSlots, type ConcurrencyLimiter } from "@/lib/hardening/concurrency";

/** A successful transition, as transitionJobTask reports it. */
export type TransitionDone = Extract<TransitionResult, { ok: true }>;

/** Runs after a transition made by this service succeeded (production: the close-loop afterTransition). */
export type TransitionHook = (t: TransitionDone, user: SessionUser) => Promise<unknown>;

export type AgentServiceDeps = RunnerDeps & {
  agents: Readonly<Record<string, AnyAgent>>;
  afterTransition?: TransitionHook;
  /** Per-process cap on concurrent runs (default: agentRunSlots(), 2 at once + a short queue). */
  runSlots?: ConcurrencyLimiter;
};

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 403 | 404 | 409 | 502 | 503; error: string; retryAfterSec?: number };

const fail = (status: 400 | 403 | 404 | 409 | 502 | 503, error: string) => ({ ok: false as const, status, error });

/**
 * Runs `fn` (a run, or a transition + run) in an agent-run slot. When the slots and the queue are
 * full, or the wait runs out, nothing runs and the person gets 503 + Retry-After with a plain message.
 */
async function withRunSlot<T>(deps: AgentServiceDeps, fn: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  const slots = deps.runSlots ?? agentRunSlots();
  const r = await slots.run(fn);
  if (r.ok) return r.value;
  console.warn(`[agents] run refused: ${r.reason} (${slots.active} running, ${slots.waiting} waiting, max ${slots.options.max})`);
  return { ok: false, status: 503, error: agentRunBusyMessage(r, slots.options.max), retryAfterSec: r.retryAfterSec };
}

let cached: AgentServiceDeps | null = null;

/** Prisma + ModelRouter + SharePoint (app-only Graph) + ClientDocs inputs. Built on first use. */
export async function defaultAgentDeps(): Promise<AgentServiceDeps> {
  if (cached) return cached;
  const [{ prisma }, { run }, { defaultSharePointClient }, { createDeliverableStore }, { defaultInputSource }, { prismaNameDirectory }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/ai/router"),
    import("@/lib/integrations/sharepoint/factory"),
    import("@/lib/integrations/sharepoint/deliverable-store"),
    import("@/lib/agents/core/inputs"),
    import("@/lib/ai/name-directory"),
  ]);
  const client = defaultSharePointClient();
  const store = createDeliverableStore(client);
  cached = {
    db: prisma as unknown as FirmDb,
    router: { run },
    store,
    inputs: defaultInputSource(client, store),
    now: () => new Date(),
    ids: () => randomUUID(),
    // ADR-006: client-master and staff names for every run's masking dictionary.
    names: prismaNameDirectory(prisma as unknown as Parameters<typeof prismaNameDirectory>[0]),
    agents: AGENTS,
  };
  return cached;
}

// ------------------------------------------------------------------ loading

const RUN_SELECT = {
  id: true,
  agent: true,
  status: true,
  attempt: true,
  jobTaskId: true,
  jobTask: {
    select: {
      id: true,
      state: true,
      service: true,
      assigneeId: true,
      reviewerId: true,
      fy: true,
      period: true,
      firmClient: { select: { clientCode: true, lmsClientId: true, client: { select: { name: true, contactName: true, entityType: true } } } },
    },
  },
} as const;

async function loadRun(db: FirmDb, runId: string) {
  return db.agentRun.findUnique({ where: { id: runId }, select: RUN_SELECT });
}
type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

/** A note or comment as stored: the client's names and identifiers masked (ADR-006; DPDP erasure). */
function storedNote(run: LoadedRun, text: string): string {
  return scrubFreeText(text, clientDictionary(run.jobTask.firmClient?.client));
}

async function latestRunId(db: FirmDb, jobTaskId: string): Promise<string | null> {
  return (await db.agentRun.findFirst({ where: { jobTaskId }, orderBy: { startedAt: "desc" }, select: { id: true } }))?.id ?? null;
}

async function blockingFailuresOf(db: FirmDb, runId: string): Promise<number> {
  return db.checklistResult.count({ where: { agentRunId: runId, severity: "block", status: "fail" } });
}

/** The run, if the person may see it; 404 otherwise (so hidden runs do not leak). */
async function visibleRun(user: SessionUser, db: FirmDb, runId: string): Promise<ServiceResult<LoadedRun>> {
  const run = await loadRun(db, runId);
  if (!run || !canViewJob(user, run.jobTask)) return fail(404, "Run not found");
  return { ok: true, data: run };
}

function outcomeResult(out: RunOutcome): ServiceResult<{ runId: string; status: "AGENT_DONE" | "FAILED"; reason?: string }> {
  if (out.ok) return { ok: true, data: { runId: out.runId, status: "AGENT_DONE" } };
  if (out.code === "FAILED") return { ok: true, data: { runId: out.runId, status: "FAILED", reason: out.reason } };
  return fail(out.code === "NOT_FOUND" ? 404 : 409, out.reason);
}

/** Starts a run and records it (AuditEvent `agent-run` / `rerun` / `request-changes`) once a run row exists. */
async function runAndAudit(user: SessionUser, def: AnyAgent, jobTaskId: string, deps: AgentServiceDeps, action: string, notes?: string) {
  const out = await runAgent(def, jobTaskId, deps, { startedById: user?.id ?? null, ...(notes === undefined ? {} : { notes }) });
  if (out.ok || out.code === "FAILED") {
    await logAudit(deps.db, { actorId: user?.id, action, entity: "AgentRun", entityId: out.runId, meta: { agent: def.key, jobTaskId, status: out.ok ? "AGENT_DONE" : "FAILED" } });
  }
  return outcomeResult(out);
}

/** Records a JobTask transition this service made (AuditEvent on the JobTask). */
async function auditTransition(user: SessionUser, deps: AgentServiceDeps, t: TransitionDone, runId: string, extra: Record<string, unknown> = {}) {
  await logAudit(deps.db, { actorId: user?.id, action: t.edge, entity: "JobTask", entityId: t.jobTaskId, meta: { from: t.from, to: t.to, runId, eventId: t.eventId, ...extra } });
}

/** Runs the injected hook; a throwing hook is logged and swallowed (the transition stands). */
async function fireHook(deps: AgentServiceDeps, t: TransitionDone, user: SessionUser): Promise<void> {
  if (!deps.afterTransition) return;
  try {
    await deps.afterTransition(t, user);
  } catch (e) {
    console.error(`[agents] afterTransition hook failed for ${t.jobTaskId} ${t.from} → ${t.to}: ${(e as Error).message}`);
  }
}

// ------------------------------------------------------------------ actions

/** "Run agent": the assignee (or a manager/partner) starts a run on an ASSIGNED / IN_PREP job. */
export async function startAgentRun(user: SessionUser, agentKey: string, jobTaskId: string, deps: AgentServiceDeps) {
  const def = getAgent(agentKey, deps.agents);
  if (!def) return fail(404, `Unknown agent ${agentKey}`);
  const job = await deps.db.jobTask.findUnique({ where: { id: jobTaskId }, select: { id: true, state: true, service: true, assigneeId: true, reviewerId: true } });
  if (!job || !canViewJob(user, job)) return fail(404, "Job not found");
  const latest = await latestRunId(deps.db, jobTaskId);
  const actions = reviewActions(user, job, latest ? await blockingFailuresOf(deps.db, latest) : 0, deps.now());
  if (!actions.run) return fail(403, "Only the assignee, a manager or a partner can run the agent on an ASSIGNED or IN_PREP job");
  return withRunSlot(deps, () => runAndAudit(user, def, jobTaskId, deps, "agent-run"));
}

/** "Submit for review": AGENT_DONE → IN_REVIEW, on the job's latest run. */
export async function submitForReview(user: SessionUser, runId: string, deps: AgentServiceDeps): Promise<ServiceResult<{ state: "IN_REVIEW" }>> {
  const v = await visibleRun(user, deps.db, runId);
  if (!v.ok) return v;
  if ((await latestRunId(deps.db, v.data.jobTaskId)) !== runId) return fail(409, "A newer run exists for this job; open the latest run");
  const t = await transitionJobTask(deps.db, v.data.jobTaskId, "IN_REVIEW", actorOf(user)!, { expectedState: "AGENT_DONE", now: deps.now() });
  if (!t.ok) return fail(t.code === "FORBIDDEN" ? 403 : 409, t.reason);
  await auditTransition(user, deps, t, runId);
  await fireHook(deps, t, user);
  return { ok: true, data: { state: "IN_REVIEW" } };
}

/**
 * Back to IN_PREP with a note, then a new run (attempt n+1) with that note. Shared by "Request
 * changes" (from IN_REVIEW, the reviewer) and "Re-run with a note" (from AGENT_DONE, the preparer);
 * the state machine decides who may take each edge. A change request is also recorded on the old
 * run (CHANGES_REQUESTED + the reviewer's note); a re-run leaves the old run as it was.
 */
async function backToPrepAndRun(
  user: SessionUser,
  runId: string,
  note: string,
  from: "IN_REVIEW" | "AGENT_DONE",
  deps: AgentServiceDeps,
) {
  const v = await visibleRun(user, deps.db, runId);
  if (!v.ok) return v;
  const def = getAgent(v.data.agent, deps.agents);
  if (!def) return fail(404, `Unknown agent ${v.data.agent}`);
  if ((await latestRunId(deps.db, v.data.jobTaskId)) !== runId) return fail(409, "A newer run exists for this job; open the latest run");
  // DPDP: the new run would send the client's data to a model. Refuse before the job moves, so a
  // restricted client's job stays exactly where it was (src/lib/privacy/consent.ts).
  if (await isAiProcessingRestricted(deps.db, { lmsClientId: v.data.jobTask.firmClient.lmsClientId })) return fail(409, AI_RESTRICTED_MESSAGE);
  // The slot is taken before the transition, so a refused (busy) request leaves the job as it was.
  // The stored copies (event note, review note, audit) are masked; the new run gets the note as typed.
  const stored = storedNote(v.data, note);
  return withRunSlot(deps, async () => {
    const t = await transitionJobTask(deps.db, v.data.jobTaskId, "IN_PREP", actorOf(user)!, { expectedState: from, note: stored, now: deps.now() });
    if (!t.ok) return fail(t.code === "FORBIDDEN" ? 403 : t.code === "NOTE_REQUIRED" ? 400 : 409, t.reason);
    if (from === "IN_REVIEW") await deps.db.agentRun.update({ where: { id: runId }, data: { status: "CHANGES_REQUESTED", reviewNotes: stored } });
    await auditTransition(user, deps, t, runId, { note: stored });
    await fireHook(deps, t, user);
    return runAndAudit(user, def, v.data.jobTaskId, deps, "agent-run", note);
  });
}

/** "Request changes": IN_REVIEW → IN_PREP with the reviewer's note, then a new run with that note. */
export async function requestChanges(user: SessionUser, runId: string, note: string, deps: AgentServiceDeps) {
  return backToPrepAndRun(user, runId, note, "IN_REVIEW", deps);
}

/**
 * "Re-run with a note": AGENT_DONE → IN_PREP (edge `rerun-agent`: the assignee, a manager or a
 * partner, note required), then a new run with that note. The old run stays as it was, for the
 * record; the note is kept on the JobTaskEvent and on the new run.
 */
export async function rerunAgent(user: SessionUser, runId: string, note: string, deps: AgentServiceDeps) {
  return backToPrepAndRun(user, runId, note, "AGENT_DONE", deps);
}

/**
 * "Approve pack": IN_REVIEW → APPROVED, then Working → Final copies (version suffix, Final rows).
 * The injected close-loop hook runs first (onApproved copies to Final unless Final rows exist);
 * finalizeRun runs after it either way. finalizeRun is idempotent: after a hook copy it adds
 * nothing and reports the Final names; if the hook could not copy, it is the retry (502 + message).
 */
export async function approvePack(user: SessionUser, runId: string, note: string | null, deps: AgentServiceDeps): Promise<ServiceResult<{ state: "APPROVED"; final: string[] }>> {
  const v = await visibleRun(user, deps.db, runId);
  if (!v.ok) return v;
  if ((await latestRunId(deps.db, v.data.jobTaskId)) !== runId) return fail(409, "A newer run exists for this job; approve the latest run");
  const stored = note ? storedNote(v.data, note) : note;
  const t = await transitionJobTask(deps.db, v.data.jobTaskId, "APPROVED", actorOf(user)!, { expectedState: "IN_REVIEW", note: stored, now: deps.now() });
  if (!t.ok) {
    const status = t.code === "FORBIDDEN" || t.code === "SELF_APPROVAL" || t.code === "BLOCKING_FAILURES" ? 403 : t.code === "NOTE_REQUIRED" ? 400 : 409;
    return fail(status, t.reason);
  }
  await deps.db.agentRun.update({ where: { id: runId }, data: { status: "APPROVED" } });
  await auditTransition(user, deps, t, runId, stored ? { note: stored } : {});
  await fireHook(deps, t, user);
  return finalizeRun(user, runId, deps);
}

/**
 * Copies the run's Working files to Final (create-only, next free `_v{n}`) and records Final
 * Deliverable rows. Idempotent: a Working file whose bytes already have a Final row is skipped.
 * Called by approvePack, and again by the "Copy to Final" retry if SharePoint failed midway.
 */
export async function finalizeRun(user: SessionUser, runId: string, deps: AgentServiceDeps): Promise<ServiceResult<{ state: "APPROVED"; final: string[] }>> {
  const v = await visibleRun(user, deps.db, runId);
  if (!v.ok) return v;
  const job = v.data.jobTask;
  if (job.state !== "APPROVED") return fail(409, `Files go to Final only after approval; the job is ${job.state}`);
  const code = job.firmClient.clientCode;
  const where = { clientCode: code, fy: job.fy, service: job.service, period: job.period };
  const working = jobFolder(where, "Working");
  const final = jobFolder(where, "Final");
  const rows = await deps.db.deliverable.findMany({ where: { agentRunId: runId }, orderBy: { createdAt: "asc" } });
  const done = new Set(rows.filter((r) => r.kind === "Final").map((r) => r.sha256));
  const names: string[] = rows.filter((r) => r.kind === "Final").map((r) => r.name);
  const copied: string[] = [];
  try {
    for (const w of rows.filter((r) => r.kind === "Working" && !done.has(r.sha256))) {
      const driveId = w.driveId ?? (await deps.store.complianceDrive(code));
      const copy = await deps.store.copyVersioned(driveId, working.path, w.name, final.path);
      if (copy.sha256 !== w.sha256) return fail(502, `${w.name} changed in Working since the run (sha256 differs); re-run the agent`);
      await deps.db.deliverable.create({
        data: {
          jobTaskId: job.id,
          agentRunId: runId,
          kind: "Final",
          name: copy.fileName,
          spPath: final.serverRelativeUrl,
          driveId,
          driveItemId: copy.item.id,
          sha256: copy.sha256,
          // SharePoint's content fingerprint at upload: the close gate verifies from metadata, also after a restart.
          quickXorHash: copy.quickXorHash,
          cTag: copy.cTag,
          sizeBytes: copy.sizeBytes,
          version: copy.version,
          verifiedAt: deps.now(),
        },
      });
      names.push(copy.fileName);
      copied.push(copy.fileName);
    }
  } catch (e) {
    return fail(502, `Approved, but copying to Final failed: ${(e as Error).message}. Use "Copy to Final" to retry.`);
  } finally {
    // Export to the client's Final folder: one `finalize` AuditEvent naming the files this call copied
    // (none on a no-op retry). The close-loop hook, when it triggered the copy, adds its own `copy-to-final`.
    if (copied.length) await logAudit(deps.db, { actorId: user?.id, action: "finalize", entity: "AgentRun", entityId: runId, meta: { jobTaskId: job.id, files: copied } });
  }
  return { ok: true, data: { state: "APPROVED", final: names } };
}

/** A reviewer note on the run (AuditEvent, append-only). */
export async function addComment(user: SessionUser, runId: string, text: string, deps: AgentServiceDeps): Promise<ServiceResult<{ id: string }>> {
  const v = await visibleRun(user, deps.db, runId);
  if (!v.ok) return v;
  const body = text.trim();
  if (!body) return fail(400, "Write a comment first");
  const ev = await logAudit(deps.db, { actorId: user!.id, action: "comment", entity: "AgentRun", entityId: runId, meta: { text: storedNote(v.data, body) } });
  return { ok: true, data: { id: ev.id } };
}

/** Log a missed / wrong finding → MistakeLog PROPOSED. */
export async function logMistake(
  user: SessionUser,
  runId: string,
  input: { finding: string; ruleProposal: unknown; example?: unknown },
  deps: AgentServiceDeps,
): Promise<ServiceResult<{ id: string }>> {
  const v = await visibleRun(user, deps.db, runId);
  if (!v.ok) return v;
  const r = await proposeMistake({ db: deps.db, now: deps.now, agent: (k) => getAgent(k, deps.agents) }, runId, input.finding, input.ruleProposal, input.example, actorOf(user)!);
  if (r.ok) {
    await logAudit(deps.db, { actorId: user?.id, action: "propose", entity: "MistakeLog", entityId: r.data.id, meta: { runId, agent: v.data.agent } });
    return r;
  }
  return fail(r.code === "NOT_FOUND" ? 404 : r.code === "CONFLICT" ? 409 : 400, r.reason);
}

/** A partner approves or rejects a proposed rule (an SOP rule change, Phase 11 RBAC). */
export async function decideMistakeFor(user: SessionUser, id: string, decision: Decision, deps: AgentServiceDeps) {
  if (!canDecideMistakes(user)) return fail(403, "Only a partner may decide mistake rules");
  const r = await decideMistake({ db: deps.db, now: deps.now, agent: (k) => getAgent(k, deps.agents) }, id, decision, actorOf(user)!);
  if (r.ok) return r;
  return fail(r.code === "NOT_FOUND" ? 404 : r.code === "FORBIDDEN" ? 403 : r.code === "CONFLICT" ? 409 : 400, r.reason);
}

// ------------------------------------------------------------------ files

async function visibleDeliverable(user: SessionUser, deliverableId: string, deps: AgentServiceDeps) {
  const d = await deps.db.deliverable.findUnique({
    where: { id: deliverableId },
    select: {
      id: true,
      name: true,
      kind: true,
      driveId: true,
      jobTask: { select: { id: true, state: true, service: true, assigneeId: true, reviewerId: true, fy: true, period: true, firmClient: { select: { clientCode: true } } } },
    },
  });
  if (!d || !canViewJob(user, d.jobTask)) return null;
  return d;
}

export type DeliverableFile = { name: string; mimeType: string; bytes: Buffer };

/** File bytes from SharePoint for download (access-checked). */
export async function readDeliverable(user: SessionUser, deliverableId: string, deps: AgentServiceDeps): Promise<ServiceResult<DeliverableFile>> {
  const d = await visibleDeliverable(user, deliverableId, deps);
  if (!d) return fail(404, "File not found");
  const job = d.jobTask;
  const kind = d.kind === "Final" ? "Final" : "Working";
  const folder = jobFolder({ clientCode: job.firmClient.clientCode, fy: job.fy, service: job.service, period: job.period }, kind).path;
  try {
    const driveId = d.driveId ?? (await deps.store.complianceDrive(job.firmClient.clientCode));
    const bytes = await deps.store.read(driveId, folder, d.name);
    if (!bytes) return fail(404, `${d.name} is no longer in ${kind}`);
    const mimeType = d.name.endsWith(".xlsx") ? XLSX_MIME : d.name.endsWith(".docx") ? DOCX_MIME : "application/octet-stream";
    return { ok: true, data: { name: d.name, mimeType, bytes } };
  } catch (e) {
    return fail(502, `SharePoint: ${(e as Error).message}`);
  }
}

/** "Download": the file bytes (access-checked) plus an `export` AuditEvent, since the file leaves the firm's systems. */
export async function exportDeliverable(user: SessionUser, deliverableId: string, deps: AgentServiceDeps): Promise<ServiceResult<DeliverableFile>> {
  const f = await readDeliverable(user, deliverableId, deps);
  if (f.ok) await logAudit(deps.db, { actorId: user?.id, action: "export", entity: "Deliverable", entityId: deliverableId, meta: { name: f.data.name, bytes: f.data.bytes.length } });
  return f;
}

/** XLSX → sheets of display text for the review screen. DOCX has no preview (download only). */
export async function previewDeliverable(user: SessionUser, deliverableId: string, deps: AgentServiceDeps): Promise<ServiceResult<WorkbookPreview>> {
  const f = await readDeliverable(user, deliverableId, deps);
  if (!f.ok) return f;
  if (f.data.mimeType !== XLSX_MIME) return fail(400, "Preview is available for spreadsheets only; download the file instead");
  // The preview shows the file's contents on screen: a "view" (one per person per file per hour; breach runbook §2).
  await auditRead(deps.db, { actorId: user?.id, entity: "Deliverable", entityId: deliverableId, meta: { kind: "preview" }, now: deps.now() });
  try {
    return { ok: true, data: await previewWorkbook(f.data.bytes) };
  } catch (e) {
    return fail(502, `Could not read ${f.data.name}: ${(e as Error).message}`);
  }
}
