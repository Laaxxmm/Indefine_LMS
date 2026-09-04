# Tech Work Tracker — Design

Date: 2026-09-04
Status: approved in conversation, pending written review

## Goal

A two-person work tracker for the technical work at SRCA (Lakshmanan and Amit), built as a
module inside the existing LMS (lms.indefine.in). The problem it solves is not record
keeping but focus: work gets started at random, nothing gets finished, nothing is listed.
The tool forces one small commitment per day and one honest review per week, keeps a Kanban
board that moves itself from actions, and logs every change so the history of a piece of
work is visible without anyone maintaining it.

It is deliberately small: three screens, five work statuses, no hours, no priorities, no
tags, no comments. Independent of Turia.

## Decisions taken

| Question | Decision |
|---|---|
| Where it lives | Inside LMS repo, new `/work` module. Reuses Entra SSO, Prisma/Postgres, delegated Graph token refresh, GitHub Actions cron with `CRON_SECRET`, `istDate` helper from the clients module. |
| Who | Two users, listed by email in env `WORK_TRACKER_EMAILS`. First email is the lead (Lakshmanan). Second is Amit (`info@indefine.in`, a real licensed user). Everyone else gets 404. |
| Hierarchy | Work → Task. Two levels only. No subtasks. |
| Roles | Lead creates works, assigns tasks to either person, reviews Amit's done tasks, changes work status. Amit sees all works, adds tasks to himself, ticks his own tasks, and may change the status only of works he owns (ideas he captured). |
| Ritual | Weekly plan (Monday) sets the pool of works. Daily pick (up to 3 tasks) comes from that pool. Friday review shows the score and forces a decision on every stale work. |
| Score | Kept-promise % (picked tasks finished), shipped count, stale list with forced decision, Amit's column beside the lead's. Nothing else. |
| Nudge | Teams group chat "Tech Work" with both people. Posted as the lead via delegated Graph token. Morning if no pick, Friday afternoon if no review. Silent when done. |
| Turia | No link in either direction. |
| Deletes | None. Obsolete is the delete. |

## Data model (Prisma, Postgres)

New enums and models. Existing `User` gets the back-relations, existing `Settings`
singleton gets one column.

```prisma
enum WorkStatus      { INBOX ACTIVE PARKED DONE OBSOLETE }
enum WorkTaskStatus  { TODO DONE DROPPED }
enum DayPickOutcome  { DONE CARRIED }
enum WorkEventKind {
  WORK_CREATED WORK_STATUS WORK_REOPENED
  TASK_CREATED TASK_DONE TASK_DROPPED TASK_REVIEWED TASK_REOPENED
  PICKED CARRIED AUTO_PAUSED WEEK_PLANNED WEEK_REVIEWED
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
  reviewedAt  DateTime?      // set by lead on a task Amit finished
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
  detail String?       // one plain line, e.g. "Enable MFA"
  at     DateTime      @default(now())

  work Work  @relation(fields: [workId], references: [id], onDelete: Cascade)
  user User? @relation("WorkEventActor", fields: [userId], references: [id])

  @@index([workId, at])
}

// Added to the existing Settings singleton.
//   workTeamsChatId String?   // Graph chat id of the "Tech Work" group chat
```

`lastTouchedAt` is bumped by every human action that writes a `WorkEvent`, in the same
transaction. Cron-written events (`CARRIED`, `AUTO_PAUSED`) do not bump it, so carrying a
task every day cannot keep a work from going stale.

## Rules

All rules live in server actions and the cron sweep, never only in the UI. Refusals return
a plain one-line message shown inline.

**Work status**

- New work always starts in `INBOX`, whoever creates it.
- `INBOX → ACTIVE`: by owner or lead, or automatically when the lead adds the work to a week plan.
- `ACTIVE ↔ PARKED`: by owner or lead, or `ACTIVE → PARKED` automatically after 28 untouched days.
- `ACTIVE → DONE`: by owner or lead, or automatically when an action (tick done, drop, or review)
  leaves the work with no `TODO` task and no task awaiting review, and at least one task
  `DONE` (see auto shifts). `DONE → ACTIVE` ("Reopen") by owner or lead any time.
- Any status `→ OBSOLETE`: by owner or lead, `obsoleteReason` required. `OBSOLETE → INBOX` ("Reopen") for a mistaken obsolete.
- WIP cap: at most 3 `ACTIVE` works per owner. Activating a fourth, by any route, is
  refused with "3 works already active, pause or finish one first".

**Tasks**

- A task belongs to one work and one assignee (lead or Amit).
- Lead may create tasks for either person on any work. Amit may create tasks only with
  himself as assignee, on any work that is `ACTIVE`.
- Assignee ticks their own task `DONE`. Lead may tick anyone's. A task finished by Amit
  carries a "check" chip until the lead sets `reviewedAt`.
- `DROPPED` is for a task that is no longer needed. Only the lead can drop.
- `DONE`/`DROPPED → TODO` ("Reopen") clears `doneAt` and `reviewedAt`.

**Week plan**

- Week starts Monday 00:00 IST.
- Each person picks up to 3 works for the week. Amit may pick only `ACTIVE` works. Lead
  may also pick `INBOX` works, which activates them (WIP cap applies).
- A work may sit in both people's plans.
- Plan can be edited any day of the week; the gate only asks for it when empty. Saving
  writes `WEEK_PLANNED` on each work added.

**Day pick**

- Day is the IST calendar day. Weekdays only; weekends have no gate and no picks.
- Up to 3 tasks per person per day. Each must be a `TODO` task assigned to that person
  whose work is `ACTIVE` and in that person's plan for the current week.
- Picks can be added during the day up to the cap ("Pick another" on the Today view). A
  pick cannot be removed; it is a promise, and an unfinished one becomes `CARRIED`.
- A pick row is created with `outcome = null`. Ticking the task done sets the task `DONE`
  and today's pick `DONE`. Ticking done from the board does the same if a pick exists.
- The nightly close flips every open pick whose task is still `TODO` to `CARRIED`.
- Next morning, tasks that were `CARRIED` on the person's most recent pick day and are
  still `TODO` appear pre-checked in the pick screen.
- A person with no open `TODO` task in any `ACTIVE` work sees "Nothing assigned yet" and
  passes both gate steps without a plan or a pick. The morning nudge skips them.
- A person whose plan holds no open task of theirs (not yet picked today) also passes the gate; the Today view says so and points to the board and the Week page. The gate never dead-ends.

**Stale**

- Stale = `ACTIVE` and `lastTouchedAt` older than 14 days at the time of checking.
- Stale works owned by a person appear in that person's Friday review with three choices
  and no dismiss: **Continue** (must type the next task, created as `TODO` assigned to the
  owner; creating it bumps the touch),
  **Pause** (`PARKED`), **Obsolete** (reason required).
- The lead can act on any work from the board regardless of owner.

**Score (per person, per week)**

- Kept-promise % = pick rows with outcome `DONE` ÷ pick rows with any outcome set, for
  the week. Today's still-open picks are excluded until the nightly close. A task carried
  three days then finished counts 1 of 4. Carrying is meant to hurt. No picks yet shows
  "—", not 0 %.
- Shipped = works with `doneAt` in the week, plus the same for the calendar month.
- Stale count = as above.
- "Review done" button is enabled only when the person's stale list is empty. Pressing it
  creates the `WeekReview` row and writes `WEEK_REVIEWED` on each work in the plan.

## Auto shifts

The board moves itself. Nothing below needs a drag.

| Trigger | Effect | Event |
|---|---|---|
| Lead adds an `INBOX` work to a week plan | Work → `ACTIVE` | `WORK_STATUS` |
| Tick done, drop, or review leaves an `ACTIVE` work with no `TODO` task, no task awaiting review, and at least one task `DONE` | Work → `DONE`, `doneAt` set. Toast with **Undo** (which reopens). | `WORK_STATUS` |
| `ACTIVE` work untouched 14 days | "Stale" badge on card, appears in owner's review | none (derived) |
| `ACTIVE` work untouched 28 days (nightly sweep) | Work → `PARKED` | `AUTO_PAUSED` |
| Task picked for today | Task shows in the **Today** lane | `PICKED` |
| Nightly close, task still `TODO` | Pick → `CARRIED`, task back in **To do** | `CARRIED` |

Task lanes inside a work are derived, never stored: **Today** = has a pick for today
with `outcome = null`; **Done** = status `DONE` or `DROPPED` (dropped shown struck
through); **To do** = everything else.

## Screens

Three routes under `/work`, one small nav: **Today · Board · Week**. Same three screens
for both people. Labels are plain English throughout: Ideas, Working, Paused, Done,
Obsolete; To do, Today, Done.

**Today — `/work`**

Gate, in order, on weekdays:

1. No week plan for this week → "Pick this week's work": list of `ACTIVE` works (lead also
   sees `INBOX`), choose up to 3, save.
2. No pick for today → "Pick today": the person's `TODO` tasks grouped by planned work,
   carried tasks pre-checked, choose up to 3, save.
3. Otherwise the Today view: the day's tasks with tick boxes, work name beside each, an
   "add task here" link under each work, and one text box **Capture an idea** that
   creates an `INBOX` work and clears itself. Nothing else on the page.

The capture box is present on the gate screens as well, so a passing thought can be
parked without breaking the gate. `/work/board` and `/work/week` redirect to `/work`
until the gate is passed on a weekday. Weekends show the Today view with "Weekend, nothing
promised" and the capture box.

**Board — `/work/board`**

Kanban, five columns in status order. Card: title, owner initial, open task count, days
since last touch, Stale badge when applicable. Move by buttons on the card (Start, Pause,
Finish, Obsolete, Reopen; only the ones valid for the current status and the current
user) or by native HTML5 drag between columns, which calls the same server action. No
drag library.

Card click opens work detail (`/work/[id]`): title, why, owner, status buttons, the three
task lanes with tick boxes, "add task" with assignee choice (Amit's is fixed to himself),
and the timeline from `WorkEvent` newest first, one line each ("Amit finished 'Enable
MFA' · Tue 2 Sep").

**Week — `/work/week`**

Top: this week's plan, two columns (lead, Amit), each editable by its own person.
Bottom: review, same two columns. Each column shows kept-promise %, shipped this week and
this month, then the stale list with Continue / Pause / Obsolete on each row, then the
**Review done** button. Past weeks reachable by a simple previous/next link; past weeks
are read-only.

## Nudges and cron

One endpoint `GET /api/cron/work?job=morning|friday|close`, bearer `CRON_SECRET`, same
guard as the other cron routes. One workflow `.github/workflows/work-nudges.yml` with three
schedules and steps conditioned on `github.event.schedule`, plus `workflow_dispatch` with a
`job` input for manual runs:

| Job | Schedule (UTC) | IST | What it does |
|---|---|---|---|
| `morning` | `30 3 * * 1-5` | 09:00 Mon–Fri | For each tracker user with open tasks and no pick today: post one message naming them, with link to `/work`. Silent if nobody is missing. |
| `friday` | `30 10 * * 5` | 16:00 Fri | Post one message naming anyone without a `WeekReview` row for this week, with link to `/work/week`. Silent if none. |
| `close` | `30 14 * * *` | 20:00 daily | Flip open picks with `TODO` tasks to `CARRIED` (event per pick). Auto-pause `ACTIVE` works untouched 28 days (event per work). |

**Teams route.** Graph does not allow app-only tokens to post chat messages, so messages
go out as the lead through the existing delegated-token path (`getUserGraphToken`):

- Add `Chat.Create ChatMessage.Send` to the NextAuth Entra scope string. The lead signs
  out and in once so the stored refresh token carries the new scopes.
- On the first nudge, if `Settings.workTeamsChatId` is null, create a group chat via
  `POST /chats` (chatType `group`, topic "Tech Work", both tracker emails as owner
  members bound by UPN) and store the id. Subsequent runs reuse it.
- Post with `POST /chats/{id}/messages`, plain text body, names written as text (no
  mention entities). A group chat message notifies both members on its own.
- Any Graph failure is logged and the job continues. A nudge never blocks the app or the
  close sweep.

Weekends skipped. No holiday calendar. No per-person quiet hours.

## Access, dates, errors

- `canUseWork(email)` in `src/lib/work/core.ts` checks membership in `WORK_TRACKER_EMAILS`.
  Every `/work` page and `/api/work` handler calls it and returns `notFound()` / 404 for
  anyone else. `isWorkLead(email)` is true for the first listed email.
- The LMS nav shows a **Work** link only when `canUseWork` is true for the session user.
- The assignee picker lists only tracker users.
- "Today" and week start are computed in IST with `istDate` from the clients module (and a
  sibling `istWeekStart`). Stored as UTC instants as the clients module already does.
- Refused actions (WIP cap, pick cap, wrong assignee, status transition not allowed for
  this user) return a one-line message rendered inline next to the control. Nothing fails
  silently. Unexpected errors surface as a visible banner, not a blank page.

## Testing

- `src/lib/work/core.ts` holds pure logic with no Prisma import: IST day and week start,
  stale days, kept-promise %, WIP check, allowed status transitions per role, auto-done
  decision, next-morning pre-check selection, access helpers.
- `scripts/verify-work.ts` asserts those with `node:assert/strict`, wired as
  `npm run verify:work`, mirroring `verify-clients.ts`.
- Before every commit: `npx tsc --noEmit`, `npm run build`, `npm run verify:work`.
- After deploy, smoke on the live site in this order: plan a week, pick 3 tasks, tick one,
  Week page shows 33 %, capture an idea and see it in Ideas, run `close` by
  `workflow_dispatch` and see the two open picks turn to carried, sign in as Amit and see
  only his picks, run `morning` by `workflow_dispatch` and see the Teams message.

## Deployment

- Schema changes apply through the existing `prisma db push` on start. No migration files
  in this repo.
- New Railway env `WORK_TRACKER_EMAILS` (comma-separated, lead first).
- Entra app registration: no new application permission. The delegated scopes
  `Chat.Create` and `ChatMessage.Send` are requested at sign-in; if the tenant requires
  admin consent for them, grant it once in Entra before the lead signs in again.
- `work-nudges.yml` reuses the existing `CRON_SECRET` repo secret.

## Out of scope for v1

Priorities, hours, tags, comments, attachments, subtasks, holiday calendar, mentions in
Teams messages, adding a third person through a UI (edit the env instead), charts, any
Turia link, mobile-specific layout beyond the LMS's existing responsive styles.
