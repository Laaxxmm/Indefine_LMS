# Retention: Firm OS data

- **Status:** Phase 11, 2026-11-05. Source of the rules: [ADR-006](../adr/ADR-006-dpdp-data-classes.md) "Retention".
- **Job:** `GET /api/cron/firm-os/retention` (daily, 02:30 IST), `CRON_SECRET` bearer, workflow
  `.github/workflows/firm-os-retention.yml`. Code: `src/lib/hardening/retention.ts`.

| Data | Kept | Then | How |
|---|---|---|---|
| `AgentRun.inputs` (cached extracted rows, file list) | until `inputsPurgeAt` (the runner sets it to finish + 30 days); runs from before that column default to `startedAt` + 30 days | `inputs` set to **null**; the run row, its figures, checklist results, deliverable hashes and audit trail stay | `UPDATE … SET inputs = NULL` (`clearExpiredAgentRunInputs`). Not a delete: the no-delete rule still holds |
| `ActivityHeartbeat` rows (break-nudge signal) | **7 days** | **deleted** | `purgeExpiredHeartbeats`: the only delete in Firm OS code, allowlisted by name in `scripts/lib/guards.ts` (`NO_DELETE_EXEMPTIONS`, one entry, citing ADR-006). These rows have no business value after the nudge window and ADR-006 commits to deleting them |
| Deliverables (packs, filings, acknowledgements) | in SharePoint `CL-{Code}` under the firm's existing retention | not copied into Postgres; Postgres keeps only the pointer and SHA-256 | ADR-004 |
| `ModelCall`, `AuditEvent` | kept | — | no raw client text in them (ModelCall: masked-prompt hash; AuditEvent: ids, refs, counts) |
| Everything else in the [inventory](data-inventory.md) | kept with the record | archive / flag only | Never delete LMS user data, Turia records or SharePoint files |

## Each run

1. Clears expired `AgentRun.inputs` (batch of up to 500 rows per run; the next day continues).
2. Deletes `ActivityHeartbeat` rows with `at` older than 7 days.
3. Writes the missing `model-escalation` AuditEvents for escalated `ModelCall` rows of the last 7 days.
4. Writes one `retention` AuditEvent with the counts (actor `system:retention`).

The windows are constants in `retention.ts` (`AGENT_RUN_INPUTS_DAYS = 30`, `HEARTBEAT_DAYS = 7`).
Changing either is a threshold change: partner approval and an ADR (orchestrator FAILURE RULES).

## Checks

- Unit tests (`src/lib/hardening/retention.test.ts`): only expired inputs are cleared and the rows remain; only heartbeats older than 7 days are removed; the cron route needs the secret and audits the counts.
- `npm run verify:firm-os` (verify:no-delete): the guard exemption covers exactly one function, `purgeExpiredHeartbeats` in `src/lib/hardening/retention.ts`, and only `activityHeartbeat.deleteMany` inside it; any other delete in Firm OS code still fails.
