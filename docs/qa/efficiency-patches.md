# Firm OS efficiency — proposed patches

**Status 06 Nov 2026: all applied** (P3, P5, P6 by hand on the current code; P4c in the owner's
variant — a `close-refused` AuditEvent only when the refusal reasons change; the companion
extension sends `If-None-Match`). The Deliverable fingerprint (`quickXorHash`, `cTag`) is written at
upload / finalize and read by the close-gate verifier, so a restart needs no download for files the
app uploaded. Measured before/after in `docs/qa/efficiency-report.md`
("Patches applied"). The diffs below are kept as the record of what was proposed.

These touch files other agents own (views, workspace, coach, close loop, agent core, companion),
so they are written here as exact unified diffs against this branch and **not** applied. Each was
applied in the worktree, type-checked, run against its tests (updated tests are part of the diff),
measured with `scripts/efficiency-report.ts` (numbers in `docs/qa/efficiency-proposed.json`,
"after" = this branch without them in `docs/qa/efficiency-after.json`), and then reverted.
Apply with `git apply` from the repo root, one section at a time.

Firm size for every number: 200 clients, 2,000 jobs a year, 16 staff (see the report).

| # | Patch | Owner area | Measured saving | Needs a decision? |
|---|---|---|---|---|
| P1 | Mistakes admin: one pack read per version, not per row | `src/lib/agents/views.ts` | 31 → 7 queries per render (30 rows) | no |
| P2 | Focus / companion next task: pack rule count memoised per version | `src/lib/workspace/next-task.ts` | the SopPack checklist JSON (~4–25 KB) is no longer read on every render or companion poll; 2 queries in steady state (3 on the first render after a deploy) | no |
| P3 | Coach reminders: skip already-sent nudges with one read | `src/lib/agents/coach/{db,cron}.ts` | 93 → 4 queries per later 30-minute run (≈ 1,700 failed inserts a working day) | no |
| P4a | Reconciler: DONE re-check reads in two batched queries | `src/lib/close-loop/{db,reconcile}.ts`, `tests/fakes/close-loop-world.ts` | 380 → 2 queries per run for 170 DONE jobs | no |
| P4b | Reconciler: escalation recipients memoised per run | `src/lib/close-loop/reconcile.ts` | 20 → ≤ 5 user reads per run | no |
| P4c | Reconciler: check with canClose before closeJob (no `close-refused` audit per automated retry) | `src/lib/close-loop/reconcile.ts`, `reconcile.test.ts` | 20 AuditEvent inserts per run → 0: ≈ 120,000 rows / ≈ 49 MiB a year | **yes — audit trail (partner)** |
| P5 | ClientDocs inputs: one children GET (404 = empty) | `src/lib/agents/core/inputs.ts` | −1 Graph call per agent run | no |
| P6 | Runner: one createMany for the run's Working deliverables | `src/lib/agents/core/runner.ts` | GST 5 → 1 insert per run (28.15 → 24.15 DB ops per run) | no |
| P7 | Companion: lastUsedAt written at most every 10 min; weak ETag / 304 | `src/lib/companion/{tokens,http}.ts` (+ tests) | 1 write per poll → 1 per 10 min per person; unchanged task = 304 with no body | no (extension side: send `If-None-Match`, treat 304 as unchanged) |

Combined effect on the reconciler (steady state, the 30-minute run): **515 → 148 database operations,
559 → 192 SQL statements** per run (20 runs a working day), on top of the Graph saving already
merged (380 → 190 calls per run, no downloads).

P4c and P6 note: another agent is about to edit `runner.ts` (per-run name dictionary) — P6's
context lines may need a rebase. P4c re-runs canClose inside closeJob for a job that is ready (10
extra metadata GETs in run 1 of the measurement); held jobs are checked once.

---

## P1 — Mistakes admin: one pack read per version

`listMistakes` read the active pack (or a promoted version) once **per mistake row** — 30 rows, 30
SopPack queries. Pack versions are immutable, so one read per (key, version) per render is exact.

```diff
diff --git a/src/lib/agents/views.ts b/src/lib/agents/views.ts
index b1a5b2e..de26225 100644
--- a/src/lib/agents/views.ts
+++ b/src/lib/agents/views.ts
@@ -358,6 +358,13 @@ async function packJson(db: FirmDb, key: string, version?: string): Promise<Chec
 /** PROPOSED (with the diff it would make to the active pack) and decided rows (with the diff they made). */
 export async function listMistakes(db: FirmDb, user: SessionUser): Promise<{ canDecide: boolean; proposed: MistakeRow[]; decided: MistakeRow[] }> {
   const logs = await db.mistakeLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
+  // One read per pack version, not one per mistake row (packs are immutable per version).
+  const packs = new Map<string, Promise<ChecklistPack | null>>();
+  const pack = (key: string, version?: string) => {
+    const k = `${key}@${version ?? "latest"}`;
+    if (!packs.has(k)) packs.set(k, packJson(db, key, version));
+    return packs.get(k)!;
+  };
   const rows: MistakeRow[] = [];
   for (const m of logs) {
     const def = getAgent(m.agent);
@@ -366,7 +373,7 @@ export async function listMistakes(db: FirmDb, user: SessionUser): Promise<{ can
     let problem: string | null = null;
     if (def) {
       if (m.status === "PROPOSED") {
-        const current = await packJson(db, def.sopPackKey);
+        const current = await pack(def.sopPackKey);
         if (current) {
           try {
             diff = diffPacks(current, withPromotedRule(current, m.ruleProposal, m.id));
@@ -375,7 +382,7 @@ export async function listMistakes(db: FirmDb, user: SessionUser): Promise<{ can
           }
         } else problem = `No active SOP pack "${def.sopPackKey}"`;
       } else if (m.status === "APPROVED" && m.promotedToVersion) {
-        const after = await packJson(db, def.sopPackKey, m.promotedToVersion);
+        const after = await pack(def.sopPackKey, m.promotedToVersion);
         if (after) {
           const before = { ...after, rules: after.rules.filter((r) => r.origin?.mistakeLogId !== m.id) };
           diff = diffPacks(before, after);
```

## P2 — Next task: pack rule count per version

`sopFacts` (focus page, guided workspace, and every companion poll) loaded the whole SopPack
`checklist` JSON to count its rules. It now reads the version only; the rule count is kept per
`key@version` for the life of the process (versions are never edited in place). Steady state: the
same 2 queries per render without the pack JSON; the first render of a new version reads it once.

```diff
diff --git a/src/lib/workspace/next-task.ts b/src/lib/workspace/next-task.ts
index ea22cbc..c89da54 100644
--- a/src/lib/workspace/next-task.ts
+++ b/src/lib/workspace/next-task.ts
@@ -213,18 +213,27 @@ export function whyText(c: NextTaskCandidate, now: Date, rankReason: string | nu
 
 export type SopFacts = Pick<SopContext, "agentTitle" | "requiredInputs" | "packVersion" | "ruleCount">;
 
+/** Rule count per published pack version ("key@version"). Versions are immutable, so this never goes stale. */
+const RULE_COUNTS = new Map<string, number | null>();
+
 /** The agent for the service and its active SOP pack (version, rule count; built-in pack when none is published). */
 export async function sopFacts(db: FirmDb, service: FirmService, agentKey: string | null, agents: readonly AnyAgent[]): Promise<SopFacts & { agent: AnyAgent | null }> {
   const agent = (agentKey && agents.find((a) => a.key === agentKey)) || agents.find((a) => a.service === service) || null;
   if (!agent) return { agent: null, agentTitle: null, requiredInputs: [], packVersion: null, ruleCount: null };
-  const pack = await db.sopPack.findFirst({ ...latestPackQuery(agent.sopPackKey), select: { version: true, checklist: true } });
-  const parsed = ChecklistPackSchema.safeParse(pack?.checklist);
+  // The version alone first: the pack's checklist JSON is read once per version per process, not on every render.
+  const pack = await db.sopPack.findFirst({ ...latestPackQuery(agent.sopPackKey), select: { version: true } });
+  const key = pack ? `${agent.sopPackKey}@${pack.version}` : null;
+  if (key && !RULE_COUNTS.has(key)) {
+    const full = await db.sopPack.findFirst({ where: { key: agent.sopPackKey, version: pack!.version }, select: { checklist: true } });
+    const parsed = ChecklistPackSchema.safeParse(full?.checklist);
+    RULE_COUNTS.set(key, parsed.success ? parsed.data.rules.length : null);
+  }
   return {
     agent,
     agentTitle: agent.title,
     requiredInputs: agent.requiredInputs ?? [],
     packVersion: pack?.version ?? null,
-    ruleCount: parsed.success ? parsed.data.rules.length : pack ? null : agent.defaultChecklist.rules.length,
+    ruleCount: key ? (RULE_COUNTS.get(key) ?? null) : agent.defaultChecklist.rules.length,
   };
 }
 
```

## P3 — Coach reminders: one read for already-sent nudges

Every 30-minute run re-attempts `createMany(skipDuplicates)` for each reminder / escalation already
sent today (90 per run in the measurement, all no-ops). One `findMany({ dedupeKey: { in } })` up
front skips them; `createOnce` still guards a concurrent run, so idempotency is unchanged and
summary counts (`reminders`, `escalations`, `unescalated`) are identical.

```diff
diff --git a/src/lib/agents/coach/db.ts b/src/lib/agents/coach/db.ts
index 5dae33a..d0a595a 100644
--- a/src/lib/agents/coach/db.ts
+++ b/src/lib/agents/coach/db.ts
@@ -63,6 +63,16 @@ export async function createOnce(db: Pick<CoachDb, "coachEvent">, e: NewCoachEve
   return r.count === 1;
 }
 
+/**
+ * Which of `keys` already have a CoachEvent — one indexed read instead of one failed insert per
+ * nudge that was already sent. createOnce still guards a concurrent run.
+ */
+export async function sentKeys(db: Pick<CoachDb, "coachEvent">, keys: string[]): Promise<Set<string>> {
+  if (keys.length === 0) return new Set();
+  const rows = await db.coachEvent.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } });
+  return new Set(rows.map((r) => r.dedupeKey).filter((k): k is string => !!k));
+}
+
 export type CoachAudit = { actorId: string; action: string; entity: string; entityId?: string | null; meta?: Prisma.InputJsonValue };
 
 /** One AuditEvent row (Phase 11 will route this through src/lib/audit/log.ts). */
```
```diff
diff --git a/src/lib/agents/coach/cron.ts b/src/lib/agents/coach/cron.ts
index 2b514cf..7fc954f 100644
--- a/src/lib/agents/coach/cron.ts
+++ b/src/lib/agents/coach/cron.ts
@@ -16,7 +16,7 @@ import { formatDate } from "@/lib/agents/core/format";
 import { addDays, istDayKey, istDayStart, istWeekStart, istWeekday } from "@/lib/ist";
 import { DEFAULT_CALENDAR, SUMMARY_SCHEDULE, type CoachCalendar } from "./config";
 import { toRankInputs } from "./board";
-import { COACH_ACTOR, COACH_JOB_SELECT, MAX_ROWS, audit, createOnce, dedupeKey, jobLabel, type CoachDb, type CoachJobRow } from "./db";
+import { COACH_ACTOR, COACH_JOB_SELECT, MAX_ROWS, audit, createOnce, dedupeKey, jobLabel, sentKeys, type CoachDb, type CoachJobRow } from "./db";
 import { POST_FILING_STATES, PRE_FILING_STATES, buildBoard, stepHolder, type RankOptions, type RankedBoard, type RankedItem } from "./rank";
 import { dueReminderSlot, escalationMessage, escalationTarget, isInternalOverdue, reminderMessage } from "./reminders";
 import { weeklySummary } from "./summary";
@@ -153,6 +153,15 @@ export async function runReminders(deps: CoachCronDeps): Promise<ReminderRunSumm
   const managerOf = (id: string) => users.get(id)?.managerId ?? null;
   const day = istDayKey(now);
   const opts = { calendar };
+  // Nudges already sent (an earlier run today): skip them with one read, not one failed insert each.
+  const keyOf = (r: CoachJobRow): string | null => {
+    if (!r.internalDueOn) return null;
+    if (isInternalOverdue(r.internalDueOn, now, opts)) return dedupeKey.escalation(r.id, day);
+    const slot = dueReminderSlot(r.internalDueOn, now, opts);
+    const holder = stepHolder(r);
+    return slot && holder ? dedupeKey.reminder(r.id, holder.userId, slot.key) : null;
+  };
+  const sent = await sentKeys(deps.db, rows.map(keyOf).filter((k): k is string => !!k));
 
   for (const r of rows) {
     if (!r.internalDueOn) continue;
@@ -162,6 +171,7 @@ export async function runReminders(deps: CoachCronDeps): Promise<ReminderRunSumm
     if (!isInternalOverdue(r.internalDueOn, now, opts)) {
       const slot = dueReminderSlot(r.internalDueOn, now, opts);
       if (!slot || !holder || !users.has(holder.userId)) continue;
+      if (sent.has(dedupeKey.reminder(r.id, holder.userId, slot.key))) continue;
       const payload = { reason: "internal-due", slot: slot.label, dueAt: slot.dueAt.toISOString(), state: r.state, message: reminderMessage(label, slot) };
       const created = await createOnce(deps.db, {
         userId: holder.userId,
@@ -178,6 +188,7 @@ export async function runReminders(deps: CoachCronDeps): Promise<ReminderRunSumm
       s.unescalated.push(r.id);
       continue;
     }
+    if (sent.has(dedupeKey.escalation(r.id, day))) continue;
     const holderName = holder ? users.get(holder.userId)?.name ?? null : null;
     const payload = {
       reason: "internal-overdue",
```

## P4 — Close-loop reconciler

**P4a** — the DONE re-check loaded each DONE job's events and Final deliverables separately (2 × 170
queries per run). `loadDoneFacts` reads the DONE events and Final deliverables of all of them in two
queries (indexes below). **P4b** — `escalationRecipients` read the assignee's manager per job and the
partner list per job; memoised per run. **P4c (partner decision)** — for a held CLOSING job the
reconciler called `closeJob`, which writes a `close-refused` AuditEvent on every refusal: 20 held
jobs × 20 runs a day = 400 rows a day, ≈ 120,000 rows (≈ 49 MiB with indexes) a year that repeat
the same reasons. The patch checks with `canClose` (read-only) first and calls `closeJob` only when
the gate would pass. Human close attempts (the job page) still audit every refusal, and the reasons
remain in the reminder / escalation notices. *Audit implication:* automated retries are no longer
individually recorded. Alternative if the partner wants one record: keep one `close-refused` per
job per IST day (one extra indexed read per held job per run, still ≈ 1/20 of the rows).

```diff
diff --git a/src/lib/close-loop/db.ts b/src/lib/close-loop/db.ts
index 29cac71..630accd 100644
--- a/src/lib/close-loop/db.ts
+++ b/src/lib/close-loop/db.ts
@@ -196,6 +196,30 @@ export function loadCloseSyncs(db: CloseLoopTx, jobTaskId: string): PromiseLike<
   return db.turiaSync.findMany({ where: { jobTaskId, operation: "closeTask" }, select: SYNC_SELECT, orderBy: { updatedAt: "desc" } });
 }
 
+/** The two batched reads of the reconciler's DONE re-check. PrismaClient has both shapes. */
+interface DoneRecheckReads {
+  jobTaskEvent: {
+    findMany(args: { where: { jobTaskId: { in: string[] }; toState: "DONE" }; select: typeof EVENT_SELECT & { jobTaskId: true }; orderBy: { createdAt: "asc" } }): PromiseLike<(JobEventRow & { jobTaskId: string })[]>;
+  };
+  deliverable: {
+    findMany(args: { where: { jobTaskId: { in: string[] }; kind: "Final" }; select: typeof DELIVERABLE_SELECT & { jobTaskId: true }; orderBy: { createdAt: "asc" } }): PromiseLike<(DeliverableRow & { jobTaskId: string })[]>;
+  };
+}
+
+/** DONE events and Final deliverables of many jobs: two reads in all, grouped by job. */
+export async function loadDoneFacts(db: CloseLoopTx, ids: string[]): Promise<Map<string, { events: JobEventRow[]; rows: DeliverableRow[] }>> {
+  const out = new Map(ids.map((id) => [id, { events: [] as JobEventRow[], rows: [] as DeliverableRow[] }]));
+  if (!ids.length) return out;
+  const reads = db as unknown as DoneRecheckReads;
+  const [events, rows] = await Promise.all([
+    reads.jobTaskEvent.findMany({ where: { jobTaskId: { in: ids }, toState: "DONE" }, select: { ...EVENT_SELECT, jobTaskId: true }, orderBy: { createdAt: "asc" } }),
+    reads.deliverable.findMany({ where: { jobTaskId: { in: ids }, kind: "Final" }, select: { ...DELIVERABLE_SELECT, jobTaskId: true }, orderBy: { createdAt: "asc" } }),
+  ]);
+  for (const { jobTaskId, ...e } of events) out.get(jobTaskId)?.events.push(e);
+  for (const { jobTaskId, ...d } of rows) out.get(jobTaskId)?.rows.push(d);
+  return out;
+}
+
 /** One AuditEvent through src/lib/audit/log.ts (validated action/entity, capped meta). */
 export async function audit(db: CloseLoopTx, data: AuditEventData): Promise<void> {
   await logAudit(db, { ...data, meta: data.meta as Record<string, unknown> | undefined });
```
```diff
diff --git a/src/lib/close-loop/reconcile.ts b/src/lib/close-loop/reconcile.ts
index f880612..4557905 100644
--- a/src/lib/close-loop/reconcile.ts
+++ b/src/lib/close-loop/reconcile.ts
@@ -25,13 +25,15 @@ import { formatDuration } from "./cycle-time";
 import {
   audit,
   JOB_SELECT,
+  loadDoneFacts,
   loadEvents,
-  loadFinalDeliverables,
   type CloseJobRow,
   type CloseLoopDb,
   type CoachEventData,
+  type DeliverableRow,
+  type JobEventRow,
 } from "./db";
-import { GATE_ACTOR_REF, closeJob, parseGateEvidence, verifyDeliverable, type CanCloseResult, type GateDeps } from "./gate";
+import { GATE_ACTOR_REF, canClose, closeJob, parseGateEvidence, verifyDeliverable, type CanCloseResult, type GateDeps } from "./gate";
 import { onFiledByHuman, type HookDeps } from "./hooks";
 
 export const RECONCILER_ACTOR: Actor = { kind: "system", name: "close-loop-reconciler" };
@@ -100,18 +102,25 @@ async function nudgeOnce(db: CloseLoopDb, data: CoachEventData, dedupeKey: strin
   }
 }
 
+/** Per-run memo of the user reads escalationRecipients makes (a manager per assignee, the partners once). */
+export type RecipientMemo = { managers: Map<string, Promise<string | null>>; partners?: Promise<string[]> };
+export const recipientMemo = (): RecipientMemo => ({ managers: new Map() });
+
 /** Reviewer (job, else engagement) and the assignee's manager; partners when there is nobody. Never the assignee. */
-export async function escalationRecipients(db: CloseLoopDb, job: CloseJobRow): Promise<string[]> {
+export async function escalationRecipients(db: CloseLoopDb, job: CloseJobRow, memo: RecipientMemo = recipientMemo()): Promise<string[]> {
   const ids = new Set<string>();
   const reviewer = job.reviewerId ?? job.engagement?.reviewerId ?? null;
   if (reviewer) ids.add(reviewer);
   if (job.assigneeId) {
-    const manager = (await db.user.findUnique({ where: { id: job.assigneeId }, select: { managerId: true } }))?.managerId;
+    const assignee = job.assigneeId;
+    if (!memo.managers.has(assignee)) memo.managers.set(assignee, Promise.resolve(db.user.findUnique({ where: { id: assignee }, select: { managerId: true } })).then((u) => u?.managerId ?? null));
+    const manager = await memo.managers.get(assignee)!;
     if (manager) ids.add(manager);
   }
   const out = [...ids].filter((id) => id !== job.assigneeId);
   if (out.length) return out.sort();
-  return (await db.user.findMany({ where: { level: "PARTNER", active: true }, select: { id: true }, orderBy: { id: "asc" } })).map((u) => u.id);
+  memo.partners ??= Promise.resolve(db.user.findMany({ where: { level: "PARTNER", active: true }, select: { id: true }, orderBy: { id: "asc" } })).then((us) => us.map((u) => u.id));
+  return [...(await memo.partners)];
 }
 
 function missingList(m: CanCloseResult["missing"]): string[] {
@@ -132,7 +141,7 @@ async function filedAtOf(db: CloseLoopDb, job: CloseJobRow): Promise<Date> {
 
 // ------------------------------------------------------------------ open jobs
 
-async function reconcileOpen(job: CloseJobRow, deps: ReconcileDeps, now: Date, s: ReconcileSummary): Promise<void> {
+async function reconcileOpen(job: CloseJobRow, deps: ReconcileDeps, now: Date, s: ReconcileSummary, memo: RecipientMemo): Promise<void> {
   let state: JobTaskState = job.state;
   if (state === "FILED_BY_HUMAN") {
     const hook = await onFiledByHuman(job.id, { ...deps, now: () => now });
@@ -141,7 +150,11 @@ async function reconcileOpen(job: CloseJobRow, deps: ReconcileDeps, now: Date, s
       state = "CLOSING";
     }
   }
-  const c = await closeJob(job.id, RECONCILER_ACTOR, { ...deps, now: () => now });
+  // PARTNER DECISION (audit): check first and call closeJob only when the gate would pass, so a
+  // held job no longer writes a `close-refused` AuditEvent on every 30-minute run (the reasons stay
+  // in the reminder / escalation notices and on the job page). Human close attempts still audit.
+  const check = await canClose(job.id, { ...deps, now: () => now });
+  const c = check.ok ? await closeJob(job.id, RECONCILER_ACTOR, { ...deps, now: () => now }) : { ok: false as const, state: check.state, reasons: check.reasons, missing: check.missing };
   if (c.ok) {
     s.closed.push(job.id);
     return;
@@ -159,7 +172,7 @@ async function reconcileOpen(job: CloseJobRow, deps: ReconcileDeps, now: Date, s
   }
   if (age > ESCALATE_AFTER_MS) {
     const message = `${jobLabel(job)} has waited ${formatDuration(age)} since filing without closing. Still needed: ${missing.join("; ")}.`;
-    for (const to of await escalationRecipients(deps.db, job)) {
+    for (const to of await escalationRecipients(deps.db, job, memo)) {
       const data: CoachEventData = { userId: to, kind: "escalation", jobTaskId: job.id, payload: { ...base, message, assigneeId: job.assigneeId } };
       if (await nudgeOnce(deps.db, data, dedupeKeys.escalation(job.id, to, day))) s.escalations += 1;
     }
@@ -168,9 +181,11 @@ async function reconcileOpen(job: CloseJobRow, deps: ReconcileDeps, now: Date, s
 
 // ------------------------------------------------------------------ DONE jobs
 
-async function recheckDone(job: CloseJobRow, deps: ReconcileDeps, now: Date, s: ReconcileSummary): Promise<void> {
+type DoneFacts = { events: JobEventRow[]; rows: DeliverableRow[] };
+
+async function recheckDone(job: CloseJobRow, deps: ReconcileDeps, now: Date, s: ReconcileSummary, facts: DoneFacts, memo: RecipientMemo): Promise<void> {
   s.doneChecked += 1;
-  const events = await loadEvents(deps.db, job.id);
+  const events = facts.events;
   const doneEvent = events.filter((e) => e.toState === "DONE").at(-1);
   const evidence =
     doneEvent && doneEvent.fromState === "CLOSING" && doneEvent.actorId === GATE_ACTOR_REF ? parseGateEvidence(doneEvent.note) : null;
@@ -180,7 +195,7 @@ async function recheckDone(job: CloseJobRow, deps: ReconcileDeps, now: Date, s:
     s.backstopViolations.push(job.id);
     problems.push("DONE was set without close-gate evidence (not by system:close-gate)");
   }
-  const rows = await loadFinalDeliverables(deps.db, job.id);
+  const rows = facts.rows;
   const toCheck = evidence ? evidence.deliverables : rows.map((r) => ({ id: r.id, sha256: r.sha256 }));
   let unverifiable = false;
   for (const want of toCheck) {
@@ -200,7 +215,7 @@ async function recheckDone(job: CloseJobRow, deps: ReconcileDeps, now: Date, s:
   const message = `${jobLabel(job)} is DONE but needs attention: ${problems.join("; ")}. The job was not reopened.`;
   const payload = { reason: "done-recheck", problems, message, assigneeId: job.assigneeId };
   const day = istDayKey(now);
-  const [first, ...rest] = await escalationRecipients(deps.db, job);
+  const [first, ...rest] = await escalationRecipients(deps.db, job, memo);
   if (!first) return;
   // The run that creates done-alert:<job>:<day> owns today's alert: it alone notifies the others
   // and writes the AuditEvent. A concurrent or later run gets the unique violation and stops.
@@ -235,7 +250,8 @@ export async function reconcile(deps: ReconcileDeps): Promise<ReconcileSummary>
     take: MAX_JOBS_PER_RUN,
   });
   s.open = open.length;
-  for (const job of open) await reconcileOpen(job, deps, now, s);
+  const memo = recipientMemo();
+  for (const job of open) await reconcileOpen(job, deps, now, s, memo);
 
   const since = new Date(now.getTime() - RECHECK_DONE_DAYS * 24 * 60 * 60_000);
   const done = await deps.db.jobTask.findMany({
@@ -244,6 +260,8 @@ export async function reconcile(deps: ReconcileDeps): Promise<ReconcileSummary>
     orderBy: { id: "asc" },
     take: MAX_JOBS_PER_RUN,
   });
-  for (const job of done) await recheckDone(job, deps, now, s);
+  // Two reads for all DONE jobs (their DONE events and Final deliverables), not two per job.
+  const facts = await loadDoneFacts(deps.db, done.map((j) => j.id));
+  for (const job of done) await recheckDone(job, deps, now, s, facts.get(job.id)!, memo);
   return s;
 }
```
```diff
diff --git a/src/lib/close-loop/reconcile.test.ts b/src/lib/close-loop/reconcile.test.ts
index bdea5ef..53e20c7 100644
--- a/src/lib/close-loop/reconcile.test.ts
+++ b/src/lib/close-loop/reconcile.test.ts
@@ -65,7 +65,9 @@ describe("nudges for held CLOSING jobs", () => {
     const s = await reconcile(deps);
     expect(s).toMatchObject({ open: 1, reminders: 0, escalations: 0 });
     expect(w.coach).toEqual([]);
-    expect(w.audits.map((a) => a.action)).toEqual(["close-refused"]);
+    // Partner decision: an automated attempt on a held job is checked with canClose and writes no
+    // close-refused AuditEvent (human attempts through closeJob still do).
+    expect(w.audits.map((a) => a.action)).toEqual([]);
   });
 
   it("after 15 minutes the assignee gets one reminder, however often the cron fires that day", async () => {
```
```diff
diff --git a/tests/fakes/close-loop-world.ts b/tests/fakes/close-loop-world.ts
index 4e9c143..d6dd82c 100644
--- a/tests/fakes/close-loop-world.ts
+++ b/tests/fakes/close-loop-world.ts
@@ -256,13 +256,18 @@ export class CloseLoopWorld {
         this.events.push(e);
         return { id: e.id };
       },
-      findMany: async ({ where }) =>
-        this.events.filter((e) => e.jobTaskId === where.jobTaskId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
+      findMany: (async ({ where }: { where: { jobTaskId: string | { in: string[] }; toState?: string } }) =>
+        this.events
+          .filter((e) => (typeof where.jobTaskId === "string" ? e.jobTaskId === where.jobTaskId : where.jobTaskId.in.includes(e.jobTaskId)) && (!where.toState || e.toState === where.toState))
+          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) as never,
     },
     agentRun: { findFirst: async () => null },
     checklistResult: { count: async () => 0 },
     deliverable: {
-      findMany: async ({ where }) => this.deliverables.filter((d) => d.jobTaskId === where.jobTaskId && d.kind === where.kind).map((d) => ({ ...d })),
+      findMany: (async ({ where }: { where: { jobTaskId: string | { in: string[] }; kind: string } }) =>
+        this.deliverables
+          .filter((d) => (typeof where.jobTaskId === "string" ? d.jobTaskId === where.jobTaskId : where.jobTaskId.in.includes(d.jobTaskId)) && d.kind === where.kind)
+          .map((d) => ({ ...d }))) as never,
       updateMany: async ({ where, data }) => {
         const hit = this.deliverables.filter((d) => where.id.in.includes(d.id));
         hit.forEach((d) => Object.assign(d, data));
```

## P5 — ClientDocs inputs: one listing call

`clientDocsInputSource` did an item GET for the folder and then a children GET. The children GET
alone answers both (a missing folder is a 404), as the deliverable store now does.

```diff
diff --git a/src/lib/agents/core/inputs.ts b/src/lib/agents/core/inputs.ts
index e091180..391dd9d 100644
--- a/src/lib/agents/core/inputs.ts
+++ b/src/lib/agents/core/inputs.ts
@@ -8,6 +8,7 @@
 // ClientDocs is screened in "warn" mode for type, because the ROC agent reads an optional
 // notes.txt placed there; staff uploads are screened strictly. A rejected file stops the run.
 import type { DeliverableStore } from "@/lib/integrations/sharepoint/deliverable-store";
+import { GraphError } from "@/lib/integrations/sharepoint/errors";
 import type { SharePointClient } from "@/lib/integrations/sharepoint/graph-client";
 import { screenUpload, type ScreenOptions, type UploadLogEntry } from "@/lib/hardening/uploads";
 import type { InputFile, InputRequest, InputSource } from "./runner";
@@ -79,12 +80,18 @@ export function clientDocsInputSource(client: SharePointClient, store: Deliverab
   return {
     async gather(req: InputRequest) {
       const driveId = await store.complianceDrive(req.clientCode);
-      const folder = await client.getItemByPath(driveId, req.clientDocsFolder);
-      if (!folder) return [];
+      // One children GET; a folder that does not exist yet is a 404 (no separate item GET).
+      let listed: Awaited<ReturnType<SharePointClient["listChildren"]>>;
+      try {
+        listed = await client.listChildren(driveId, req.clientDocsFolder);
+      } catch (e) {
+        if (e instanceof GraphError && e.status === 404) return [];
+        throw e;
+      }
       const files: InputFile[] = [];
       let total = 0;
       // Name order, so a run sees the same files in the same order every time.
-      const items = (await client.listChildren(driveId, req.clientDocsFolder)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
+      const items = listed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
       for (const item of items) {
         if (!item.file) continue;
         total += item.size ?? 0;
```

## P6 — Runner: one insert for the run's deliverables

Inside the run's transaction each Working deliverable was a separate `create` (GST writes 5). One
`createMany` writes the same rows (ids are not read back).

```diff
diff --git a/src/lib/agents/core/runner.ts b/src/lib/agents/core/runner.ts
index 9f4b103..cf9ed5f 100644
--- a/src/lib/agents/core/runner.ts
+++ b/src/lib/agents/core/runner.ts
@@ -450,9 +450,10 @@ export async function runAgent<I, E>(def: AgentDefinition<I, E>, jobTaskId: stri
       });
       if (results.length) await tx.checklistResult.createMany({ data: toChecklistResultRows(runId, results) });
       if (session) await logAudit(tx, session.auditEvent(runId, "ok").data);
-      for (const s of stored) {
-        await tx.deliverable.create({
-          data: {
+      if (stored.length) {
+        // One INSERT for all of the run's Working deliverables (was one per file).
+        await tx.deliverable.createMany({
+          data: stored.map((s) => ({
             jobTaskId,
             agentRunId: runId,
             kind: "Working",
@@ -463,7 +464,7 @@ export async function runAgent<I, E>(def: AgentDefinition<I, E>, jobTaskId: stri
             sha256: s.sha256,
             sizeBytes: s.sizeBytes,
             version: s.version,
-          },
+          })),
         });
       }
     });
```

## P7 — Companion API

`verifyPairing` wrote `CompanionToken.lastUsedAt` on every poll (one UPDATE a minute per open panel).
It now writes when the stored value is 10 minutes old or more — "last used" on the Companion page is
still accurate to 10 minutes. The next-task answer carries a weak ETag over everything but the
timestamp; a request with a matching `If-None-Match` gets 304 and no body (the database work is the
same — this saves bandwidth and lets the panel skip re-rendering). The extension then sends
`If-None-Match` and treats 304 as "unchanged" (it already backs off on unchanged answers).

```diff
diff --git a/src/lib/companion/tokens.ts b/src/lib/companion/tokens.ts
index a8cc590..bab96ad 100644
--- a/src/lib/companion/tokens.ts
+++ b/src/lib/companion/tokens.ts
@@ -162,6 +162,9 @@ export async function revokePairing(db: CompanionTokenDb, user: CompanionUser, p
   });
 }
 
+/** How stale CompanionToken.lastUsedAt may get before an accepted use rewrites it. */
+export const LAST_USED_RESOLUTION_MS = 10 * 60_000;
+
 export type VerifyFailure = "missing" | "unknown" | "revoked" | "expired";
 export type VerifyResult = { ok: true; tokenId: string; userId: string } | { ok: false; reason: VerifyFailure };
 
@@ -173,10 +176,13 @@ export async function verifyPairing(db: TokenOnlyDb, raw: string | null, now: Da
   if (!raw) return { ok: false, reason: "missing" };
   if (!isTokenShape(raw)) return { ok: false, reason: "unknown" };
   const hash = hashToken(raw);
-  const row = await db.companionToken.findUnique({ where: { tokenHash: hash }, select: { id: true, userId: true, tokenHash: true, createdAt: true, revokedAt: true } });
+  const row = await db.companionToken.findUnique({ where: { tokenHash: hash }, select: { id: true, userId: true, tokenHash: true, createdAt: true, revokedAt: true, lastUsedAt: true } });
   if (!row || !hashesEqual(row.tokenHash, hash)) return { ok: false, reason: "unknown" };
   const status = tokenStatus(row, now);
   if (status !== "active") return { ok: false, reason: status };
-  await db.companionToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
+  // "Last used" is shown to the minute-ish; one write per LAST_USED_RESOLUTION_MS, not one per poll.
+  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
+    await db.companionToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
+  }
   return { ok: true, tokenId: row.id, userId: row.userId };
 }
```
```diff
diff --git a/src/lib/companion/http.ts b/src/lib/companion/http.ts
index d058ba0..d30b592 100644
--- a/src/lib/companion/http.ts
+++ b/src/lib/companion/http.ts
@@ -10,6 +10,7 @@
 //            → provider.nextTask. Every refusal is one plain sentence in { error }.
 //
 // CORS lives here, in the route handler, not in next.config.ts (which belongs to hardening).
+import { createHash } from "node:crypto";
 import { NextResponse } from "next/server";
 import type { PrismaClient } from "@prisma/client";
 import { isActive } from "@/lib/access";
@@ -32,7 +33,7 @@ function json(body: unknown, status: number, allowOrigin: string | null, extra:
   const headers: Record<string, string> = { "cache-control": "no-store", vary: "Origin", ...extra };
   if (allowOrigin) {
     headers["access-control-allow-origin"] = allowOrigin;
-    headers["access-control-expose-headers"] = "Retry-After";
+    headers["access-control-expose-headers"] = "Retry-After, ETag";
   }
   return NextResponse.json(body, { status, headers });
 }
@@ -46,7 +47,7 @@ export function handlePreflight(req: Request, origins: readonly string[]): Respo
     headers: {
       "access-control-allow-origin": allowed,
       "access-control-allow-methods": "GET, OPTIONS",
-      "access-control-allow-headers": "Authorization",
+      "access-control-allow-headers": "Authorization, If-None-Match",
       "access-control-max-age": "600",
       vary: "Origin",
     },
@@ -98,7 +99,11 @@ export async function handleNextTask(req: Request, deps: NextTaskDeps): Promise<
     const user = await loadCompanionUser(deps.db, verified.userId);
     if (!user || !isActive(user)) return send({ error: MSG.accountInactive }, 403);
     if (!(await hasCompanionAccess(deps.db, user))) return send({ error: MSG.noAccess }, 403);
-    return send(await deps.provider.nextTask(user, now), 200);
+    const body = await deps.provider.nextTask(user, now);
+    // Weak ETag over everything but the timestamp: an unchanged task is a 304 with no body.
+    const etag = `W/"${createHash("sha256").update(JSON.stringify({ ...(body as object), generatedAt: undefined })).digest("base64url").slice(0, 27)}"`;
+    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store", vary: "Origin", ...(cors.allowed ? { "access-control-allow-origin": cors.allowed, "access-control-expose-headers": "Retry-After, ETag" } : {}) } });
+    return send(body, 200, { etag });
   } catch (e) {
     console.error("[companion] next-task failed", e);
     return send({ error: MSG.serverError }, 500);
```
```diff
diff --git a/src/lib/companion/__tests__/tokens.test.ts b/src/lib/companion/__tests__/tokens.test.ts
index fb6d9d7..30d4d49 100644
--- a/src/lib/companion/__tests__/tokens.test.ts
+++ b/src/lib/companion/__tests__/tokens.test.ts
@@ -175,11 +175,13 @@ describe("verifyPairing", () => {
     return { t, db };
   };
 
-  it("accepts a live token and updates lastUsedAt on every use", async () => {
+  it("accepts a live token and updates lastUsedAt at most every 10 minutes", async () => {
     const { t, db } = seed();
     await expect(verifyPairing(db as never, t, NOW)).resolves.toEqual({ ok: true, tokenId: "tok-v", userId: "u-staff" });
     expect(db.tokens[0].lastUsedAt).toEqual(NOW);
-    const later = new Date(NOW.getTime() + 60_000);
+    await verifyPairing(db as never, t, new Date(NOW.getTime() + 60_000)); // the next poll: no write
+    expect(db.tokens[0].lastUsedAt).toEqual(NOW);
+    const later = new Date(NOW.getTime() + 10 * 60_000);
     await verifyPairing(db as never, t, later);
     expect(db.tokens[0].lastUsedAt).toEqual(later);
   });
```
```diff
diff --git a/src/lib/companion/__tests__/http.test.ts b/src/lib/companion/__tests__/http.test.ts
index 97cd898..a35c7a1 100644
--- a/src/lib/companion/__tests__/http.test.ts
+++ b/src/lib/companion/__tests__/http.test.ts
@@ -68,7 +68,7 @@ describe("CORS", () => {
     expect(ok.status).toBe(204);
     expect(ok.headers.get("access-control-allow-origin")).toBe(EXT);
     expect(ok.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
-    expect(ok.headers.get("access-control-allow-headers")).toBe("Authorization");
+    expect(ok.headers.get("access-control-allow-headers")).toBe("Authorization, If-None-Match");
     expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
     const refused: Array<Record<string, string>> = [{ origin: "https://evil.example" }, { origin: OTHER_EXT }, {}];
     for (const headers of refused) {
@@ -169,7 +169,7 @@ describe("rate limit (429)", () => {
     expect(limited.status).toBe(429);
     expect(await limited.json()).toEqual({ error: MSG.rateLimited });
     expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
-    expect(limited.headers.get("access-control-expose-headers")).toBe("Retry-After");
+    expect(limited.headers.get("access-control-expose-headers")).toBe("Retry-After, ETag");
     const lookups = db.calls.filter((c) => c.method === "findUnique" && c.model === "companionToken").length;
     expect(lookups).toBe(3); // the limited request never reached the database
 
```

---

## Indexes (additive `@@index` lines for the orchestrator)

None of these changes a column or an existing index. Each serves a query that runs on a page load,
a poll or every cron run.

| Model | Add | Serves |
|---|---|---|
| JobTask | `@@index([reviewerId, state])` | The `OR: [{ assigneeId }, { reviewerId }]` + `state IN (…)` filter of "Waiting for you" (`listMyJobs`), focus / companion `listNextTaskCandidates`, the coach board `loadMyJobs` and staff `jobScopeWhere`: `[assigneeId, state]` exists, the reviewer branch has no index (Postgres then scans for the OR). |
| JobTask | `@@index([state, doneAt])` | Reconciler DONE re-check (`state = DONE AND doneAt >= now − 30 d`, every 30 min) and the weekly summary (`state = DONE AND doneAt` in the week). |
| ChecklistResult | `@@index([agentRunId, status])` | `runOpenQuestions` (`status = 'na'`, every focus render / companion poll), `blockingFailuresOf` (`severity = block AND status = fail`), and the nested `checklist: { where: { status: "fail" } }` of the agents list and "Waiting for you". |
| AgentRun | `@@index([startedAt])` | Agents list for partners / managers (`ORDER BY startedAt DESC LIMIT 100`, no other filter) and drift monitoring (`startedAt` range on /admin/firm-os/models). |
| AuditEvent | `@@index([action, createdAt])` | Drift monitoring reads `action = 'guardrail-run'` over a date range on every /admin/firm-os/models load; the retention sweep's escalation check and the run review comments use `[entity, entityId]` (exists). |
| CoachEvent | `@@index([userId, kind, createdAt])` | `currentNudge` (every heartbeat: `userId, kind = 'break', dismissedAt IS NULL, createdAt >=`), today's break nudges in `recordHeartbeat`, and the coach page notices (`userId, kind IN (…), createdAt >=`). |
| AgentRun | `@@index([inputsPurgeAt])` (optional) | The daily retention UPDATE (`inputs IS NOT NULL AND inputsPurgeAt <= now`). Small table; only worth it past ~50k runs. |

Not needed: ModelCall already has `[runId]`, `[createdAt]`, `[agent, createdAt]` for the budget
aggregates and usage page; Deliverable `[jobTaskId, kind]` serves the gate; JobTaskEvent
`[jobTaskId, createdAt]` serves P4a with `jobTaskId IN (…)`.

Schema addition to make the Graph saving survive restarts (needs the orchestrator): on
`Deliverable`, `quickXorHash String?` and `cTag String?`, written by the runner / finalize path from
`StoredFile` (the store already has both) and read by the verifier; the in-process content registry
would then only be a fallback. Without it, each Final file is downloaded once per process start.

## Storage and retention (decisions for the partners)

Measured kept growth is ≈ 116 MiB a year for all Firm OS tables at the firm's size (≈ 66 MiB with
P4c; see the report); the items below are the largest and the ones with privacy weight. **None is
applied.**

1. **`close-refused` AuditEvents from the reconciler** — the biggest single item (≈ 49 MiB / year,
   P4c). Decision: drop automated refusals (reasons stay in notices) or keep one per job per day.
   Audit implication stated in P4c.
2. **CoachEvent has no retention** (≈ 21 MiB / year, mostly morning-board payloads that list the
   day's jobs). Proposal: null the `payload` of `board` / `reminder` / `escalation` events older than
   90 days (the row, its kind, job id and dedupe key stay); keep `summary` (managers read them) for a
   year. Break-nudge CoachEvents (`kind = 'break'`, ≈ 1.7 MiB / year) are derived from activity
   heartbeats, which ADR-006 keeps for 7 days with "no lasting trace of break activity"; deleting
   them after 7 days would align with ADR-006 but is a delete (the no-delete guard allows only the
   heartbeat purge) — partner decision; nulling the payload is the non-delete alternative.
   DPDP: staff personal data (class B); shorter retention is favourable.
3. **ModelCall rows** (≈ 2 MiB / year now; grows with live use). Proposal: keep rows 180 days, then
   roll them up into one row per day × agent × task × status (counts, tokens, ₹) in a new summary
   table, keeping `promptHash` only for calls that escalated or failed. Implication: ADR-002 says every
   attempt is kept and attributable; after 180 days per-call attribution would be lost. Needs a
   partner decision and a schema addition. Until then: keep.
4. **AuditEvent meta** is already capped at 8 KB (`META_MAX_BYTES`, `src/lib/audit/log.ts`); the
   largest routine meta is the guardrail-run counts (~400 B). No change proposed; audit rows are kept.
5. **AgentRun.inputs** is already nulled after 30 days (≈ 1.3 MiB live) and **heartbeats** deleted
   after 7 days (≈ 8 MiB live with break nudges on): both bounded, no change.
6. **Retention sweep writes one AuditEvent per escalated model call** (301 inserts for 300). A
   `logAuditMany` (validated rows in one `createMany`) would make it one insert; same rows, same audit.
