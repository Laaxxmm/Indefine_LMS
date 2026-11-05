# ADR-003: Turia adapter — ManualBridge by default

- **Status:** Accepted, 2026-11-05
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
