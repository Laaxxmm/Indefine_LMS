# ADR-003: Turia adapter — ManualBridge by default

- **Status:** Accepted, 2026-11-05; amended 2026-11-06 (Amendment 1: read-only Turia task pull, below)
- **Deciders:** Lakshmanan A (owner); Firm OS lead engineer
- **Related:** ADR-005 (close loop), `docs/inventory.md` §8.3, G-1

## Context

Turia (practice.turia.in) is the firm's source of truth for clients, services, tasks and time.
Firm OS needs to create clients and tasks at onboarding (Phase 3) and confirm that a task is closed
with time logged before a job can be DONE (Phase 8).

What the repository shows about Turia:

- `src/lib/neo-centra/turia.ts` calls `POST https://practice.turia.in/api/<endpoint>` with an
  `action` field and the firm's **browser session cookie**. Actions used: `utilities/organizationUserListNew`,
  `task/list`, `task/get`, `leads/list`, `invoice/list`, `timesheet/list`. All are reads; there is no
  create, update, close or time-log call anywhere in the repo.
- The cookie (including the HttpOnly `accessToken`) is captured by `neo-centra-extension/` from a
  director's logged-in Turia tab and pushed every 5 minutes to `/api/tools/neo-centra/turia-cookie`
  (`NEO_TURIA_RELAY_TOKEN`). It is stored encrypted in `NeoTuriaSession` with `NEO_TURIA_COOKIE_KEY`.
- `neo-centra-extension/README.md` states that Turia has no API. There is no Turia API key, client id,
  OAuth configuration or API documentation in the repo or `.env.example`.

These are Turia's internal endpoints, observed from its web app. They are not a documented API: the
field names already vary (see the defensive parsing in `turia.ts`) and may change without notice.

## Decision

`src/lib/integrations/turia/adapter.ts` defines one `TuriaAdapter` interface (`findClient`,
`createClient`, `addService`, `createTask`, `getTask`, `closeTask`, `logTime`). It has **no delete
method**, enforced by `verify:no-delete`. Three bridges implement it; one is active per environment,
recorded in PROGRESS and on each `TuriaSync` row (`mode`).

| Bridge | Status | Behaviour |
|---|---|---|
| `ManualBridge` (`manual-bridge.ts`) | **Default, active** | Produces a numbered checklist with prefilled values and copy buttons for staff to perform in Turia. Staff confirm with the Turia client ref / task ref and minutes logged. The confirmation, who made it and when are stored as evidence. A partner spot-checks 10% of closures (Phase 8). |
| `UiAutomationBridge` (`ui-bridge.ts`) | Optional, off by default | Playwright against practice.turia.in, reusing the encrypted Neo Centra session cookie. Partner role only. Read-first: reads (find client, get task, check closed/time) may run when enabled; any write runs in dry-run by default and shows the exact steps it would take. A real write needs a partner to switch off dry-run for that run. Session expiry falls back to ManualBridge. |
| `ApiBridge` (`api-bridge.ts`) | Not built | Only if Turia supplies a documented API and credentials. Until then it is an interface placeholder that throws. |

Firm OS does not call Turia's internal write endpoints by reverse engineering, and does not invent
Turia API calls.

**Blocked / needs human:** ask Turia (vendor) for API documentation and credentials, and whether
UI automation against their app is permitted under the firm's subscription terms.

## Consequences

- Week 1 works without any Turia change: Turia steps are human steps with recorded evidence.
- The close loop (ADR-005) checks `TuriaSync.status = CLOSED` regardless of bridge, so switching bridges later changes no gate logic.
- ManualBridge confirmations are self-reported. The 10% partner spot-check and the evidence fields are the control; the cycle-time report will show how long Turia steps take.
- The shared cookie belongs to one director's Turia login. Anything UiAutomationBridge does in Turia is attributed to that director, not to the staff member. This is a further reason writes stay manual by default.
- Turia UI changes can break UiAutomationBridge without warning; it must fail to ManualBridge, never to a silent pass.
- Neo Centra's existing reads are unchanged.

## Alternatives considered

1. **Call Turia's internal write endpoints directly** (as `turia.ts` does for reads). Rejected: undocumented, unversioned, and a write mistake cannot be undone (no deletes allowed).
2. **UI automation as the default.** Rejected for week 1: brittle, attributes actions to one director, and needs a terms check.
3. **Skip Turia and track tasks only in Firm OS.** Rejected: Turia stays the firm's system of record for tasks, time and billing.

---

## Amendment 1 — read-only Turia → Firm OS task pull (06 Nov 2026)

- **Status:** Accepted, 2026-11-06
- **Deciders:** Lakshmanan A (owner)
- **Code:** `src/lib/integrations/turia/pull/`, `/api/cron/firm-os/turia-pull`, `/api/firm-os/turia-sync/*`,
  `/admin/firm-os/turia-sync`. Docs: `docs/turia-bridge.md` ("Turia pull"), `docs/go-live.md` §4.1.

### Context

Firm OS had no jobs in production: jobs came only from Firm OS onboarding, one client at a time, and a
one-off bulk import is useless because Turia changes every day. Turia remains the firm's system of record
for tasks. The LMS already reads Turia every day for the Neo Centra incentive scheme, through the firm-wide
Turia sign-in the Neo Centra Chrome extension pushes every 5 minutes (`NeoTuriaSession`, sealed with
`NEO_TURIA_COOKIE_KEY`) and `turiaPost()` in `src/lib/neo-centra/turia.ts`.

### Decision

Firm OS **pulls** Turia's tasks automatically, **read only**, over that same connection, and turns them into
JobTasks. The "Decision" above still holds for writes: Firm OS never writes to Turia, and every Turia step a
person does stays on the ManualBridge checklist.

- **Read-only, enforced.** `read-client.ts` wraps Neo Centra's `turiaPost` (now exported for this one
  caller; Neo Centra's own calls are unchanged) in `turiaRead()`, which refuses anything outside
  `TURIA_READ_ALLOWLIST` before a request is made: `task/list` (the source), `task/get` (allowed for
  diagnosis, not called), `utilities/organizationUserListNew` (people with email, for matching) and
  `timesheet/list` (time logged on a task Turia shows completed, so the close gate gets real minutes; a
  read Neo Centra already makes). `tests/unit/turia-pull-readonly.test.ts` fails if a write action is added,
  if any other file in the pull imports `turiaPost`, or if the pull calls `fetch`, Turia's address or a
  TuriaAdapter write.
- **Off by default.** `FIRM_OS_TURIA_PULL = off | dry-run | on`, under the master switch `FIRM_OS_ENABLED`.
  Dry run stores only the mirror, the match suggestions and a preview report; it creates or changes no
  JobTask, FirmClient, Engagement or TuriaSync. On applies.
- **What it does with a task.** Mirror (`TuriaTaskMirror`, hash-skipped when unchanged) → people
  (`TuriaPersonLink`: email, then exact name, admin pick kept) → client (`TuriaClientLink`: code, then exact
  normalised name, admin pick or ignore; a matched LMS client without a FirmClient gets one with Turia's
  code when valid, else one made from the name) → rule (`TuriaTaskRule`, admin-editable, seeded from the
  onboarding JOB_CATALOG titles and calendar rules; unmapped tasks become agentless jobs) → job.
  New jobs start ASSIGNED (as onboarding's do); only the assignee, reviewer and internal due date follow
  Turia afterwards; the state machine is never driven by the pull, so a job never moves backwards; DONE
  jobs are left alone; a task first seen completed or cancelled makes no job.
- **Completion.** When Turia shows a linked task completed and has time logged, the pull writes a
  `TuriaSync` closeTask row (mode `PULL`, status CLOSED, Turia's task number as the ref, the minutes) — the
  record the close gate's "Turia task closed" check reads. DONE still needs the filing and the Final
  deliverable and still happens only through `closeJob()` and the DB trigger. With no time in Turia,
  nothing is written and staff record the minutes by hand as before.
- **Never deletes.** A task missing from a complete scan, or cancelled, sets `JobTask.turiaMissingAt` /
  `turiaNote`; the flag clears if the task returns.
- **DPDP.** The mirror keeps only task id and number, task name, client name and code, department,
  status, dates and people ids and names — no descriptions, comments or amounts. Nothing goes to an AI
  model. Each run writes one AuditEvent with counts only; each mapping change is audited.
- **Politeness.** 100 tasks a page, 400 ms between pages, at most 50 pages, 30 s per call, 4 minutes a run,
  one run at a time (`TuriaPullLock` lease), at most 20 timesheet reads a run; an updatedon-sorted run may
  stop at an unchanged page only when that order is verified and a full scan ran in the last 24 hours.

### Risks (accepted by the owner)

1. **Undocumented API.** `task/list` and friends are Turia's internal web-app endpoints. Field names
   already vary (see the defensive parsing) and may change without notice. Mitigations: dry run first;
   tolerant field reading with known fallbacks; a change shows up as missing fields in the preview or a
   failed run with a plain message, never as silent writes; the mirror hash means a field change re-plans
   every task once, not repeatedly.
2. **One firm session.** Every read uses one director's Turia login (the Neo Centra cookie). If it expires,
   the run stops with "Open Turia in Chrome with the Neo Centra extension signed in, then try again",
   records it and does nothing else. Reads are attributed to that director in Turia's logs.
3. **Terms with Turia.** Automated reading of Turia's internal endpoints is not confirmed as permitted by
   the firm's subscription terms. The same question was already open for Neo Centra and for
   UiAutomationBridge. **Blocked / needs human:** the owner asks Turia (vendor) to confirm, or for a
   documented read API (which would replace `read-client.ts` and nothing else).

### Consequences

- Firm OS work appears in Next task, My day and Agents for the mapped Turia assignee and reviewer without
  onboarding each client; staff still see only their own jobs (existing RBAC).
- ManualBridge, UiAutomationBridge and ApiBridge are unchanged; `FIRM_OS_TURIA_BRIDGE` still governs
  writes (there are none from the pull).
- `JobTask` gains additive columns: `source`, `turiaTaskId` (unique), `agentless`, `turiaMissingAt`,
  `turiaNote`.
