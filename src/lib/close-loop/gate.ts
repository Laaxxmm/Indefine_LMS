// The close gate (ADR-005, orchestrator NON-NEGOTIABLE #5): the ONLY code that can move a JobTask
// to DONE. It claims the CloseGateToken minter once, at module load, and keeps it private.
//
// canClose(jobTaskId) requires ALL of:
//   (a) ≥ 1 Deliverable kind "Final" whose spPath is the job's Path A Final folder
//       (deliverablePath(code, fy, service, period, "Final")) and whose driveItemId is verified
//       live: the item exists at that folder, is the same item, size > 0, SHA-256 matches;
//   (b) a TuriaSync closeTask for the job with status CLOSED and minutesLogged > 0;
//   (c) FILED_BY_HUMAN → CLOSING has happened, the filing was confirmed by a named person, and the
//       acknowledgement reference is stored where the service has one (never checked against a portal).
// closeJob() re-reads the database facts inside one transaction, mints a token and asks the state
// machine for CLOSING → DONE as `system:close-gate`, with the evidence as JSON in the event note.
// Every attempt, passing or not, writes an AuditEvent. A refused job stays CLOSING.
import { createHash } from "node:crypto";
import type { JobTaskState } from "@prisma/client";
import { ACK_REF_REQUIRED, actorRef, registerCloseGate, type Actor } from "@/lib/agents/core/state";
import { transitionJobTask } from "@/lib/agents/core/state-db";
import { deliverablePath, isServiceFolder, type DeliverablePath } from "@/lib/integrations/sharepoint/paths";
import {
  audit,
  joinTransaction,
  loadCloseSyncs,
  loadEvents,
  loadFinalDeliverables,
  loadJob,
  toJson,
  type CloseJobRow,
  type CloseLoopDb,
  type CloseLoopTx,
  type DeliverableRow,
  type JobEventRow,
  type TuriaSyncRow,
} from "./db";
import { sha256Hex, type DeliverableRef, type DeliverableVerifier } from "./verifier";

const mint = registerCloseGate();

export const GATE_ACTOR: Actor = { kind: "system", name: "close-gate" };
export const GATE_ACTOR_REF = actorRef(GATE_ACTOR); // "system:close-gate"
export const GATE_EVIDENCE_VERSION = 1;

export interface GateDeps {
  db: CloseLoopDb;
  verifier: DeliverableVerifier;
  now?: () => Date;
}

// ------------------------------------------------------------------ evidence

export interface DeliverableEvidence {
  id: string;
  name: string;
  driveItemId: string;
  sha256: string;
  sizeBytes: number;
  path: string;
}

export interface TuriaEvidence {
  syncId: string;
  mode: string;
  turiaRef: string;
  minutesLogged: number;
  confirmedById: string | null;
  spotCheck: boolean;
}

export interface FilingEvidence {
  filedEventId: string;
  closingEventId: string;
  filedById: string;
  filedAt: string;
  ackRef: string | null;
}

/** Stored as JSON in the CLOSING → DONE JobTaskEvent note; the reconciler's backstop reads it back. */
export interface GateEvidence {
  gate: "close-gate";
  v: typeof GATE_EVIDENCE_VERSION;
  checkedAt: string;
  deliverables: DeliverableEvidence[];
  turia: TuriaEvidence;
  filing: FilingEvidence;
}

export type ReasonCode =
  | "not-found"
  | "state"
  | "filing"
  | "ack-ref"
  | "no-final"
  | "final-path"
  | "final-missing"
  | "final-moved"
  | "final-empty"
  | "final-hash"
  | "final-unverifiable"
  | "turia-missing"
  | "turia-open"
  | "turia-minutes"
  | "changed";

export interface CloseCheck {
  code: ReasonCode;
  message: string;
  deliverableId?: string;
}

export interface CanCloseResult {
  ok: boolean;
  /** Plain-language reasons, in check order; empty when ok. */
  reasons: string[];
  checks: CloseCheck[];
  /** Which ADR-005 condition is unmet (reconciler nudges use this). */
  missing: { finalFile: boolean; turiaClose: boolean; filing: boolean };
  state: JobTaskState | null;
  evidence: GateEvidence | null;
}

// ------------------------------------------------------------------ spot check

/**
 * Deterministic ~10% sample of manual Turia closes for a partner spot-check: the first 32 bits of
 * SHA-256(jobTaskId) mod 10 === 0. A selected job is flagged (evidence + AuditEvent); DONE is not held.
 */
export function isSpotCheckSelected(jobTaskId: string): boolean {
  return Number.parseInt(createHash("sha256").update(jobTaskId).digest("hex").slice(0, 8), 16) % 10 === 0;
}

// ------------------------------------------------------------------ (a) SharePoint

const normPath = (p: string) => p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
const validName = (n: string) => n.trim().length > 0 && !/[\\/]/.test(n) && n !== "." && n !== "..";

/** The job's Path A Final folder, or a reason why it cannot be built. */
export function finalFolder(job: Pick<CloseJobRow, "fy" | "service" | "period" | "firmClient">): { ok: true; folder: DeliverablePath } | { ok: false; reason: string } {
  try {
    if (!isServiceFolder(job.service)) return { ok: false, reason: `Service ${job.service} has no Path A folder` };
    return { ok: true, folder: deliverablePath(job.firmClient.clientCode, job.fy, job.service, job.period as DeliverablePath["period"], "Final") };
  } catch (e) {
    return { ok: false, reason: `The Path A Final folder cannot be built: ${(e as Error).message}` };
  }
}

/** spPath must be the Final folder itself (or that folder + the file name); never a subfolder or elsewhere. */
export function isInFinalFolder(d: Pick<DeliverableRow, "spPath" | "name">, folder: DeliverablePath): boolean {
  if (!validName(d.name)) return false;
  const sp = normPath(d.spPath);
  const want = normPath(folder.serverRelativeUrl);
  return sp === want || sp === `${want}/${d.name.toLowerCase()}`;
}

export type DeliverableCheck = { ok: true; evidence: DeliverableEvidence } | { ok: false; check: CloseCheck; unverifiable: boolean };

/** Location rule + live Graph check for one Final deliverable. Never throws. */
export async function verifyDeliverable(
  job: Pick<CloseJobRow, "fy" | "service" | "period" | "firmClient">,
  d: DeliverableRow,
  verifier: DeliverableVerifier,
): Promise<DeliverableCheck> {
  const fail = (code: ReasonCode, message: string, unverifiable = false): DeliverableCheck => ({
    ok: false,
    check: { code, message: `${d.name}: ${message}`, deliverableId: d.id },
    unverifiable,
  });
  const f = finalFolder(job);
  if (!f.ok) return fail("final-path", f.reason);
  if (!isInFinalFolder(d, f.folder)) return fail("final-path", `recorded at ${d.spPath}, not in ${f.folder.serverRelativeUrl}`);
  if (!d.driveItemId) return fail("final-missing", "no SharePoint item id recorded");

  const expectedPath = `${f.folder.path}/${d.name}`;
  const ref: DeliverableRef = { clientCode: job.firmClient.clientCode, driveId: d.driveId, driveItemId: d.driveItemId, path: expectedPath };
  try {
    const live = await verifier.getItem(ref);
    if (!live.exists) return fail("final-missing", `not found in SharePoint at ${f.folder.serverRelativeUrl}`);
    if (live.driveItemId && live.driveItemId !== d.driveItemId) return fail("final-moved", "a different file is at that path in SharePoint");
    if (!live.path || normPath(live.path) !== normPath(expectedPath)) return fail("final-moved", `the file is not inside ${f.folder.serverRelativeUrl}`);
    if (!(live.sizeBytes > 0)) return fail("final-empty", "the file in SharePoint is empty (0 bytes)");
    let sha = live.sha256;
    if (!sha) {
      const bytes = await verifier.download(ref);
      if (!bytes) return fail("final-missing", "the file could not be downloaded from SharePoint");
      sha = sha256Hex(bytes);
    }
    if (sha.toLowerCase() !== d.sha256.toLowerCase()) return fail("final-hash", "the file in SharePoint has changed (SHA-256 does not match)");
    return { ok: true, evidence: { id: d.id, name: d.name, driveItemId: d.driveItemId, sha256: d.sha256.toLowerCase(), sizeBytes: live.sizeBytes, path: expectedPath } };
  } catch (e) {
    const action = (e as { action?: string }).action;
    return fail("final-unverifiable", `SharePoint check failed: ${action ?? (e as Error).message}`, true);
  }
}

// ------------------------------------------------------------------ (b) Turia

export function checkTuria(syncs: TuriaSyncRow[]): { ok: true; sync: TuriaSyncRow } | { ok: false; check: CloseCheck } {
  const closed = syncs.filter((s) => s.status === "CLOSED");
  const good = closed.find((s) => (s.minutesLogged ?? 0) > 0 && !!s.turiaRef?.trim());
  if (good) return { ok: true, sync: good };
  if (closed.length) return { ok: false, check: { code: "turia-minutes", message: "Turia task closed but no time logged (minutes must be more than 0)" } };
  if (syncs.length) return { ok: false, check: { code: "turia-open", message: `Turia task close not confirmed yet (${syncs[0].status.toLowerCase().replace(/_/g, " ")})` } };
  return { ok: false, check: { code: "turia-missing", message: "Turia task not closed: enter the Turia task ref and minutes logged" } };
}

// ------------------------------------------------------------------ (c) filing

export function checkFiling(
  job: CloseJobRow,
  events: JobEventRow[],
): { ok: true; filed: JobEventRow; closing: JobEventRow } | { ok: false; checks: CloseCheck[] } {
  const checks: CloseCheck[] = [];
  let filedIdx = -1;
  let closingIdx = -1;
  events.forEach((e, i) => {
    if (e.toState === "FILED_BY_HUMAN" && e.fromState === "APPROVED") filedIdx = i;
    if (e.fromState === "FILED_BY_HUMAN" && e.toState === "CLOSING") closingIdx = i;
  });
  if (filedIdx < 0 || !job.filedById || !job.filedAt) checks.push({ code: "filing", message: "No filing confirmation by a named person (mark the job filed first)" });
  else if (closingIdx < filedIdx) checks.push({ code: "filing", message: "The filing has not moved to closing yet" });
  if (ACK_REF_REQUIRED[job.service] && !job.ackRef?.trim()) {
    checks.push({ code: "ack-ref", message: `${job.service} filings need the acknowledgement reference (ARN / SRN / ack no.)` });
  }
  if (checks.length) return { ok: false, checks };
  return { ok: true, filed: events[filedIdx], closing: events[closingIdx] };
}

// ------------------------------------------------------------------ canClose

function result(job: CloseJobRow | null, checks: CloseCheck[], evidence: GateEvidence | null): CanCloseResult {
  const has = (...codes: ReasonCode[]) => checks.some((c) => codes.includes(c.code));
  return {
    ok: checks.length === 0 && evidence !== null,
    reasons: checks.map((c) => c.message),
    checks,
    missing: {
      finalFile: has("no-final", "final-path", "final-missing", "final-moved", "final-empty", "final-hash", "final-unverifiable"),
      turiaClose: has("turia-missing", "turia-open", "turia-minutes"),
      filing: has("filing", "ack-ref"),
    },
    state: job?.state ?? null,
    evidence,
  };
}

/** All three ADR-005 conditions, checked live. Reads only; never throws for a failed check. */
export async function canClose(jobTaskId: string, deps: GateDeps): Promise<CanCloseResult> {
  const now = deps.now?.() ?? new Date();
  const job = await loadJob(deps.db, jobTaskId);
  if (!job) return result(null, [{ code: "not-found", message: `Job ${jobTaskId} not found` }], null);
  const [events, deliverables, syncs] = await Promise.all([
    loadEvents(deps.db, jobTaskId),
    loadFinalDeliverables(deps.db, jobTaskId),
    loadCloseSyncs(deps.db, jobTaskId),
  ]);

  const checks: CloseCheck[] = [];
  if (job.state !== "CLOSING") checks.push({ code: "state", message: `Job is ${job.state}; only a CLOSING job can be closed` });

  const filing = checkFiling(job, events);
  if (!filing.ok) checks.push(...filing.checks);

  const passing: DeliverableEvidence[] = [];
  const fileFailures: CloseCheck[] = [];
  if (deliverables.length === 0) fileFailures.push({ code: "no-final", message: "No Final deliverable recorded: copy the approved pack to the Final folder" });
  for (const d of deliverables) {
    const r = await verifyDeliverable(job, d, deps.verifier);
    if (r.ok) passing.push(r.evidence);
    else fileFailures.push(r.check);
  }
  if (passing.length === 0) checks.push(...fileFailures);

  const turia = checkTuria(syncs);
  if (!turia.ok) checks.push(turia.check);

  if (checks.length || !filing.ok || !turia.ok) return result(job, checks, null);
  const evidence: GateEvidence = {
    gate: "close-gate",
    v: GATE_EVIDENCE_VERSION,
    checkedAt: now.toISOString(),
    deliverables: passing,
    turia: {
      syncId: turia.sync.id,
      mode: turia.sync.mode,
      turiaRef: turia.sync.turiaRef!.trim(),
      minutesLogged: turia.sync.minutesLogged!,
      confirmedById: turia.sync.confirmedById,
      spotCheck: turia.sync.mode === "MANUAL" && isSpotCheckSelected(jobTaskId),
    },
    filing: {
      filedEventId: filing.filed.id,
      closingEventId: filing.closing.id,
      filedById: job.filedById!,
      filedAt: job.filedAt!.toISOString(),
      ackRef: job.ackRef?.trim() || null,
    },
  };
  return result(job, [], evidence);
}

// ------------------------------------------------------------------ evidence read-back

/** Parses a CLOSING → DONE event note; null unless it is complete, passing gate evidence. */
export function parseGateEvidence(note: string | null | undefined): GateEvidence | null {
  if (!note) return null;
  let v: unknown;
  try {
    v = JSON.parse(note);
  } catch {
    return null;
  }
  const e = v as Partial<GateEvidence> | null;
  if (!e || e.gate !== "close-gate" || e.v !== GATE_EVIDENCE_VERSION) return null;
  if (!Array.isArray(e.deliverables) || e.deliverables.length === 0) return null;
  if (!e.deliverables.every((d) => d && typeof d.id === "string" && typeof d.driveItemId === "string" && /^[0-9a-f]{64}$/.test(d.sha256 ?? "") && d.sizeBytes > 0)) return null;
  if (!e.turia || typeof e.turia.syncId !== "string" || !(e.turia.minutesLogged > 0) || !e.turia.turiaRef) return null;
  if (!e.filing || typeof e.filing.filedById !== "string" || typeof e.filing.filedEventId !== "string") return null;
  return e as GateEvidence;
}

// ------------------------------------------------------------------ closeJob

export type CloseJobResult =
  | { ok: true; state: "DONE"; eventId: string; evidence: GateEvidence; spotCheck: boolean }
  | { ok: false; state: JobTaskState | null; reasons: string[]; missing: CanCloseResult["missing"] };

const NONE_MISSING: CanCloseResult["missing"] = { finalFile: false, turiaClose: false, filing: false };

/** Re-reads the facts the evidence rests on; a non-null string means something moved. */
async function recheck(tx: CloseLoopTx, jobTaskId: string, ev: GateEvidence): Promise<string | null> {
  const job = await loadJob(tx, jobTaskId);
  if (!job || job.state !== "CLOSING") return `Job is ${job?.state ?? "missing"} now; only a CLOSING job can be closed`;
  if ((job.ackRef?.trim() || null) !== ev.filing.ackRef || job.filedById !== ev.filing.filedById) return "The filing confirmation changed while closing; try again";
  const syncs = await loadCloseSyncs(tx, jobTaskId);
  const s = syncs.find((x) => x.id === ev.turia.syncId);
  if (!s || s.status !== "CLOSED" || s.minutesLogged !== ev.turia.minutesLogged) return "The Turia close changed while closing; try again";
  const rows = await loadFinalDeliverables(tx, jobTaskId);
  for (const d of ev.deliverables) {
    const row = rows.find((r) => r.id === d.id);
    if (!row || row.sha256.toLowerCase() !== d.sha256 || row.driveItemId !== d.driveItemId) return "A Final deliverable record changed while closing; try again";
  }
  return null;
}

/**
 * Closes the job if, and only if, canClose passes. `triggeredBy` is who asked (a person or the
 * reconciler); the transition itself is always made by `system:close-gate`.
 */
export async function closeJob(jobTaskId: string, triggeredBy: Actor, deps: GateDeps): Promise<CloseJobResult> {
  const now = deps.now?.() ?? new Date();
  const actorId = actorRef(triggeredBy);
  const refuse = async (state: JobTaskState | null, reasons: string[], missing: CanCloseResult["missing"]): Promise<CloseJobResult> => {
    await audit(deps.db, { actorId, action: "close-refused", entity: "JobTask", entityId: jobTaskId, meta: { reasons, state } });
    return { ok: false, state, reasons, missing };
  };

  const check = await canClose(jobTaskId, { ...deps, now: () => now });
  if (!check.ok || !check.evidence) return refuse(check.state, check.reasons, check.missing);
  const evidence = check.evidence;

  const token = mint({ jobTaskId, now, evidence: { ...evidence } });
  const outcome = await deps.db.$transaction(async (tx): Promise<CloseJobResult> => {
    const moved = await recheck(tx, jobTaskId, evidence);
    if (moved) return { ok: false, state: (await loadJob(tx, jobTaskId))?.state ?? null, reasons: [moved], missing: NONE_MISSING };
    await tx.deliverable.updateMany({ where: { id: { in: evidence.deliverables.map((d) => d.id) } }, data: { verifiedAt: now } });
    const r = await transitionJobTask(joinTransaction(tx), jobTaskId, "DONE", GATE_ACTOR, {
      expectedState: "CLOSING",
      gateToken: token,
      note: JSON.stringify(evidence),
      now,
    });
    if (!r.ok) return { ok: false, state: "CLOSING", reasons: [r.reason], missing: NONE_MISSING };
    await audit(tx, { actorId, action: "close", entity: "JobTask", entityId: jobTaskId, meta: toJson({ eventId: r.eventId, evidence }) });
    if (evidence.turia.spotCheck) {
      await audit(tx, { actorId: GATE_ACTOR_REF, action: "spot-check-selected", entity: "TuriaSync", entityId: evidence.turia.syncId, meta: { jobTaskId } });
    }
    return { ok: true, state: "DONE", eventId: r.eventId, evidence, spotCheck: evidence.turia.spotCheck };
  });
  return outcome.ok ? outcome : refuse(outcome.state, outcome.reasons, outcome.missing);
}
