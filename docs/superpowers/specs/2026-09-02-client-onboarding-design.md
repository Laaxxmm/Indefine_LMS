# Client Onboarding System — Design

Date: 2026-09-02
Status: approved in conversation, pending written review

## Goal

Internal client onboarding and client database for SRCA, built as a module inside the
existing LMS (lms.indefine.in). Staff capture client details, jobs and documents in one
form. Documents land in SharePoint under a per-client folder tree. Every save regenerates
an Excel workbook on SharePoint so partners can pivot the client base by year, month,
department, service, handler, turnover band and growth goal. Access is limited to signed-in
staff (existing Entra SSO).

## Decisions taken

| Question | Decision |
|---|---|
| Where it lives | Inside LMS repo, new `/clients` module. Reuses Entra SSO, app-only Graph token, folder/upload helpers, User table. |
| Work vs job | Work = existing `Department` enum. Job = a `ServiceType` under that department. |
| Service list | Admin-editable table, seeded with the list below. |
| Visibility | All staff see all clients and jobs and can add. Edit client / delete job or document = admin or PARTNER level. |
| Turnover | Exact ₹ figure stored, band derived for reports. |
| Growth goal | Pick-list plus optional free-text note. |
| Documents | Client-level KYC folder plus per-job folders, each upload tagged with a doc type. |
| Excel | Postgres is source of truth. Workbook fully regenerated, never appended. |
| Job tracking | Status + due date on every job. |
| Bulk import | Out of v1. |

## Seed service list

- **AUDIT**: Statutory Audit, Tax Audit, Internal Audit, Stock Audit, Certification
- **TAX**: ITR filing, GST registration, GST monthly/quarterly returns, GST annual return, TDS returns, Advance tax, Scrutiny/Notice reply, Appeals
- **ACCOUNTS**: Bookkeeping, MIS, Payroll, Finalisation
- **ROC**: Incorporation, Annual filing (AOC-4/MGT-7), Director changes, Share transfer, Strike-off, LLP filing
- **TECH**: Tally setup, Software implementation
- **ADMIN**: Registrations (MSME, IEC, PF/ESI, Shop Act)

## Data model (Prisma, Postgres)

### Client
- `id`, `name` (unique), `folderName` (sanitised, unique), `entityType` enum:
  INDIVIDUAL, HUF, PROPRIETORSHIP, PARTNERSHIP, LLP, PVT_LTD, PUBLIC_LTD, TRUST_SOCIETY, OTHER
- `pan` (unique when set), `gstin`, `cin`, `industry`, `city`
- `contactName`, `contactPhone`, `contactEmail`
- `referralSource`
- `turnover` (Decimal ₹, exact), `turnoverBand` enum derived on save:
  UNDER_40L, L40_TO_1CR, CR1_TO_5CR, CR5_TO_20CR, ABOVE_20CR
- `growthGoal` enum: EXPAND_LOCATIONS, RAISE_FUNDING, CONVERT_ENTITY, EXPORT,
  COMPLIANCE_CLEANUP, COST_REDUCTION, EXIT_SALE, MAINTAIN, OTHER
- `growthNote` text
- `onboardedOn` date
- `primaryHandlerId` → User
- `active` boolean default true
- `graphFolderId` nullable, `folderStatus` enum PENDING | READY | FAILED
- `createdById` → User, `createdAt`, `updatedAt`

### ServiceType
- `id`, `department` (existing `Department` enum), `name`, `active`, `order`
- unique on (department, name)

### Job
- `id`, `clientId` → Client, `serviceTypeId` → ServiceType, `fy` string `YYYY-YY`
- `handlerId` → User
- `status` enum: NOT_STARTED, IN_PROGRESS, DELIVERED, CLOSED
- `dueOn` date nullable, `fees` Decimal nullable, `notes` text
- `graphFolderId` nullable, `folderStatus` PENDING | READY | FAILED
- `createdById` → User, `createdAt`, `updatedAt`
- unique on (clientId, serviceTypeId, fy)
- Reporting month = `createdAt` month.

### ClientDocument
- `id`, `clientId` → Client, `jobId` → Job nullable (null = KYC, client-level)
- `docType` enum:
  client-level: PAN, AADHAAR_DIN, INCORPORATION_DEED, GST_CERT, MOA_AOA, BANK, ENGAGEMENT_LETTER, OTHER_KYC
  job-level: SOURCE_DATA, WORKING_PAPERS, FILED_RETURN, ACKNOWLEDGEMENT, SIGN_OFF, OTHER_JOB
- `name`, `graphDriveId`, `graphItemId`, `webUrl`, `sizeBytes`
- `uploadedById` → User, `createdAt`
- Same shape as existing `Material`.

No audit-log table in v1. `createdById` + `updatedAt` suffice.

## SharePoint layout

Drive: existing `GRAPH_DRIVE_ID`, app-only token. New env `GRAPH_CLIENTS_ROOT`, default `Clients`.

```
Clients/
  _Database/Client Database.xlsx
  <Client folderName>/
    KYC/
    <FY>/<Department label>/<Service name>/
```

- Folders created on demand with existing `ensureFolder`; ids stored on Client / Job.
- `folderName` = client name with `\ / : * ? " < > |` stripped and whitespace collapsed.
- Client rename moves the folder with existing `moveDriveItem` and updates `folderName`.
- Uploads: browser → app route → Graph simple upload via existing `uploadFileToFolderId`
  (conflict = rename). App-side limit 50 MB per file.
- File name on SharePoint = `<Doc type label> - <original name>`.
- No SharePoint column tagging in v1. Tag lives in DB and file name.
- Never delete in SharePoint. Deleting a ClientDocument only removes the DB row.

## Excel workbook

- Built with exceljs (already a dependency), uploaded with existing `uploadFileContent`
  to `Clients/_Database/Client Database.xlsx`.
- Always a full rewrite. Hand edits to the workbook are lost; first row of each sheet says so.
- Triggers: after any client / job / document save, debounced 30 s per process;
  nightly cron; "Rebuild now" button on reports page.
- Sheets, each a real Excel table:
  - **Clients**: all client fields, handler name, job count, last job date.
  - **Jobs**: client, FY, month (`YYYY-MM`), department, service, handler, status, due,
    fees, turnover band, growth goal, entity type, city.
  - **Documents**: client, job (or KYC), doc type, file name, uploaded by, date, web link.

## Screens

All under `/clients`. Card on Tools page and nav link. Pattern: server components +
small client forms, API routes under `/api/clients`, same as sop-builder.

- `/clients` — list. Search by name / PAN. Filters: FY, department, handler, status,
  turnover band. Columns: client, entity, city, handler, open jobs, last activity. Add button.
- `/clients/new` — onboarding form, single page: client fields, first job (FY, department →
  service, handler defaults to current user, due date), KYC uploads (multi-file, doc type per
  file). One submit creates client, job, folders, uploads, queues Excel rebuild.
- `/clients/[id]` — client page. Details header, edit (admin/partner). Tabs: Jobs (add,
  inline status / handler / due), Documents (KYC vs per job, upload, open-in-SharePoint link),
  Notes.
- `/clients/reports` — see below.
- `/clients/admin/services` — ServiceType CRUD, admin only.

Permissions: any signed-in user views and adds clients, jobs, documents. Edit client and
delete job / document require admin role or PARTNER level.

Validation (zod): PAN `^[A-Z]{5}[0-9]{4}[A-Z]$`, GSTIN 15 chars, phone 10 digits,
turnover ≥ 0, FY `^\d{4}-\d{2}$` with second part = first + 1. Duplicate name / PAN
rejected with a link to the existing client.

## Reports

`/clients/reports`, one query. Filters: FY, job-created date range, department, service,
handler, turnover band, growth goal, status. Output:

- Tiles: clients, jobs, open jobs, overdue jobs, turnover sum in scope.
- Group-by picker: FY, Month, Department, Service, Handler, Turnover band, Growth goal,
  Entity type, City. Table: jobs, distinct clients, turnover sum, open vs done. Row click
  drills to the filtered job list.
- "Download Excel" of the filtered set. "Rebuild database workbook" button.
- No charts in v1.

## Error handling

- Graph unavailable on submit: client and job saved, `folderStatus = PENDING`; client page
  shows a retry banner; nightly cron retries pending folders.
- Upload failure: that file skipped and reported, others proceed, no DB row for the failed
  file.
- Excel rebuild failure: logged, retried on next trigger, never blocks the user.

## Testing

- `scripts/clients-selfcheck.ts` (run with `npx tsx`): builds workbook from fixtures and
  asserts sheet names and row counts; asserts turnover band boundaries, folder-name
  sanitiser, PAN / GSTIN / FY validators.
- `npx tsc --noEmit` and `next build` before every commit.
- Manual on Railway: onboard one test client, verify folder tree, files, workbook. Test
  client removed by a human afterwards.

## Deployment

- Prisma migration + seed of ServiceType.
- New env `GRAPH_CLIENTS_ROOT` on Railway.
- Entra app already holds `Files.ReadWrite.All` application permission (used by recording
  ingest). No new Entra work.

## Out of scope for v1

Bulk import from the current spreadsheet, email / Teams reminders on due dates, client
portal, SharePoint column tagging, audit log, charts.
