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
3. **Erasure / withdrawal:** Firm OS never hard-deletes client records (non-negotiable 2). Mark the client inactive, stop new jobs, and clear cached copies (`AgentRun.inputs`, `OnboardingRun.prompt`) by the retention job; statutory records are kept for the period the law requires and the client is told so.
4. **Grievance:** acknowledged within 7 days by the named partner; record each request as an AuditEvent (`action: "dpdp-request"`).

## Security integration (how a withdrawal is enforced)

A consent withdrawal, or a legal hold during an erasure, records processing restrictions on the
person's LMS `Client` (`AuditEvent "restrict-processing"`; `src/lib/privacy/consent.ts`). They are
enforced in code, not just shown: every entry point that would send the client's data to an AI
model calls `isAiProcessingRestricted()` first and refuses, writing nothing, with the sentence
"This client has restricted AI processing. Prepare this by hand or ask a partner to lift the
restriction."

| Entry point | Where | What happens when restricted |
|---|---|---|
| Agent runs (all agents) | `runAgent` in `src/lib/agents/core/runner.ts` | Refused before the AgentRun row, the job move or any model call (`AI_RESTRICTED`, 409 from "Run agent") |
| Re-run / Request changes | `src/lib/agents/service.ts` | Refused before the job moves back to IN_PREP |
| Onboarding reading | `src/lib/agents/onboarding/service.ts` (start, follow-up sentences) | Refused (409) when the sentence, the spec so far or the run names an existing restricted client (PAN, GSTIN, client code); answers typed into the form never reach a model |
| Comms drafts | `createDraft` in `src/lib/agents/comms/service.ts` | Refused before drafting or translation; the "no new drafts" restriction is honoured here too |

Restrictions are read by replaying `restrict-processing` and `lift-restriction` events per request,
so the newest decision wins and a restriction recorded by another request stays in force. Only a
partner lifts one (`canLiftRestriction`), with a written reason, from the privacy request page; the
lift is an AuditEvent and the restriction's own record is kept. Tests: `src/lib/agents/privacy-
restriction.test.ts`, `src/lib/agents/onboarding/service.test.ts`, `src/lib/privacy/consent.test.ts`.

## Staff notice (before enabling break nudges)

Tell staff, in writing, what the heartbeat collects (a timestamp each few minutes of LMS activity),
that it is kept 7 days, that nobody else sees it, and how to turn nudges off (CoachPreference).
