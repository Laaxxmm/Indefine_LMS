# Consent and purpose: client personal data in Firm OS

- **Status:** Phase 11 draft, 2026-11-05, for partner review before go-live. Not legal advice; the
  firm's counsel should confirm the wording against the DPDP Act, 2023 and the DPDP Rules in force.
- **Related:** [data inventory](data-inventory.md) · [retention](retention.md) · [ADR-006](../adr/ADR-006-dpdp-data-classes.md).

## Who is who

- **Data principals:** the people behind the firm's clients (proprietors, partners, directors,
  signatories, contact persons) and the firm's own staff.
- **Data fiduciary:** the firm (SRCA & Associates / Indefine), which decides why and how the data is processed.
- **Processors:** Microsoft (Entra ID, SharePoint, Outlook, Teams), Railway (hosting and Postgres),
  Anthropic (and optionally xAI) for masked model calls, Turia (practice management).

## Purposes (what the data is used for, and nothing else)

| Purpose | Data | Basis |
|---|---|---|
| Delivering the engaged compliance services: GST, ROC, income tax, TDS, books, audit | Client identifiers, financial records, filings | The engagement letter the client signs (consent for the specified purpose, and processing the client asked for) |
| Preparing draft packs with task agents and cloud models | Masked text only; tokens such as `⟨PAN_1⟩` replace identifiers before any cloud call | Same engagement; the masking is the safeguard (ADR-002/006) |
| Keeping the client's records in its own `CL-{Code}` SharePoint site | KYC and working papers | Same engagement; the firm's statutory record-keeping |
| Closing work in Turia with time logged | Task refs, minutes, client name | Same engagement; billing |
| Client communication drafts (never sent by the app) | Names, due dates, amounts; PAN/Aadhaar only last 4 and only on request | Same engagement |
| Staff work management (assignments, reminders, break nudges) | Staff names, emails, heartbeats (7 days) | Employment; break nudges are opt-out and off unless `FIRM_OS_BREAK_NUDGE` is on |

Data is not used for marketing, profiling, sale, or any purpose outside the engagement. No staff
break or heartbeat report exists for managers (ADR-006).

## Notice to clients (proposed text for the engagement letter)

> **How we use your information.** To provide the services in this letter we hold the details you
> give us (such as PAN, GSTIN, bank and contact details) and your records, in our Microsoft 365
> environment and our practice systems [hosting regions: partner to confirm]. We use software tools,
> including AI models, to help prepare draft working papers; before any text is sent to an AI model
> your identifying details are replaced by placeholders. A qualified member of our team reviews every
> draft, and only our people file returns or contact authorities on your behalf. We keep your records
> for as long as the law and our professional obligations require. You may ask us what we hold about
> you, ask us to correct it, or withdraw consent for processing that is not required by law, by
> writing to [grievance contact]. If a breach affects your data we will tell you and the Data
> Protection Board as the law requires.

The partner fills in the grievance contact and confirms the hosting regions (Railway and Anthropic
regions) before go-live. Clients onboarded before go-live receive the notice with their next
engagement letter renewal.

## Rights requests (how the firm answers them)

1. **Access / summary:** export the client's `Client`, `FirmClient`, `JobTask`, `OnboardingRun` and `CommsDraft` rows plus a SharePoint folder listing; log an `export` AuditEvent.
2. **Correction:** edit the LMS client record; Firm OS re-reads it on the next run.
3. **Erasure / withdrawal:** Firm OS never hard-deletes client records (non-negotiable 2). The retention job clears cached copies on a schedule (`AgentRun.inputs` after at most 30 days; `OnboardingRun` prompt, details and plan 30 days after the run last changed — [retention](retention.md)). An erasure request anonymises the person's data in place, including copies of their names and identifiers in notes, findings and logs, or places a recorded legal hold where the law makes the firm keep the records; the client is told which, and until when ([rights](rights.md)).
4. **Grievance:** acknowledged within 7 days by the named partner; record each request as an AuditEvent (`action: "dpdp-request"`).

## Staff notice (before enabling break nudges)

Tell staff, in writing, what the heartbeat collects (a timestamp each few minutes of LMS activity),
that it is kept 7 days, that nobody else sees it, and how to turn nudges off (CoachPreference).
