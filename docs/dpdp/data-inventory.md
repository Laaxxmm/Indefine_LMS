# DPDP data inventory: Firm OS

- **Status:** Phase 11, 2026-11-05; updated 2026-11-06 after the DPDP data-coverage audit (erasure
  residue, retention schedule, write-time masking); updated 2026-11-18 (Turia pull tables in the access
  export and erasure). Owner: Firm OS lead engineer. Reviewer: partner
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
| **C** | Firm and public data: Firm OS SOP packs (`SopPack` checklists), circulars, company GSTIN/CIN of a non-individual, computed totals without identifiers. SOP Builder text and screenshots are **not** class C (see below) | Yes, unmasked (`privacy: 'public'`), still logged |
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
| `TuriaTaskMirror` (Turia pull, ADR-003 Amendment 1) | `clientName`, `clientKey`, `clientCode`, `taskName` | A (may) / C | A copy of Turia's task list, the minimum a job needs: client name / code, task name, department, status, dates. **No descriptions, comments or amounts are stored.** Exported to the client (dataset `turia-tasks`, without staff names). Erasure, once no duty applies: `clientName` and `taskName` → `[erased]`, `clientCode` → null, `clientKey` → the erased key (below), `hash` / `appliedHash` → `[erased]`; the row, its Turia task id, dates and job link stay. Held with the client's records while a duty applies. A client's rows are found by its Turia client keys (below) |
| | `assignees`, `reviewers` | B | Turia user ids and names. Exported to the staff member (dataset `staff-turia-tasks`: their own name only; other people's names and the client's name in the task name withheld). Erasure replaces their name with `[erased]` in their own entries only (held while the employment-records duty applies) |
| `TuriaPersonLink` | `turiaName`, `turiaEmail`, `userId` | B | Turia user -> LMS user match (staff only). Exported to the staff member (`staff-turia-link`). Erasure: name → `[erased]`, email and `userId` cleared, `matchedBy` → `erased`; the pull then never matches that Turia user again and mirrors their name as `[erased]`. Kept as it is while the employment-records duty applies (legal hold) |
| `TuriaClientLink` | `key`, `turiaName`, `turiaCode`, `lmsClientId` | A (may) / C | Turia client -> LMS client match; `key` is the client's normalised Turia name. Exported to the client (`turia-client-links`). Erasure: `status` → `ignored`, `key` → the erased key, `turiaName` → a privacy note (`[erased] Erased under a DPDP request …`), `turiaCode` → null; `lmsClientId` stays so a later request still finds it. The admin page refuses to re-link or re-match an erased match. Held while a duty applies |
| `TuriaPullRun` | `counts`, `preview` | A (may) / B | Per-run counts and the preview rows (task number, task name, client name, preparer names); kept as the run's report. Erasure (residue, a copy): a client's lines get `client` → `[erased]` and its names and identifiers in `task` / `detail` erased; a staff member's name is erased wherever it appears (not a name another user shares). `counts` hold no personal data |
| `OnboardingRun` | `prompt` | **A** | The partner's plain-English sentence (may name people, carry PAN/GSTIN). **Retention: replaced by `[cleared by retention]` 30 days after the run last changed** (done, failed or abandoned) |
| | `spec`, `plan` | **A** | Extracted client details (PAN, GSTIN, contact name, phone, email) and the plan. **Retention: cleared with the prompt** (`spec` → `{ cleared: true }`, `plan` → null). A run that never reached a client record (`firmClientId` null) is found for erasure by identifiers that pin the person alone (PAN / GSTIN / CIN, an email or phone no other client shares), never by a name; for a person no record matches, by the request's identifier hash (they are then "known only by identifiers", rights.md) |
| | `steps`, `error` | C | Saga progress. A failure is stored as a classification for IT, never the thrown text: known errors as fixed text (no client, file or sheet name, path or received value), anything else masked with the run's names or withheld (`src/lib/agents/onboarding/run-errors.ts`); the page shows a plain sentence (`onboardingFailureMessage`) |
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

## SOP Builder (LMS Tools, `/tools/sop-builder`)

Reclassified after the SOP Builder review (2026-11-18, finding H1). SOPs are firm guidance, but staff type
clients' names into descriptions, gap answers and captions, and a screenshot of Tally or a portal can show
a client even after the author hid what they saw. Nothing links a SOP to a client, so the inventory finds
these by the person's identifiers in the SOP text (`sop-text`, `sop-screenshots` in `src/lib/privacy/inventory.ts`).

| Table | Column | Class | Notes |
|---|---|---|---|
| `SopImage` | `bytes` | **A (may)** | Screenshot under a step. The author must tick "No client details are visible in this screenshot (I have hidden any)" with every upload; the server refuses a screen without it (the hiding itself is done in the browser and cannot be checked). Never sent to the AI. Served `no-store`. **Remove this screen** (admins and partners) blanks the bytes and sets `removedAt` (UPDATE, never a delete), audited; the versions' Word files in OneDrive are filed again, and any OneDrive would not take are named and flagged on the SOP page for removal by hand |
| | `createdById`, `removedById` | B | Who added / removed it |
| `SopVersion` | `rawProcedure` (description and gap answers), `purpose`, `brief`, `content` (steps and screen captions) | **A (may)** | Masked and gated before Gemini (`gateForGemini`); stored as typed. Erasure replaces the person's names and identifiers with `[erased]` in place |
| | `content.preparedBy`, `creatorName`, `createdById` | B | The author; cleaned on a staff erasure once the employment-records duty ends |
| | `graphItemId`, `graphWebUrl`, `graphFiledAt` | — | The version's Word file in OneDrive and when it was last written (a screen removed after it means the file may still show it) |
| `Sop` | `title`, `workCategory` | C (may) | Normally a process name; erasure does not touch it |
| | `createdByName`, `createdById` | B | |
| `SopView` | `userId`, `userName` | B | Who opened which SOP |

**OneDrive.** Each SOP's Word files (with the screenshots in them) are saved under
`<L&D folder>/SOP/<Department>/<Title>/`. Those folders are made inside the shared L&D folder and
**inherit its OneDrive permissions**: everyone the L&D folder is shared with can open every SOP's Word
file. The app never shares or unshares them; who can see them is set on the L&D folder. OneDrive keeps
earlier copies of a file in its version history: when a screen is removed or erased, an admin deletes
those copies there by hand.

**Access and erasure.** The access export lists the screenshots under steps that name the person (step,
caption and link; a partner shares copies on request) and adds a manual check: a picture cannot be
searched, so a partner looks through the SOPs and uses Remove this screen on any that shows the person.
Erasure blanks those screenshots (no retention duty: a how-to picture, not a working paper), cleans the
SOP text, and adds a manual step to file the affected Word files again (Save to OneDrive on each
flagged version).

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
| Turia client match audit trail | `AuditEvent.entityId` (the old `TuriaClientLink.key`) and `meta` of `turia-pull.client-link` rows | Yes, with the match: `entityId` moves to the erased key, so the trail still points at the record |
| Turia pull run reports | `TuriaPullRun.preview` (client: its lines; staff: their name) | No: a copy of Turia's task list |
| SOP text (SOP Builder) | `SopVersion.purpose`, `rawProcedure`, `brief`, `content`, `creatorName` | No for a client (firm guidance; a copy). A staff author's name is held with their employment records |

A company's contact person gets only their own name, email and phone cleaned out of the company's
records. The audit PoC that found 36 surviving copies after a confirmed erasure is a permanent test
(`src/lib/privacy/erasure-coverage.test.ts`): 0 survivors, UPDATEs only, now with the Turia pull's
tables seeded for a client and for a former staff member.

### The Turia pull's copy (ADR-003 Amendment 1)

Turia holds the record; Firm OS holds a copy it rewrites from Turia every 15 minutes. So erasure
marks the copy in a way the pull recognises (`src/lib/integrations/turia/pull/erased.ts`, honoured in
`sync.ts` and `admin.ts`), instead of relying on Turia being cleaned first:

- **Which rows are a client's.** Its Turia client keys (`TuriaClientLink.key` = `TuriaTaskMirror.clientKey`):
  links pointing at the client record (the pull's match or an admin's pick), plus the keys the pull
  would match to it — Turia's client code equal to its FirmClient code, or its exact normalised name
  when no other client has that name — unless a link points the key at another client or an admin set
  it to ignore (the single-principal rule). Staff: the `TuriaPersonLink` rows pointing at their user,
  and the mirror rows whose assignee or reviewer list holds one of those Turia user ids.
- **Erased key.** `erased:` + an HMAC-SHA256 of the old key, keyed with the privacy register's secret
  (`AUTH_SECRET`). The pull hashes each task's client key the same way: a task of an erased client is
  skipped (the mirror row is not rewritten, no match is re-created, nothing is planned), an already
  erased mirror row is never rewritten even if the hash no longer matches, and an LMS client erased in
  place (`[erased] …`) is never given work when Turia's code still matches it.
- **Erased person.** `TuriaPersonLink.matchedBy = "erased"`: never matched again; their name is mirrored
  as `[erased]` in every assignee / reviewer list.
- **Hold and restriction.** While a duty applies, the mirror rows and the match are held as they are and
  the erasure restricts the client's processing (as for every held client). The pull treats a client
  with restricted AI processing (`isAiProcessingRestricted`: a consent withdrawal or an erasure hold) as
  **restricted**: its tasks are still mirrored and matched, but no new job is created or linked for it
  ("No job made: this client has restricted processing …"); a job it already has still follows Turia's
  people and due date. Lifting the restriction lets the next run make the jobs.
- **Turia itself** stays a partner's manual step (the erasure plan lists it): until the Turia admin
  archives or anonymises the client there, its tasks remain in Turia, but not in Firm OS.

## Keeping this inventory true

- A migration that adds a Firm OS table or a column that can hold personal data updates this file **and `src/lib/privacy/inventory.ts`** (a dataset or a residue dataset) in the same change.
- Tables added after 2026-11-05 by later work (e.g. companion pairing tokens, workspace settings, search) must be added here when they merge.
- `npm run verify:audit-coverage` and `npm run verify:rbac` run in the QA gate; this file is reviewed at each phase gate.

## Open items (partner decisions)

1. `MistakeLog.example` keeps a run's extraction (class A) for as long as the rule is in force. Option: replace it by a synthetic example when the rule is approved. (Erasure now cleans the person's identifiers in it.)
2. Resolved: `OnboardingRun.prompt` / `spec` / `plan` are cleared 30 days after the run last changed (retention.md). Partner to confirm the 30 days (a threshold: ADR-006 retention table to be amended). `TuriaSync.evidence` stays with the record as spot-check evidence.
3. Resolved in code: reviewer comments and transition notes are masked when written and swept nightly. Staff guidance should still say "no PAN/Aadhaar in comments": a first name typed alone, a nickname or a misspelling is not recognised as the client's.
4. Resolved: the note of a re-run is stored on the new run (`AgentRun.reviewNotes`) masked, like the other notes (`src/lib/agents/core/runner.ts`); the agent itself still receives it as typed.
5. Resolved (Turia pull, ADR-003 Amendment 1): `TuriaTaskMirror`, `TuriaClientLink`, `TuriaPersonLink` and `TuriaPullRun.preview` are in the access export and the erasure plan, and the pull skips an erased client or person on later runs (see "The Turia pull's copy" above). Partner to note: the erased key is keyed with `AUTH_SECRET`; if that secret is rotated, the pull no longer recognises an erased client from its Turia name, so a new task Turia still lists for it would be mirrored again and its name shown as an unmatched Turia client (already erased rows stay erased, and no job is made for a client whose LMS record was erased). Rotating `AUTH_SECRET` already breaks the privacy register's identifier hash, so it needs a re-keying step either way. Erasing in Turia itself remains the manual step.
