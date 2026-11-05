# Retention: Firm OS data

- **Status:** Phase 11, 2026-11-05; updated 2026-11-06 (DPDP data-coverage audit, finding #20). Source
  of the rules: [ADR-006](../adr/ADR-006-dpdp-data-classes.md) "Retention" and
  [consent and purpose](consent-purpose.md) §3.
- **Job:** `GET /api/cron/firm-os/retention` (daily, 02:30 IST), `CRON_SECRET` bearer, workflow
  `.github/workflows/firm-os-retention.yml`. Code: `src/lib/hardening/retention.ts`.

## What the job does

| Data | Kept | Then | How |
|---|---|---|---|
| `AgentRun.inputs` (cached extracted rows, file list) | until `inputsPurgeAt` (the runner sets it to finish + 30 days); runs from before that column default to `startedAt` + 30 days | `inputs` set to **null**; the run row, its figures, checklist results, deliverable hashes and audit trail stay | `UPDATE … SET inputs = NULL` (`clearExpiredAgentRunInputs`). Not a delete: the no-delete rule still holds |
| `OnboardingRun.prompt`, `spec`, `plan` (the typed request, the details extracted from it, the plan) | **30 days after the run last changed** (`updatedAt`), whatever its status: done, failed, blocked or abandoned | `prompt` → `[cleared by retention]` (the column is required), `spec` → `{ "cleared": true }`, `plan` → null. The row, status, steps, error, link to the client and audit trail stay; the client master holds the client's details | `UPDATE` (`clearStaleOnboardingCopies`), one statement per night. Erased runs (`[erased]`) are left as they are |
| Typed notes in `AuditEvent.meta` (`comment` text; `note` of request-changes, re-run, approve, retract-filing, manual prep, spot-check) and provider errors in `ModelCall.error` | masked when written (Firm OS writers); older rows and other writers on the next nightly run | PAN, GSTIN, Aadhaar, phone, email and account numbers become anonymizer tokens (`⟨PAN_1⟩`); every other value, key and link stays | `UPDATE` per changed row (`sweepFreeText`), up to 1,000 rows of each table a night, resuming from cursors kept in the `retention` AuditEvent |
| `ActivityHeartbeat` rows (break-nudge signal) | **7 days** | **deleted** | `purgeExpiredRows`: the only delete function in Firm OS code, allowlisted by name in `scripts/lib/guards.ts` (`NO_DELETE_EXEMPTIONS`, one entry, citing ADR-006). These rows have no business value after the nudge window and ADR-006 commits to deleting them |
| `RateLimitBucket` rows (request counters: key, window start, count) | until **a day after the bucket's window ends** (window = the longest rate-limit window in force) | **deleted** | Same function, `purgeExpiredRows` (ADR-006 amendment 2026-11-06). The rows hold no personal data and no business record; an expired bucket limits nothing (the next request starts a new window), so deleting it changes no limit and only stops the table growing with every new key |

## Kept with the record (no scheduled clearing), and why

Everything below leaves Postgres only through an erasure request (rights.md): anonymised in place
once no retention duty applies, or under a recorded legal hold until then.

| Data | Why it is kept |
|---|---|
| Client master (`Client`), `FirmClient`, `JobTask` (incl. `ackRef`), `Engagement` | The client record and the filings: statutory and professional record keeping (Income-tax, GST, Companies Act, ICAI SQC 1 / SA 230; durations in `src/lib/privacy/policy.ts`, each with a verify note) |
| `AgentRun.figures` / `reviewNotes` / `error`, `ChecklistResult`, `JobTaskEvent.note`, `AuditEvent` | Working papers and the review trail of the engagement (SA 230), and accountability for who did what. Free text in them is masked when written (above) |
| `Deliverable` rows | Pointers (name, path, SHA-256) to files that stay in SharePoint `CL-{Code}` under the firm's retention (ADR-004); the close gate rests on them |
| `TuriaSync.evidence` | The evidence that a person did the manual Turia step the partner spot-checks (ADR-005); its idempotency key is used to avoid issuing a checklist twice |
| `CommsDraft.subject` / `body` | The firm's record of what was prepared for the client; the sent mail itself lives in the staff member's Outlook |
| `MistakeLog.example` | Needed to prove a checklist rule while it is in force (open item 1 in the inventory: a partner may replace it by a synthetic example) |
| `CoachEvent` | Reminders and escalations are the record that the firm chased due work. Break events (at most 3 a person a day, a short message) are the per-person daily aggregate ADR-006 allows to remain after heartbeats go; they are **not** purged |
| `ModelCall`, `AuditEvent` | Usage, cost and escalation log (ADR-002) and accountability: kept, on the promise that they hold no raw client text — made true by masking at write time and the nightly sweep |
| `PrivacyRequest`, `BreachIncident` | The firm's register of DPDP requests and breaches (accountability); identifiers are stored only as a keyed hash and a masked label |
| `CertificateIssue`, `EngagementLetter` (LMS) | ICAI duty for certificates and engagement letters |
| Deliverable files, KYC documents (SharePoint) | Firm OS never deletes SharePoint files; the firm's SharePoint retention decides disposal after the hold date |

Never deleted in any case: LMS user data, Turia records, SharePoint files.

## Each run

1. Clears expired `AgentRun.inputs` (one `UPDATE`).
2. Clears `OnboardingRun` prompt / spec / plan untouched for 30 days (one `UPDATE`).
3. Masks identifiers left in typed `AuditEvent` notes and in `ModelCall.error`, from the cursors the last run recorded (the first run starts at the beginning; 1,000 rows of each table a night).
4. Deletes `ActivityHeartbeat` rows with `at` older than 7 days, and `RateLimitBucket` rows whose window ended more than a day ago.
5. Writes the missing `model-escalation` AuditEvents for escalated `ModelCall` rows of the last 7 days.
6. Writes one `retention` AuditEvent (actor `system:retention`) with the counts, the windows and the sweep cursors.

Idempotent: a second run the same night changes nothing and records that it ran.

The windows are constants in `retention.ts` (`AGENT_RUN_INPUTS_DAYS = 30`, `ONBOARDING_COPY_DAYS = 30`,
`HEARTBEAT_DAYS = 7`, `RATE_LIMIT_BUCKET_GRACE_DAYS = 1`). Changing one is a threshold change: partner approval and an ADR (orchestrator
FAILURE RULES). **The 30-day onboarding window is new on 2026-11-06** (consent-purpose.md promised the
clearing without a period; the inventory's open item proposed 30 days): a partner confirms it and
ADR-006's retention table gains the line.

## Checks

- Unit tests (`src/lib/hardening/retention.test.ts`): only expired inputs are cleared and the rows remain; onboarding copies are cleared after 30 days with the rows, status and error kept; identifiers in audit notes and model errors are masked and nothing else changes; the sweep resumes from its cursor and stops at the batch size; only heartbeats older than 7 days and rate-limit buckets whose window ended more than a day ago are removed; a second run changes nothing; the cron route needs the secret and returns the counts. The audit PoC (`retention-gaps`) is ported there.
- `npm run verify:firm-os` (verify:no-delete): the guard exemption covers exactly one function, `purgeExpiredRows` in `src/lib/hardening/retention.ts`, and only `activityHeartbeat.deleteMany` and `rateLimitBucket.deleteMany` inside it; any other delete in Firm OS code still fails.
