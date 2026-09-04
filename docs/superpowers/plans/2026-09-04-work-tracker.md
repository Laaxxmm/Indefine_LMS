# Tech Work Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/work` module inside the LMS where Lakshmanan and Amit plan a week, promise up to three tasks a day, review every Friday, and watch a Kanban board that moves itself from their actions.

**Architecture:** Postgres (Prisma) holds works, tasks, plans, picks, reviews and an append-only event timeline. All rules are pure functions in `src/lib/work/core.ts` (tested by `scripts/verify-work.ts`); every write goes through `src/lib/work/db.ts`, which wraps each change and its timeline row in one transaction. Route handlers under `src/app/api/work/*`, server-component pages under `src/app/work/*` with small `"use client"` panels, mirroring the clients module. Nudges post into a Teams chat as the lead through the existing delegated Graph token; three cron jobs run through the existing GitHub Actions + `CRON_SECRET` pattern.

**Tech Stack:** Next.js 15 App Router, Prisma 6 (Postgres), NextAuth v5 (Entra), Microsoft Graph via `src/lib/graph.ts`, zod (installed), lucide-react (installed), Tailwind, tsx for the self-check script. No new dependencies.

Spec: `docs/superpowers/specs/2026-09-04-work-tracker-design.md`.

## Global Constraints

- Repo: https://github.com/Laaxxmm/Indefine_LMS, branch `main`. The working clone is shallow: run `git fetch --unshallow` once before any rebase. Commit locally; **never push until Lakshmanan says "push"**. Before any push: `git fetch && git rebase origin/main`.
- Deploy runs `prisma db push --accept-data-loss` on start (`package.json` `start`). No migration files. After editing `prisma/schema.prisma` run `npx prisma validate && npx prisma generate`.
- Every commit must pass `npx tsc --noEmit` and `npx tsx scripts/verify-work.ts`. Run `npm run build` before the final commit of the plan.
- Two levels only: Work → Task. No subtasks, no priority, no hours, no tags, no comments, no attachments.
- Work statuses `INBOX ACTIVE PARKED DONE OBSOLETE`, shown as **Ideas · Working · Paused · Done · Obsolete**. Task statuses `TODO DONE DROPPED`, lanes **To do · Today · Done** derived, never stored.
- Caps: `WIP_CAP = 3` ACTIVE works per owner, `PLAN_CAP = 3` works per person per week, `PICK_CAP = 3` tasks per person per day. `STALE_DAYS = 14`, `AUTO_PAUSE_DAYS = 28`.
- Access: signed-in user whose email is in env `WORK_TRACKER_EMAILS` (comma-separated, lowercase compare). First email is the lead. Everyone else gets 404 from `/work/*` and `/api/work/*`; anonymous users are redirected to `/`.
- Roles: lead creates works, assigns tasks to anyone on the list, reviews, drops tasks. Owner or lead changes a work's status. Anyone on the list captures ideas (becomes owner), adds tasks for themselves on ACTIVE works, ticks their own tasks.
- Time: "today" and "week" are IST (UTC+5:30, no DST). Week starts Monday 00:00 IST. Weekends have no gate and no picks. Store instants as UTC `DateTime`.
- Every write appends a `WorkEvent`. Human actions bump `Work.lastTouchedAt`; cron sweeps (`CARRIED`, `AUTO_PAUSED`) do not.
- Never delete works or tasks. Obsolete is the delete. Editing a week plan may remove `WeekPlanWork` rows.
- Teams nudges are best-effort: any Graph failure is logged and the cron job continues.
- Fabrication ban: no invented data in UI copy. Placeholder examples in the plan (like "Enable MFA") appear only in tests and code comments, never in shipped UI text.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | New enums + `Work`, `WorkTask`, `WeekPlanWork`, `DayPick`, `WeekReview`, `WorkEvent`; User relations; `Settings.workTeamsChatId` |
| `src/lib/work/core.ts` | Pure: constants, labels, access, IST clock, stale, transitions, auto-done, score, gate, timeline lines, zod bodies, `Actor`/`Result` types |
| `src/lib/work/db.ts` | Prisma: `touch`, tracker users, create/status/tasks/plan/picks/review, close sweep, page queries |
| `src/lib/work/actor.ts` | Session → `Actor` |
| `src/lib/work/http.ts` | Route-handler helpers: 404, body parsing, `Result` → response |
| `src/lib/work/teams.ts` | Graph: ensure the "Tech Work" chat, post a message as the lead |
| `src/app/api/work/route.ts` | `POST` create work |
| `src/app/api/work/[id]/route.ts` | `PATCH` work status action |
| `src/app/api/work/[id]/tasks/route.ts` | `POST` create task |
| `src/app/api/work/tasks/[taskId]/route.ts` | `PATCH` task action |
| `src/app/api/work/week/route.ts` | `PUT` this week's plan |
| `src/app/api/work/picks/route.ts` | `POST` today's picks |
| `src/app/api/work/review/route.ts` | `POST` review done |
| `src/app/api/cron/work/route.ts` | `morning` / `friday` / `close` |
| `src/app/work/layout.tsx` | Header nav + access gate |
| `src/app/work/ui.ts` | Client-side `call()` and shared class strings |
| `src/app/work/page.tsx`, `CaptureBox.tsx`, `PlanForm.tsx`, `PickForm.tsx`, `TodayList.tsx` | Today with the plan/pick gate |
| `src/app/work/board/page.tsx`, `Board.tsx` | Kanban |
| `src/app/work/[id]/page.tsx`, `WorkDetail.tsx` | Work detail: lanes, add task, timeline |
| `src/app/work/week/page.tsx`, `WeekPanels.tsx` | Plan + Friday review, two columns |
| `src/lib/graph.ts`, `src/lib/auth.ts` | Shared `GRAPH_SCOPES` with the two chat scopes |
| `src/app/dashboard/page.tsx` | Nav link |
| `.github/workflows/work-nudges.yml`, `.env.example` | Cron + env docs |
| `scripts/verify-work.ts`, `package.json` | Self-check |

---

### Task 1: Schema, pure rules, self-check script, spec amendments

**Files:**
- Modify: `prisma/schema.prisma` (User relations block ends at the line `clientDocsUploaded  ClientDocument[]   @relation("ClientDocUploader")`; `Settings` model near line 279; append new section at end of file)
- Create: `src/lib/work/core.ts`
- Create: `scripts/verify-work.ts`
- Modify: `package.json` (scripts)
- Modify: `docs/superpowers/specs/2026-09-04-work-tracker-design.md` (three one-line amendments)

**Interfaces:**
- Produces (core.ts): everything listed in the code below. Later tasks import by these exact names: `WIP_CAP`, `PLAN_CAP`, `PICK_CAP`, `STALE_DAYS`, `AUTO_PAUSE_DAYS`, `WORK_STATUS_ORDER`, `WORK_STATUS_LABELS`, `trackerEmails`, `canUseWork`, `isWorkLead`, `istDayKey`, `istDayStart`, `istWeekday`, `isWeekend`, `addDays`, `istWeekStart`, `istMonthStart`, `parseDayKey`, `daysUntouched`, `isStale`, `shouldAutoPause`, `WORK_ACTIONS`, `WorkAction`, `nextStatus`, `actionForMove`, `actionsFor`, `wipAllows`, `TASK_ACTIONS`, `TaskAction`, `TaskLane`, `taskLane`, `awaitsReview`, `autoDone`, `keptPromise`, `precheckTaskIds`, `PickGroup`, `GateStep`, `gateStep`, `eventLine`, `createWorkZ`, `workActionZ`, `createTaskZ`, `taskActionZ`, `planZ`, `picksZ`, `Actor`, `Result`.

- [ ] **Step 1: Add the schema**

Append to the `User` model relations, directly after the `clientDocsUploaded` line:

```prisma
  worksOwned          Work[]             @relation("WorkOwner")
  worksCreated        Work[]             @relation("WorkCreator")
  workTasksAssigned   WorkTask[]         @relation("WorkTaskAssignee")
  workTasksCreated    WorkTask[]         @relation("WorkTaskCreator")
  weekPlanWorks       WeekPlanWork[]
  dayPicks            DayPick[]
  weekReviews         WeekReview[]
  workEvents          WorkEvent[]        @relation("WorkEventActor")
```

Add to the `Settings` model, after `quizUnlockAtPercent`:

```prisma
  // Graph chat id of the "Tech Work" group chat used by the work-tracker nudges.
  workTeamsChatId     String?
```

Append at the end of the file:

```prisma
// -------------------- Tech work tracker (/work) --------------------
// Two-person focus tool. Work -> Task. Rules in src/lib/work/core.ts, every
// write in src/lib/work/db.ts appends a WorkEvent in the same transaction.

enum WorkStatus {
  INBOX     // "Ideas"
  ACTIVE    // "Working"
  PARKED    // "Paused"
  DONE
  OBSOLETE
}

enum WorkTaskStatus {
  TODO
  DONE
  DROPPED
}

enum DayPickOutcome {
  DONE
  CARRIED
}

enum WorkEventKind {
  WORK_CREATED
  WORK_STATUS
  WORK_REOPENED
  TASK_CREATED
  TASK_DONE
  TASK_DROPPED
  TASK_REVIEWED
  TASK_REOPENED
  PICKED
  CARRIED
  AUTO_PAUSED
  WEEK_PLANNED
  WEEK_REVIEWED
}

model Work {
  id             String     @id @default(cuid())
  title          String
  why            String?    // one line: what changes when this is done
  ownerId        String
  status         WorkStatus @default(INBOX)
  obsoleteReason String?
  lastTouchedAt  DateTime   @default(now())
  doneAt         DateTime?
  createdById    String
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  owner     User           @relation("WorkOwner", fields: [ownerId], references: [id])
  createdBy User           @relation("WorkCreator", fields: [createdById], references: [id])
  tasks     WorkTask[]
  events    WorkEvent[]
  weekPlans WeekPlanWork[]

  @@index([ownerId, status])
  @@index([status, lastTouchedAt])
}

model WorkTask {
  id          String         @id @default(cuid())
  workId      String
  title       String
  assigneeId  String
  status      WorkTaskStatus @default(TODO)
  order       Int            @default(0)
  doneAt      DateTime?
  reviewedAt  DateTime?      // lead's tick on a task someone else finished; set at once for the lead's own
  createdById String
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  work      Work      @relation(fields: [workId], references: [id], onDelete: Cascade)
  assignee  User      @relation("WorkTaskAssignee", fields: [assigneeId], references: [id])
  createdBy User      @relation("WorkTaskCreator", fields: [createdById], references: [id])
  picks     DayPick[]

  @@index([workId, status])
  @@index([assigneeId, status])
}

// One row per (person, week, work): "this work is in my plan this week".
model WeekPlanWork {
  id        String   @id @default(cuid())
  userId    String
  weekStart DateTime // Monday 00:00 IST, stored as the UTC instant
  workId    String

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  work Work @relation(fields: [workId], references: [id], onDelete: Cascade)

  @@unique([userId, weekStart, workId])
}

// One row per (person, day, task) the person promised to do that day.
model DayPick {
  id      String          @id @default(cuid())
  userId  String
  day     DateTime        // IST calendar day, 00:00 IST as the UTC instant
  taskId  String
  outcome DayPickOutcome? // null while the day is open

  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  task WorkTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@unique([userId, day, taskId])
  @@index([userId, day])
}

// Exists once the person has finished the Friday review for that week.
model WeekReview {
  id        String   @id @default(cuid())
  userId    String
  weekStart DateTime
  doneAt    DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, weekStart])
}

// Append-only timeline. Every server action and cron sweep writes one row.
model WorkEvent {
  id     String        @id @default(cuid())
  workId String
  taskId String?
  userId String?       // null when written by cron
  kind   WorkEventKind
  detail String?       // one plain line, e.g. the task title or "Ideas → Working"
  at     DateTime      @default(now())

  work Work  @relation(fields: [workId], references: [id], onDelete: Cascade)
  user User? @relation("WorkEventActor", fields: [userId], references: [id])

  @@index([workId, at])
}
```

- [ ] **Step 2: Validate and generate**

Run: `npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid 🚀` then `✔ Generated Prisma Client`.

- [ ] **Step 3: Write the failing self-check**

Create `scripts/verify-work.ts`:

```ts
import assert from "node:assert/strict";
import {
  WIP_CAP, PICK_CAP, STALE_DAYS, AUTO_PAUSE_DAYS,
  trackerEmails, canUseWork, isWorkLead,
  istDayKey, istDayStart, istWeekday, isWeekend, istWeekStart, istMonthStart, parseDayKey, addDays,
  daysUntouched, isStale, shouldAutoPause,
  nextStatus, actionForMove, actionsFor, wipAllows,
  taskLane, awaitsReview, autoDone, keptPromise, precheckTaskIds, gateStep, eventLine,
  createWorkZ, picksZ,
} from "../src/lib/work/core";

// Access: env order decides the lead, matching is case-insensitive.
const emails = trackerEmails("Lead@Indefine.in, info@indefine.in ,");
assert.deepEqual(emails, ["lead@indefine.in", "info@indefine.in"]);
assert.equal(canUseWork("LEAD@indefine.in", emails), true);
assert.equal(canUseWork("someone@indefine.in", emails), false);
assert.equal(canUseWork(null, emails), false);
assert.equal(isWorkLead("lead@indefine.in", emails), true);
assert.equal(isWorkLead("info@indefine.in", emails), false);
assert.deepEqual(trackerEmails(undefined), []);

// IST clock. 2026-09-04 is a Friday; 18:30 UTC is midnight IST.
const friEvening = new Date("2026-09-04T13:00:00Z"); // 18:30 IST Friday
assert.equal(istDayKey(friEvening), "2026-09-04");
assert.equal(istDayKey(new Date("2026-09-04T18:29:59Z")), "2026-09-04");
assert.equal(istDayKey(new Date("2026-09-04T18:30:00Z")), "2026-09-05");
assert.equal(istDayStart(friEvening).toISOString(), "2026-09-03T18:30:00.000Z");
assert.equal(istWeekday(friEvening), 5);
assert.equal(isWeekend(friEvening), false);
assert.equal(isWeekend(new Date("2026-09-05T03:00:00Z")), true); // Saturday IST
assert.equal(istWeekStart(friEvening).toISOString(), "2026-08-30T18:30:00.000Z"); // Mon 31 Aug 00:00 IST
assert.equal(istWeekStart(new Date("2026-08-30T18:30:00Z")).toISOString(), "2026-08-30T18:30:00.000Z"); // Monday itself
assert.equal(istWeekStart(new Date("2026-09-06T18:29:00Z")).toISOString(), "2026-08-30T18:30:00.000Z"); // Sunday 23:59 IST, same week
assert.equal(istMonthStart(friEvening).toISOString(), "2026-08-31T18:30:00.000Z");
assert.equal(parseDayKey("2026-09-04")?.toISOString(), "2026-09-03T18:30:00.000Z");
assert.equal(parseDayKey("junk"), null);
assert.equal(parseDayKey(undefined), null);
assert.equal(addDays(istDayStart(friEvening), 7).toISOString(), "2026-09-10T18:30:00.000Z");

// Stale.
const now = new Date("2026-09-04T04:00:00Z");
assert.equal(daysUntouched(addDays(now, -13.9), now), 13);
assert.equal(daysUntouched(addDays(now, 5), now), 0);
assert.equal(isStale("ACTIVE", addDays(now, -13), now), false);
assert.equal(isStale("ACTIVE", addDays(now, -14), now), true);
assert.equal(isStale("PARKED", addDays(now, -40), now), false);
assert.equal(shouldAutoPause("ACTIVE", addDays(now, -27), now), false);
assert.equal(shouldAutoPause("ACTIVE", addDays(now, -28), now), true);
assert.equal(STALE_DAYS < AUTO_PAUSE_DAYS, true);

// Transitions.
assert.equal(nextStatus("activate", "INBOX"), "ACTIVE");
assert.equal(nextStatus("activate", "PARKED"), "ACTIVE");
assert.equal(nextStatus("activate", "DONE"), null);
assert.equal(nextStatus("pause", "ACTIVE"), "PARKED");
assert.equal(nextStatus("pause", "INBOX"), null);
assert.equal(nextStatus("finish", "ACTIVE"), "DONE");
assert.equal(nextStatus("finish", "INBOX"), null);
assert.equal(nextStatus("obsolete", "INBOX"), "OBSOLETE");
assert.equal(nextStatus("obsolete", "OBSOLETE"), null);
assert.equal(nextStatus("reopen", "DONE"), "ACTIVE");
assert.equal(nextStatus("reopen", "OBSOLETE"), "INBOX");
assert.equal(nextStatus("reopen", "ACTIVE"), null);
assert.equal(actionForMove("INBOX", "ACTIVE"), "activate");
assert.equal(actionForMove("ACTIVE", "DONE"), "finish");
assert.equal(actionForMove("DONE", "ACTIVE"), "reopen");
assert.equal(actionForMove("INBOX", "DONE"), null);
assert.equal(actionForMove("ACTIVE", "ACTIVE"), null);
assert.deepEqual(actionsFor("INBOX").map(([a]) => a), ["activate", "obsolete"]);
assert.deepEqual(actionsFor("PARKED")[0], ["activate", "Resume"]);
assert.deepEqual(actionsFor("INBOX")[0], ["activate", "Start"]);
assert.deepEqual(actionsFor("ACTIVE").map(([a]) => a), ["pause", "finish", "obsolete"]);
assert.deepEqual(actionsFor("DONE").map(([a]) => a), ["obsolete", "reopen"]);
assert.equal(wipAllows(WIP_CAP - 1), true);
assert.equal(wipAllows(WIP_CAP), false);

// Task lanes and auto-done.
assert.equal(taskLane("TODO", false), "TODO");
assert.equal(taskLane("TODO", true), "TODAY");
assert.equal(taskLane("DONE", true), "DONE");
assert.equal(taskLane("DROPPED", false), "DONE");
const t = (status: "TODO" | "DONE" | "DROPPED", reviewed: boolean) => ({ status, reviewedAt: reviewed ? now : null });
assert.equal(awaitsReview(t("DONE", false)), true);
assert.equal(awaitsReview(t("DONE", true)), false);
assert.equal(awaitsReview(t("TODO", false)), false);
assert.equal(autoDone([]), false);
assert.equal(autoDone([t("DONE", true)]), true);
assert.equal(autoDone([t("DONE", true), t("TODO", false)]), false);
assert.equal(autoDone([t("DONE", false)]), false); // finished by Amit, lead has not reviewed
assert.equal(autoDone([t("DROPPED", false)]), false); // nothing actually done
assert.equal(autoDone([t("DONE", true), t("DROPPED", false)]), true);

// Score.
assert.equal(keptPromise([]), null);
assert.equal(keptPromise([{ outcome: null }]), null);
assert.equal(keptPromise([{ outcome: "DONE" }, { outcome: "CARRIED" }, { outcome: "CARRIED" }, { outcome: "CARRIED" }]), 25);
assert.equal(keptPromise([{ outcome: "DONE" }, { outcome: null }]), 100);
assert.equal(keptPromise([{ outcome: "DONE" }, { outcome: "DONE" }, { outcome: "CARRIED" }]), 67);
assert.deepEqual(
  precheckTaskIds([
    { taskId: "a", outcome: "CARRIED", taskStatus: "TODO" },
    { taskId: "b", outcome: "CARRIED", taskStatus: "DONE" },
    { taskId: "c", outcome: "DONE", taskStatus: "TODO" },
  ]),
  ["a"],
);

// Gate.
assert.equal(gateStep({ weekend: true, hasOpenTasks: true, planned: false, picked: false, hasCandidates: true }), "today");
assert.equal(gateStep({ weekend: false, hasOpenTasks: false, planned: false, picked: false, hasCandidates: false }), "today");
assert.equal(gateStep({ weekend: false, hasOpenTasks: true, planned: false, picked: false, hasCandidates: false }), "plan");
assert.equal(gateStep({ weekend: false, hasOpenTasks: true, planned: true, picked: false, hasCandidates: true }), "pick");
assert.equal(gateStep({ weekend: false, hasOpenTasks: true, planned: true, picked: false, hasCandidates: false }), "today"); // plan has no task for me
assert.equal(gateStep({ weekend: false, hasOpenTasks: true, planned: true, picked: true, hasCandidates: true }), "today");

// Timeline lines.
assert.equal(eventLine({ kind: "TASK_DONE", detail: "Enable MFA", actor: "Amit" }), 'Amit finished "Enable MFA"');
assert.equal(eventLine({ kind: "AUTO_PAUSED", detail: "Untouched 28 days", actor: null }), "Paused automatically, untouched 28 days");
assert.equal(eventLine({ kind: "WORK_STATUS", detail: "Ideas → Working", actor: "Lakshmanan" }), "Lakshmanan moved it Ideas → Working");
assert.equal(eventLine({ kind: "CARRIED", detail: "Enable MFA", actor: null }), '"Enable MFA" carried over');

// Request bodies.
assert.equal(createWorkZ.safeParse({ title: "  " }).success, false);
assert.equal(createWorkZ.safeParse({ title: " XBRL " }).data?.title, "XBRL");
assert.equal(picksZ.safeParse({ taskIds: ["a", "b", "c", "d"] }).success, false);
assert.equal(picksZ.safeParse({ taskIds: [] }).success, false);
assert.equal(PICK_CAP, 3);

console.log("verify-work: all checks passed");
```

Add to `package.json` scripts, after `"verify:clients"`:

```json
    "verify:work": "tsx scripts/verify-work.ts"
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx tsx scripts/verify-work.ts`
Expected: fails with `Cannot find module '../src/lib/work/core'`.

- [ ] **Step 5: Write `src/lib/work/core.ts`**

```ts
// Pure rules for the tech work tracker. No Prisma, no fetch — everything here is
// exercised by scripts/verify-work.ts. db.ts applies these against the database.
import { z } from "zod";
import type { DayPickOutcome, WorkEventKind, WorkStatus, WorkTaskStatus } from "@prisma/client";

export const WIP_CAP = 3;
export const PLAN_CAP = 3;
export const PICK_CAP = 3;
export const STALE_DAYS = 14;
export const AUTO_PAUSE_DAYS = 28;

export const WORK_STATUS_ORDER: WorkStatus[] = ["INBOX", "ACTIVE", "PARKED", "DONE", "OBSOLETE"];
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  INBOX: "Ideas",
  ACTIVE: "Working",
  PARKED: "Paused",
  DONE: "Done",
  OBSOLETE: "Obsolete",
};

export type Actor = { id: string; email: string; name: string; isLead: boolean };
export type Result<T = Record<string, never>> = { ok: true; data: T } | { ok: false; error: string };

// ---------------- access ----------------

/** Emails allowed into /work, lowercased, in env order. The first one is the lead. */
export function trackerEmails(env: string | undefined = process.env.WORK_TRACKER_EMAILS): string[] {
  return (env ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export function canUseWork(email: string | null | undefined, emails: string[] = trackerEmails()): boolean {
  return !!email && emails.includes(email.toLowerCase());
}
export function isWorkLead(email: string | null | undefined, emails: string[] = trackerEmails()): boolean {
  return !!email && emails.length > 0 && emails[0] === email.toLowerCase();
}

// ---------------- IST clock (India has no DST, so a fixed offset is exact) ----------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const shifted = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

/** "YYYY-MM-DD" of the IST calendar day. */
export function istDayKey(d: Date): string {
  return shifted(d).toISOString().slice(0, 10);
}
/** 00:00 IST of the IST calendar day, as a UTC instant. */
export function istDayStart(d: Date): Date {
  const s = shifted(d);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - IST_OFFSET_MS);
}
/** 0 = Sunday … 6 = Saturday, in IST. */
export function istWeekday(d: Date): number {
  return shifted(d).getUTCDay();
}
export function isWeekend(d: Date): boolean {
  const w = istWeekday(d);
  return w === 0 || w === 6;
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
/** Monday 00:00 IST of the IST week containing d. */
export function istWeekStart(d: Date): Date {
  return addDays(istDayStart(d), -((istWeekday(d) + 6) % 7));
}
/** The 1st, 00:00 IST, of the IST month containing d. */
export function istMonthStart(d: Date): Date {
  const s = shifted(d);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1) - IST_OFFSET_MS);
}
/** "YYYY-MM-DD" → 00:00 IST of that day, or null when malformed. */
export function parseDayKey(key: string | undefined): Date | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const t = Date.parse(`${key}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : new Date(t - IST_OFFSET_MS);
}

// ---------------- stale ----------------

export function daysUntouched(lastTouchedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - lastTouchedAt.getTime()) / DAY_MS));
}
export function isStale(status: WorkStatus, lastTouchedAt: Date, now: Date): boolean {
  return status === "ACTIVE" && daysUntouched(lastTouchedAt, now) >= STALE_DAYS;
}
export function shouldAutoPause(status: WorkStatus, lastTouchedAt: Date, now: Date): boolean {
  return status === "ACTIVE" && daysUntouched(lastTouchedAt, now) >= AUTO_PAUSE_DAYS;
}

// ---------------- work status transitions ----------------

export const WORK_ACTIONS = ["activate", "pause", "finish", "obsolete", "reopen"] as const;
export type WorkAction = (typeof WORK_ACTIONS)[number];

/** Where an action takes a work from its current status, or null when not allowed. */
export function nextStatus(action: WorkAction, from: WorkStatus): WorkStatus | null {
  switch (action) {
    case "activate":
      return from === "INBOX" || from === "PARKED" ? "ACTIVE" : null;
    case "pause":
      return from === "ACTIVE" ? "PARKED" : null;
    case "finish":
      return from === "ACTIVE" ? "DONE" : null;
    case "obsolete":
      return from === "OBSOLETE" ? null : "OBSOLETE";
    case "reopen":
      return from === "DONE" ? "ACTIVE" : from === "OBSOLETE" ? "INBOX" : null;
  }
}
/** Which action a drag from one board column to another means, or null if that move is not allowed. */
export function actionForMove(from: WorkStatus, to: WorkStatus): WorkAction | null {
  if (from === to) return null;
  for (const a of WORK_ACTIONS) if (nextStatus(a, from) === to) return a;
  return null;
}
/** Buttons to show on a card in this status: [action, label]. */
export function actionsFor(status: WorkStatus): Array<[WorkAction, string]> {
  const labels: Record<WorkAction, string> = {
    activate: status === "PARKED" ? "Resume" : "Start",
    pause: "Pause",
    finish: "Finish",
    obsolete: "Obsolete",
    reopen: "Reopen",
  };
  return WORK_ACTIONS.filter((a) => nextStatus(a, status) !== null).map((a) => [a, labels[a]]);
}
export function wipAllows(activeCount: number): boolean {
  return activeCount < WIP_CAP;
}

// ---------------- tasks ----------------

export const TASK_ACTIONS = ["done", "drop", "reopen", "review"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];
export type TaskLane = "TODO" | "TODAY" | "DONE";

export function taskLane(status: WorkTaskStatus, pickedToday: boolean): TaskLane {
  if (status !== "TODO") return "DONE";
  return pickedToday ? "TODAY" : "TODO";
}
/** A finished task waits for the lead's tick. The lead's own tasks are reviewed on completion. */
export function awaitsReview(t: { status: WorkTaskStatus; reviewedAt: Date | null }): boolean {
  return t.status === "DONE" && t.reviewedAt === null;
}
/** A work finishes itself when nothing is open, nothing awaits review, and something was actually done. */
export function autoDone(tasks: Array<{ status: WorkTaskStatus; reviewedAt: Date | null }>): boolean {
  return (
    tasks.length > 0 &&
    tasks.every((t) => t.status !== "TODO") &&
    !tasks.some(awaitsReview) &&
    tasks.some((t) => t.status === "DONE")
  );
}

// ---------------- picks, score, gate ----------------

/** Percent of closed picks that were kept; null until at least one pick has closed. */
export function keptPromise(picks: Array<{ outcome: DayPickOutcome | null }>): number | null {
  const closed = picks.filter((p) => p.outcome !== null);
  if (closed.length === 0) return null;
  return Math.round((100 * closed.filter((p) => p.outcome === "DONE").length) / closed.length);
}
/** Tasks to pre-check next morning: carried on the most recent pick day and still open. */
export function precheckTaskIds(
  lastDayPicks: Array<{ taskId: string; outcome: DayPickOutcome | null; taskStatus: WorkTaskStatus }>,
): string[] {
  return lastDayPicks.filter((p) => p.outcome === "CARRIED" && p.taskStatus === "TODO").map((p) => p.taskId);
}
export type PickGroup = { workId: string; workTitle: string; tasks: { id: string; title: string }[] };
export type GateStep = "plan" | "pick" | "today";
/** hasCandidates = open tasks of mine inside this week's planned Working items, not yet picked today.
 *  Without it the pick step could be a dead end (plan set, but no task to promise). */
export function gateStep(i: { weekend: boolean; hasOpenTasks: boolean; planned: boolean; picked: boolean; hasCandidates: boolean }): GateStep {
  if (i.weekend || !i.hasOpenTasks) return "today";
  if (!i.planned) return "plan";
  if (!i.picked && i.hasCandidates) return "pick";
  return "today";
}

// ---------------- timeline ----------------

export function eventLine(e: { kind: WorkEventKind; detail: string | null; actor: string | null }): string {
  const who = e.actor ?? "System";
  const d = e.detail ?? "";
  switch (e.kind) {
    case "WORK_CREATED":
      return `${who} captured "${d}"`;
    case "WORK_STATUS":
      return `${who} moved it ${d}`;
    case "WORK_REOPENED":
      return `${who} reopened it`;
    case "TASK_CREATED":
      return `${who} added "${d}"`;
    case "TASK_DONE":
      return `${who} finished "${d}"`;
    case "TASK_DROPPED":
      return `${who} dropped "${d}"`;
    case "TASK_REVIEWED":
      return `${who} reviewed "${d}"`;
    case "TASK_REOPENED":
      return `${who} reopened "${d}"`;
    case "PICKED":
      return `${who} picked "${d}" for the day`;
    case "CARRIED":
      return `"${d}" carried over`;
    case "AUTO_PAUSED":
      return `Paused automatically, ${d.toLowerCase()}`;
    case "WEEK_PLANNED":
      return `${who} planned it for the week of ${d}`;
    case "WEEK_REVIEWED":
      return `${who} reviewed the week of ${d}`;
  }
}

// ---------------- request bodies ----------------

export const createWorkZ = z.object({
  title: z.string().trim().min(1, "Give it a title").max(120, "Title is too long"),
  why: z.string().trim().max(200, "Keep 'why' to one line").optional(),
});
export const workActionZ = z.object({
  action: z.enum(WORK_ACTIONS),
  reason: z.string().trim().max(200, "Keep the reason to one line").optional(),
});
export const createTaskZ = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(160, "Task title is too long"),
  assigneeId: z.string().min(1),
});
export const taskActionZ = z.object({ action: z.enum(TASK_ACTIONS) });
export const planZ = z.object({
  workIds: z.array(z.string().min(1)).max(PLAN_CAP, `Pick at most ${PLAN_CAP} works for the week`),
});
export const picksZ = z.object({
  taskIds: z.array(z.string().min(1)).min(1, "Pick at least one task").max(PICK_CAP, `Only ${PICK_CAP} picks a day`),
});
```

- [ ] **Step 6: Run the self-check and typecheck**

Run: `npx tsx scripts/verify-work.ts && npx tsc --noEmit`
Expected: `verify-work: all checks passed` and no type errors.

- [ ] **Step 7: Amend the spec to match three rule refinements**

In `docs/superpowers/specs/2026-09-04-work-tracker-design.md`:

1. Replace the sentence
   `lastTouchedAt` is a denormalised copy of the latest event time for the work. Every
   action that writes a `WorkEvent` for a work also sets `lastTouchedAt` in the same
   transaction.
   with:
   `lastTouchedAt` is bumped by every human action that writes a `WorkEvent`, in the same
   transaction. Cron-written events (`CARRIED`, `AUTO_PAUSED`) do not bump it, so carrying a
   task every day cannot keep a work from going stale.
2. Replace `- Any status `→ OBSOLETE`: by lead, `obsoleteReason` required.` with:
   `- Any status `→ OBSOLETE`: by owner or lead, `obsoleteReason` required. `OBSOLETE → INBOX` ("Reopen") for a mistaken obsolete.`
3. In "Decisions taken", Roles row, replace `Amit sees all works, adds tasks to himself, ticks his own tasks, cannot change work status.` with `Amit sees all works, adds tasks to himself, ticks his own tasks, and may change the status only of works he owns (ideas he captured).` And in Rules → Work status, replace every `by lead` in the `INBOX → ACTIVE`, `ACTIVE ↔ PARKED`, `ACTIVE → DONE` bullets with `by owner or lead`.
4. In Rules → Day pick, after the bullet starting `- A person with no open `TODO` task`, add:
   `- A person whose plan holds no open task of theirs (not yet picked today) also passes the gate; the Today view says so and points to the board and the Week page. The gate never dead-ends.`

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma src/lib/work/core.ts scripts/verify-work.ts package.json docs/superpowers/specs/2026-09-04-work-tracker-design.md
git commit -m "Work tracker: schema, pure rules and self-check

Work/WorkTask/WeekPlanWork/DayPick/WeekReview/WorkEvent models, Settings.workTeamsChatId.
core.ts holds every rule (IST clock, stale, transitions, auto-done, score, gate) with no
Prisma import; scripts/verify-work.ts asserts them. Spec amended: cron events do not bump
lastTouchedAt, obsolete can be reopened to Ideas, owner or lead changes status.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Database layer, actor and HTTP helpers

**Files:**
- Create: `src/lib/work/db.ts`
- Create: `src/lib/work/actor.ts`
- Create: `src/lib/work/http.ts`

**Interfaces:**
- Consumes (core.ts): constants, `Actor`, `Result`, `WorkAction`, `TaskAction`, clock, rules.
- Produces (db.ts): `TrackerUser`, `touch`, `trackerUsers`, `createWork`, `changeWorkStatus`, `createTask`, `taskAction`, `setWeekPlan`, `addPicks`, `completeReview`, `staleWorksFor`, `closeDay`, `gateState`, `planCandidates`, `pickCandidates`, `todayPicks`, `weekStats`, `usersMissingPick`, `usersMissingReview`. Signatures are in the code below and are relied on verbatim by Tasks 3–7.
- Produces (actor.ts): `actorFrom(session)`, `currentActor()`.
- Produces (http.ts): `notFoundJson()`, `parseBody(schema, req)`, `fromResult(result, status?)`.

- [ ] **Step 1: Write `src/lib/work/db.ts`**

```ts
// Database operations for the tech work tracker. Every write runs in a transaction
// that also appends a WorkEvent, so the timeline is complete by construction.
// The rules themselves live in ./core.ts; this file only applies them.
import { Prisma, type WorkEventKind, type WorkStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AUTO_PAUSE_DAYS, PICK_CAP, PLAN_CAP, STALE_DAYS, WIP_CAP, WORK_STATUS_LABELS,
  addDays, autoDone, gateStep, isWeekend, istDayKey, istDayStart, istMonthStart, istWeekStart,
  keptPromise, nextStatus, precheckTaskIds, trackerEmails, wipAllows,
  type Actor, type PickGroup, type Result, type TaskAction, type WorkAction,
} from "./core";

type Tx = Prisma.TransactionClient;
const fail = (error: string): Result<never> => ({ ok: false, error });
function okr<T>(data: T): Result<T> {
  return { ok: true, data };
}
const NONE: Record<string, never> = {};

/** Append a timeline row. Human actions also bump lastTouchedAt; cron sweeps pass bump=false. */
export async function touch(
  tx: Tx,
  workId: string,
  e: { kind: WorkEventKind; taskId?: string; userId?: string | null; detail?: string | null },
  at: Date = new Date(),
  bump = true,
): Promise<void> {
  await tx.workEvent.create({
    data: { workId, taskId: e.taskId ?? null, userId: e.userId ?? null, kind: e.kind, detail: e.detail ?? null, at },
  });
  if (bump) await tx.work.update({ where: { id: workId }, data: { lastTouchedAt: at } });
}

export type TrackerUser = { id: string; email: string; name: string };

/** Tracker users in env order (lead first). Emails with no User row yet are skipped. */
export async function trackerUsers(): Promise<TrackerUser[]> {
  const emails = trackerEmails();
  if (emails.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { email: { in: emails, mode: "insensitive" } },
    select: { id: true, email: true, name: true },
  });
  return emails.flatMap((e) => {
    const u = rows.find((r) => r.email.toLowerCase() === e);
    return u ? [{ id: u.id, email: u.email, name: u.name ?? u.email }] : [];
  });
}

// ---------------- works ----------------

export async function createWork(input: { title: string; why?: string }, actor: Actor, now = new Date()): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const work = await tx.work.create({
      data: { title: input.title, why: input.why || null, ownerId: actor.id, createdById: actor.id },
      select: { id: true, title: true },
    });
    await touch(tx, work.id, { kind: "WORK_CREATED", userId: actor.id, detail: work.title }, now);
    return { id: work.id };
  });
}

const WIP_MESSAGE = `${WIP_CAP} works already active, pause or finish one first`;

export async function changeWorkStatus(
  workId: string,
  action: WorkAction,
  actor: Actor,
  reason?: string,
  now = new Date(),
): Promise<Result<{ status: WorkStatus }>> {
  const why = reason?.trim() ?? "";
  if (action === "obsolete" && !why) return fail("Give a reason for marking it obsolete");
  return prisma.$transaction(async (tx) => {
    const work = await tx.work.findUnique({ where: { id: workId } });
    if (!work) return fail("Work not found");
    if (!actor.isLead && work.ownerId !== actor.id) return fail("Only the owner or the lead can change this");
    const to = nextStatus(action, work.status);
    if (!to) return fail(`Cannot ${action} work that is ${WORK_STATUS_LABELS[work.status].toLowerCase()}`);
    if (to === "ACTIVE") {
      const active = await tx.work.count({ where: { ownerId: work.ownerId, status: "ACTIVE" } });
      if (!wipAllows(active)) return fail(WIP_MESSAGE);
    }
    await tx.work.update({
      where: { id: workId },
      data: {
        status: to,
        doneAt: to === "DONE" ? now : to === "ACTIVE" ? null : undefined,
        obsoleteReason: to === "OBSOLETE" ? why : undefined,
      },
    });
    await touch(
      tx,
      workId,
      {
        kind: action === "reopen" ? "WORK_REOPENED" : "WORK_STATUS",
        userId: actor.id,
        detail: `${WORK_STATUS_LABELS[work.status]} → ${WORK_STATUS_LABELS[to]}${why ? `: ${why}` : ""}`,
      },
      now,
    );
    return okr({ status: to });
  });
}

// ---------------- tasks ----------------

export async function createTask(
  workId: string,
  input: { title: string; assigneeId: string },
  actor: Actor,
  now = new Date(),
): Promise<Result<{ id: string }>> {
  if (!actor.isLead && input.assigneeId !== actor.id) return fail("You can only add tasks for yourself");
  const users = await trackerUsers();
  if (!users.some((u) => u.id === input.assigneeId)) return fail("Assignee must be a tracker user");
  return prisma.$transaction(async (tx) => {
    const work = await tx.work.findUnique({ where: { id: workId }, select: { status: true, _count: { select: { tasks: true } } } });
    if (!work) return fail("Work not found");
    if (!actor.isLead && work.status !== "ACTIVE") return fail("Tasks can only be added to work that is Working");
    const task = await tx.workTask.create({
      data: { workId, title: input.title, assigneeId: input.assigneeId, createdById: actor.id, order: work._count.tasks },
      select: { id: true, title: true },
    });
    await touch(tx, workId, { kind: "TASK_CREATED", taskId: task.id, userId: actor.id, detail: task.title }, now);
    return okr({ id: task.id });
  });
}

/** done / drop / reopen / review. Also closes today's pick and may finish the work. */
export async function taskAction(taskId: string, action: TaskAction, actor: Actor, now = new Date()): Promise<Result<{ workDone: boolean }>> {
  const day = istDayStart(now);
  return prisma.$transaction(async (tx) => {
    const task = await tx.workTask.findUnique({ where: { id: taskId }, include: { work: { select: { status: true } } } });
    if (!task) return fail("Task not found");
    if (!actor.isLead && task.assigneeId !== actor.id) return fail("Not your task");
    const ev = (kind: WorkEventKind) => touch(tx, task.workId, { kind, taskId, userId: actor.id, detail: task.title }, now);

    switch (action) {
      case "done":
        if (task.status !== "TODO") return fail("Task is not open");
        await tx.workTask.update({ where: { id: taskId }, data: { status: "DONE", doneAt: now, reviewedAt: actor.isLead ? now : null } });
        await tx.dayPick.updateMany({ where: { taskId, day, outcome: null }, data: { outcome: "DONE" } });
        await ev("TASK_DONE");
        break;
      case "drop":
        if (!actor.isLead) return fail("Only the lead can drop a task");
        if (task.status !== "TODO") return fail("Task is not open");
        await tx.workTask.update({ where: { id: taskId }, data: { status: "DROPPED", doneAt: now } });
        await tx.dayPick.updateMany({ where: { taskId, outcome: null }, data: { outcome: "CARRIED" } });
        await ev("TASK_DROPPED");
        break;
      case "reopen":
        if (task.status === "TODO") return fail("Task is already open");
        if (task.work.status === "DONE" || task.work.status === "OBSOLETE") return fail("Reopen the work first");
        await tx.workTask.update({ where: { id: taskId }, data: { status: "TODO", doneAt: null, reviewedAt: null } });
        await ev("TASK_REOPENED");
        break;
      case "review":
        if (!actor.isLead) return fail("Only the lead reviews");
        if (task.status !== "DONE" || task.reviewedAt) return fail("Nothing to review");
        await tx.workTask.update({ where: { id: taskId }, data: { reviewedAt: now } });
        await ev("TASK_REVIEWED");
        break;
    }

    let workDone = false;
    if (task.work.status === "ACTIVE" && action !== "reopen") {
      const tasks = await tx.workTask.findMany({ where: { workId: task.workId }, select: { status: true, reviewedAt: true } });
      if (autoDone(tasks)) {
        await tx.work.update({ where: { id: task.workId }, data: { status: "DONE", doneAt: now } });
        await touch(tx, task.workId, { kind: "WORK_STATUS", userId: null, detail: "Working → Done, all tasks finished" }, now);
        workDone = true;
      }
    }
    return okr({ workDone });
  });
}

// ---------------- week plan ----------------

/** Replace the actor's plan for the current week. Lead may plan INBOX works, which activates them. */
export async function setWeekPlan(workIds: string[], actor: Actor, now = new Date()): Promise<Result> {
  const weekStart = istWeekStart(now);
  const ids = [...new Set(workIds)];
  if (ids.length > PLAN_CAP) return fail(`Pick at most ${PLAN_CAP} works for the week`);
  return prisma.$transaction(async (tx) => {
    const works = await tx.work.findMany({ where: { id: { in: ids } } });
    if (works.length !== ids.length) return fail("Unknown work");
    for (const w of works) {
      if (w.status === "ACTIVE") continue;
      if (w.status === "INBOX" && actor.isLead) {
        const active = await tx.work.count({ where: { ownerId: w.ownerId, status: "ACTIVE" } });
        if (!wipAllows(active)) return fail(WIP_MESSAGE);
        await tx.work.update({ where: { id: w.id }, data: { status: "ACTIVE", doneAt: null } });
        await touch(tx, w.id, { kind: "WORK_STATUS", userId: actor.id, detail: "Ideas → Working, added to the week plan" }, now);
        continue;
      }
      return fail(`"${w.title}" is ${WORK_STATUS_LABELS[w.status].toLowerCase()}, only Working items can be planned`);
    }
    const existing = await tx.weekPlanWork.findMany({ where: { userId: actor.id, weekStart }, select: { workId: true } });
    const have = new Set(existing.map((e) => e.workId));
    await tx.weekPlanWork.deleteMany({ where: { userId: actor.id, weekStart, workId: { notIn: ids } } });
    for (const id of ids) {
      if (have.has(id)) continue;
      await tx.weekPlanWork.create({ data: { userId: actor.id, weekStart, workId: id } });
      await touch(tx, id, { kind: "WEEK_PLANNED", userId: actor.id, detail: istDayKey(weekStart) }, now);
    }
    return okr(NONE);
  });
}

// ---------------- day picks ----------------

export async function addPicks(taskIds: string[], actor: Actor, now = new Date()): Promise<Result> {
  if (isWeekend(now)) return fail("No picks on weekends");
  const day = istDayStart(now);
  const weekStart = istWeekStart(now);
  const ids = [...new Set(taskIds)];
  return prisma.$transaction(async (tx) => {
    const existing = await tx.dayPick.count({ where: { userId: actor.id, day } });
    if (existing + ids.length > PICK_CAP) return fail(`Only ${PICK_CAP} picks a day, ${existing} already picked`);
    const tasks = await tx.workTask.findMany({
      where: { id: { in: ids } },
      include: { work: { select: { status: true, title: true, weekPlans: { where: { userId: actor.id, weekStart }, select: { id: true } } } } },
    });
    if (tasks.length !== ids.length) return fail("Unknown task");
    for (const t of tasks) {
      if (t.assigneeId !== actor.id) return fail(`"${t.title}" is not your task`);
      if (t.status !== "TODO") return fail(`"${t.title}" is not open`);
      if (t.work.status !== "ACTIVE") return fail(`"${t.work.title}" is not Working`);
      if (t.work.weekPlans.length === 0) return fail(`"${t.work.title}" is not in your plan this week`);
    }
    for (const t of tasks) {
      const dup = await tx.dayPick.findUnique({ where: { userId_day_taskId: { userId: actor.id, day, taskId: t.id } } });
      if (dup) continue;
      await tx.dayPick.create({ data: { userId: actor.id, day, taskId: t.id } });
      await touch(tx, t.workId, { kind: "PICKED", taskId: t.id, userId: actor.id, detail: t.title }, now);
    }
    return okr(NONE);
  });
}

// ---------------- review ----------------

export function staleWorksFor(ownerId: string, now = new Date()) {
  return prisma.work.findMany({
    where: { ownerId, status: "ACTIVE", lastTouchedAt: { lte: addDays(now, -STALE_DAYS) } },
    orderBy: { lastTouchedAt: "asc" },
    select: { id: true, title: true, lastTouchedAt: true },
  });
}

export async function completeReview(actor: Actor, now = new Date()): Promise<Result> {
  const weekStart = istWeekStart(now);
  const stale = await staleWorksFor(actor.id, now);
  if (stale.length > 0) return fail(`${stale.length} stale work${stale.length > 1 ? "s" : ""} still need a decision`);
  return prisma.$transaction(async (tx) => {
    const dup = await tx.weekReview.findUnique({ where: { userId_weekStart: { userId: actor.id, weekStart } } });
    if (dup) return okr(NONE);
    await tx.weekReview.create({ data: { userId: actor.id, weekStart, doneAt: now } });
    const plan = await tx.weekPlanWork.findMany({ where: { userId: actor.id, weekStart }, select: { workId: true } });
    for (const p of plan) await touch(tx, p.workId, { kind: "WEEK_REVIEWED", userId: actor.id, detail: istDayKey(weekStart) }, now);
    return okr(NONE);
  });
}

// ---------------- nightly close ----------------

/** Flip today's unfinished picks to CARRIED and auto-pause works untouched 28 days. */
export async function closeDay(now = new Date()): Promise<{ carried: number; paused: number }> {
  const day = istDayStart(now);
  const open = await prisma.dayPick.findMany({
    where: { day, outcome: null, task: { status: "TODO" } },
    select: { id: true, taskId: true, userId: true, task: { select: { workId: true, title: true } } },
  });
  for (const p of open) {
    await prisma.$transaction(async (tx) => {
      await tx.dayPick.update({ where: { id: p.id }, data: { outcome: "CARRIED" } });
      await touch(tx, p.task.workId, { kind: "CARRIED", taskId: p.taskId, userId: p.userId, detail: p.task.title }, now, false);
    });
  }
  const tired = await prisma.work.findMany({
    where: { status: "ACTIVE", lastTouchedAt: { lte: addDays(now, -AUTO_PAUSE_DAYS) } },
    select: { id: true },
  });
  for (const w of tired) {
    await prisma.$transaction(async (tx) => {
      await tx.work.update({ where: { id: w.id }, data: { status: "PARKED" } });
      await touch(tx, w.id, { kind: "AUTO_PAUSED", userId: null, detail: `Untouched ${AUTO_PAUSE_DAYS} days` }, now, false);
    });
  }
  return { carried: open.length, paused: tired.length };
}

// ---------------- page queries ----------------

export async function gateState(userId: string, now = new Date()) {
  const weekStart = istWeekStart(now);
  const day = istDayStart(now);
  const [planned, picked, open, candidates] = await Promise.all([
    prisma.weekPlanWork.count({ where: { userId, weekStart } }),
    prisma.dayPick.count({ where: { userId, day } }),
    prisma.workTask.count({ where: { assigneeId: userId, status: "TODO", work: { status: "ACTIVE" } } }),
    prisma.workTask.count({
      where: { assigneeId: userId, status: "TODO", work: { status: "ACTIVE", weekPlans: { some: { userId, weekStart } } }, picks: { none: { userId, day } } },
    }),
  ]);
  const weekend = isWeekend(now);
  const flags = { weekend, hasOpenTasks: open > 0, planned: planned > 0, picked: picked > 0, hasCandidates: candidates > 0 };
  return { ...flags, pickCount: picked, step: gateStep(flags) };
}

/** Works the actor may put in a week plan: Working for everyone, plus Ideas for the lead. */
export function planCandidates(actor: Actor) {
  const statuses: WorkStatus[] = actor.isLead ? ["ACTIVE", "INBOX"] : ["ACTIVE"];
  return prisma.work.findMany({
    where: { status: { in: statuses } },
    orderBy: [{ status: "asc" }, { lastTouchedAt: "desc" }],
    select: { id: true, title: true, status: true, owner: { select: { name: true, email: true } } },
  });
}

/** The actor's open tasks in this week's planned Working items, not yet picked today, plus carried ids to pre-check. */
export async function pickCandidates(userId: string, now = new Date()): Promise<{ groups: PickGroup[]; precheck: string[] }> {
  const weekStart = istWeekStart(now);
  const day = istDayStart(now);
  const tasks = await prisma.workTask.findMany({
    where: {
      assigneeId: userId,
      status: "TODO",
      work: { status: "ACTIVE", weekPlans: { some: { userId, weekStart } } },
      picks: { none: { userId, day } },
    },
    orderBy: [{ work: { title: "asc" } }, { order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, work: { select: { id: true, title: true } } },
  });
  const last = await prisma.dayPick.findFirst({ where: { userId, day: { lt: day } }, orderBy: { day: "desc" }, select: { day: true } });
  const lastPicks = last
    ? await prisma.dayPick.findMany({ where: { userId, day: last.day }, select: { taskId: true, outcome: true, task: { select: { status: true } } } })
    : [];
  const precheck = precheckTaskIds(lastPicks.map((p) => ({ taskId: p.taskId, outcome: p.outcome, taskStatus: p.task.status })));
  const groups = new Map<string, PickGroup>();
  for (const t of tasks) {
    const g = groups.get(t.work.id) ?? { workId: t.work.id, workTitle: t.work.title, tasks: [] };
    g.tasks.push({ id: t.id, title: t.title });
    groups.set(t.work.id, g);
  }
  return { groups: [...groups.values()], precheck };
}

export function todayPicks(userId: string, now = new Date()) {
  return prisma.dayPick.findMany({
    where: { userId, day: istDayStart(now) },
    orderBy: { id: "asc" },
    select: { taskId: true, outcome: true, task: { select: { title: true, status: true, work: { select: { id: true, title: true } } } } },
  });
}

export async function weekStats(userId: string, weekStart: Date, now = new Date()) {
  const weekEnd = addDays(weekStart, 7);
  const [picks, shippedWeek, shippedMonth, stale, review] = await Promise.all([
    prisma.dayPick.findMany({ where: { userId, day: { gte: weekStart, lt: weekEnd } }, select: { outcome: true } }),
    prisma.work.count({ where: { ownerId: userId, status: "DONE", doneAt: { gte: weekStart, lt: weekEnd } } }),
    prisma.work.count({ where: { ownerId: userId, status: "DONE", doneAt: { gte: istMonthStart(now) } } }),
    staleWorksFor(userId, now),
    prisma.weekReview.findUnique({ where: { userId_weekStart: { userId, weekStart } } }),
  ]);
  return { kept: keptPromise(picks), shippedWeek, shippedMonth, stale, reviewed: !!review };
}

// ---------------- nudges ----------------

export async function usersMissingPick(now = new Date()): Promise<TrackerUser[]> {
  const day = istDayStart(now);
  const out: TrackerUser[] = [];
  for (const u of await trackerUsers()) {
    const [open, picks] = await Promise.all([
      prisma.workTask.count({ where: { assigneeId: u.id, status: "TODO", work: { status: "ACTIVE" } } }),
      prisma.dayPick.count({ where: { userId: u.id, day } }),
    ]);
    if (open > 0 && picks === 0) out.push(u);
  }
  return out;
}

export async function usersMissingReview(now = new Date()): Promise<TrackerUser[]> {
  const weekStart = istWeekStart(now);
  const users = await trackerUsers();
  const done = await prisma.weekReview.findMany({ where: { weekStart, userId: { in: users.map((u) => u.id) } }, select: { userId: true } });
  const doneIds = new Set(done.map((d) => d.userId));
  return users.filter((u) => !doneIds.has(u.id));
}
```

- [ ] **Step 2: Write `src/lib/work/actor.ts`**

```ts
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { canUseWork, isWorkLead, type Actor } from "./core";

/** The tracker identity behind a session, or null when signed out or not on the list. */
export function actorFrom(session: Session | null): Actor | null {
  const email = session?.user?.email;
  if (!session?.user || !email || !canUseWork(email)) return null;
  return { id: session.user.id, email: email.toLowerCase(), name: session.user.name ?? email, isLead: isWorkLead(email) };
}

export async function currentActor(): Promise<Actor | null> {
  return actorFrom(await auth());
}
```

- [ ] **Step 3: Write `src/lib/work/http.ts`**

```ts
import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import type { Result } from "./core";

/** Outsiders get 404, not 403: the module should not be visible to the rest of the firm. */
export const notFoundJson = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function parseBody<T>(schema: ZodSchema<T>, req: Request): Promise<{ data: T; res?: undefined } | { data?: undefined; res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  return { res: NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 }) };
}

export function fromResult<T>(r: Result<T>, status = 200): NextResponse {
  return r.ok ? NextResponse.json(r.data, { status }) : NextResponse.json({ error: r.error }, { status: 400 });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If Prisma complains that `mode` is not accepted next to `in`, replace the `trackerUsers` query with `where: { OR: emails.map((email) => ({ email: { equals: email, mode: "insensitive" } })) }`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work/db.ts src/lib/work/actor.ts src/lib/work/http.ts
git commit -m "Work tracker: database layer, actor and route helpers

Every write is one transaction with its WorkEvent. Owner or lead changes status,
lead drops and reviews, picks must be open tasks in Working items planned this week.
closeDay carries unfinished picks and auto-pauses works untouched 28 days without
bumping lastTouchedAt.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: API routes

**Files:**
- Create: `src/app/api/work/route.ts`
- Create: `src/app/api/work/[id]/route.ts`
- Create: `src/app/api/work/[id]/tasks/route.ts`
- Create: `src/app/api/work/tasks/[taskId]/route.ts`
- Create: `src/app/api/work/week/route.ts`
- Create: `src/app/api/work/picks/route.ts`
- Create: `src/app/api/work/review/route.ts`

**Interfaces:**
- Consumes: `currentActor`, `parseBody`, `fromResult`, `notFoundJson`, zod bodies from core, db functions.
- Produces (HTTP, used by the client panels in Tasks 4–6):
  - `POST /api/work` body `{ title, why? }` → `201 { id }`
  - `PATCH /api/work/[id]` body `{ action: WorkAction, reason? }` → `{ status }`
  - `POST /api/work/[id]/tasks` body `{ title, assigneeId }` → `201 { id }`
  - `PATCH /api/work/tasks/[taskId]` body `{ action: TaskAction }` → `{ workDone }`
  - `PUT /api/work/week` body `{ workIds }` → `{}`
  - `POST /api/work/picks` body `{ taskIds }` → `{}`
  - `POST /api/work/review` no body → `{}`
  - Every refusal is `400 { error }` with the one-line message from db.ts; outsiders get `404`.

- [ ] **Step 1: `src/app/api/work/route.ts`**

```ts
import { NextResponse } from "next/server";
import { currentActor } from "@/lib/work/actor";
import { createWorkZ } from "@/lib/work/core";
import { createWork } from "@/lib/work/db";
import { notFoundJson, parseBody } from "@/lib/work/http";

// Capture an idea. Lands in INBOX, owned by whoever typed it.
export async function POST(req: Request) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(createWorkZ, req);
  if (body.res) return body.res;
  const work = await createWork(body.data, actor);
  return NextResponse.json(work, { status: 201 });
}
```

- [ ] **Step 2: `src/app/api/work/[id]/route.ts`**

```ts
import { currentActor } from "@/lib/work/actor";
import { workActionZ } from "@/lib/work/core";
import { changeWorkStatus } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

// Start / Resume / Pause / Finish / Obsolete / Reopen. Owner or lead.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(workActionZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return fromResult(await changeWorkStatus(id, body.data.action, actor, body.data.reason));
}
```

- [ ] **Step 3: `src/app/api/work/[id]/tasks/route.ts`**

```ts
import { currentActor } from "@/lib/work/actor";
import { createTaskZ } from "@/lib/work/core";
import { createTask } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(createTaskZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return fromResult(await createTask(id, body.data, actor), 201);
}
```

- [ ] **Step 4: `src/app/api/work/tasks/[taskId]/route.ts`**

```ts
import { currentActor } from "@/lib/work/actor";
import { taskActionZ } from "@/lib/work/core";
import { taskAction } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(taskActionZ, req);
  if (body.res) return body.res;
  const { taskId } = await params;
  return fromResult(await taskAction(taskId, body.data.action, actor));
}
```

- [ ] **Step 5: `src/app/api/work/week/route.ts`**

```ts
import { currentActor } from "@/lib/work/actor";
import { planZ } from "@/lib/work/core";
import { setWeekPlan } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

// Replace my plan for the current IST week.
export async function PUT(req: Request) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(planZ, req);
  if (body.res) return body.res;
  return fromResult(await setWeekPlan(body.data.workIds, actor));
}
```

- [ ] **Step 6: `src/app/api/work/picks/route.ts`**

```ts
import { currentActor } from "@/lib/work/actor";
import { picksZ } from "@/lib/work/core";
import { addPicks } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

// Promise up to PICK_CAP tasks for today. Picks are never removed.
export async function POST(req: Request) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(picksZ, req);
  if (body.res) return body.res;
  return fromResult(await addPicks(body.data.taskIds, actor), 201);
}
```

- [ ] **Step 7: `src/app/api/work/review/route.ts`**

```ts
import { currentActor } from "@/lib/work/actor";
import { completeReview } from "@/lib/work/db";
import { fromResult, notFoundJson } from "@/lib/work/http";

// "Review done" for the current week. Refused while stale works await a decision.
export async function POST() {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  return fromResult(await completeReview(actor));
}
```

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/api/work
git commit -m "Work tracker: API routes

Seven thin handlers over db.ts: create work, work status, create task, task action,
week plan, day picks, review done. Outsiders get 404.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Layout, shared client helpers, Today page with the gate

**Files:**
- Create: `src/app/work/layout.tsx`
- Create: `src/app/work/ui.ts`
- Create: `src/app/work/page.tsx`
- Create: `src/app/work/CaptureBox.tsx`
- Create: `src/app/work/PlanForm.tsx`
- Create: `src/app/work/PickForm.tsx`
- Create: `src/app/work/TodayList.tsx`

**Interfaces:**
- Consumes: `actorFrom`, `currentActor`, `gateState`, `planCandidates`, `pickCandidates`, `todayPicks`, `PICK_CAP`, `PLAN_CAP`, `PickGroup`, `WORK_STATUS_LABELS`; HTTP routes from Task 3.
- Produces: `call()` and class-string constants in `ui.ts`; `PlanForm` (`{ works: PlanWork[]; selected: string[]; cap: number }`) and `PlanWork` type, reused by Task 6; `PickForm` (`{ groups: PickGroup[]; precheck: string[]; remaining: number }`); `TodayList`; `CaptureBox`.

- [ ] **Step 1: `src/app/work/ui.ts`**

```ts
// Shared bits for the client panels under /work. No "use client" needed: plain module.
export type CallResult = { ok: boolean; error: string | null; data: Record<string, unknown> };

export async function call(url: string, body?: unknown, method = "POST"): Promise<CallResult> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, error: res.ok ? null : String(data.error ?? "Something went wrong"), data };
}

export const btn = "px-3 py-1.5 rounded-lg text-[12.5px] font-bold transition disabled:opacity-50 disabled:cursor-not-allowed";
export const btnPrimary = `${btn} bg-brand-500 hover:bg-brand-600 text-white`;
export const btnGhost = `${btn} border border-border text-ink-mute hover:bg-muted hover:text-ink`;
export const card = "rounded-2xl bg-card border border-border shadow-lift p-5";
export const h2 = "text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3";
export const field = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px] w-full";
export const errorText = "text-[12.5px] text-red-600";
```

- [ ] **Step 2: `src/app/work/layout.tsx`**

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { LogoMark } from "@/components/Logo";
import { actorFrom } from "@/lib/work/actor";

export const dynamic = "force-dynamic";

const link = "px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition";

// Signed-out users go to sign-in. Signed-in users who are not on WORK_TRACKER_EMAILS get a
// 404 so the module stays invisible to the rest of the firm.
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!actorFrom(session)) notFound();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/work" className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-faint uppercase tracking-[0.16em] font-extrabold">Tech work</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/work" className={link}>Today</Link>
            <Link href="/work/board" className={link}>Board</Link>
            <Link href="/work/week" className={link}>Week</Link>
            <Link href="/dashboard" className={`${link} flex items-center gap-2`}><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: `src/app/work/CaptureBox.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, call, field } from "./ui";

// One line in, one Ideas card out. Present on every Today screen, including the gate steps,
// so a passing thought can be parked without breaking the gate.
export function CaptureBox() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setNote(null);
    const r = await call("/api/work", { title });
    setBusy(false);
    if (!r.ok) {
      setNote(r.error);
      return;
    }
    setTitle("");
    setNote("Saved to Ideas");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <label className="block text-[11px] font-bold text-ink-mute mb-1.5">Capture an idea</label>
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="One line. It goes to Ideas and out of your way."
          className={field}
        />
        <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>Capture</button>
      </div>
      {note && <p className="mt-2 text-[12px] text-ink-mute">{note}</p>}
    </form>
  );
}
```

- [ ] **Step 4: `src/app/work/PlanForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import { WORK_STATUS_LABELS } from "@/lib/work/core";
import { btnPrimary, call, card, errorText } from "./ui";

export type PlanWork = { id: string; title: string; status: WorkStatus; owner: string };

// Choose up to `cap` works for the current week. PUT replaces the whole plan.
export function PlanForm({ works, selected, cap }: { works: PlanWork[]; selected: string[]; cap: number }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(selected);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function save() {
    setBusy(true);
    setError(null);
    const r = await call("/api/work/week", { workIds: ids }, "PUT");
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className={card}>
      {works.length === 0 ? (
        <p className="text-ink-mute text-[13.5px]">Nothing to plan yet. Only Working items can be planned; they are started from the board.</p>
      ) : (
        <ul className="space-y-2">
          {works.map((w) => {
            const on = ids.includes(w.id);
            const full = !on && ids.length >= cap;
            return (
              <li key={w.id}>
                <label className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${on ? "border-brand-500 bg-brand-50" : "border-border"} ${full ? "opacity-50" : "cursor-pointer"}`}>
                  <input type="checkbox" checked={on} disabled={full || busy} onChange={() => toggle(w.id)} className="w-4 h-4" />
                  <span className="font-semibold text-[14px] flex-1">{w.title}</span>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">{WORK_STATUS_LABELS[w.status]} · {w.owner}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={save} disabled={busy || ids.length === 0} className={btnPrimary}>Save plan ({ids.length}/{cap})</button>
        {error && <span className={errorText}>{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `src/app/work/PickForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PickGroup } from "@/lib/work/core";
import { btnPrimary, call, card, errorText, h2 } from "./ui";

// Promise up to `remaining` tasks for today. Carried tasks come pre-checked.
export function PickForm({ groups, precheck, remaining }: { groups: PickGroup[]; precheck: string[]; remaining: number }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(precheck.slice(0, remaining));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function save() {
    setBusy(true);
    setError(null);
    const r = await call("/api/work/picks", { taskIds: ids });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className={card}>
      {groups.length === 0 && <p className="text-ink-mute text-[13.5px]">No open tasks in this week's plan.</p>}
      {groups.map((g) => (
        <div key={g.workId} className="mb-4 last:mb-0">
          <p className={h2}>{g.workTitle}</p>
          <ul className="space-y-1.5">
            {g.tasks.map((t) => {
              const on = ids.includes(t.id);
              const full = !on && ids.length >= remaining;
              return (
                <li key={t.id}>
                  <label className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${on ? "border-brand-500 bg-brand-50" : "border-border"} ${full ? "opacity-50" : "cursor-pointer"}`}>
                    <input type="checkbox" checked={on} disabled={full || busy} onChange={() => toggle(t.id)} className="w-4 h-4" />
                    <span className="text-[14px] flex-1">{t.title}</span>
                    {precheck.includes(t.id) && <span className="text-[10.5px] uppercase tracking-wide text-amber-700">carried</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={save} disabled={busy || ids.length === 0} className={btnPrimary}>Promise these ({ids.length}/{remaining})</button>
        {error && <span className={errorText}>{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `src/app/work/TodayList.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DayPickOutcome, WorkTaskStatus } from "@prisma/client";
import { btnGhost, call, card, errorText } from "./ui";

export type TodayPick = { taskId: string; title: string; status: WorkTaskStatus; outcome: DayPickOutcome | null; workId: string; workTitle: string };

// Today's promises with tick boxes. Finishing the last task of a work finishes the work;
// the banner offers Undo, which reopens it.
export function TodayList({ picks }: { picks: TodayPick[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ workId: string; title: string } | null>(null);

  async function done(p: TodayPick) {
    setBusy(p.taskId);
    setError(null);
    const r = await call(`/api/work/tasks/${p.taskId}`, { action: "done" }, "PATCH");
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (r.data.workDone) setUndo({ workId: p.workId, title: p.workTitle });
    router.refresh();
  }

  async function reopenWork() {
    if (!undo) return;
    const r = await call(`/api/work/${undo.workId}`, { action: "reopen" }, "PATCH");
    if (!r.ok) setError(r.error);
    setUndo(null);
    router.refresh();
  }

  return (
    <div className={card}>
      <ul className="space-y-3">
        {picks.map((p) => {
          const finished = p.status !== "TODO";
          return (
            <li key={p.taskId} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={finished}
                disabled={finished || busy === p.taskId}
                onChange={() => done(p)}
                className="w-5 h-5"
                aria-label={`Finish ${p.title}`}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-[15px] font-semibold ${finished ? "line-through text-ink-faint" : ""}`}>{p.title}</p>
                <Link href={`/work/${p.workId}`} className="text-[12px] text-ink-mute hover:text-brand-600">{p.workTitle}</Link>
              </div>
              {p.outcome === "CARRIED" && <span className="text-[10.5px] uppercase tracking-wide text-amber-700">carried</span>}
            </li>
          );
        })}
      </ul>
      {undo && (
        <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] flex items-center justify-between gap-3">
          <span>&ldquo;{undo.title}&rdquo; is Done, all its tasks are finished.</span>
          <button type="button" onClick={reopenWork} className={btnGhost}>Undo</button>
        </div>
      )}
      {error && <p className={`mt-3 ${errorText}`}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 7: `src/app/work/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/work/actor";
import { PICK_CAP, PLAN_CAP } from "@/lib/work/core";
import { gateState, pickCandidates, planCandidates, todayPicks } from "@/lib/work/db";
import { CaptureBox } from "./CaptureBox";
import { PlanForm } from "./PlanForm";
import { PickForm } from "./PickForm";
import { TodayList } from "./TodayList";

export const dynamic = "force-dynamic";

function Shell({ kicker, title, sub, children }: { kicker: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="max-w-[720px] mx-auto">
      <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">{kicker}</p>
      <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">{title}</h1>
      <p className="text-ink-mute text-[15px] mt-1.5 mb-6">{sub}</p>
      {children}
      <div className="mt-8">
        <CaptureBox />
      </div>
    </div>
  );
}

// The gate: no week plan → plan; no pick today (and something to pick) → pick; else Today.
export default async function TodayPage() {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const now = new Date();
  const kicker = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  const gate = await gateState(actor.id, now);

  if (gate.step === "plan") {
    const works = await planCandidates(actor);
    return (
      <Shell kicker={kicker} title="Pick this week's work" sub={`Up to ${PLAN_CAP}. Everything else waits until next Monday.`}>
        <PlanForm works={works.map((w) => ({ id: w.id, title: w.title, status: w.status, owner: w.owner.name ?? w.owner.email }))} selected={[]} cap={PLAN_CAP} />
      </Shell>
    );
  }

  if (gate.step === "pick") {
    const { groups, precheck } = await pickCandidates(actor.id, now);
    return (
      <Shell kicker={kicker} title="Pick today" sub={`Up to ${PICK_CAP} tasks. A pick is a promise, it cannot be taken back.`}>
        <PickForm groups={groups} precheck={precheck} remaining={PICK_CAP} />
      </Shell>
    );
  }

  const picks = await todayPicks(actor.id, now);
  const remaining = PICK_CAP - picks.length;
  const more = !gate.weekend && remaining > 0 && gate.hasOpenTasks ? await pickCandidates(actor.id, now) : null;

  let title = "Today";
  let sub = "Tick what you finish. Unfinished picks carry to tomorrow.";
  if (gate.weekend) {
    title = "Weekend, nothing promised";
    sub = "Capture ideas if they come. The gate returns on Monday.";
  } else if (!gate.hasOpenTasks) {
    title = "Nothing assigned yet";
    sub = "Ask the lead for a task, or capture an idea below.";
  } else if (picks.length === 0) {
    title = "No open tasks in your plan";
    sub = "Add tasks on the board, or change the plan on the Week page.";
  }

  return (
    <Shell kicker={kicker} title={title} sub={sub}>
      {picks.length > 0 && (
        <TodayList
          picks={picks.map((p) => ({
            taskId: p.taskId,
            title: p.task.title,
            status: p.task.status,
            outcome: p.outcome,
            workId: p.task.work.id,
            workTitle: p.task.work.title,
          }))}
        />
      )}
      {more && more.groups.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-bold text-brand-600">Pick another ({remaining} left)</summary>
          <div className="mt-3">
            <PickForm groups={more.groups} precheck={[]} remaining={remaining} />
          </div>
        </details>
      )}
    </Shell>
  );
}
```

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/work/layout.tsx src/app/work/ui.ts src/app/work/page.tsx src/app/work/CaptureBox.tsx src/app/work/PlanForm.tsx src/app/work/PickForm.tsx src/app/work/TodayList.tsx
git commit -m "Work tracker: layout and Today page with the plan/pick gate

Weekdays: no plan → pick up to 3 works; no pick → promise up to 3 tasks; then the
day's list with tick boxes and a capture box that drops ideas into Ideas.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Board and work detail

**Files:**
- Create: `src/app/work/board/page.tsx`
- Create: `src/app/work/board/Board.tsx`
- Create: `src/app/work/[id]/page.tsx`
- Create: `src/app/work/[id]/WorkDetail.tsx`

**Interfaces:**
- Consumes: `currentActor`, `gateState`, `trackerUsers`, `prisma`; from core `WORK_STATUS_ORDER`, `WORK_STATUS_LABELS`, `actionForMove`, `actionsFor`, `daysUntouched`, `isStale`, `istDayStart`, `taskLane`, `awaitsReview`, `eventLine`, `WorkAction`, `TaskLane`; `call` and class strings from `../ui`; routes `PATCH /api/work/[id]`, `PATCH /api/work/tasks/[taskId]`, `POST /api/work/[id]/tasks`.
- Produces: `Board` (`{ cards: Card[]; isLead: boolean; meId: string }`), `WorkDetail`.

- [ ] **Step 1: `src/app/work/board/Board.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import { WORK_STATUS_LABELS, WORK_STATUS_ORDER, actionForMove, actionsFor, type WorkAction } from "@/lib/work/core";
import { btnGhost, call, errorText } from "../ui";

export type Card = { id: string; title: string; status: WorkStatus; ownerId: string; owner: string; openTasks: number; days: number; stale: boolean };

// Five columns in status order. Buttons and native HTML5 drag both call the same PATCH.
// Owner or lead may move a card; the server enforces this too.
export function Board({ cards, isLead, meId }: { cards: Card[]; isLead: boolean; meId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Card | null>(null);
  const canMove = (c: Card) => isLead || c.ownerId === meId;

  async function act(card: Card, action: WorkAction) {
    let reason: string | undefined;
    if (action === "obsolete") {
      const r = window.prompt(`Why is "${card.title}" obsolete?`);
      if (!r?.trim()) return;
      reason = r.trim();
    }
    setError(null);
    const r = await call(`/api/work/${card.id}`, { action, reason }, "PATCH");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  function drop(to: WorkStatus) {
    if (!dragging) return;
    const from = dragging;
    setDragging(null);
    const action = actionForMove(from.status, to);
    if (!action) {
      setError(`Cannot move from ${WORK_STATUS_LABELS[from.status]} to ${WORK_STATUS_LABELS[to]}`);
      return;
    }
    void act(from, action);
  }

  return (
    <div>
      {error && <p className={`mb-3 ${errorText}`}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {WORK_STATUS_ORDER.map((status) => {
          const inColumn = cards.filter((c) => c.status === status);
          return (
            <div
              key={status}
              onDragOver={(e) => { if (dragging && canMove(dragging)) e.preventDefault(); }}
              onDrop={() => drop(status)}
              className="rounded-2xl bg-muted/40 border border-border p-3 min-h-[200px]"
            >
              <p className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3">{WORK_STATUS_LABELS[status]} · {inColumn.length}</p>
              <div className="space-y-2">
                {inColumn.map((c) => (
                  <div
                    key={c.id}
                    draggable={canMove(c)}
                    onDragStart={() => setDragging(c)}
                    onDragEnd={() => setDragging(null)}
                    className="rounded-xl bg-card border border-border shadow-lift p-3"
                  >
                    <Link href={`/work/${c.id}`} className="font-semibold text-[14px] hover:text-brand-600 block">{c.title}</Link>
                    <p className="text-[11.5px] text-ink-mute mt-1">
                      {c.owner} · {c.openTasks} open · {c.days === 0 ? "today" : `${c.days}d ago`}
                      {c.stale && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold uppercase text-[10px]">Stale</span>}
                    </p>
                    {canMove(c) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {actionsFor(c.status).map(([a, label]) => (
                          <button key={a} type="button" onClick={() => act(c, a)} className={btnGhost}>{label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `src/app/work/board/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/work/actor";
import { daysUntouched, isStale } from "@/lib/work/core";
import { gateState } from "@/lib/work/db";
import { Board } from "./Board";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const now = new Date();
  const gate = await gateState(actor.id, now);
  if (gate.step !== "today") redirect("/work");

  const works = await prisma.work.findMany({
    orderBy: { lastTouchedAt: "desc" },
    select: {
      id: true, title: true, status: true, ownerId: true, lastTouchedAt: true,
      owner: { select: { name: true, email: true } },
      tasks: { where: { status: "TODO" }, select: { id: true } },
    },
  });
  const cards = works.map((w) => ({
    id: w.id,
    title: w.title,
    status: w.status,
    ownerId: w.ownerId,
    owner: w.owner.name ?? w.owner.email,
    openTasks: w.tasks.length,
    days: daysUntouched(w.lastTouchedAt, now),
    stale: isStale(w.status, w.lastTouchedAt, now),
  }));

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Board</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">All work</h1>
        <p className="text-ink-mute text-[14px] mt-1">Cards move themselves when you plan, finish tasks or go quiet. Drag or use the buttons to move one by hand.</p>
      </div>
      <Board cards={cards} isLead={actor.isLead} meId={actor.id} />
    </div>
  );
}
```

- [ ] **Step 3: `src/app/work/[id]/WorkDetail.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkStatus, WorkTaskStatus } from "@prisma/client";
import { WORK_STATUS_LABELS, actionsFor, type TaskAction, type TaskLane, type WorkAction } from "@/lib/work/core";
import { btnGhost, btnPrimary, call, card, errorText, field, h2, type CallResult } from "../ui";

export type TaskView = { id: string; title: string; status: WorkTaskStatus; assigneeId: string; assignee: string; lane: TaskLane; awaitsReview: boolean };

type Props = {
  work: { id: string; title: string; why: string | null; status: WorkStatus; owner: string; obsoleteReason: string | null; days: number; stale: boolean; canChange: boolean };
  tasks: TaskView[];
  users: { id: string; name: string }[];
  events: { id: string; line: string; when: string }[];
  isLead: boolean;
  meId: string;
};

const LANES: Array<[TaskLane, string]> = [["TODO", "To do"], ["TODAY", "Today"], ["DONE", "Done"]];

export function WorkDetail({ work, tasks, users, events, isLead, meId }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(false);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(meId);

  async function run(fn: () => Promise<CallResult>): Promise<CallResult> {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
    return r;
  }
  async function workAction(action: WorkAction) {
    let reason: string | undefined;
    if (action === "obsolete") {
      const r = window.prompt(`Why is "${work.title}" obsolete?`);
      if (!r?.trim()) return;
      reason = r.trim();
    }
    setUndo(false);
    await run(() => call(`/api/work/${work.id}`, { action, reason }, "PATCH"));
  }
  async function taskAct(id: string, action: TaskAction) {
    const r = await run(() => call(`/api/work/tasks/${id}`, { action }, "PATCH"));
    if (r.ok && r.data.workDone) setUndo(true);
  }
  async function addTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    const r = await run(() => call(`/api/work/${work.id}/tasks`, { title, assigneeId }));
    if (r.ok) setTitle("");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/work/board" className="text-[12.5px] font-semibold text-ink-mute hover:text-ink">← Board</Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-2">
          <div>
            <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em]">{work.title}</h1>
            <p className="text-ink-mute text-[14px] mt-1">{work.why ?? "No 'why' written yet."}</p>
            <p className="text-[12px] text-ink-faint mt-2 flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-muted font-bold uppercase tracking-wide text-[10.5px] text-ink">{WORK_STATUS_LABELS[work.status]}</span>
              <span>{work.owner} · last touched {work.days === 0 ? "today" : `${work.days}d ago`}</span>
              {work.stale && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold uppercase text-[10px]">Stale</span>}
              {work.obsoleteReason && <span>· {work.obsoleteReason}</span>}
            </p>
          </div>
          {work.canChange && (
            <div className="flex flex-wrap gap-1.5">
              {actionsFor(work.status).map(([a, label]) => (
                <button key={a} type="button" disabled={busy} onClick={() => workAction(a)} className={btnGhost}>{label}</button>
              ))}
            </div>
          )}
        </div>
        {undo && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] flex items-center justify-between gap-3">
            <span>All tasks finished, so this work is Done.</span>
            <button type="button" onClick={() => workAction("reopen")} className={btnGhost}>Undo</button>
          </div>
        )}
        {error && <p className={`mt-3 ${errorText}`}>{error}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {LANES.map(([lane, label]) => (
          <div key={lane} className="rounded-2xl bg-muted/40 border border-border p-3 min-h-[120px]">
            <p className={h2}>{label}</p>
            <ul className="space-y-2">
              {tasks.filter((t) => t.lane === lane).map((t) => {
                const mine = t.assigneeId === meId;
                const open = t.status === "TODO";
                return (
                  <li key={t.id} className="rounded-xl bg-card border border-border p-3 flex items-start gap-3">
                    {open && (mine || isLead) ? (
                      <input type="checkbox" disabled={busy} onChange={() => taskAct(t.id, "done")} className="w-5 h-5 mt-0.5" aria-label={`Finish ${t.title}`} />
                    ) : (
                      <span className="w-5 h-5 mt-0.5 inline-block" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[14px] font-semibold ${t.status === "DROPPED" ? "line-through text-ink-faint" : ""}`}>{t.title}</p>
                      <p className="text-[11.5px] text-ink-mute mt-0.5">{t.assignee}{t.status === "DROPPED" && " · dropped"}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {t.awaitsReview && (isLead ? (
                          <button type="button" disabled={busy} onClick={() => taskAct(t.id, "review")} className={btnPrimary}>Check</button>
                        ) : (
                          <span className="text-[10.5px] uppercase tracking-wide text-amber-700 self-center">waiting for check</span>
                        ))}
                        {open && isLead && <button type="button" disabled={busy} onClick={() => taskAct(t.id, "drop")} className={btnGhost}>Drop</button>}
                        {!open && (mine || isLead) && <button type="button" disabled={busy} onClick={() => taskAct(t.id, "reopen")} className={btnGhost}>Reopen</button>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <form onSubmit={addTask} className={card}>
        <p className={h2}>Add a task</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="One clear next step" className={field} />
          {isLead ? (
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={`${field} sm:w-48`}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          ) : (
            <span className="text-[12.5px] text-ink-mute self-center whitespace-nowrap">for you</span>
          )}
          <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>Add</button>
        </div>
      </form>

      <div className={card}>
        <p className={h2}>Timeline</p>
        {events.length === 0 ? (
          <p className="text-ink-mute text-[13px]">Nothing yet.</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3"><span className="text-ink-faint w-16 shrink-0">{e.when}</span><span>{e.line}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `src/app/work/[id]/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/work/actor";
import { awaitsReview, daysUntouched, eventLine, isStale, istDayStart, taskLane } from "@/lib/work/core";
import { gateState, trackerUsers } from "@/lib/work/db";
import { WorkDetail } from "./WorkDetail";

export const dynamic = "force-dynamic";

export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const now = new Date();
  const gate = await gateState(actor.id, now);
  if (gate.step !== "today") redirect("/work");
  const { id } = await params;

  const [work, users] = await Promise.all([
    prisma.work.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true, email: true } },
        tasks: {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          include: {
            assignee: { select: { name: true, email: true } },
            picks: { where: { day: istDayStart(now), outcome: null }, select: { id: true } },
          },
        },
        events: { orderBy: { at: "desc" }, take: 100, include: { user: { select: { name: true, email: true } } } },
      },
    }),
    trackerUsers(),
  ]);
  if (!work) notFound();

  const when = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  return (
    <WorkDetail
      work={{
        id: work.id,
        title: work.title,
        why: work.why,
        status: work.status,
        owner: work.owner.name ?? work.owner.email,
        obsoleteReason: work.obsoleteReason,
        days: daysUntouched(work.lastTouchedAt, now),
        stale: isStale(work.status, work.lastTouchedAt, now),
        canChange: actor.isLead || work.ownerId === actor.id,
      }}
      tasks={work.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigneeId: t.assigneeId,
        assignee: t.assignee.name ?? t.assignee.email,
        lane: taskLane(t.status, t.picks.length > 0),
        awaitsReview: awaitsReview(t),
      }))}
      users={users.map((u) => ({ id: u.id, name: u.name }))}
      events={work.events.map((e) => ({
        id: e.id,
        line: eventLine({ kind: e.kind, detail: e.detail, actor: e.user ? (e.user.name ?? e.user.email) : null }),
        when: when(e.at),
      }))}
      isLead={actor.isLead}
      meId={actor.id}
    />
  );
}
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/work/board src/app/work/\[id\]
git commit -m "Work tracker: board and work detail

Kanban in status order with buttons and native drag; detail page with derived
To do / Today / Done lanes, add-task form and the event timeline.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Week page — plan and Friday review

**Files:**
- Create: `src/app/work/week/page.tsx`
- Create: `src/app/work/week/WeekPanels.tsx`

**Interfaces:**
- Consumes: `PlanForm`/`PlanWork` from Task 4, `weekStats`, `planCandidates`, `trackerUsers`, `gateState`, `prisma`; from core `PLAN_CAP`, `addDays`, `daysUntouched`, `istDayKey`, `istWeekStart`, `parseDayKey`, `WORK_STATUS_LABELS`; routes `PATCH /api/work/[id]`, `POST /api/work/[id]/tasks`, `POST /api/work/review`.
- Produces: `WeekPanels` (`{ columns: Column[]; isCurrent: boolean; cap: number }`) and `Column`.

- [ ] **Step 1: `src/app/work/week/WeekPanels.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import { WORK_STATUS_LABELS } from "@/lib/work/core";
import { PlanForm, type PlanWork } from "../PlanForm";
import { btnGhost, btnPrimary, call, card, errorText, field, h2, type CallResult } from "../ui";

export type Column = {
  user: { id: string; name: string };
  mine: boolean;
  plan: { id: string; title: string; status: WorkStatus }[];
  candidates: PlanWork[] | null; // only for my own column in the current week
  kept: number | null;
  shippedWeek: number;
  shippedMonth: number;
  stale: { id: string; title: string; days: number }[];
  reviewed: boolean;
};

export function WeekPanels({ columns, isCurrent, cap }: { columns: Column[]; isCurrent: boolean; cap: number }) {
  return (
    <div className={`grid grid-cols-1 ${columns.length > 1 ? "md:grid-cols-2" : ""} gap-4`}>
      {columns.map((c) => <PersonColumn key={c.user.id} c={c} isCurrent={isCurrent} cap={cap} />)}
    </div>
  );
}

// One person's plan and review. Decisions on stale work are only offered in the
// owner's own column, in the current week. "Review done" unlocks once nothing is stale.
function PersonColumn({ c, isCurrent, cap }: { c: Column; isCurrent: boolean; cap: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [continueId, setContinueId] = useState<string | null>(null);
  const [next, setNext] = useState("");

  async function run(fn: () => Promise<CallResult>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
    return r.ok;
  }
  const pause = (id: string) => run(() => call(`/api/work/${id}`, { action: "pause" }, "PATCH"));
  async function obsolete(id: string, title: string) {
    const reason = window.prompt(`Why is "${title}" obsolete?`);
    if (!reason?.trim()) return;
    await run(() => call(`/api/work/${id}`, { action: "obsolete", reason: reason.trim() }, "PATCH"));
  }
  async function continueWork(id: string) {
    if (!next.trim()) return;
    const ok = await run(() => call(`/api/work/${id}/tasks`, { title: next, assigneeId: c.user.id }));
    if (ok) {
      setNext("");
      setContinueId(null);
    }
  }
  const reviewDone = () => run(() => call("/api/work/review"));

  const canDecide = c.mine && isCurrent;

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className={h2}>{c.user.name} · plan</p>
        {c.candidates ? (
          <PlanForm works={c.candidates} selected={c.plan.map((p) => p.id)} cap={cap} />
        ) : c.plan.length === 0 ? (
          <p className="text-ink-mute text-[13px]">No plan.</p>
        ) : (
          <ul className="space-y-1.5">
            {c.plan.map((p) => (
              <li key={p.id} className="text-[14px]">
                <Link href={`/work/${p.id}`} className="font-semibold hover:text-brand-600">{p.title}</Link>
                <span className="text-[11px] uppercase text-ink-faint ml-2">{WORK_STATUS_LABELS[p.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <p className={h2}>{c.user.name} · review</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat label="Kept promises" value={c.kept === null ? "—" : `${c.kept}%`} />
          <Stat label="Shipped this week" value={String(c.shippedWeek)} />
          <Stat label="Shipped this month" value={String(c.shippedMonth)} />
        </div>
        {isCurrent && (
          <div>
            <p className="text-[12px] font-bold text-ink-mute mb-2">Stale ({c.stale.length})</p>
            {c.stale.length === 0 ? (
              <p className="text-ink-mute text-[13px]">Nothing stale.</p>
            ) : (
              <ul className="space-y-2">
                {c.stale.map((s) => (
                  <li key={s.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-[14px] font-semibold">
                      <Link href={`/work/${s.id}`} className="hover:text-brand-600">{s.title}</Link>
                      <span className="text-[11px] text-amber-800 ml-2">{s.days}d untouched</span>
                    </p>
                    {canDecide && (
                      <div className="mt-2">
                        {continueId === s.id ? (
                          <div className="flex gap-2">
                            <input value={next} onChange={(e) => setNext(e.target.value)} maxLength={160} placeholder="Next task" className={field} autoFocus />
                            <button type="button" disabled={busy || !next.trim()} onClick={() => continueWork(s.id)} className={btnPrimary}>Add</button>
                            <button type="button" onClick={() => setContinueId(null)} className={btnGhost}>Cancel</button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" disabled={busy} onClick={() => { setNext(""); setContinueId(s.id); }} className={btnPrimary}>Continue</button>
                            <button type="button" disabled={busy} onClick={() => pause(s.id)} className={btnGhost}>Pause</button>
                            <button type="button" disabled={busy} onClick={() => obsolete(s.id, s.title)} className={btnGhost}>Obsolete</button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canDecide ? (
              <div className="mt-4 flex items-center gap-3">
                {c.reviewed ? (
                  <span className="text-[12.5px] font-bold text-emerald-700">Review done</span>
                ) : (
                  <button type="button" disabled={busy || c.stale.length > 0} onClick={reviewDone} className={btnPrimary}>Review done</button>
                )}
                {c.stale.length > 0 && !c.reviewed && <span className="text-[12px] text-ink-mute">Decide on every stale work first.</span>}
              </div>
            ) : (
              c.reviewed && <p className="mt-3 text-[12.5px] font-bold text-emerald-700">Review done</p>
            )}
          </div>
        )}
        {error && <p className={`mt-3 ${errorText}`}>{error}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 border border-border px-3 py-2.5">
      <p className="text-[10.5px] uppercase tracking-wide text-ink-faint font-bold">{label}</p>
      <p className="font-display font-extrabold text-2xl mt-0.5">{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: `src/app/work/week/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/work/actor";
import { PLAN_CAP, addDays, daysUntouched, istDayKey, istWeekStart, parseDayKey } from "@/lib/work/core";
import { gateState, planCandidates, trackerUsers, weekStats } from "@/lib/work/db";
import { WeekPanels, type Column } from "./WeekPanels";

export const dynamic = "force-dynamic";

// ?w=YYYY-MM-DD (any day) shows that IST week read-only. No param = current week.
export default async function WeekPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const now = new Date();
  const gate = await gateState(actor.id, now);
  if (gate.step !== "today") redirect("/work");

  const sp = await searchParams;
  const thisWeek = istWeekStart(now);
  const requested = parseDayKey(sp.w);
  const weekStart = requested ? istWeekStart(requested) : thisWeek;
  const isCurrent = weekStart.getTime() === thisWeek.getTime();
  const users = await trackerUsers();
  const myCandidates = isCurrent ? await planCandidates(actor) : [];

  const columns: Column[] = await Promise.all(
    users.map(async (u) => {
      const mine = u.id === actor.id;
      const [plan, stats] = await Promise.all([
        prisma.weekPlanWork.findMany({ where: { userId: u.id, weekStart }, include: { work: { select: { id: true, title: true, status: true } } } }),
        weekStats(u.id, weekStart, now),
      ]);
      return {
        user: { id: u.id, name: u.name },
        mine,
        plan: plan.map((p) => ({ id: p.work.id, title: p.work.title, status: p.work.status })),
        candidates: mine && isCurrent ? myCandidates.map((w) => ({ id: w.id, title: w.title, status: w.status, owner: w.owner.name ?? w.owner.email })) : null,
        kept: stats.kept,
        shippedWeek: stats.shippedWeek,
        shippedMonth: stats.shippedMonth,
        stale: stats.stale.map((s) => ({ id: s.id, title: s.title, days: daysUntouched(s.lastTouchedAt, now) })),
        reviewed: stats.reviewed,
      };
    }),
  );

  const label = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const nav = "px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-ink-mute hover:bg-muted hover:text-ink";
  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Week</p>
          <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">{label(weekStart)} – {label(addDays(weekStart, 6))}</h1>
          <p className="text-ink-mute text-[14px] mt-1">Plan on Monday, up to {PLAN_CAP} works each. Review on Friday: kept promises, shipped, stale.</p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/work/week?w=${istDayKey(addDays(weekStart, -7))}`} className={nav}>← Previous</Link>
          {!isCurrent && <Link href="/work/week" className={nav}>This week</Link>}
          {!isCurrent && <Link href={`/work/week?w=${istDayKey(addDays(weekStart, 7))}`} className={nav}>Next →</Link>}
        </div>
      </div>
      <WeekPanels columns={columns} isCurrent={isCurrent} cap={PLAN_CAP} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/work/week
git commit -m "Work tracker: week page with plan and Friday review

Two columns, one per person: editable plan for the current week, kept-promise %,
shipped counts, stale works with Continue / Pause / Obsolete, and Review done
that unlocks only when nothing is stale.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Teams nudges, cron endpoint, workflow, scopes, env, nav link

**Files:**
- Modify: `src/lib/graph.ts` (top of file, and the `scope:` line inside `getUserGraphToken`)
- Modify: `src/lib/auth.ts` (imports and the `scope:` string near line 22)
- Create: `src/lib/work/teams.ts`
- Create: `src/app/api/cron/work/route.ts`
- Create: `.github/workflows/work-nudges.yml`
- Modify: `.env.example`
- Modify: `src/app/dashboard/page.tsx` (nav, the line with `href="/clients"` near line 310)

**Interfaces:**
- Consumes: `getUserGraphToken`, `getSettings`, `prisma`, `trackerUsers`, `usersMissingPick`, `usersMissingReview`, `closeDay`, `isWeekend`, `canUseWork`.
- Produces: `GRAPH_SCOPES` (graph.ts), `postTechWorkMessage(text)` (teams.ts), `GET /api/cron/work?job=morning|friday|close`.

- [ ] **Step 1: One scope string for sign-in and refresh**

In `src/lib/graph.ts`, directly below `const GRAPH = "https://graph.microsoft.com/v1.0";` add:

```ts
/** Delegated scopes requested at sign-in and on refresh. auth.ts imports this so the two
 *  never drift. Chat.Create + ChatMessage.Send carry the work-tracker nudges. */
export const GRAPH_SCOPES =
  "openid profile email offline_access User.Read Files.Read.All Files.ReadWrite.All Calendars.ReadWrite OnlineMeetings.ReadWrite OnlineMeetingTranscript.Read.All OnlineMeetingArtifact.Read.All Chat.Create ChatMessage.Send";
```

In the same file, inside `getUserGraphToken`, replace the `scope:` value in the refresh request (the multi-line string literal) with `scope: GRAPH_SCOPES,`.

In `src/lib/auth.ts`, add `import { GRAPH_SCOPES } from "@/lib/graph";` after the prisma import, and replace the `scope:` literal in `authorization.params` with `scope: GRAPH_SCOPES,`.

- [ ] **Step 2: `src/lib/work/teams.ts`**

```ts
// Nudges go into a Teams chat as the lead. Graph does not allow app-only tokens to post
// chat messages, so this rides on the lead's delegated token (getUserGraphToken), which
// means the lead must have signed in after Chat.Create / ChatMessage.Send were added.
import { getUserGraphToken } from "@/lib/graph";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { trackerUsers } from "./db";

const GRAPH = "https://graph.microsoft.com/v1.0";
const post = (token: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(15_000),
});

/** Find or create the chat. Tries a named group chat first; if Graph refuses a two-person
 *  group, falls back to a oneOnOne chat. The id is stored in Settings either way. */
async function ensureChat(token: string): Promise<string> {
  const settings = await getSettings();
  if (settings.workTeamsChatId) return settings.workTeamsChatId;
  const users = await trackerUsers();
  if (users.length < 2) throw new Error("Need two tracker users to create the chat");
  const members = users.map((u) => ({
    "@odata.type": "#microsoft.graph.aadUserConversationMember",
    roles: ["owner"],
    "user@odata.bind": `${GRAPH}/users('${u.email}')`,
  }));
  let res = await fetch(`${GRAPH}/chats`, post(token, { chatType: "group", topic: "Tech Work", members }));
  if (!res.ok) {
    console.warn("Tech Work group chat refused, trying oneOnOne:", res.status, await res.text());
    res = await fetch(`${GRAPH}/chats`, post(token, { chatType: "oneOnOne", members: members.slice(0, 2) }));
  }
  if (!res.ok) throw new Error(`Graph create chat failed: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  await prisma.settings.update({ where: { id: 1 }, data: { workTeamsChatId: id } });
  return id;
}

/** Post one plain-text message. Never throws; the caller logs the result and moves on. */
export async function postTechWorkMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const lead = (await trackerUsers())[0];
    if (!lead) return { ok: false, error: "No tracker users configured" };
    const token = await getUserGraphToken(lead.id);
    if (!token) return { ok: false, error: "Lead has no usable Graph token, sign out and in again" };
    const chatId = await ensureChat(token);
    const res = await fetch(`${GRAPH}/chats/${chatId}/messages`, post(token, { body: { contentType: "text", content: text } }));
    if (!res.ok) return { ok: false, error: `Graph post failed: ${res.status} ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    console.error("Tech Work nudge failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 3: `src/app/api/cron/work/route.ts`**

```ts
// Work-tracker cron. Same secret handshake as /api/cron/clients.
//   ?job=morning  09:00 IST Mon–Fri  name whoever has open tasks and no pick today
//   ?job=friday   16:00 IST Fri      name whoever has not finished the week review
//   ?job=close    20:00 IST daily    carry unfinished picks, auto-pause quiet works
import { NextRequest, NextResponse } from "next/server";
import { isWeekend } from "@/lib/work/core";
import { closeDay, usersMissingPick, usersMissingReview } from "@/lib/work/db";
import { postTechWorkMessage } from "@/lib/work/teams";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const APP_URL = (process.env.AUTH_URL ?? "https://lms.indefine.in").replace(/\/$/, "");
const firstNames = (users: { name: string }[]) => users.map((u) => u.name.split(" ")[0]).join(" and ");

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = req.nextUrl.searchParams.get("job");
  const now = new Date();

  if (job === "close") return NextResponse.json(await closeDay(now));

  if (job === "morning") {
    if (isWeekend(now)) return NextResponse.json({ skipped: "weekend" });
    const missing = await usersMissingPick(now);
    if (missing.length === 0) return NextResponse.json({ sent: false, missing: [] });
    const r = await postTechWorkMessage(`Good morning. No pick for today yet: ${firstNames(missing)}. ${APP_URL}/work`);
    return NextResponse.json({ sent: r.ok, missing: missing.map((u) => u.email), error: r.error });
  }

  if (job === "friday") {
    const missing = await usersMissingReview(now);
    if (missing.length === 0) return NextResponse.json({ sent: false, missing: [] });
    const r = await postTechWorkMessage(`Week review still pending: ${firstNames(missing)}. ${APP_URL}/work/week`);
    return NextResponse.json({ sent: r.ok, missing: missing.map((u) => u.email), error: r.error });
  }

  return NextResponse.json({ error: "job must be morning, friday or close" }, { status: 400 });
}
```

- [ ] **Step 4: `.github/workflows/work-nudges.yml`**

```yaml
# Work tracker: three scheduled calls into /api/cron/work. GitHub cron is UTC;
# IST = UTC + 5:30. Reuses the CRON_SECRET repo secret set up for recording ingest.
name: Work tracker nudges

on:
  schedule:
    - cron: "30 3 * * 1-5"   # 09:00 IST Mon-Fri  -> morning
    - cron: "30 10 * * 5"    # 16:00 IST Fri      -> friday
    - cron: "30 14 * * *"    # 20:00 IST daily    -> close
  workflow_dispatch:
    inputs:
      job:
        description: "morning | friday | close"
        required: true
        default: "close"

jobs:
  nudge:
    runs-on: ubuntu-latest
    steps:
      - name: Pick job from schedule
        id: pick
        run: |
          case "${{ github.event.schedule }}" in
            "30 3 * * 1-5") echo "job=morning" >> "$GITHUB_OUTPUT" ;;
            "30 10 * * 5")  echo "job=friday"  >> "$GITHUB_OUTPUT" ;;
            "30 14 * * *")  echo "job=close"   >> "$GITHUB_OUTPUT" ;;
            *)              echo "job=${{ github.event.inputs.job }}" >> "$GITHUB_OUTPUT" ;;
          esac
      - name: Call work cron endpoint
        run: |
          if [ -z "${{ secrets.CRON_SECRET }}" ]; then
            echo "CRON_SECRET repo secret not set — skipping."
            exit 0
          fi
          curl -fsS --max-time 290 \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "https://lms.indefine.in/api/cron/work?job=${{ steps.pick.outputs.job }}"
```

- [ ] **Step 5: `.env.example`**

Append after the `ADMIN_EMAILS` line:

```
# --- Tech work tracker (/work) ---
# Comma-separated emails allowed in. The first one is the lead (assigns, reviews, drops tasks).
# Nudges post to Teams as the lead; the lead must sign in once after deploy so the stored
# token carries Chat.Create and ChatMessage.Send.
WORK_TRACKER_EMAILS="lead@yourcompany.com,second@yourcompany.com"
```

- [ ] **Step 6: Nav link on the dashboard**

In `src/app/dashboard/page.tsx` add `import { canUseWork } from "@/lib/work/core";` with the other imports, and directly after the line

```tsx
          <Link href="/clients" className="px-4 py-2 rounded-full text-ink-mute font-semibold text-[13.5px] hover:text-ink transition">Clients</Link>
```

add

```tsx
          {canUseWork(session.user.email) && (
            <Link href="/work" className="px-4 py-2 rounded-full text-ink-mute font-semibold text-[13.5px] hover:text-ink transition">Work</Link>
          )}
```

- [ ] **Step 7: Typecheck, self-check, commit**

Run: `npx tsc --noEmit && npx tsx scripts/verify-work.ts`
Expected: no type errors, `verify-work: all checks passed`.

```bash
git add src/lib/graph.ts src/lib/auth.ts src/lib/work/teams.ts src/app/api/cron/work/route.ts .github/workflows/work-nudges.yml .env.example src/app/dashboard/page.tsx
git commit -m "Work tracker: Teams nudges, cron jobs, scopes, nav link

morning/friday/close jobs behind CRON_SECRET, scheduled from one workflow. Nudges post
as the lead via the delegated token into a Tech Work chat whose id lives in Settings.
GRAPH_SCOPES shared by sign-in and refresh, now including Chat.Create ChatMessage.Send.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Build, final verification, deploy checklist

**Files:**
- No new files. This task proves the branch and writes down what happens after "push".

- [ ] **Step 1: Full verification**

Run, in order:

```bash
npx prisma validate
npx tsc --noEmit
npx tsx scripts/verify-work.ts
npx tsx scripts/verify-clients.ts
npm run build
```

Expected: valid schema, no type errors, both self-checks pass, `next build` finishes with `/work`, `/work/board`, `/work/[id]`, `/work/week`, `/api/work/*` and `/api/cron/work` listed as dynamic routes. If `next build` fails on a lint rule, fix the code rather than disabling the rule.

- [ ] **Step 2: Fix anything the build surfaced and commit**

```bash
git add -A
git commit -m "Work tracker: build fixes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Skip this commit if the build was clean.

- [ ] **Step 3: Report and wait for "push"**

Tell Lakshmanan the branch is ready: list the commits (`git log --oneline origin/main..HEAD`), state that build, typecheck and both self-checks pass, and stop. Do not push. When he says "push":

```bash
git fetch --unshallow 2>/dev/null || git fetch
git rebase origin/main
npx tsc --noEmit
git push origin main
```

- [ ] **Step 4: After the push, one-time setup (Lakshmanan does these, the plan only lists them)**

1. Railway → Variables → add `WORK_TRACKER_EMAILS` = his email, then `info@indefine.in`, comma-separated, lead first. Redeploy picks it up; `prisma db push` on start creates the new tables.
2. Entra → App registrations → the LMS app → API permissions → confirm the delegated scopes `Chat.Create` and `ChatMessage.Send` are listed (add them if the tenant needs admin consent, then Grant admin consent).
3. Sign out of the LMS and sign in again as the lead so the stored refresh token carries the new scopes.
4. Amit signs in once with `info@indefine.in` so his `User` row is linked.

- [ ] **Step 5: Smoke test on the live site, in this order**

1. `/work` as the lead: capture an idea, see "Saved to Ideas".
2. Gate asks for the week plan: pick that idea (it becomes Working). Save.
3. Board: open the work, add three tasks, two for the lead and one for Amit.
4. `/work`: gate asks for today's pick, promise the two lead tasks, tick one.
5. `/work/week`: kept promises shows "—" (nothing closed yet), shipped 0, nothing stale.
6. GitHub → Actions → "Work tracker nudges" → Run workflow with job `close`: response `{"carried":1,"paused":0}`; `/work` next morning shows that task pre-checked as carried; Week shows 50 %.
7. Sign in as Amit: sees the same board, his one task, gate asks him to plan and pick.
8. Amit ticks his task: lead sees "Check" on the work detail; lead ticks Check; when the lead's remaining task is done the work moves to Done with the Undo banner.
9. Run workflow with job `morning` while one person has no pick: the Teams chat "Tech Work" appears with the message. If the response carries `error`, read it: `sign out and in again` means step 4.3 above was skipped; `403` from Graph means the scopes are not consented.
10. Someone outside the list opens `/work`: 404, and no Work link on their dashboard.

---

## Self-review notes

- Spec coverage: model (Task 1), rules and auto shifts (Tasks 1–2), screens Today / Board / Week (Tasks 4–6), nudges and cron (Task 7), access and IST (Tasks 1–2, 4), verification (Tasks 1, 8), deployment (Task 8). Spec amendments applied in Task 1 Step 7.
- Deliberate simplifications: `window.prompt` for the obsolete reason instead of a modal; no drag library; past weeks are read-only with no stale section; oneOnOne fallback for the Teams chat means the lead is not notified of their own nudge in that mode.
- If `Chat.Create` is refused for a two-person group chat and the oneOnOne fallback is used, the nudge still reaches Amit; the lead sees it in the same chat when they open Teams.
