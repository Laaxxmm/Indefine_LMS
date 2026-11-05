# ADR-005: A job is DONE only when Turia is closed and the file is in SharePoint

- **Status:** Accepted, 2026-11-05
- **Deciders:** Lakshmanan A (owner); Firm OS lead engineer
- **Related:** ADR-003 (Turia), ADR-004 (Path A), Phase 8 `src/lib/close-loop/`

## Context

Work is often "done" in one system and not the others: the return is filed but the acknowledgement
is not in the client folder, or the Turia task stays open so time and billing are wrong. A status
that anyone can set by clicking does not prevent this.

The LMS has a simple `Job.status` (`NOT_STARTED`, `IN_PROGRESS`, `DELIVERED`, `CLOSED`) with no
checks. Firm OS adds `JobTask` with a stricter lifecycle and leaves `Job` as it is.

## Decision

**State machine.** `JobTask.state` moves only through:

`DRAFT → ASSIGNED → IN_PREP → AGENT_DONE → IN_REVIEW → APPROVED → FILED_BY_HUMAN → CLOSING → DONE`

Allowed transitions (plus "request changes" back from `IN_REVIEW` to `IN_PREP`) are a table in
`src/lib/agents/core/state.ts`, a pure function covered by unit tests. Each transition is appended
to a history with actor and IST timestamp (the `WorkEvent` pattern), which also feeds cycle time.

**DONE only through the gate.** The only code that may set `DONE` is `closeLoop.gate()` in
`src/lib/close-loop/gate.ts`. In one transaction it re-checks, and moves the job to `DONE` only if
all three hold:

1. **SharePoint presence:** at least one `Deliverable` for the job in `Final/`, at exactly
   `deliverablePath()` (ADR-004), verified live through Graph: the item exists, size > 0, SHA-256
   matches the stored hash.
2. **Turia closed:** `TuriaSync.status = CLOSED` with time logged, through the active bridge
   (ADR-003). With ManualBridge this is the staff confirmation of task ref and minutes.
3. **Human filing:** a `FILED_BY_HUMAN` confirmation by a named person, with the acknowledgement
   reference where the service has one (GST ARN, MCA SRN, ITR acknowledgement number). Stored, not
   verified against any portal, because Firm OS never contacts government portals.

Otherwise the job stays in `CLOSING` and the reasons are shown.

**Enforced below the UI.** Route handlers call the state machine; none accepts a target state of
`DONE`. A direct attempt returns 403/state error (integration-tested). As a backstop Phase 8 adds a
database-level check (a Postgres trigger in an additive migration, or a Prisma client extension if a
trigger proves impractical) that rejects an update to `DONE` that does not come from the gate.

**After DONE.** The reconciler cron (every 30 minutes, IST working hours) re-checks recent jobs. If a
final file disappears it raises an alert; it does not silently reopen the job. Jobs in
`FILED_BY_HUMAN` for more than 15 minutes without Turia close or file nudge the assignee; after 24
hours, the manager.

## Consequences

- "Done" means the same thing for every service and every person, and can be audited.
- Staff carry two extra steps (file to `Final/`, close Turia). Hooks reduce them: approval copies `Working/` to `Final/`; marking filed prompts the Turia close at once.
- A Graph or Turia outage holds jobs in `CLOSING`. That is correct: the gate fails safe.
- ManualBridge makes condition 2 self-reported; the partner 10% spot-check is the control.
- `Job.status` in the LMS is not driven by `JobTask` in week 1; any link is display-only.

## Alternatives considered

1. **UI-only rule** (hide the DONE button until conditions are met). Rejected: any API call or bug bypasses it.
2. **Trust a checkbox per condition.** Rejected for SharePoint: the file can be checked live, so it is. Turia is checkbox-based only because no documented API exists (ADR-003).
3. **Reopen jobs automatically when a file goes missing.** Rejected: silent state changes confuse staff; an alert to a person is clearer.
