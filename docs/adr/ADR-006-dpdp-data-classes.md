# ADR-006: DPDP data classes and anonymization

- **Status:** Accepted, 2026-11-05; amended 2026-11-06 (retention lines, owner-approved)
- **Deciders:** Lakshmanan A (owner); Firm OS lead engineer
- **Related:** ADR-002 (router), Phase 2 `src/lib/ai/anonymizer.ts`, Phase 9 (break nudge), Phase 11 (DPDP inventory)

## Context

The Digital Personal Data Protection Act, 2023 applies to the personal data the firm holds about
clients' people (proprietors, directors, partners, signatories) and about its own staff. Firm OS
sends text to cloud language models and adds activity tracking for break nudges. The firm needs a
clear rule for what may leave the firm, in what form, and for how long anything is kept.

The LMS already holds client personal data: `Client` (`pan`, `gstin`, `cin`, `contactName`,
`contactPhone`, `contactEmail`), KYC documents on SharePoint, `CertificateIssue.payload`,
`EngagementLetter`. It does not send these to a model today; the Gemini callers that may carry
client data are listed in ADR-002.

## Decision

**Data classes**

| Class | Examples | Where it may go |
|---|---|---|
| A. Client personal data | PAN, Aadhaar, GSTIN tied to a person (proprietor), bank account and IFSC, date of birth, phone, email, postal address, names of individuals, DIN, and anything linking these to a person | Postgres and SharePoint inside the firm's tenant. To a cloud model **only masked**. `local-only` tasks: never to a cloud model (ADR-002). |
| B. Staff personal data | Staff names, emails, attendance (greytHR CSV), performance data, activity heartbeats for break nudges | LMS database. Not sent to any model except a staff member's own name where a draft needs it. |
| C. Firm and public data | SOP text, checklists, statutory circulars, company-level GSTIN/CIN of a non-individual entity, computed totals without identifiers | May go to a cloud model unmasked (`privacy: 'public'`), still logged. |

When unsure whether a field is class A or C, treat it as A.

**Anonymization (Phase 2).** `Anonymizer.mask()` runs before every cloud call and replaces class A
values with stable tokens (`⟨PAN_1⟩`, `⟨GSTIN_2⟩`, `⟨PHONE_1⟩` …): regex and checksum maskers for
PAN, GSTIN (state code + checksum), Aadhaar (12 digits, Verhoeff), CIN/LLPIN, DIN, TAN, IFSC and
account numbers, +91 phone numbers, email, PIN-code addresses, and a dictionary of person and company
names from the client master. `unmask()` restores values in the response.

- The **token map is never sent** to any provider. It lives in memory for the call, or, when a run spans several calls, in a database row encrypted with `src/lib/secret-box.ts`, deleted with the run's other inputs (see retention).
- `ModelCall` stores only the SHA-256 of the masked prompt (ADR-002).
- A leak test spies on every provider payload and fails on any PAN, GSTIN, Aadhaar, phone or email pattern. Target: 200+ synthetic strings, zero leaks, exact round trip.
- Client messages drafted in Phase 10 show at most the last four characters of PAN/Aadhaar, and only if the client asked for them.

**Retention**

| Data | Kept | Then |
|---|---|---|
| `AgentRun` inputs cached in the database (extracted rows, uploaded copies, token maps) | ≤ 30 days | Purged by a scheduled job; the run record, checklist results and hashes remain |
| Deliverables | In SharePoint `CL-{Code}` (ADR-004) under the firm's existing retention | Not copied into Postgres |
| `ModelCall`, `AuditEvent` | Kept (no raw client text in them) | – |
| Break-nudge activity heartbeats | **7 days** | Deleted; only per-person daily aggregates for the person's own view remain |

The purge of cached inputs removes derived copies. It is not a deletion of client records or files,
which the no-delete rule still protects.

**Amendment 2026-11-06 (owner-approved): retention lines added by the DPDP data-coverage work**

These rows join the retention table above. They were introduced by the privacy data-coverage fix
(security audit finding #20, "retention narrower than documented") and the integration pass, and are
implemented in `src/lib/hardening/retention.ts` (daily job, `docs/dpdp/retention.md`).

| Data | Kept | Then |
|---|---|---|
| `OnboardingRun` copies: the typed request (`prompt`), the extracted details (`spec`) and the `plan` | **30 days** after the run last changed (`updatedAt`), whatever its status (done, failed, blocked, abandoned) | Cleared: `prompt` → `[cleared by retention]`, `spec` → `{ "cleared": true }`, `plan` → null. The run row, its status, steps, error and audit trail stay; the client master holds the client's details. An update, not a delete |
| Free text in `ModelCall.error` and in typed `AuditEvent` notes (comment text; the note of request-changes, re-run, approve, retract-filing, manual prep, spot-check) | Masked when written by Firm OS; older rows and other writers on the **nightly** run | PAN, GSTIN, Aadhaar, phone, email and account numbers replaced by anonymizer tokens (`⟨PAN_1⟩`); every other value stays. This keeps the promise above that `ModelCall` and `AuditEvent` hold no raw client text |
| `RateLimitBucket` rows (request counters: key, window start, count; no personal data, no business record) | Until **a day after** the bucket's window ends | Deleted. An expired bucket limits nothing (the next request starts a new window), so deleting it changes no limit and only stops the table growing. The no-delete guard allows exactly one function for this and the heartbeat delete (`purgeExpiredRows`, `scripts/lib/guards.ts` `NO_DELETE_EXEMPTIONS`) |

Changing any of these windows is a threshold change (partner approval and an amendment here). The
30-day onboarding window and the legal periods in `src/lib/privacy/policy.ts` remain subject to the
DPDP legal confirmation listed in PROGRESS "Blocked / needs human".

**Break-nudge data (Phase 9).** Break nudges need to know whether someone has been working
continuously for 100 minutes. The LMS has no live punch data (greytHR arrives as a monthly CSV,
`AttendanceRecord`), so the signal is a new LMS activity heartbeat.

- Purpose is limited to nudging the person. Heartbeats are kept 7 days and then deleted.
- Aggregate only. No manager, partner or admin report of breaks or heartbeats is built; no export.
- The nudge is gentle, dismissible, at most 3 a day; each person can snooze or turn it off, and the opt-out is honoured at once.
- The feature is off unless `FIRM_OS_BREAK_NUDGE` is on, and staff are told what is collected before it is enabled.

## Consequences

- Cloud models see masked text for class A data; quality depends on masking that keeps structure (token types are preserved for that reason).
- Some agent work runs slower in week 1 because `local-only` tasks wait for a person until the local model exists.
- Phase 11 produces the full DPDP data inventory, purpose note for client data, and breach runbook, building on this table.
- Known gaps carried from ADR-002: Gemini transcription of recorded live sessions and SOP Builder free text are outside this control until a partner decides how to handle them.

## Alternatives considered

1. **No cloud models for client work at all.** Rejected for week 1: no local model yet; masking plus `local-only` gives a workable middle ground.
2. **Irreversible redaction instead of reversible tokens.** Rejected: drafts must come back with the right names and numbers for the reviewer.
3. **Keep heartbeats longer for productivity reporting.** Rejected: outside the stated purpose; the firm chose not to monitor breaks.
