# Correcting a wrong entry

Firm OS has one way to fix a wrong entry: `correctField(user, { entity, id, field, newValue,
reason })` in `src/lib/corrections/service.ts`, behind `POST /api/firm-os/corrections` and the
**History** panel (`src/components/CorrectionHistory.tsx`). It also serves DPDP correction
requests (`docs/dpdp/rights.md`).

## What happens

All in one transaction:

1. The field must be on the allow-list (`src/lib/corrections/allowlist.ts`). Anything else is
   refused with a sentence saying why and what to do instead.
2. The record is loaded and the person's permission checked.
3. Record-level rules: a DONE job, an archived engagement, or a draft already opened in Outlook
   cannot be corrected.
4. The new value is parsed and checked — reusing the `/clients` schema (`clientBodyZ`) and the
   onboarding validators (PAN holder status, GSTIN state code + checksum + embedded PAN, CIN /
   LLPIN), the SharePoint period rules, and the onboarding service frequencies.
5. Database checks: unique client code and PAN, the picked person is an active user (not a shared
   mailbox), assignee and reviewer differ, title + period unique for the client.
6. `UPDATE` of that one column (turnover also updates the turnover band).
7. `AuditEvent { action: "correct", entity, entityId, meta: { field, label, before, after, reason } }`.

Nothing is ever removed. A correction can itself be corrected; the history keeps both.

## Masking in the audit

`AuditEvent` keeps no raw client personal data (ADR-006). What is masked follows the field's data
class in the [inventory](data-inventory.md) (`src/lib/privacy/inventory.ts`): every class A client
field on the allow-list is masked, and a test keeps the two in step.

| Data | Stored as |
|---|---|
| PAN, Aadhaar, phone, email, GSTIN | `****` + last four characters |
| Names | Initials (`Kiran Kumar` → `K. K.`) |
| City, industry | First letter only (`Bengaluru` → `B…`): no fingerprint, because a hash of a value from a small set is reversed by trying every city |
| Free text (growth note, referral source, draft subject and body) | `[text, 42 characters, #a1b2c3]` |
| Reason | Typed text with identifiers replaced by anonymizer tokens (`⟨PAN_1⟩`) and the client's names too (`⟨NAME_1⟩`, `⟨ORG_1⟩`): the name and contact name of the record's client, and the old and new value when a name is corrected |
| Other values | As they are (entity type, turnover, dates as ISO, people as user ids, shown as names) |

## The allow-list

| Record | Field | Who may correct | Rules |
|---|---|---|---|
| Firm OS client (`FirmClient`) | client code | Admin or partner | Only while no SharePoint site exists (`clSiteUrl` empty): the site address and every folder path use the code. Afterwards: *"This client already has a SharePoint site, so its code can't be changed here … Ask IT to rename the site first."* Unique; A–Z0–9, 3–10. Reminder to change it in Turia too |
| | Turia client reference | Admin or partner | Up to 100 characters; may be cleared |
| | preferred language | Admin or partner | English, Kannada, Tamil, Hindi |
| LMS client (`Client`) | entity type, PAN, GSTIN, CIN / LLPIN, industry, city, contact name / phone / email, referral source, turnover, growth goal, growth note, onboarded on, primary handler | Admin or partner (the `/clients` edit rule, `canManageClients`) | `/clients` validation plus PAN holder status for the entity type, GSTIN checksum and PAN match, CIN shape; PAN unique; turnover cannot be cleared |
| Firm OS job (`JobTask`) | internal due date, assignee, reviewer, title, period | A partner, or the line manager of the current assignee | Not on a DONE job. Internal due date not after the statutory due date. Period only before IN_PREP and inside the job's FY |
| Engagement | frequency, assignee, reviewer | A partner, or the line manager of the current assignee | Frequency must suit the service (GST monthly / quarterly, ROC annual, …) |
| Comms draft | subject, message | The person who wrote it | Only before it is opened in Outlook |

Refused on purpose, with the way to do it instead:

| Field | Instead |
|---|---|
| Client name | Edit on the client page (the SharePoint folder is renamed with it) |
| Client active / archived | The client page |
| Job acknowledgement reference (ARN / SRN / ack no.) | A manager or partner retracts the filing confirmation and it is confirmed again, so the history keeps both references (state machine `FILED_BY_HUMAN → APPROVED`) |
| Job state | The job's own buttons |
| Statutory due date | A partner corrects the SOP pack calendar |
| Job client / service / FY | A partner sets up the right job |

## History view

`GET /api/firm-os/corrections/history?entity=…&id=…` returns the corrections of one record,
newest first (who, when in IST, field, before → after, reason), the fields the viewer may correct,
and active people for person fields. Who may see it: anyone active for clients; the job's assignee
and reviewer plus managers, partners and admins for jobs and engagements; the creator, admins and
partners for drafts.

## Where to mount the History link

`<HistoryLink entity="…" id={…} />` from `@/components/CorrectionHistory` is a client component: a
"History" button that opens the panel and, for people allowed to correct, a small form. Suggested
places (owned by other modules, not edited here):

| Page | Line to add |
|---|---|
| `src/app/clients/[id]/page.tsx` (client detail) | `<HistoryLink entity="Client" id={client.id} />`, and `<HistoryLink entity="FirmClient" id={firmClient.id} />` when the client is linked to Firm OS |
| `src/app/agents/[agent]/runs/[id]/page.tsx` (job / run review) | `<HistoryLink entity="JobTask" id={job.id} />` near the job header |
| Comms draft page (comms branch) | `<HistoryLink entity="CommsDraft" id={draft.id} />` |
| Engagement settings, when a page exists | `<HistoryLink entity="Engagement" id={engagement.id} />` |

The privacy request page already mounts it for DPDP corrections, with `privacyRequestId` so the
correction is recorded against the request.

## When logAudit() lands

The hardening branch adds `logAudit()` in `src/lib/audit`. Until it merges, corrections and the
privacy module write `AuditEvent` rows directly (`writeCorrectionAudit()` in the service,
`writeAudit()` in `src/lib/privacy/register.ts`); switch those two functions over then.
