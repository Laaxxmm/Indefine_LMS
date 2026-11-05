# DPDP data inventory: Firm OS

- **Status:** Phase 11, 2026-11-05. Owner: Firm OS lead engineer. Reviewer: partner (data fiduciary decisions).
- **Rules this applies:** [ADR-006](../adr/ADR-006-dpdp-data-classes.md) data classes and retention;
  [ADR-002](../adr/ADR-002-model-router.md) (every cloud model call is masked first);
  [ADR-004](../adr/ADR-004-sharepoint-path-a.md) (documents live in SharePoint, not Postgres).
- **Companions:** [retention](retention.md) · [consent and purpose](consent-purpose.md) ·
  [breach runbook](../runbooks/breach.md) · [backup restore drill](../runbooks/backup-restore.md).

## Data classes (from ADR-006)

| Class | Meaning | May go to a cloud model |
|---|---|---|
| **A** | Client personal data: PAN, Aadhaar, GSTIN of a person (proprietor), bank account / IFSC, DOB, phone, email, postal address, individuals' names, DIN, anything linking these to a person | Only masked by `Anonymizer` (tokens such as `⟨PAN_1⟩`); `local-only` tasks never |
| **B** | Staff personal data: names, emails, attendance, performance, activity heartbeats | No (a staff member's own name in a draft is the one exception) |
| **C** | Firm and public data: SOP text, checklists, circulars, company GSTIN/CIN of a non-individual, computed totals without identifiers | Yes, unmasked (`privacy: 'public'`), still logged |
| **—** | No personal data (ids, states, timestamps, hashes, counts) | n/a |

When unsure, a field is class **A**. A column marked **A (may)** holds class A data for some clients
only (e.g. the GSTIN of a proprietorship is the proprietor's; a company's is class C).

## Where personal data lives

| Store | What | Personal data |
|---|---|---|
| Postgres (Railway, `DATABASE_URL`) | the tables below | A, B (minimised), C |
| SharePoint `CL-{Code}` sites (firm tenant) | KYC documents, client inputs (`ClientDocs`), Working and Final deliverables | A (documents) |
| Microsoft Graph mailboxes (staff's own) | Outlook drafts created by Phase 10 comms (never sent by the app) | A (draft bodies, masked where required) |
| Cloud models (Anthropic, optional xAI) | masked prompts only; ModelCall stores the prompt's SHA-256, not its text | A only as tokens |
| Railway logs | request logs, structured app lines (`[rate-limit]`, `[upload]` without file names, `[audit]`) | B (user ids); no class A by design |
| Turia (practice.turia.in) | source of truth for clients, tasks and time; Firm OS writes only through the Manual bridge checklist a person follows | A (outside Firm OS) |

## Firm OS tables (Postgres)

Columns not listed hold ids, enums, booleans, counts or timestamps only (class —).

### Shared spine

| Table | Column | Class | Notes / why kept |
|---|---|---|---|
| `FirmClient` | `clientCode`, `clSiteUrl`, `turiaClientRef`, `preferredLanguage` | C | Links the LMS `Client` to its `CL-{Code}` site and Turia record; no identifiers of people |
| | `createdById` | B | Who onboarded (accountability) |
| `ModelCall` | `runId`, `agent`, `task`, `provider`, `model`, `tier`, `status`, tokens, cost | — | Usage and escalation log (ADR-002) |
| | `promptHash` | — | SHA-256 of the **masked** prompt; the text is never stored |
| | `error` | C (may) | Provider error text; contains no prompt text by design |
| `AuditEvent` | `actorId` | B | User id, `agent:<runId>` or `system:<name>` |
| | `action`, `entity`, `entityId` | — | What happened to which row (`logAudit`, src/lib/audit/log.ts) |
| | `meta` | B / C | Small JSON summary (ids, states, refs, counts; capped at 8 KB). Must not carry class A: onboarding answers are recorded by **field name only**; reviewer comments are staff text (`action: "comment"`) and are the one place free text is kept |

### Jobs, agents, close loop

| Table | Column | Class | Notes |
|---|---|---|---|
| `Engagement` | `assigneeId`, `reviewerId` | B | Who works the service |
| `SopPack` | `calendar`, `checklist`, `title`, `changeNote` | C | Firm SOP as data |
| | `createdById`, `approvedById` | B | Partner approval trail |
| `JobTask` | `title`, `fy`, `period`, `service` | C | |
| | `ackRef` | A (may) | Portal acknowledgement (ARN / SRN / ITR ack no.); identifies a filing of the client. Stored, never verified against a portal |
| | `assigneeId`, `reviewerId`, `filedById`, `createdById` | B | |
| `JobTaskEvent` | `actorId` | B | |
| | `note` | B / A (may) | Staff notes on transitions (e.g. "wrong ARN"); the CLOSING → DONE note holds the gate evidence JSON (file ids, SHA-256, Turia ref, minutes) |
| `AgentRun` | `inputs` | **A** | Cached extracted rows and file list for review and mistake replay. **Retention: cleared to null after `inputsPurgeAt` (≤ 30 days), row kept** (src/lib/hardening/retention.ts) |
| | `figures` | A (may) / C | Deterministic totals; per-party breakdowns can name a proprietor |
| | `reviewNotes`, `error` | B / A (may) | Reviewer note, failure reason |
| | `startedById` | B | |
| `ChecklistResult` | `message`, `evidence` | A (may) | A finding quotes the input it rests on (grounding, ADR-008): may contain a party name or GSTIN |
| `MistakeLog` | `pattern`, `ruleProposal` | C | The proposed rule |
| | `example` | **A** | The run's extraction used to replay the rule. Kept with the rule while it is in force (needed to prove the rule); see "Open items" |
| | `createdById`, `decidedById` | B | |
| `Deliverable` | `name`, `spPath`, `driveItemId`, `sha256`, `sizeBytes` | C (may A) | Pointer to the file in SharePoint; file names follow the folder contract (`{Code}_{Form}_{Period}_v{n}`) and carry no personal identifiers. **The file itself is not in Postgres** |
| `TuriaSync` | `turiaRef`, `minutesLogged`, `operation`, `mode`, `status` | C | |
| | `evidence` | **A** | Manual-bridge checklist with prefilled client values (name, PAN/GSTIN where Turia needs them) for the person to type into Turia |
| | `confirmedById`, `spotCheckedById` | B | |
| | `spotCheckNote` | B | Partner's spot-check note |
| `OnboardingRun` | `prompt` | **A** | The partner's plain-English sentence (may name people, carry PAN/GSTIN) |
| | `spec`, `plan` | **A** | Extracted client details (PAN, GSTIN, contact name, phone, email) and the plan |
| | `steps`, `error` | C | Saga progress |
| | `createdById` | B | |

### Coach, comms, hardening

| Table | Column | Class | Notes |
|---|---|---|---|
| `CommsDraft` | `subject`, `body` | **A** | Draft client message. PAN/Aadhaar only masked to the last 4 and only when the client asked (ADR-006, Phase 10) |
| | `outlookDraftId`, `createdById` | B | Draft lives in the staff member's own mailbox |
| `CoachEvent` | `userId`, `payload` | B | Nudges to staff (job labels by client code, not people). `dedupeKey` = `reminder:<job>:<user>:<IST day>` etc. |
| `ActivityHeartbeat` | `userId`, `at`, `source` | **B** | Break-nudge signal only. **Retention: 7 days, then deleted** (the one Firm OS table rows are purged from; ADR-006) |
| `CoachPreference` | `userId`, toggles | B | Each person's own opt-outs |
| `RateLimitBucket` | `key` (`<scope>:<userId>`), `count`, `windowStart` | B | One row per person and scope, overwritten each window |

## LMS tables Firm OS reads (not changed by Firm OS)

| Table | Columns with personal data | Class | Firm OS use |
|---|---|---|---|
| `Client` | `pan`, `contactName`, `contactPhone`, `contactEmail`, `city` | A | Onboarding writes the client record; agents read names for the anonymizer dictionary |
| | `gstin`, `cin` | A (may) / C | Proprietor GSTIN is A; company GSTIN/CIN is C |
| `User` | `name`, `email`, `image`, `level`, `managerId`, `aspiration`, `strengths` | B | Roles (src/lib/rbac/policy.ts), assignees, escalation recipients |
| `Account` | OAuth tokens (encrypted at rest) | B (secret) | Staff's delegated Graph token (Outlook drafts) |
| `NeoTuriaSession` | `cookie` (encrypted) | secret | Turia session for the read-only UI bridge |
| `EngagementLetter` | `clientName`, `data`, `sentTo` | A | Shown read-only at onboarding |
| `CertificateIssue` | `clientName`, `payload` | A | Not read by Firm OS (listed for completeness, inventory §7) |
| `ClientDocument` | pointers to legacy SharePoint files | — | Read-only |

## Audit

Every create / approve / close / export / model escalation / retract / spot-check / onboard /
comms-draft action writes an `AuditEvent` through `logAudit()`; `npm run verify:audit-coverage`
proves statically that every mutating Firm OS route reaches it. Model escalations are mirrored from
`ModelCall` by the daily cron (`auditModelEscalations`).

## Keeping this inventory true

- A migration that adds a Firm OS table or a column that can hold personal data updates this file in the same change.
- Tables added after 2026-11-05 by later work (e.g. companion pairing tokens, workspace settings, search) must be added here when they merge.
- `npm run verify:audit-coverage` and `npm run verify:rbac` run in the QA gate; this file is reviewed at each phase gate.

## Open items (partner decisions)

1. `MistakeLog.example` keeps a run's extraction (class A) for as long as the rule is in force. Option: replace it by a synthetic example when the rule is approved.
2. `OnboardingRun.prompt` / `spec` and `TuriaSync.evidence` are kept with the record. Option: clear the prompt 30 days after the run is DONE (same pattern as `AgentRun.inputs`).
3. Reviewer comments (`AuditEvent` `comment`) are free text and kept; staff guidance should say "no PAN/Aadhaar in comments".
