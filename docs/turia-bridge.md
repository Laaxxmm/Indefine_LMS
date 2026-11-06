# Turia bridge — how Firm OS talks to Turia

Decision record: [ADR-003](adr/ADR-003-turia-adapter.md). Code: `src/lib/integrations/turia/`.

Turia (practice.turia.in) is the firm's system of record for clients, services, tasks and time.
Turia publishes no API. Firm OS therefore reaches Turia through one interface, `TuriaAdapter`,
with three interchangeable bridges. Exactly one is active per environment, chosen by
`FIRM_OS_TURIA_BRIDGE`, and the mode is stored on every `TuriaSync` row.

## The interface

`src/lib/integrations/turia/adapter.ts`

| Operation | What it means in Turia |
|---|---|
| `createClient(input)` | A client record with legal name, client code, entity type, PAN, GSTIN(s), CIN/LLPIN, primary contact, billing |
| `addService(input)` | A service (GST, ROC, Income tax, TDS, Books, Audit, Engagement) with its frequency, assignee and reviewer |
| `createTask(input)` | A task for one JobTask (title, period, FY, assignee, due date) |
| `closeTask(taskRef, minutes)` | Log the minutes and mark the task complete |
| `findClientByCode(code)` | Is this client code already in Turia? `found` / `not-found` / `unknown` |

There is **no delete or archive operation**, by design (orchestrator NON-NEGOTIABLE #2). A test
(`turia.test.ts`, "no destructive operation") fails if any bridge grows one, and
`npm run verify:no-delete` scans the folder.

## Modes

| `FIRM_OS_TURIA_BRIDGE` | Bridge | Status | Behaviour |
|---|---|---|---|
| `MANUAL` (default, also when unset) | `ManualBridge` (`manual-bridge.ts`) | **Active** | Each operation produces a numbered checklist with every value prefilled. A `TuriaSync` row is written with `mode = MANUAL`, `status = CHECKLIST_ISSUED`. A person does the steps in Turia and confirms with the Turia reference ("Done in Turia"); `confirm()` moves the row to `CONFIRMED` (or `CLOSED` with minutes for `closeTask`). |
| `UI` | `UiAutomationBridge` (`ui-bridge.ts`) | Stub, disabled | Every method throws `TuriaBlockedError`. Even with `FIRM_OS_TURIA_UI=true` it stays blocked: partner-only, and the automation is not built. |
| `API` | `ApiBridge` (`api-bridge.ts`) | Not available | Every method throws `TuriaBlockedError`: no documented Turia API. |

Any other value of `FIRM_OS_TURIA_BRIDGE` is a configuration error and is reported as such.

### ManualBridge in detail

- **Idempotent.** Each operation has a key (`createClient:<firmClientId>`, `addService:<firmClientId>:<service>`,
  `createTask:<jobTaskId>`, `closeTask:<jobTaskId or taskRef>`) stored in `TuriaSync.evidence.key`. Issuing
  the same operation again returns the existing row; a resumed onboarding never creates a second checklist.
  Only a row marked `FAILED` is re-issued.
- **Checklist text** says what to do, not where Turia puts its buttons: Turia's UI is not documented and the
  code does not guess at menu names. The first step for a new client is always "search Turia for this code
  first", which is also what `findClientByCode` returns under this bridge (`status: "unknown"` plus that
  checklist item).
- **Confirmation** needs the Turia reference (trimmed, at most 100 characters). `closeTask` also needs the
  minutes logged (whole number, 1 to 6,000). Confirming twice with the same reference is a no-op; a different
  reference is refused. Who confirmed and when are stored (`confirmedById`, `evidence.confirmedAt`).
- **Values in the checklist** (PAN, GSTIN, contact details) stay inside the firm: Postgres and the LMS page.
  They are never sent to a model.
- **Control.** Confirmations are self-reported. Phase 8 adds a partner spot-check of 10% of closures
  (`TuriaSync.spotChecked`).

### UiAutomationBridge rules (for whoever builds it)

1. Off unless `FIRM_OS_TURIA_BRIDGE=UI` **and** `FIRM_OS_TURIA_UI=true`. Both default off.
2. Partner-only. The session is one director's Turia login (the encrypted Neo Centra cookie), so every action is attributed to that director.
3. Read-first and dry-run by default: lookups may run; writes print the steps they would take unless a partner turns dry-run off for that run.
4. Session expired or Turia's UI changed: fail to the manual checklist, never to a silent pass.
5. Only after Turia confirms UI automation is permitted under the firm's subscription (Blocked / needs human).

## Where it is used

- **Onboarding (Phase 3).** The saga's Turia step issues `createClient` and one `addService` per service; the
  assignment step issues `createTask` for the first period of each job series (later periods get their Turia
  task when the job starts — a Phase 4/9 hook). Under ManualBridge these steps finish as "waiting": the
  checklists appear on `/onboard` with copy buttons and a "Done in Turia" confirm with a Turia client ref field.
  Confirming a `createClient` checklist also stores the ref on `FirmClient.turiaClientRef`.
- **Close loop (Phase 8).** A job is DONE only when its `TuriaSync` for `closeTask` is `CLOSED` with minutes,
  whatever bridge produced it (ADR-005).

## Blocked / needs human

- Ask Turia (vendor) for API documentation and credentials. Until then `ApiBridge` stays unavailable.
- Ask Turia whether UI automation against practice.turia.in is permitted under the firm's subscription.
- Ask Turia whether the automated read-only task pull below is permitted, or for a documented read API.

## Turia pull — Turia tasks become Firm OS jobs (read only)

Decision: [ADR-003 Amendment 1](adr/ADR-003-turia-adapter.md) (owner, 06 Nov 2026). Code:
`src/lib/integrations/turia/pull/`. Admin page: `/admin/firm-os/turia-sync`. Rollout: `docs/go-live.md` §4.1.

The bridges above are for **writes** a person makes in Turia. The pull is the other direction: Firm OS
**reads** Turia's task list on a schedule and keeps its jobs in step. It never writes to Turia.

### Connection and the read-only guard

- Same connection as Neo Centra: the firm-wide Turia sign-in (`accessToken` cookie) pushed every 5 minutes
  by the Neo Centra Chrome extension, stored sealed in `NeoTuriaSession` (`NEO_TURIA_COOKIE_KEY`), and
  `turiaPost(endpoint, action, data)` with `NEO_TURIA_ORG_ID`. Neo Centra's behaviour is unchanged (the
  function is only exported now).
- `read-client.ts` → `turiaRead()` refuses anything outside `TURIA_READ_ALLOWLIST` before a request:

  | Call | Why |
  |---|---|
  | `task/list` | The task list, paged 100 at a time. |
  | `task/get` | Allowed for diagnosis; not called on a normal run. |
  | `utilities/organizationUserListNew` | Turia users with email, to match them to the firm's users. |
  | `timesheet/list` | Time logged on a task Turia shows completed (for the close gate). |

  `tests/unit/turia-pull-readonly.test.ts` guards the allowlist, the gate, the reader and the code.

### Modes (`FIRM_OS_TURIA_PULL`, needs `FIRM_OS_ENABLED`)

| Mode | Reads Turia | Writes |
|---|---|---|
| `off` (default) | no | nothing |
| `dry-run` | yes | `TuriaTaskMirror`, `TuriaPersonLink` / `TuriaClientLink` match suggestions, `TuriaTaskRule` seeds, `TuriaPullRun` (counts + preview), one AuditEvent |
| `on` | yes | the above, plus `JobTask` (create, assignee / reviewer / due date, Turia flag), `Engagement` (mapped services), `FirmClient` (matched LMS client without one), `TuriaSync` closeTask (mode `PULL`) |

Runs: `/api/cron/firm-os/turia-pull` (GitHub Action every 15 minutes, Mon–Sat 09:00–20:00 IST,
`CRON_SECRET`) and **Sync now** on the admin page (admins and partners). One at a time (`TuriaPullLock`).
Politeness: 100 tasks a page, 400 ms between pages, at most 50 pages, 30 s per call, 4 minutes a run, at
most 20 timesheet reads a run.

### Data model

| Table | Key | Holds |
|---|---|---|
| `TuriaTaskMirror` | Turia task id | identity (TSK number), task name, client name / normalised key / code, department, status code and name, due / completed / created dates, assignees and reviewers (`[{id,name}]`), `hash`, `appliedHash`, first / last seen, `missingSince`, `closeCheckedAt`, `jobTaskId` |
| `TuriaPersonLink` | Turia user id | Turia name and email, LMS `userId`, `matchedBy` (email / name / manual / none) |
| `TuriaClientLink` | normalised Turia client name | Turia name and code, `lmsClientId`, `firmClientId`, `status` (matched / manual / unmatched / ignored) |
| `TuriaTaskRule` | id | position, label, department words, task-name words, service, job title, frequency, use agent, calendar rule, active |
| `TuriaPullRun` | id | mode, trigger, status, message, complete scan or not, counts, preview (up to 300 rows) |
| `TuriaPullLock` | 1 | lease holder and expiry |
| `JobTask` (new columns) | | `source` ("turia"), `turiaTaskId` (unique), `agentless`, `turiaMissingAt`, `turiaNote` |

### From a Turia task to a job

1. **People.** Email (case-insensitive) to an active user, else the exact normalised name when exactly one
   active user has it. An admin's pick is kept. A task waits until its first assignee is matched; an
   unmatched reviewer leaves the reviewer empty.
2. **Client.** A FirmClient whose code equals Turia's client code, else the exact normalised name
   ("Pvt. Ltd." = "Private Limited", "&" = "and") when exactly one LMS client has it. An admin can pick or
   ignore. A matched LMS client without a FirmClient gets one (mode on): Turia's code when it is a valid,
   free folder-contract code, else one made from the name (first word up to 6 letters plus initials, then
   numbered: `ACMET`, `ACMET01` …; never a Windows reserved name).
3. **Rule.** The first active rule by position whose words appear (whole words; `|` = any of, `+` = all
   of; optional department words). It gives the service, title, frequency and calendar rule. The period
   comes from the task name (month, quarter, FY or AY) or, failing that, the due date (a monthly return is
   for the month before its due date; quarterly for the last quarter ended before it; annual for the FY
   ended before it). No rule, or no readable period: an **agentless** job (service guessed from the
   department, for the label only; title = Turia task name + number; period = the due-date month). It shows
   in Next task and My day as "Open the job"; no agent runs on it.
4. **Job.** An existing job with the same client, service, FY, period and title and no Turia link (e.g.
   from onboarding) is linked, not duplicated. Otherwise a new job: state ASSIGNED, the mapped assignee and
   reviewer, internal due = Turia's due date, statutory due from the calendar rule, `source = turia`.
5. **Afterwards.** Only the assignee, reviewer and internal due date follow Turia (never cleared by an
   unmatched person or a blank date). The state is never touched; DONE jobs are left alone.
6. **Completion.** Turia status `3` or a completion date, on a linked job: the minutes logged in Turia
   (`timesheet/list`) are written as a `TuriaSync` closeTask row (mode `PULL`, CLOSED, ref = TSK number).
   That satisfies the close gate's Turia check; the gate still needs the filing and the Final file, and the
   reconciler closes the job. No time in Turia: nothing is written and staff use **Record Turia close** as
   before (Turia is checked again a day later).
7. **Gone or cancelled.** Missing from a complete scan, or a status name containing "cancel": the job is
   flagged (`turiaMissingAt`, `turiaNote`), never removed; the flag clears if the task returns. A task
   first seen completed or cancelled makes no job.

### Seeded rules

| Order | Words in the task name | Service · title · frequency | Agent | Calendar rule |
|---|---|---|---|---|
| 10 | gstr 3b + qrmp / quarterly | GST · GSTR-3B (QRMP) · quarterly | yes | gstr-3b |
| 20 | gstr 1 + qrmp / quarterly | GST · GSTR-1 (QRMP) · quarterly | yes | gstr-1 |
| 30 | gstr 3b, gstr3b | GST · GSTR-3B · monthly | yes | gstr-3b |
| 40 | gstr 1, gstr1 | GST · GSTR-1 · monthly | yes | gstr-1 |
| 50 | gstr 9, gstr9, gstr 9c, gstr9c | GST · GSTR-9 · annual | yes | gstr-9 |
| 60 | 24q | TDS · TDS 24Q · quarterly | no (no TDS agent) | tds-24q |
| 70 | 26q, tds return | TDS · TDS 26Q · quarterly | no | tds-26q |
| 80 | advance tax | Income tax · Advance tax · quarterly | yes | advance-tax |
| 90 | itr, income tax return | Income tax · ITR · annual | yes | itr |
| 100–150 | aoc 4, mgt 7, adt 1, dir 3, form 11, form 8 | ROC · AOC-4 / MGT-7 / ADT-1 / DIR-3 KYC / LLP Form 11 / LLP Form 8 · annual | yes | same names |
| 160 | annual filing / return / compliance, with department roc / secretarial / company law / mca | ROC · ROC annual filing · annual | yes | roc-annual |
| 170 | bookkeeping, book keeping, books close, books of accounts, accounting | Books · Books close · monthly | yes | books-close |
| 180 | statutory audit, audit | Audit · Audit · annual | yes | audit |

### Fields

Confirmed from Neo Centra's existing task/list reads: `id`, `uniqueidentity`, `taskname`, `clientname`,
`assignee[]`, `reviewer[]` (`{id, name}`), `taskstatus` (`3` = completed; `1`, `2`, `6` open),
`completedon`, `createdon`; `organizationUserListNew`: `id`, `name`, `email`; `timesheet/list`:
`tasktimesheets[].totalhours`.

**Not confirmed** (read with fallbacks; the dry-run preview shows whether they arrive): department
(`departmentname` / `department` / `deptname`, which Neo Centra reads on task/get), due date
(`targetduedate`, from task/get, then `duedate`, `due_date`, `taskduedate`, `enddate`), client code
(`clientcode`, `client_code`, `clientuniqueidentity`, `clientidentity`, `clientuniqueid`), status name
(`taskstatusname`, `statusname`), `updatedon` (only for the optional updatedon sort), and the status code
for "cancelled" (only the name is checked). When Turia gives no time on a completed task, the manual
minutes entry stays.
