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
