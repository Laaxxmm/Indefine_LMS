# DPDP data inventory: Firm OS

- **Status:** Phase 11, 2026-11-05; updated 2026-11-06 after the DPDP data-coverage audit (erasure
  residue, retention schedule, write-time masking). Owner: Firm OS lead engineer. Reviewer: partner
  (data fiduciary decisions).
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
| | `error` | C (may) | Provider error text; should hold no prompt text, but a provider can echo some. **Retention: identifiers masked by the nightly sweep** (`sweepFreeText`); erasure cleans the person's names |
| `AuditEvent` | `actorId` | B | User id, `agent:<runId>` or `system:<name>` |
| | `action`, `entity`, `entityId` | — | What happened to which row (`logAudit`, src/lib/audit/log.ts) |
| | `meta` | B / C | Small JSON summary (ids, states, refs, counts; capped at 8 KB). Must not carry class A: onboarding answers are recorded by **field name only**; correction values are masked (docs/dpdp/corrections.md). Typed text — reviewer comments (`comment`), change-request / re-run / approval / retraction / spot-check notes — is **masked when written** (identifiers always; the client's names where the writer knows the client, `scrubFreeText` + `clientDictionary`) and swept nightly for identifiers left in older rows. Erasure cleans the person's names and identifiers in place |

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
| | `note` | B / A (may) | Staff notes on transitions (e.g. "wrong ARN"), **masked when written** by the agent service and the close-loop actions; the CLOSING → DONE note holds the gate evidence JSON (file ids, SHA-256, Turia ref, minutes). Erasure cleans the person's names, identifiers and ack refs in place (held while a duty applies) |
| `AgentRun` | `inputs` | **A** | Cached extracted rows and file list for review and mistake replay. **Retention: cleared to null after `inputsPurgeAt` (≤ 30 days), row kept** (src/lib/hardening/retention.ts) |
| | `figures` | A (may) / C | Deterministic totals; per-party breakdowns can name a proprietor. Erasure replaces names and identifiers inside the JSON, never a number |
| | `reviewNotes`, `error` | B / A (may) | Reviewer note (masked when a change is requested), failure reason. Erasure cleans both |
| | `startedById` | B | |
| `ChecklistResult` | `message`, `evidence` | A (may) | A finding quotes the input it rests on (grounding, ADR-008): may contain a party name or GSTIN. Kept with the working papers; erasure cleans it once no duty applies |
| `MistakeLog` | `pattern`, `ruleProposal` | C | The proposed rule |
| | `example` | **A** | The run's extraction used to replay the rule. Kept with the rule while it is in force (needed to prove the rule); erasure cleans the person's identifiers in it at once (a copy, not the record); see "Open items" |
| | `createdById`, `decidedById` | B | |
| `Deliverable` | `name`, `spPath`, `driveItemId`, `sha256`, `sizeBytes` | C (may A) | Pointer to the file in SharePoint; file names follow the folder contract (`{Code}_{Form}_{Period}_v{n}`) and should carry no personal identifiers. **The file itself is not in Postgres** (held in SharePoint). Erasure cleans a name or path that does carry one; the id and SHA-256 stay |
| `TuriaSync` | `turiaRef`, `minutesLogged`, `operation`, `mode`, `status` | C | |
| | `evidence` | **A** | Manual-bridge checklist with prefilled client values (name, PAN/GSTIN where Turia needs them) for the person to type into Turia. Kept with the record as the evidence of the manual step the partner spot-checks (ADR-005); erasure cleans the person's values at once (Turia holds the record); the idempotency `key` stays |
| | `confirmedById`, `spotCheckedById` | B | |
| | `spotCheckNote` | B | Partner's spot-check note |
| `OnboardingRun` | `prompt` | **A** | The partner's plain-English sentence (may name people, carry PAN/GSTIN). **Retention: replaced by `[cleared by retention]` 30 days after the run last changed** (done, failed or abandoned) |
| | `spec`, `plan` | **A** | Extracted client details (PAN, GSTIN, contact name, phone, email) and the plan. **Retention: cleared with the prompt** (`spec` → `{ cleared: true }`, `plan` → null). A run that never reached a client record (`firmClientId` null) is found for erasure by identifiers that pin the person alone (PAN / GSTIN / CIN, an email or phone no other client shares), never by a name; for a person no record matches, by the request's identifier hash (they are then "known only by identifiers", rights.md) |
| | `steps`, `error` | C | Saga progress |
| | `createdById` | B | |

### Coach, comms, hardening

| Table | Column | Class | Notes |
|---|---|---|---|
| `CommsDraft` | `subject`, `body` | **A** | Draft client message. PAN/Aadhaar only masked to the last 4 and only when the client asked (ADR-006, Phase 10). Kept with the record; erasure replaces both with `[erased]` (with or without a job) |
| | `outlookDraftId`, `createdById` | B | Draft lives in the staff member's own mailbox |
| `CoachEvent` | `userId`, `payload` | B (may A) | Nudges to staff (job labels by client code, not people). `dedupeKey` = `reminder:<job>:<user>:<IST day>` etc. Break events (`kind: "break"`, at most 3 a person a day, payload a short message) are the per-person daily aggregate ADR-006 allows. Erasure cleans a client's names in reminder / escalation payloads |
| `ActivityHeartbeat` | `userId`, `at`, `source` | **B** | Break-nudge signal only. **Retention: 7 days, then deleted** (the one Firm OS table rows are purged from; ADR-006) |
| `CoachPreference` | `userId`, toggles | B | Each person's own opt-outs |
| `RateLimitBucket` | `key` (`<scope>:<userId>`), `count`, `windowStart` | B | One row per person and scope, overwritten each window |

### Privacy register

| Table | Column | Class | Notes |
|---|---|---|---|
| `PrivacyRequest` | `principalLabel` | A (masked) | Initials, client code and the last four characters of what matched — never the identifier |
| | `identifierHash` | — | HMAC-SHA256 (keyed with `AUTH_SECRET`) of the identifiers searched; links a later request without storing them, and finds an onboarding run of a person no client record matches |
| | `notes`, `outcome` | A (may) | Typed by staff; identifiers masked when written. The request itself is kept for accountability; erasure cleans the person's names in them |
| | `createdById`, `handledById` | B | Separation of duties: the person who logs a request does not verify it; the one who verifies does not confirm an erasure |
| `BreachIncident` | `summary` | — | A summary without personal details (rights.md) |

## LMS tables Firm OS reads (not changed by Firm OS)

| Table | Columns with personal data | Class | Firm OS use |
|---|---|---|---|
| `Client` | `pan`, `contactName`, `contactPhone`, `contactEmail`, `city` | A | Onboarding writes the client record; agents read names for the anonymizer dictionary |
| | `industry` | A (may) | With the name and city, an individual's or proprietor's trade identifies them: masked in the correction audit, cleared by erasure |
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

## What erasure walks

`src/lib/privacy/inventory.ts` holds this inventory as data. `DATASETS` are the person's records
(exported on an access request and planned for on erasure). `RESIDUE_DATASETS` are the columns
above that copy the person's identifiers into free text and JSON; erasure replaces the person's
names, PAN (also inside a GSTIN), GSTIN, CIN, email, phone (any spacing), city and filing ack refs
with `[erased]` in place (`src/lib/privacy/scrub.ts`), keeping row ids, numbers, JSON keys, record
ids, idempotency keys and hashes. They are not exported, because the same rows hold staff notes and
other parties' data. Each carries its own legal-hold basis:

| Residue dataset | Columns | Held while a duty applies? |
|---|---|---|
| Audit trail notes | `AuditEvent.meta` of the client's records | Yes, all of the client's duties (review trail is working papers, SA 230) |
| Agent run notes | `AgentRun.figures`, `reviewNotes`, `error` | Yes |
| Checklist findings | `ChecklistResult.message`, `evidence` | Yes |
| Job history notes | `JobTaskEvent.note` | Yes |
| Deliverable names | `Deliverable.name`, `spPath` (the file stays in SharePoint, held) | Yes |
| Turia bridge evidence | `TuriaSync.evidence`, `spotCheckNote` | No: a copy; Turia and the client master hold the record |
| Mistake examples | `MistakeLog.pattern`, `example` | No: a copy of the run's data |
| Coach nudges | `CoachEvent.payload` | No: a copy of the job label |
| Model call errors | `ModelCall.error` | No |
| Onboarding runs never linked to a client | `OnboardingRun.prompt`, `spec`, `plan`, `error`, `steps` | No: no engagement started |
| Privacy register notes | `PrivacyRequest.notes`, `outcome`; `AuditEvent.meta` of the person's requests | No: the request itself is kept, names in its notes are cleaned |

A company's contact person gets only their own name, email and phone cleaned out of the company's
records. The audit PoC that found 36 surviving copies after a confirmed erasure is a permanent test
(`src/lib/privacy/erasure-coverage.test.ts`): 0 survivors, UPDATEs only.

## Keeping this inventory true

- A migration that adds a Firm OS table or a column that can hold personal data updates this file **and `src/lib/privacy/inventory.ts`** (a dataset or a residue dataset) in the same change.
- Tables added after 2026-11-05 by later work (e.g. companion pairing tokens, workspace settings, search) must be added here when they merge.
- `npm run verify:audit-coverage` and `npm run verify:rbac` run in the QA gate; this file is reviewed at each phase gate.

## Open items (partner decisions)

1. `MistakeLog.example` keeps a run's extraction (class A) for as long as the rule is in force. Option: replace it by a synthetic example when the rule is approved. (Erasure now cleans the person's identifiers in it.)
2. Resolved: `OnboardingRun.prompt` / `spec` / `plan` are cleared 30 days after the run last changed (retention.md). Partner to confirm the 30 days (a threshold: ADR-006 retention table to be amended). `TuriaSync.evidence` stays with the record as spot-check evidence.
3. Resolved in code: reviewer comments and transition notes are masked when written and swept nightly. Staff guidance should still say "no PAN/Aadhaar in comments": a first name typed alone, a nickname or a misspelling is not recognised as the client's.
4. Resolved: the note of a re-run is stored on the new run (`AgentRun.reviewNotes`) masked, like the other notes (`src/lib/agents/core/runner.ts`); the agent itself still receives it as typed.
