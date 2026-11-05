# Data-principal rights and breaches (DPDP Act 2023)

How Firm OS handles requests from the people whose personal data the firm holds — clients who are
individuals (proprietors, HUF kartas), contact persons of clients, and staff — and how a personal
data breach is recorded. Code: `src/lib/privacy/`. Screens: **Admin → Firm OS → Privacy requests**
(`/admin/firm-os/privacy`) and **Breach register** (`/admin/firm-os/breaches`).

> **Not legal advice.** Every period below is either a firm policy target or our reading of the
> Act and the DPDP Rules 2025, and each carries a "verify" note in `src/lib/privacy/policy.ts`.
> A partner or the firm's lawyer must confirm them before the firm publishes its response periods.
> The Rules phase the rights provisions in after notification; confirm which are in force.

## Ground rules

- **Nothing is deleted.** Client data, Turia records, SharePoint files and LMS user data are never
  hard-deleted. Erasure means *anonymise in place* (an `UPDATE`) or *place a legal hold* — see
  below. The Firm OS guard (`npm run verify:no-delete`) covers `src/lib/privacy` and the routes.
- **Identifiers are not stored again.** A request keeps a keyed hash of the PAN / GSTIN / email /
  phone that was searched (HMAC-SHA256 keyed with `AUTH_SECRET`) and a masked label such as
  `K. T. · KUMAR1 · PAN ****234F`. Free-text notes are passed through the anonymizer.
- **Identity first.** Export, correction, erasure, restriction and nomination are refused until a
  person records how the requester's identity was checked.
- **Every step is audited** as an `AuditEvent` (entity `PrivacyRequest`, `BreachIncident`, or the
  record touched). Audit rows hold masked values only (ADR-006).

## Who does what

| Role | Can |
|---|---|
| Admin (LMS role ADMIN) | Use both admin pages; log, verify, export, correct, close; confirm erasure; record breaches |
| Partner (level PARTNER) | Everything an admin can through the API; decides erasure. The admin pages sit behind the admin layout, so a partner who is not an LMS admin needs the admin role to use the screens |
| Everyone else | Nothing here. Staff who learn of a breach tell an admin or partner at once |

## Response timelines (data, verify)

Stored on the request as `dueAt` (end of the IST day). The list shows the firm target; the detail
page also shows the outer limit.

| Right | Act | Firm target | Basis | Verify |
|---|---|---|---|---|
| Access | s.11 | 30 days | Firm policy | Rules 2025: published response period, outer limit we understand to be 90 days |
| Correction | s.12 | 30 days | Firm policy | as above |
| Erasure | s.12 | 30 days | Firm policy | as above |
| Grievance | s.13 | 30 days | Firm policy | as above; outer limit 90 days shown on the request |
| Nomination | s.14 | 30 days | Firm policy | as above |
| Consent withdrawal | s.6(4) | 7 days | Firm policy ("reasonable time") | confirm what a reasonable time to stop processing is |

## The workflow

1. **Log** (`POST /api/firm-os/privacy/requests`): kind, at least one identifier (a grievance may
   have none), date received, how it arrived, notes. Firm OS looks the person up by exact match:
   PAN / GSTIN on the client master (individual entity types only — a company's PAN is not a
   person), contact email / phone on the client master, and LMS user email for staff. A company's
   contact person is a `client-contact`; an individual client is a `client-person`.
2. **Verify identity** (`…/[id]/verify`): reply from the email on record, call back to the phone on
   record, photo ID in person, signed letter, or other (with a note).
3. **Act**, by kind:
   - **Access** — download the export (`GET …/[id]/export`): a JSON file with a plain-English
     summary, every inventoried field of the person's records, the purpose of each, who the data is
     shared with, and what is deliberately not included. Each download is audited. Staff data is
     left out of client exports; a staff member gets their own staff data only. Cached agent inputs
     are reported as "held / purged by", never their content, because they also name the client's
     customers and suppliers.
   - **Correction** — the detail page mounts the History panel on the person's Client and Firm OS
     client records; corrections go through the corrections service (`docs/dpdp/corrections.md`)
     and are recorded against the request. Staff details are corrected in Admin → Team & hierarchy.
   - **Erasure** — see the next section.
   - **Consent withdrawal** — records processing restrictions (below) and completes the request.
   - **Nomination** — records the nominee's name, relationship and contact in the register (the
     audit keeps initials only) and completes the request.
   - **Grievance** — answered in the Close step with the reply sent.
4. **Close** (`…/[id]/close`): completed with the reply, or refused with the reason. Erasure,
   consent withdrawal and nomination complete through their own step (they can still be refused).

## Erasure: anonymise or hold

The plan (`GET …/[id]/erasure`) walks the data inventory (`src/lib/privacy/inventory.ts`) item by
item. A partner or admin confirms the plan they saw (`POST`, with its fingerprint); if anything
changed in between, the confirmation is refused and the new plan is shown.

| Outcome | When | What happens |
|---|---|---|
| Legal hold | A retention duty is still in force | Nothing changes; `AuditEvent "legal-hold"` with the basis and the hold-until date; the request goes **On legal hold** with the bases listed; processing of the held client is restricted (no new AI processing, drafts or marketing use) |
| Anonymise | No duty applies | `UPDATE` in place: names and identifiers become `[erased]` or empty; row ids, entity type, turnover, fees and computed figures stay; the client is marked inactive |
| Kept as is | Not personal on its own, or purged on a schedule (heartbeats after 7 days) | Nothing; the reason is shown |
| Manual step | Turia and SharePoint | Firm OS never changes or deletes there; a partner asks the Turia admin / IT after the hold date |

### Retention duties (data in `RETENTION_DUTIES`, each with a verify note)

Periods are counted from the end (1 April, IST) of the client's latest financial year with work of
the relevant service, or from the date staff left.

| Duty | Applies to | Counted as | Verify |
|---|---|---|---|
| Active engagement | Client still active with open work (active engagement, job not DONE, legacy job open) | Until the engagement ends | Partner confirms the engagement is running |
| Income-tax Act (s.44AA, rule 6F; 2025 Act equivalent) | Income-tax, TDS, audit, books work | 84 months (six years from end of the assessment year) | Period and start, whether the firm's copy is covered, longer while assessment/appeal/reopening is pending (up to ten years), 2025 Act section |
| GST (CGST Act s.36) | GST work | 81 months (72 months from the 31 Dec annual-return due date) | Period, due date used, whether the preparer's copy is covered, longer while proceedings are pending |
| Companies Act s.128(5) / LLP Rules r.24 | Companies and LLPs with ROC, audit or books work | 96 months (eight financial years) | Period, whether it binds the firm's copy |
| ICAI SQC 1 / SA 230 | Any engagement, certificate or engagement letter | 96 months (seven years from the report, report assumed within a year) | Period in the firm's quality-control policy; non-audit work and certificates |
| Staff records | Staff | Until they leave, then 96 months | Labour-law and Income-tax periods, HR policy |

## Consent withdrawal: what it stops

Recorded as `AuditEvent "restrict-processing"` on the LMS `Client` (or `User`), no column changes.

| Restriction | Stops |
|---|---|
| No new AI processing | Agent runs and ModelRouter calls with the person's data |
| No new message drafts | New client-comms drafts |
| No growth or marketing use | Growth goals, referral notes and similar client-development data |
| No break-nudge activity (staff) | Break nudges are switched off in `CoachPreference`, so no heartbeats are collected |

It does **not** undo processing already done, nor stop the work the person engaged the firm for or
records the law makes the firm keep (DPDP Act s.7 legitimate uses, s.8(7)). A partner decides
whether the engagement continues.

**Enforcement points (owned by other modules):** the agent runner / ModelRouter callers and comms
drafting should call `isAiProcessingRestricted(db, firmClientId)` from `src/lib/privacy/consent.ts`
before starting work. Until they do, the restriction is recorded and shown but not enforced in
code. Lifting a restriction (consent given again) is not built yet.

## Breach register

`/admin/firm-os/breaches`; runbook: [`docs/runbooks/breach.md`](../runbooks/breach.md) (kept by the
hardening work). An incident records when the firm became aware, a summary without personal
details, severity, people affected, containment steps, and when the Board and the affected people
were told.

| Clock | Due | Basis | Verify |
|---|---|---|---|
| Report to the Data Protection Board | 72 hours from becoming aware | DPDP Rules 2025 (rule 7): intimation without delay, detailed report within 72 hours | **Legal to verify** the period, what starts it, extensions and the form. Not settled law |
| Tell each affected person | "Without delay"; firm target 72 hours | DPDP Rules 2025 (rule 7) | Legal to verify what "without delay" requires and the notice content |

Tiles show hours remaining for each open incident; overdue turns red. Recording a notice stops its
clock (late notices are marked late). An incident closes only after both notices are recorded.

## Open points for a partner or lawyer

- Confirm every period in the two tables above and the response periods the firm will publish.
- Decide whether erasure requests from active clients end the engagement.
- Confirm the identity-verification methods are enough for each kind of request.
- Reconcile `src/lib/privacy/inventory.ts` with `docs/dpdp/data-inventory.md` after both merge.
