# Client Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/clients` module inside the LMS that onboards clients, files their documents into SharePoint under `Clients/<name>/…`, and regenerates an Excel database workbook on SharePoint for reporting.

**Architecture:** Postgres (Prisma) is the source of truth. Pure helpers in `src/lib/clients/core.ts`; SharePoint folder/upload logic in `storage.ts`; Excel generation in `workbook.ts`; report queries in `reports.ts`. Route handlers under `src/app/api/clients/*`, server-component pages under `src/app/clients/*` with small `"use client"` forms, mirroring the SOP Builder tool.

**Tech Stack:** Next.js 15 App Router, Prisma 6 (Postgres), NextAuth v5 (Entra), Microsoft Graph via existing `src/lib/graph.ts`, exceljs (installed), zod (installed), Tailwind, tsx for the self-check script.

Spec: `docs/superpowers/specs/2026-09-02-client-onboarding-design.md`.

## Global Constraints

- Repo: https://github.com/Laaxxmm/Indefine_LMS, branch `main`. Work in a fresh clone; commit locally; **never push until Lakshmanan says "push"**. Before any push: `git fetch && git rebase origin/main`.
- Deploy runs `prisma db push --accept-data-loss` on start (see `package.json` `start`). No migration files. After editing `prisma/schema.prisma` run `npx prisma validate && npx prisma generate`.
- Every commit must pass `npx tsc --noEmit` and `npx tsx scripts/verify-clients.ts`. Run `npm run build` before the final commit of the plan.
- Never delete anything in SharePoint. No `deleteDriveItem` calls in this module.
- Access: any signed-in **active** user views/adds. Edit client, delete job/document = `role === "ADMIN"` or `level === "PARTNER"`. Service list admin = `role === "ADMIN"` only.
- Money stored as `Float` rupees (no Decimal in this repo). Turnover bands: `<40L`, `<1Cr`, `<5Cr`, `<20Cr`, else above. 1 L = 100000, 1 Cr = 10000000.
- Financial year is Indian (April–March), format `YYYY-YY`, second part must equal first + 1 mod 100.
- Folder names: strip `\ / : * ? " < > |`, collapse whitespace, max 80 chars.
- SharePoint root env: `GRAPH_CLIENTS_ROOT`, default `Clients`, single path segment.
- Per-file upload cap 50 MB (`MAX_UPLOAD_BYTES = 50 * 1024 * 1024`).
- Excel workbook path: `<root>/_Database/Client Database.xlsx`. Always full rewrite. Debounced 30 s after saves, plus nightly cron, plus manual button.
- Reporting month = `Job.createdAt` month, formatted `YYYY-MM` in IST.
- Fabrication ban: no invented client data in UI copy or seed. Seed only the approved service list.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | New enums + `Client`, `ServiceType`, `Job`, `ClientDocument`, User relations |
| `src/lib/clients/core.ts` | Pure: labels, seed list, turnover band, name sanitising, FY helpers, zod schemas, access rules |
| `src/lib/clients/services.ts` | DB: seed/list service types, list handlers |
| `src/lib/clients/storage.ts` | Graph: ensure folders, upload documents, rename folder, retry pending |
| `src/lib/clients/workbook.ts` | exceljs: build workbook from flat rows, load rows, upload, debounce |
| `src/lib/clients/reports.ts` | Flat job rows, filters, grouping, summary |
| `src/lib/graph.ts` | `uploadFileToFolderId` also returns `webUrl` |
| `src/app/api/clients/**` | Route handlers (create/patch client, jobs, documents, services, workbook, export) |
| `src/app/api/cron/clients/route.ts` | Nightly retry + rebuild |
| `src/app/clients/**` | Pages: layout, list, new, detail, reports, admin/services |
| `src/app/tools/page.tsx`, `src/app/dashboard/page.tsx` | Card + nav link |
| `.github/workflows/clients-nightly.yml`, `.env.example` | Cron + env docs |
| `scripts/verify-clients.ts` | Self-check for pure helpers and workbook builder |

---

### Task 1: Schema, pure helpers, self-check script

**Files:**
- Modify: `prisma/schema.prisma` (User model relations block ~line 61; append new section at end of file)
- Create: `src/lib/clients/core.ts`
- Create: `scripts/verify-clients.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces (core.ts): `ENTITY_TYPES`, `TURNOVER_BANDS`, `GROWTH_GOALS`, `JOB_STATUSES`, `KYC_DOC_TYPES`, `JOB_DOC_TYPES`, `DOC_TYPES`, `isKycDocType(t)`, `SEED_SERVICES`, `turnoverBand(rupees): TurnoverBand`, `safeName(s)`, `folderName(s)`, `fyFor(date)`, `fyOptions(now?)`, `isValidFy(s)`, `PAN_RE`, `GSTIN_RE`, `clientBodyZ`, `jobBodyZ`, `createClientBodyZ`, `jobPatchZ`, `canViewClients(user)`, `canManageClients(user)`, `isClientsAdmin(user)`, `keysOf(record)`.

- [ ] **Step 1: Write the failing self-check**

Create `scripts/verify-clients.ts`:

```ts
import assert from "node:assert/strict";
import {
  turnoverBand, safeName, folderName, fyFor, fyOptions, isValidFy, PAN_RE, GSTIN_RE,
  clientBodyZ, jobBodyZ, SEED_SERVICES, isKycDocType, canManageClients, canViewClients,
} from "../src/lib/clients/core";

// Turnover bands (rupees). Boundaries are inclusive on the upper band.
assert.equal(turnoverBand(0), "UNDER_40L");
assert.equal(turnoverBand(3_999_999), "UNDER_40L");
assert.equal(turnoverBand(4_000_000), "L40_TO_1CR");
assert.equal(turnoverBand(9_999_999), "L40_TO_1CR");
assert.equal(turnoverBand(10_000_000), "CR1_TO_5CR");
assert.equal(turnoverBand(49_999_999), "CR1_TO_5CR");
assert.equal(turnoverBand(50_000_000), "CR5_TO_20CR");
assert.equal(turnoverBand(199_999_999), "CR5_TO_20CR");
assert.equal(turnoverBand(200_000_000), "ABOVE_20CR");

// Names safe for SharePoint.
assert.equal(safeName('Acme / Sons: "Pvt" <Ltd>?'), "Acme - Sons- -Pvt- -Ltd-");
assert.equal(safeName("  a   b  "), "a b");
assert.equal(folderName("x".repeat(100)).length, 80);
assert.equal(folderName("///"), "-");

// Indian FY.
assert.equal(fyFor(new Date(2026, 8, 2)), "2026-27"); // Sep 2026
assert.equal(fyFor(new Date(2026, 2, 31)), "2025-26"); // Mar 2026
assert.equal(fyFor(new Date(2026, 3, 1)), "2026-27"); // Apr 2026
assert.deepEqual(fyOptions(new Date(2026, 8, 2)), ["2026-27", "2025-26", "2024-25", "2023-24"]);
assert.equal(fyFor(new Date(2099, 5, 1)), "2099-00");
assert.ok(isValidFy("2026-27"));
assert.ok(isValidFy("2099-00"));
assert.ok(!isValidFy("2026-28"));
assert.ok(!isValidFy("26-27"));

// Identifiers.
assert.ok(PAN_RE.test("ABCDE1234F"));
assert.ok(!PAN_RE.test("ABCD1234F"));
assert.ok(GSTIN_RE.test("33ABCDE1234F1Z5"));
assert.ok(!GSTIN_RE.test("33ABCDE1234F1Y5"));

// zod: empties become undefined, PAN upper-cased, turnover coerced.
const c = clientBodyZ.safeParse({
  name: "Test Client", entityType: "PVT_LTD", pan: " abcde1234f ", gstin: "", cin: "", city: "Chennai",
  contactPhone: "", contactEmail: "", turnover: "1500000", growthGoal: "MAINTAIN", growthNote: "",
  onboardedOn: "2026-09-02", primaryHandlerId: "u1",
});
assert.ok(c.success, JSON.stringify(c.success ? null : c.error.issues));
if (c.success) {
  assert.equal(c.data.pan, "ABCDE1234F");
  assert.equal(c.data.gstin, undefined);
  assert.equal(c.data.turnover, 1500000);
  assert.equal(c.data.growthNote, undefined);
  assert.ok(c.data.onboardedOn instanceof Date);
}
assert.ok(!clientBodyZ.safeParse({ name: "X", entityType: "PVT_LTD", turnover: -1, growthGoal: "MAINTAIN", onboardedOn: "2026-09-02", primaryHandlerId: "u1" }).success);
assert.ok(!clientBodyZ.safeParse({ name: "Test", entityType: "PVT_LTD", pan: "BAD", turnover: 1, growthGoal: "MAINTAIN", onboardedOn: "2026-09-02", primaryHandlerId: "u1" }).success);
assert.ok(!clientBodyZ.safeParse({ name: "Test", entityType: "PVT_LTD", contactPhone: "12345", turnover: 1, growthGoal: "MAINTAIN", onboardedOn: "2026-09-02", primaryHandlerId: "u1" }).success);

const j = jobBodyZ.safeParse({ serviceTypeId: "s1", fy: "2026-27", handlerId: "u1", dueOn: "", fees: "" });
assert.ok(j.success);
if (j.success) { assert.equal(j.data.status, "NOT_STARTED"); assert.equal(j.data.dueOn, undefined); assert.equal(j.data.fees, undefined); }
assert.ok(!jobBodyZ.safeParse({ serviceTypeId: "s1", fy: "2026-28", handlerId: "u1" }).success);

// Seed list: every entry is a known department, no duplicate names within a department.
for (const [dept, names] of SEED_SERVICES) {
  assert.ok(["AUDIT", "TAX", "ACCOUNTS", "ROC", "TECH", "ADMIN"].includes(dept), dept);
  assert.equal(new Set(names).size, names.length, `duplicate service under ${dept}`);
}
assert.equal(SEED_SERVICES.flatMap(([, n]) => n).length, 27);

// Doc type split.
assert.ok(isKycDocType("PAN"));
assert.ok(!isKycDocType("WORKING_PAPERS"));

// Access.
const base = { id: "u", active: true, role: "EMPLOYEE" as const, department: "TAX", level: "EXECUTIVE", email: "e@x", name: "n" };
assert.ok(canViewClients(base));
assert.ok(!canViewClients({ ...base, active: false }));
assert.ok(!canManageClients(base));
assert.ok(canManageClients({ ...base, role: "ADMIN" }));
assert.ok(canManageClients({ ...base, level: "PARTNER" }));
assert.ok(!canManageClients({ ...base, level: "PARTNER", active: false }));

console.log("verify-clients: core OK");
```

Add to `package.json` scripts, after `"verify:certs"`:

```json
    "verify:clients": "tsx scripts/verify-clients.ts"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-clients.ts`
Expected: error `Cannot find module '../src/lib/clients/core'`.

- [ ] **Step 3: Add the Prisma schema**

In `prisma/schema.prisma`, inside `model User`, after the line `officeToolRuns      OfficeToolRun[]    @relation("OfficeToolRunner")` add:

```prisma
  clientsHandled      Client[]           @relation("ClientHandler")
  clientsCreated      Client[]           @relation("ClientCreator")
  jobsHandled         Job[]              @relation("JobHandler")
  jobsCreated         Job[]              @relation("JobCreator")
  clientDocsUploaded  ClientDocument[]   @relation("ClientDocUploader")
```

Append at the end of `prisma/schema.prisma`:

```prisma

// -------------------- Client onboarding --------------------
// Client master + per-FY jobs + documents filed to SharePoint under
// <GRAPH_CLIENTS_ROOT>/<Client.folderName>/... Postgres is the source of truth;
// the Excel workbook on SharePoint is regenerated from these tables.

enum EntityType {
  INDIVIDUAL
  HUF
  PROPRIETORSHIP
  PARTNERSHIP
  LLP
  PVT_LTD
  PUBLIC_LTD
  TRUST_SOCIETY
  OTHER
}

enum TurnoverBand {
  UNDER_40L
  L40_TO_1CR
  CR1_TO_5CR
  CR5_TO_20CR
  ABOVE_20CR
}

enum GrowthGoal {
  EXPAND_LOCATIONS
  RAISE_FUNDING
  CONVERT_ENTITY
  EXPORT
  COMPLIANCE_CLEANUP
  COST_REDUCTION
  EXIT_SALE
  MAINTAIN
  OTHER
}

enum FolderStatus {
  PENDING
  READY
  FAILED
}

enum JobStatus {
  NOT_STARTED
  IN_PROGRESS
  DELIVERED
  CLOSED
}

enum ClientDocType {
  // client-level (KYC)
  PAN
  AADHAAR_DIN
  INCORPORATION_DEED
  GST_CERT
  MOA_AOA
  BANK
  ENGAGEMENT_LETTER
  OTHER_KYC
  // job-level
  SOURCE_DATA
  WORKING_PAPERS
  FILED_RETURN
  ACKNOWLEDGEMENT
  SIGN_OFF
  OTHER_JOB
}

model Client {
  id               String       @id @default(cuid())
  name             String       @unique
  folderName       String       @unique
  entityType       EntityType
  pan              String?      @unique
  gstin            String?
  cin              String?
  industry         String?
  city             String?
  contactName      String?
  contactPhone     String?
  contactEmail     String?
  referralSource   String?
  turnover         Float        // rupees
  turnoverBand     TurnoverBand
  growthGoal       GrowthGoal
  growthNote       String?
  onboardedOn      DateTime
  primaryHandlerId String
  active           Boolean      @default(true)
  graphFolderId    String?
  folderStatus     FolderStatus @default(PENDING)
  createdById      String
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  primaryHandler User             @relation("ClientHandler", fields: [primaryHandlerId], references: [id])
  createdBy      User             @relation("ClientCreator", fields: [createdById], references: [id])
  jobs           Job[]
  documents      ClientDocument[]

  @@index([primaryHandlerId])
  @@index([turnoverBand])
}

// Admin-editable service list, one row per (department, service).
model ServiceType {
  id         String     @id @default(cuid())
  department Department
  name       String
  active     Boolean    @default(true)
  order      Int        @default(0)

  jobs Job[]

  @@unique([department, name])
}

model Job {
  id            String       @id @default(cuid())
  clientId      String
  serviceTypeId String
  fy            String       // "2026-27"
  handlerId     String
  status        JobStatus    @default(NOT_STARTED)
  dueOn         DateTime?
  fees          Float?       // rupees
  notes         String?
  graphFolderId String?
  folderStatus  FolderStatus @default(PENDING)
  createdById   String
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  client      Client           @relation(fields: [clientId], references: [id], onDelete: Cascade)
  serviceType ServiceType      @relation(fields: [serviceTypeId], references: [id])
  handler     User             @relation("JobHandler", fields: [handlerId], references: [id])
  createdBy   User             @relation("JobCreator", fields: [createdById], references: [id])
  documents   ClientDocument[]

  @@unique([clientId, serviceTypeId, fy])
  @@index([handlerId])
  @@index([fy])
  @@index([status])
}

// jobId null = client-level KYC document. Same shape as Material.
model ClientDocument {
  id           String        @id @default(cuid())
  clientId     String
  jobId        String?
  docType      ClientDocType
  name         String
  graphDriveId String
  graphItemId  String
  webUrl       String
  sizeBytes    Int?
  uploadedById String
  createdAt    DateTime      @default(now())

  client     Client @relation(fields: [clientId], references: [id], onDelete: Cascade)
  job        Job?   @relation(fields: [jobId], references: [id], onDelete: Cascade)
  uploadedBy User   @relation("ClientDocUploader", fields: [uploadedById], references: [id])

  @@index([clientId])
  @@index([jobId])
}
```

Run: `npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid 🚀` then `Generated Prisma Client`.

- [ ] **Step 4: Write core.ts**

Create `src/lib/clients/core.ts`:

```ts
// Client onboarding — pure helpers. No DB, no Graph. Everything here is covered by
// scripts/verify-clients.ts.
import { z } from "zod";
import type { Session } from "next-auth";
import type { ClientDocType, Department, EntityType, GrowthGoal, JobStatus, TurnoverBand } from "@prisma/client";

export const keysOf = <T extends string>(o: Record<T, string>) => Object.keys(o) as [T, ...T[]];

export const ENTITY_TYPES: Record<EntityType, string> = {
  INDIVIDUAL: "Individual",
  HUF: "HUF",
  PROPRIETORSHIP: "Proprietorship",
  PARTNERSHIP: "Partnership firm",
  LLP: "LLP",
  PVT_LTD: "Private limited",
  PUBLIC_LTD: "Public limited",
  TRUST_SOCIETY: "Trust / Society",
  OTHER: "Other",
};

export const TURNOVER_BANDS: Record<TurnoverBand, string> = {
  UNDER_40L: "Under ₹40 L",
  L40_TO_1CR: "₹40 L – 1 Cr",
  CR1_TO_5CR: "₹1 – 5 Cr",
  CR5_TO_20CR: "₹5 – 20 Cr",
  ABOVE_20CR: "Above ₹20 Cr",
};

export const GROWTH_GOALS: Record<GrowthGoal, string> = {
  EXPAND_LOCATIONS: "Expand locations",
  RAISE_FUNDING: "Raise funding",
  CONVERT_ENTITY: "Convert entity (e.g. Prop → Pvt Ltd)",
  EXPORT: "Start / grow exports",
  COMPLIANCE_CLEANUP: "Compliance clean-up",
  COST_REDUCTION: "Cost reduction",
  EXIT_SALE: "Exit / sale",
  MAINTAIN: "Maintain as is",
  OTHER: "Other",
};

export const JOB_STATUSES: Record<JobStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  DELIVERED: "Filed / Delivered",
  CLOSED: "Closed",
};

export const KYC_DOC_TYPES = {
  PAN: "PAN",
  AADHAAR_DIN: "Aadhaar - DIN",
  INCORPORATION_DEED: "Incorporation cert - Deed",
  GST_CERT: "GST certificate",
  MOA_AOA: "MOA - AOA",
  BANK: "Bank details",
  ENGAGEMENT_LETTER: "Engagement letter",
  OTHER_KYC: "Other KYC",
} as const;

export const JOB_DOC_TYPES = {
  SOURCE_DATA: "Source data",
  WORKING_PAPERS: "Working papers",
  FILED_RETURN: "Filed return - report",
  ACKNOWLEDGEMENT: "Acknowledgement",
  SIGN_OFF: "Client sign-off",
  OTHER_JOB: "Other",
} as const;

export const DOC_TYPES: Record<ClientDocType, string> = { ...KYC_DOC_TYPES, ...JOB_DOC_TYPES };

export function isKycDocType(t: ClientDocType): boolean {
  return t in KYC_DOC_TYPES;
}

// Approved seed list (spec §Seed service list). Admins extend it in the UI.
export const SEED_SERVICES: Array<[Department, string[]]> = [
  ["AUDIT", ["Statutory Audit", "Tax Audit", "Internal Audit", "Stock Audit", "Certification"]],
  ["TAX", ["ITR filing", "GST registration", "GST monthly/quarterly returns", "GST annual return", "TDS returns", "Advance tax", "Scrutiny/Notice reply", "Appeals"]],
  ["ACCOUNTS", ["Bookkeeping", "MIS", "Payroll", "Finalisation"]],
  ["ROC", ["Incorporation", "Annual filing (AOC-4/MGT-7)", "Director changes", "Share transfer", "Strike-off", "LLP filing"]],
  ["TECH", ["Tally setup", "Software implementation"]],
  ["ADMIN", ["Registrations (MSME, IEC, PF/ESI, Shop Act)"]],
];

const LAKH = 100_000;
const CRORE = 10_000_000;

export function turnoverBand(rupees: number): TurnoverBand {
  if (rupees < 40 * LAKH) return "UNDER_40L";
  if (rupees < 1 * CRORE) return "L40_TO_1CR";
  if (rupees < 5 * CRORE) return "CR1_TO_5CR";
  if (rupees < 20 * CRORE) return "CR5_TO_20CR";
  return "ABOVE_20CR";
}

// Safe for a SharePoint file or folder name.
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

export function folderName(s: string): string {
  return safeName(s).slice(0, 80);
}

// Indian financial year, April–March. fyFor(2 Sep 2026) = "2026-27".
export function fyFor(d: Date): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function fyOptions(now = new Date()): string[] {
  const cur = Number(fyFor(now).slice(0, 4));
  return [0, 1, 2, 3].map((i) => {
    const y = cur - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

export function isValidFy(s: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Form fields arrive as strings; "" means "not given".
const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const upperBlankToUndef = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v);
const optText = z.preprocess(blankToUndef, z.string().trim().max(200).optional());

export const clientBodyZ = z.object({
  name: z.string().trim().min(2, "Client name is required").max(120),
  entityType: z.enum(keysOf(ENTITY_TYPES)),
  pan: z.preprocess(upperBlankToUndef, z.string().regex(PAN_RE, "PAN must look like AAAAA9999A").optional()),
  gstin: z.preprocess(upperBlankToUndef, z.string().regex(GSTIN_RE, "GSTIN must be 15 characters, e.g. 33AAAAA9999A1Z5").optional()),
  cin: z.preprocess(upperBlankToUndef, z.string().max(30).optional()),
  industry: optText,
  city: optText,
  contactName: optText,
  contactPhone: z.preprocess(blankToUndef, z.string().regex(/^\d{10}$/, "Phone must be 10 digits").optional()),
  contactEmail: z.preprocess(blankToUndef, z.string().email("Invalid email").optional()),
  referralSource: optText,
  turnover: z.coerce.number().min(0, "Turnover cannot be negative"),
  growthGoal: z.enum(keysOf(GROWTH_GOALS)),
  growthNote: z.preprocess(blankToUndef, z.string().trim().max(1000).optional()),
  onboardedOn: z.coerce.date(),
  primaryHandlerId: z.string().min(1, "Pick a handler"),
});

export const jobBodyZ = z.object({
  serviceTypeId: z.string().min(1, "Pick a service"),
  fy: z.string().refine(isValidFy, "FY must look like 2026-27"),
  handlerId: z.string().min(1, "Pick a handler"),
  status: z.enum(keysOf(JOB_STATUSES)).default("NOT_STARTED"),
  dueOn: z.preprocess(blankToUndef, z.coerce.date().optional()),
  fees: z.preprocess(blankToUndef, z.coerce.number().min(0).optional()),
  notes: z.preprocess(blankToUndef, z.string().trim().max(2000).optional()),
});

export const createClientBodyZ = z.object({ client: clientBodyZ, job: jobBodyZ });

// Inline edits on the client page. Service and FY are fixed once the folder exists.
export const jobPatchZ = jobBodyZ.pick({ handlerId: true, status: true, dueOn: true, fees: true, notes: true }).partial();

export type ClientBody = z.infer<typeof clientBodyZ>;
export type JobBody = z.infer<typeof jobBodyZ>;

type U = Session["user"] | null | undefined;

export function canViewClients(user: U): boolean {
  return !!user && user.active === true;
}

export function canManageClients(user: U): boolean {
  return canViewClients(user) && (user!.role === "ADMIN" || user!.level === "PARTNER");
}

export function isClientsAdmin(user: U): boolean {
  return canViewClients(user) && user!.role === "ADMIN";
}
```

- [ ] **Step 5: Run the self-check and typecheck**

Run: `npx tsx scripts/verify-clients.ts && npx tsc --noEmit`
Expected: `verify-clients: core OK` and no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/lib/clients/core.ts scripts/verify-clients.ts package.json
git commit -m "Clients: schema, pure helpers and self-check

Client master, admin-editable ServiceType per department, Job per FY with
status/due date, ClientDocument (KYC or per job). core.ts holds labels,
turnover bands, folder-name sanitising, Indian FY helpers, zod schemas and
the view/manage access rules. scripts/verify-clients.ts covers them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Service types + handler lists (DB helpers)

**Files:**
- Create: `src/lib/clients/services.ts`

**Interfaces:**
- Consumes: `SEED_SERVICES` from core.
- Produces: `ensureServiceTypes()`, `listServiceTypes(includeInactive?)`, `listHandlers()` returning `{ id, name }[]`.

- [ ] **Step 1: Write services.ts**

```ts
import { prisma } from "@/lib/prisma";
import { SEED_SERVICES } from "./core";

// Idempotent seed. One INSERT … ON CONFLICT DO NOTHING per call; cheap enough to run
// on every page that needs the list, so no separate seed step at deploy.
export async function ensureServiceTypes(): Promise<void> {
  const data = SEED_SERVICES.flatMap(([department, names]) => names.map((name, order) => ({ department, name, order })));
  await prisma.serviceType.createMany({ data, skipDuplicates: true });
}

export async function listServiceTypes(includeInactive = false) {
  await ensureServiceTypes();
  return prisma.serviceType.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ department: "asc" }, { order: "asc" }, { name: "asc" }],
  });
}

export type Handler = { id: string; name: string };

// Real, active people only — shared mailboxes are excludedFromScoring.
export async function listHandlers(): Promise<Handler[]> {
  const users = await prisma.user.findMany({
    where: { active: true, excludedFromScoring: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/clients/services.ts
git commit -m "Clients: service-type seed and handler list helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: SharePoint storage (folders, uploads, rename, retry)

**Files:**
- Modify: `src/lib/graph.ts:610-640` (`uploadFileToFolderId` returns `webUrl`)
- Create: `src/lib/clients/storage.ts`

**Interfaces:**
- Consumes: `ensureFolder`, `resolveFolderId`, `moveDriveItem`, `uploadFileToFolderId`, `getAppOnlyToken`, `getUserGraphToken` from `@/lib/graph`; `departmentLabel` from `@/lib/ca-firm`; `DOC_TYPES`, `safeName` from core.
- Produces: `clientsRoot()`, `MAX_UPLOAD_BYTES`, `ensureClientFolder(clientId, userId?)`, `ensureJobFolder(jobId, userId?)`, `uploadClientDocument({ clientId, jobId, docType, file, userId })`, `renameClientFolder(clientId, newFolderName, userId?)`, `retryPendingFolders()`.

- [ ] **Step 1: Extend `uploadFileToFolderId` to return `webUrl`**

In `src/lib/graph.ts`, change the signature and last lines of `uploadFileToFolderId`:

```ts
export async function uploadFileToFolderId(
  driveId: string,
  folderId: string,
  fileName: string,
  bytes: ArrayBuffer,
  token: string
): Promise<{ id: string; size: number; webUrl: string } | null> {
```
and replace the final two statements with:
```ts
  const item = (await res.json()) as { id?: string; size?: number; webUrl?: string };
  return item.id ? { id: item.id, size: item.size ?? 0, webUrl: item.webUrl ?? "" } : null;
```

- [ ] **Step 2: Write storage.ts**

```ts
// SharePoint side of client onboarding. Best-effort everywhere: the DB row is saved
// first, and a Graph failure leaves folderStatus = PENDING/FAILED for retry (client
// page banner, nightly cron). Never deletes anything on SharePoint.
import type { ClientDocType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { departmentLabel } from "@/lib/ca-firm";
import {
  ensureFolder, getAppOnlyToken, getUserGraphToken, moveDriveItem, resolveFolderId, uploadFileToFolderId,
} from "@/lib/graph";
import { DOC_TYPES, safeName } from "./core";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const driveId = () => process.env.GRAPH_DRIVE_ID ?? "";
// Single path segment directly under the drive root (ensureFolder creates one level).
export const clientsRoot = () => (process.env.GRAPH_CLIENTS_ROOT || "Clients").replace(/^\/+|\/+$/g, "");

async function graphToken(userId?: string): Promise<string | null> {
  return (await getAppOnlyToken()) ?? (userId ? await getUserGraphToken(userId) : null);
}

/** Ensures <root>/<client>/KYC exists; stores the client folder id. Returns null on failure. */
export async function ensureClientFolder(clientId: string, userId?: string): Promise<string | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { folderName: true, graphFolderId: true } });
  if (!client) return null;
  if (client.graphFolderId) return client.graphFolderId;
  const [d, t] = [driveId(), await graphToken(userId)];
  if (!d || !t) return null;
  try {
    await ensureFolder(d, "", clientsRoot(), t);
    const id = await ensureFolder(d, clientsRoot(), client.folderName, t);
    await ensureFolder(d, `${clientsRoot()}/${client.folderName}`, "KYC", t);
    await prisma.client.update({ where: { id: clientId }, data: { graphFolderId: id, folderStatus: "READY" } });
    return id;
  } catch (e) {
    console.error(`client folder ${client.folderName} failed:`, (e as Error).message);
    await prisma.client.update({ where: { id: clientId }, data: { folderStatus: "FAILED" } }).catch(() => {});
    return null;
  }
}

async function kycFolderId(clientId: string, userId?: string): Promise<string | null> {
  if (!(await ensureClientFolder(clientId, userId))) return null;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { folderName: true } });
  const [d, t] = [driveId(), await graphToken(userId)];
  if (!client || !d || !t) return null;
  return ensureFolder(d, `${clientsRoot()}/${client.folderName}`, "KYC", t).catch(() => null);
}

/** Ensures <root>/<client>/<FY>/<Department>/<Service>; stores the job folder id. */
export async function ensureJobFolder(jobId: string, userId?: string): Promise<string | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { client: { select: { id: true, folderName: true } }, serviceType: true },
  });
  if (!job) return null;
  if (job.graphFolderId) return job.graphFolderId;
  if (!(await ensureClientFolder(job.client.id, userId))) return null;
  const [d, t] = [driveId(), await graphToken(userId)];
  if (!d || !t) return null;
  const base = `${clientsRoot()}/${job.client.folderName}`;
  const dept = safeName(departmentLabel(job.serviceType.department)); // "Admin / Ops" → "Admin - Ops"
  const svc = safeName(job.serviceType.name);
  try {
    await ensureFolder(d, base, job.fy, t);
    await ensureFolder(d, `${base}/${job.fy}`, dept, t);
    const id = await ensureFolder(d, `${base}/${job.fy}/${dept}`, svc, t);
    await prisma.job.update({ where: { id: jobId }, data: { graphFolderId: id, folderStatus: "READY" } });
    return id;
  } catch (e) {
    console.error(`job folder ${base}/${job.fy}/${dept}/${svc} failed:`, (e as Error).message);
    await prisma.job.update({ where: { id: jobId }, data: { folderStatus: "FAILED" } }).catch(() => {});
    return null;
  }
}

/** Uploads one file and records it. Throws with a user-facing message on failure. */
export async function uploadClientDocument(opts: {
  clientId: string;
  jobId: string | null;
  docType: ClientDocType;
  file: File;
  userId: string;
}) {
  if (opts.file.size > MAX_UPLOAD_BYTES) throw new Error(`${opts.file.name} is over 50 MB`);
  const folderId = opts.jobId ? await ensureJobFolder(opts.jobId, opts.userId) : await kycFolderId(opts.clientId, opts.userId);
  if (!folderId) throw new Error("SharePoint folder unavailable — check Graph configuration and retry");
  const [d, t] = [driveId(), await graphToken(opts.userId)];
  if (!d || !t) throw new Error("No Graph token");
  const name = safeName(`${DOC_TYPES[opts.docType]} - ${opts.file.name}`);
  const item = await uploadFileToFolderId(d, folderId, name, await opts.file.arrayBuffer(), t);
  if (!item) throw new Error(`Upload of ${opts.file.name} failed`);
  return prisma.clientDocument.create({
    data: {
      clientId: opts.clientId,
      jobId: opts.jobId,
      docType: opts.docType,
      name,
      graphDriveId: d,
      graphItemId: item.id,
      webUrl: item.webUrl,
      sizeBytes: item.size,
      uploadedById: opts.userId,
    },
  });
}

/** Renames the client folder on SharePoint. True when nothing to move or moved OK. */
export async function renameClientFolder(clientId: string, newFolderName: string, userId?: string): Promise<boolean> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { graphFolderId: true } });
  if (!client?.graphFolderId) return true; // nothing on SharePoint yet
  const [d, t] = [driveId(), await graphToken(userId)];
  if (!d || !t) return false;
  const parent = await resolveFolderId(d, clientsRoot(), t);
  if (!parent) return false;
  return moveDriveItem(d, client.graphFolderId, parent, t, newFolderName);
}

export async function retryPendingFolders(): Promise<{ clients: number; jobs: number }> {
  let clients = 0;
  for (const c of await prisma.client.findMany({ where: { graphFolderId: null }, select: { id: true } }))
    if (await ensureClientFolder(c.id)) clients++;
  let jobs = 0;
  for (const j of await prisma.job.findMany({ where: { graphFolderId: null }, select: { id: true } }))
    if (await ensureJobFolder(j.id)) jobs++;
  return { clients, jobs };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (existing callers of `uploadFileToFolderId` only read `id`/`size`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/graph.ts src/lib/clients/storage.ts
git commit -m "Clients: SharePoint folders, uploads, rename and retry

Folders: <root>/<client>/KYC and <root>/<client>/<FY>/<Department>/<Service>,
created on demand with the existing ensureFolder. Uploads go through
uploadFileToFolderId, which now also returns webUrl. Nothing is ever deleted
on SharePoint.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Excel workbook (build, load, upload, debounce)

**Files:**
- Create: `src/lib/clients/workbook.ts`
- Modify: `scripts/verify-clients.ts` (append workbook assertions)

**Interfaces:**
- Consumes: `clientsRoot` from storage; `ensureFolder`, `getAppOnlyToken`, `uploadFileContent` from graph; labels from core; `departmentLabel` from ca-firm.
- Produces: `WorkbookInput` type, `buildClientWorkbook(input): ExcelJS.Workbook`, `loadWorkbookInput()`, `rebuildClientWorkbook(): Promise<{ ok; error? }>`, `scheduleWorkbookRebuild(delayMs?)`, `WORKBOOK_PATH()`, `istMonth(date): "YYYY-MM"`, `istDate(date): "YYYY-MM-DD"`.

- [ ] **Step 1: Append the failing workbook check**

The script runs as CommonJS (no `"type": "module"`), so no top-level `await`: async
checks go inside one IIFE at the bottom. Add to the imports at the top of
`scripts/verify-clients.ts`:

```ts
import ExcelJS from "exceljs";
import { buildClientWorkbook, istMonth, istDate, type WorkbookInput } from "../src/lib/clients/workbook";
```

Replace the final `console.log("verify-clients: core OK");` with:

```ts
console.log("verify-clients: core OK");

(async () => {
  // Workbook builder — pure, no DB.
  assert.equal(istMonth(new Date("2026-03-31T20:00:00Z")), "2026-04"); // 01:30 IST next day
  assert.equal(istDate(new Date("2026-03-31T20:00:00Z")), "2026-04-01");

  const input: WorkbookInput = {
    clients: [{
      name: "Alpha Traders", entityType: "PROPRIETORSHIP", pan: "ABCDE1234F", gstin: null, cin: null, industry: "Retail", city: "Chennai",
      contactName: "A", contactPhone: "9999999999", contactEmail: null, referralSource: null, turnover: 2_500_000, turnoverBand: "UNDER_40L",
      growthGoal: "MAINTAIN", growthNote: null, onboardedOn: new Date("2026-09-01T00:00:00Z"), handler: "H One", active: true,
      jobCount: 1, lastJobOn: new Date("2026-09-01T00:00:00Z"), folderStatus: "READY",
    }],
    jobs: [{
      client: "Alpha Traders", fy: "2026-27", department: "TAX", service: "ITR filing", handler: "H One", status: "IN_PROGRESS",
      dueOn: null, fees: 5000, turnoverBand: "UNDER_40L", growthGoal: "MAINTAIN", entityType: "PROPRIETORSHIP", city: "Chennai",
      createdAt: new Date("2026-09-01T00:00:00Z"), createdBy: "H One",
    }],
    documents: [{ client: "Alpha Traders", job: "2026-27 · ITR filing", docType: "PAN", name: "PAN - card.pdf", uploadedBy: "H One", createdAt: new Date("2026-09-01T00:00:00Z"), webUrl: "https://example.sharepoint.com/x" }],
  };
  const wb = buildClientWorkbook(input);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Clients", "Jobs", "Documents"]);
  const jobs = wb.getWorksheet("Jobs")!;
  assert.equal(jobs.getCell("A2").value, "Client");
  assert.equal(jobs.getCell("A3").value, "Alpha Traders");
  assert.equal(jobs.getCell("C3").value, "2026-09"); // Month
  assert.equal(jobs.getCell("D3").value, "Tax");
  assert.equal(jobs.getCell("G3").value, "In progress");
  assert.equal(wb.getWorksheet("Clients")!.getCell("M3").value, "Under ₹40 L");
  assert.equal(wb.getWorksheet("Documents")!.getCell("G3").value, "https://example.sharepoint.com/x");
  // Round-trips through xlsx (catches invalid table definitions).
  const bytes = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(bytes as Buffer);
  assert.equal(back.getWorksheet("Jobs")!.rowCount, 3);

  console.log("verify-clients: core + workbook OK");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/verify-clients.ts`
Expected: `Cannot find module '../src/lib/clients/workbook'`.

- [ ] **Step 3: Write workbook.ts**

```ts
// The Excel "database" on SharePoint. Regenerated from Postgres in full — never
// appended to, so hand edits in the workbook are lost (the first row says so).
import ExcelJS from "exceljs";
import type { ClientDocType, Department, EntityType, GrowthGoal, JobStatus, TurnoverBand } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { departmentLabel } from "@/lib/ca-firm";
import { ensureFolder, getAppOnlyToken, uploadFileContent } from "@/lib/graph";
import { DOC_TYPES, ENTITY_TYPES, GROWTH_GOALS, JOB_STATUSES, TURNOVER_BANDS } from "./core";
import { clientsRoot } from "./storage";

export const WORKBOOK_PATH = () => `${clientsRoot()}/_Database/Client Database.xlsx`;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NOTICE = "Generated by the LMS from the client database. Do not edit here — every rebuild overwrites this file.";

export type WorkbookInput = {
  clients: Array<{
    name: string; entityType: EntityType; pan: string | null; gstin: string | null; cin: string | null; industry: string | null;
    city: string | null; contactName: string | null; contactPhone: string | null; contactEmail: string | null; referralSource: string | null;
    turnover: number; turnoverBand: TurnoverBand; growthGoal: GrowthGoal; growthNote: string | null; onboardedOn: Date; handler: string;
    active: boolean; jobCount: number; lastJobOn: Date | null; folderStatus: string;
  }>;
  jobs: Array<{
    client: string; fy: string; department: Department; service: string; handler: string; status: JobStatus; dueOn: Date | null;
    fees: number | null; turnoverBand: TurnoverBand; growthGoal: GrowthGoal; entityType: EntityType; city: string | null;
    createdAt: Date; createdBy: string;
  }>;
  documents: Array<{ client: string; job: string; docType: ClientDocType; name: string; uploadedBy: string; createdAt: Date; webUrl: string }>;
};

const IST = "Asia/Kolkata";
export const istDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST }); // YYYY-MM-DD
export const istMonth = (d: Date) => istDate(d).slice(0, 7);
const dateOrBlank = (d: Date | null) => (d ? istDate(d) : "");

type Cell = string | number;

function addTableSheet(wb: ExcelJS.Workbook, name: string, columns: string[], rows: Cell[][]) {
  const ws = wb.addWorksheet(name);
  ws.getCell("A1").value = NOTICE;
  ws.getCell("A1").font = { italic: true, color: { argb: "FF888888" } };
  ws.addTable({
    name: `${name}Table`,
    ref: "A2",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: columns.map((c) => ({ name: c, filterButton: true })),
    rows: rows.length ? rows : [columns.map(() => "")], // exceljs needs at least one row
  });
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(44, Math.max(12, c.length + 4)); });
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

export function buildClientWorkbook(input: WorkbookInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Indefine LMS";
  addTableSheet(wb, "Clients",
    ["Client", "Entity type", "PAN", "GSTIN", "CIN", "Industry", "City", "Contact", "Phone", "Email", "Referral source",
      "Turnover (₹)", "Turnover band", "Growth goal", "Growth note", "Onboarded on", "Primary handler", "Active", "Jobs", "Last job on", "Folder status"],
    input.clients.map((c) => [
      c.name, ENTITY_TYPES[c.entityType], c.pan ?? "", c.gstin ?? "", c.cin ?? "", c.industry ?? "", c.city ?? "", c.contactName ?? "",
      c.contactPhone ?? "", c.contactEmail ?? "", c.referralSource ?? "", c.turnover, TURNOVER_BANDS[c.turnoverBand], GROWTH_GOALS[c.growthGoal],
      c.growthNote ?? "", istDate(c.onboardedOn), c.handler, c.active ? "Yes" : "No", c.jobCount, dateOrBlank(c.lastJobOn), c.folderStatus,
    ]));
  addTableSheet(wb, "Jobs",
    ["Client", "FY", "Month", "Department", "Service", "Handler", "Status", "Due on", "Fees (₹)", "Turnover band", "Growth goal",
      "Entity type", "City", "Created on", "Created by"],
    input.jobs.map((j) => [
      j.client, j.fy, istMonth(j.createdAt), departmentLabel(j.department), j.service, j.handler, JOB_STATUSES[j.status], dateOrBlank(j.dueOn),
      j.fees ?? "", TURNOVER_BANDS[j.turnoverBand], GROWTH_GOALS[j.growthGoal], ENTITY_TYPES[j.entityType], j.city ?? "", istDate(j.createdAt), j.createdBy,
    ]));
  addTableSheet(wb, "Documents",
    ["Client", "Job", "Doc type", "File name", "Uploaded by", "Uploaded on", "Link"],
    input.documents.map((d) => [d.client, d.job, DOC_TYPES[d.docType], d.name, d.uploadedBy, istDate(d.createdAt), d.webUrl]));
  return wb;
}

const who = (u: { name: string | null; email: string }) => u.name ?? u.email;

export async function loadWorkbookInput(): Promise<WorkbookInput> {
  const [clients, jobs, documents] = await Promise.all([
    prisma.client.findMany({
      orderBy: { name: "asc" },
      include: { primaryHandler: { select: { name: true, email: true } }, jobs: { select: { createdAt: true } } },
    }),
    prisma.job.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true, turnoverBand: true, growthGoal: true, entityType: true, city: true } },
        serviceType: true,
        handler: { select: { name: true, email: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
    prisma.clientDocument.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        job: { select: { fy: true, serviceType: { select: { name: true } } } },
        uploadedBy: { select: { name: true, email: true } },
      },
    }),
  ]);
  return {
    clients: clients.map((c) => ({
      name: c.name, entityType: c.entityType, pan: c.pan, gstin: c.gstin, cin: c.cin, industry: c.industry, city: c.city,
      contactName: c.contactName, contactPhone: c.contactPhone, contactEmail: c.contactEmail, referralSource: c.referralSource,
      turnover: c.turnover, turnoverBand: c.turnoverBand, growthGoal: c.growthGoal, growthNote: c.growthNote, onboardedOn: c.onboardedOn,
      handler: who(c.primaryHandler), active: c.active, jobCount: c.jobs.length,
      lastJobOn: c.jobs.reduce<Date | null>((m, j) => (!m || j.createdAt > m ? j.createdAt : m), null), folderStatus: c.folderStatus,
    })),
    jobs: jobs.map((j) => ({
      client: j.client.name, fy: j.fy, department: j.serviceType.department, service: j.serviceType.name, handler: who(j.handler),
      status: j.status, dueOn: j.dueOn, fees: j.fees, turnoverBand: j.client.turnoverBand, growthGoal: j.client.growthGoal,
      entityType: j.client.entityType, city: j.client.city, createdAt: j.createdAt, createdBy: who(j.createdBy),
    })),
    documents: documents.map((d) => ({
      client: d.client.name, job: d.job ? `${d.job.fy} · ${d.job.serviceType.name}` : "KYC", docType: d.docType, name: d.name,
      uploadedBy: who(d.uploadedBy), createdAt: d.createdAt, webUrl: d.webUrl,
    })),
  };
}

export async function rebuildClientWorkbook(): Promise<{ ok: boolean; error?: string }> {
  const d = process.env.GRAPH_DRIVE_ID;
  const t = await getAppOnlyToken();
  if (!d || !t) return { ok: false, error: "Graph not configured (GRAPH_DRIVE_ID / MS_* env)" };
  try {
    const wb = buildClientWorkbook(await loadWorkbookInput());
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    await ensureFolder(d, "", clientsRoot(), t);
    await ensureFolder(d, clientsRoot(), "_Database", t);
    await uploadFileContent(d, WORKBOOK_PATH(), bytes, XLSX_MIME, t);
    return { ok: true };
  } catch (e) {
    console.error("client workbook rebuild failed:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
// ponytail: in-process debounce — Railway runs one instance. If that changes, replace with
// a "dirty" flag in Settings and let the cron do the rebuild.
export function scheduleWorkbookRebuild(delayMs = 30_000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void rebuildClientWorkbook();
  }, delayMs);
}
```

- [ ] **Step 4: Run the self-check and typecheck**

Run: `npx tsx scripts/verify-clients.ts && npx tsc --noEmit`
Expected: `verify-clients: core + workbook OK`, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clients/workbook.ts scripts/verify-clients.ts
git commit -m "Clients: Excel database workbook generator

Three table sheets (Clients, Jobs, Documents) rebuilt in full from Postgres
and uploaded to <root>/_Database/Client Database.xlsx. Debounced 30 s after
saves; nightly cron and a manual button call rebuildClientWorkbook directly.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: API — create client, edit client, jobs

**Files:**
- Create: `src/app/api/clients/route.ts`
- Create: `src/app/api/clients/[id]/route.ts`
- Create: `src/app/api/clients/[id]/jobs/route.ts`
- Create: `src/app/api/clients/jobs/[jobId]/route.ts`

**Interfaces:**
- Consumes: `createClientBodyZ`, `clientBodyZ`, `jobBodyZ`, `jobPatchZ`, `folderName`, `turnoverBand`, `canViewClients`, `canManageClients` from core; `ensureJobFolder`, `renameClientFolder` from storage; `scheduleWorkbookRebuild` from workbook.
- Produces HTTP contract used by the forms:
  - `POST /api/clients` body `{ client: ClientBody, job: JobBody }` → `201 { id, jobId, folderStatus }`; `409 { error, existingId }` on duplicate.
  - `PATCH /api/clients/[id]` body partial ClientBody + `{ active?: boolean }` → `200 { ok: true }`.
  - `POST /api/clients/[id]/jobs` body JobBody → `201 { id, folderStatus }`; `409` on same service+FY.
  - `PATCH /api/clients/jobs/[jobId]` body partial `{ handlerId, status, dueOn, fees, notes }` → `200 { ok: true }`.
  - `DELETE /api/clients/jobs/[jobId]` → `200 { ok: true }`; `409` when the job has documents.

- [ ] **Step 1: `src/app/api/clients/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, createClientBodyZ, folderName, turnoverBand } from "@/lib/clients/core";
import { ensureJobFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

export const maxDuration = 60;

// Onboard a client together with its first job. Any active user.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const parsed = createClientBodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { client, job } = parsed.data;

  const fname = folderName(client.name);
  if (!/[A-Za-z0-9]/.test(fname)) return NextResponse.json({ error: "Client name needs at least one letter or digit" }, { status: 400 });

  const dup = await prisma.client.findFirst({
    where: { OR: [{ name: { equals: client.name, mode: "insensitive" } }, { folderName: fname }, ...(client.pan ? [{ pan: client.pan }] : [])] },
    select: { id: true, name: true },
  });
  if (dup) return NextResponse.json({ error: `Client already exists: ${dup.name}`, existingId: dup.id }, { status: 409 });

  const handlerIds = [...new Set([client.primaryHandlerId, job.handlerId])];
  const [service, handlers] = await Promise.all([
    prisma.serviceType.findUnique({ where: { id: job.serviceTypeId } }),
    prisma.user.findMany({ where: { id: { in: handlerIds }, active: true }, select: { id: true } }),
  ]);
  if (!service?.active) return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  if (handlers.length !== handlerIds.length) return NextResponse.json({ error: "Unknown handler" }, { status: 400 });

  const created = await prisma.client.create({
    data: {
      ...client,
      folderName: fname,
      turnoverBand: turnoverBand(client.turnover),
      createdById: session.user.id,
      jobs: { create: { ...job, createdById: session.user.id } },
    },
    include: { jobs: { select: { id: true } } },
  });

  const jobId = created.jobs[0].id;
  const folderId = await ensureJobFolder(jobId, session.user.id); // also creates the client + KYC folders
  scheduleWorkbookRebuild();
  return NextResponse.json({ id: created.id, jobId, folderStatus: folderId ? "READY" : "PENDING" }, { status: 201 });
}
```

- [ ] **Step 2: `src/app/api/clients/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClients, clientBodyZ, folderName, turnoverBand } from "@/lib/clients/core";
import { renameClientFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

const patchZ = clientBodyZ.partial().extend({ active: z.boolean().optional() });

// Edit client details. Admins and partners only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageClients(session.user)) return NextResponse.json({ error: "Admins and partners only" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = patchZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const body = parsed.data;

  const data: Prisma.ClientUncheckedUpdateInput = { ...body };
  if (body.turnover !== undefined) data.turnoverBand = turnoverBand(body.turnover);

  if (body.name && body.name !== existing.name) {
    const fname = folderName(body.name);
    if (!/[A-Za-z0-9]/.test(fname)) return NextResponse.json({ error: "Client name needs at least one letter or digit" }, { status: 400 });
    const dup = await prisma.client.findFirst({
      where: { id: { not: id }, OR: [{ name: { equals: body.name, mode: "insensitive" } }, { folderName: fname }] },
      select: { name: true },
    });
    if (dup) return NextResponse.json({ error: `Another client is already called ${dup.name}` }, { status: 409 });
    if (fname !== existing.folderName) {
      if (!(await renameClientFolder(id, fname, session.user.id)))
        return NextResponse.json({ error: "Could not rename the SharePoint folder — try again" }, { status: 502 });
      data.folderName = fname;
    }
  }
  if (body.pan && body.pan !== existing.pan) {
    const dup = await prisma.client.findFirst({ where: { id: { not: id }, pan: body.pan }, select: { name: true } });
    if (dup) return NextResponse.json({ error: `PAN already belongs to ${dup.name}` }, { status: 409 });
  }

  await prisma.client.update({ where: { id }, data });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `src/app/api/clients/[id]/jobs/route.ts`**

```ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, jobBodyZ } from "@/lib/clients/core";
import { ensureJobFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

export const maxDuration = 60;

// Add a job (service × FY) to an existing client. Any active user.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const { id: clientId } = await params;
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = jobBodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const job = parsed.data;

  const [service, handler] = await Promise.all([
    prisma.serviceType.findUnique({ where: { id: job.serviceTypeId } }),
    prisma.user.findUnique({ where: { id: job.handlerId }, select: { active: true } }),
  ]);
  if (!service?.active) return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  if (!handler?.active) return NextResponse.json({ error: "Unknown handler" }, { status: 400 });

  let created;
  try {
    created = await prisma.job.create({ data: { ...job, clientId, createdById: session.user.id }, select: { id: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: `${service.name} for ${job.fy} already exists on this client` }, { status: 409 });
    throw e;
  }
  const folderId = await ensureJobFolder(created.id, session.user.id);
  scheduleWorkbookRebuild();
  return NextResponse.json({ id: created.id, folderStatus: folderId ? "READY" : "PENDING" }, { status: 201 });
}
```

- [ ] **Step 4: `src/app/api/clients/jobs/[jobId]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClients, canViewClients, jobPatchZ } from "@/lib/clients/core";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

// Inline edits (handler / status / due / fees / notes). Any active user.
export async function PATCH(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const { jobId } = await params;
  const parsed = jobPatchZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  if (parsed.data.handlerId) {
    const h = await prisma.user.findUnique({ where: { id: parsed.data.handlerId }, select: { active: true } });
    if (!h?.active) return NextResponse.json({ error: "Unknown handler" }, { status: 400 });
  }
  const updated = await prisma.job.updateMany({ where: { id: jobId }, data: parsed.data });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}

// Remove a job record. Admins and partners only; refused while documents are attached
// (SharePoint files are never deleted, so the DB rows must not silently vanish either).
export async function DELETE(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageClients(session.user)) return NextResponse.json({ error: "Admins and partners only" }, { status: 403 });

  const { jobId } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { _count: { select: { documents: true } } } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job._count.documents > 0) return NextResponse.json({ error: "Remove the job's documents first" }, { status: 409 });
  await prisma.job.delete({ where: { id: jobId } });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/clients
git commit -m "Clients: API for onboarding, client edits and jobs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: API — documents, services, workbook rebuild, cron

**Files:**
- Create: `src/app/api/clients/[id]/documents/route.ts`
- Create: `src/app/api/clients/documents/[docId]/route.ts`
- Create: `src/app/api/clients/services/route.ts`
- Create: `src/app/api/clients/services/[serviceId]/route.ts`
- Create: `src/app/api/clients/workbook/route.ts`
- Create: `src/app/api/cron/clients/route.ts`
- Create: `.github/workflows/clients-nightly.yml`
- Modify: `.env.example` (after the `GRAPH_VIDEOS_FOLDER_ID` block)

**Interfaces:**
- `POST /api/clients/[id]/documents` multipart: `docType`, optional `jobId`, one or more `files` → `200 { uploaded: [{ id, name, webUrl }], failed: [{ name, error }] }` (502 when every file failed).
- `DELETE /api/clients/documents/[docId]` → `200 { ok: true }` (DB row only).
- `POST /api/clients/services` `{ department, name }` → `201 { id }`; `PATCH /api/clients/services/[serviceId]` `{ name?, active? }` → `200 { ok: true }`.
- `POST /api/clients/workbook` → `200 { ok, error? }`.
- `GET /api/cron/clients?key=CRON_SECRET` → `{ folders: { clients, jobs }, workbook: { ok, error? } }`.

- [ ] **Step 1: `src/app/api/clients/[id]/documents/route.ts`**

```ts
import { NextResponse } from "next/server";
import type { ClientDocType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, DOC_TYPES, isKycDocType } from "@/lib/clients/core";
import { MAX_UPLOAD_BYTES, uploadClientDocument } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

export const runtime = "nodejs";
export const maxDuration = 300;

// Upload one or more files as the same doc type. Per-file success/failure; nothing is
// recorded for a file that did not land on SharePoint.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const { id: clientId } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });

  const docType = String(form.get("docType") ?? "") as ClientDocType;
  if (!(docType in DOC_TYPES)) return NextResponse.json({ error: "Pick a document type" }, { status: 400 });
  const jobId = String(form.get("jobId") ?? "") || null;
  if (jobId && isKycDocType(docType)) return NextResponse.json({ error: "KYC document types go under the client, not a job" }, { status: 400 });
  if (!jobId && !isKycDocType(docType)) return NextResponse.json({ error: "Pick a job for this document type" }, { status: 400 });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { clientId: true } });
    if (job?.clientId !== clientId) return NextResponse.json({ error: "Job not found on this client" }, { status: 404 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Attach at least one file" }, { status: 400 });

  const uploaded: Array<{ id: string; name: string; webUrl: string }> = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) { failed.push({ name: file.name, error: "Over 50 MB" }); continue; }
    try {
      const doc = await uploadClientDocument({ clientId, jobId, docType, file, userId: session.user.id });
      uploaded.push({ id: doc.id, name: doc.name, webUrl: doc.webUrl });
    } catch (e) {
      failed.push({ name: file.name, error: (e as Error).message });
    }
  }
  if (uploaded.length) scheduleWorkbookRebuild();
  return NextResponse.json({ uploaded, failed }, { status: uploaded.length ? 200 : 502 });
}
```

- [ ] **Step 2: `src/app/api/clients/documents/[docId]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/clients/core";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

// Unlink a document record. The file stays on SharePoint (never deleted from here).
export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageClients(session.user)) return NextResponse.json({ error: "Admins and partners only" }, { status: 403 });
  const { docId } = await params;
  const r = await prisma.clientDocument.deleteMany({ where: { id: docId } });
  if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `src/app/api/clients/services/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS } from "@/lib/ca-firm";
import { isClientsAdmin } from "@/lib/clients/core";

const bodyZ = z.object({
  department: z.enum(DEPARTMENTS as [typeof DEPARTMENTS[number], ...typeof DEPARTMENTS]),
  name: z.string().trim().min(2).max(80),
});

// Add a service under a department. Admins only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isClientsAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const parsed = bodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const max = await prisma.serviceType.aggregate({ where: { department: parsed.data.department }, _max: { order: true } });
  try {
    const s = await prisma.serviceType.create({ data: { ...parsed.data, order: (max._max.order ?? -1) + 1 }, select: { id: true } });
    return NextResponse.json({ id: s.id }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: "That service already exists under this department" }, { status: 409 });
    throw e;
  }
}
```

- [ ] **Step 4: `src/app/api/clients/services/[serviceId]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isClientsAdmin } from "@/lib/clients/core";

const patchZ = z.object({ name: z.string().trim().min(2).max(80).optional(), active: z.boolean().optional() });

// Rename or (de)activate a service. Admins only. Never deleted — jobs reference it.
export async function PATCH(req: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isClientsAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { serviceId } = await params;
  const parsed = patchZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = await prisma.serviceType.updateMany({ where: { id: serviceId }, data: parsed.data });
  if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: `src/app/api/clients/workbook/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewClients } from "@/lib/clients/core";
import { rebuildClientWorkbook } from "@/lib/clients/workbook";

export const maxDuration = 60;

// "Rebuild database workbook" button.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });
  const r = await rebuildClientWorkbook();
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
```

- [ ] **Step 6: `src/app/api/cron/clients/route.ts`**

```ts
// Nightly: create any SharePoint folders that failed at save time, then rebuild the
// Excel workbook. Same secret handshake as /api/cron/live/ingest.
import { NextRequest, NextResponse } from "next/server";
import { retryPendingFolders } from "@/lib/clients/storage";
import { rebuildClientWorkbook } from "@/lib/clients/workbook";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const folders = await retryPendingFolders();
  const workbook = await rebuildClientWorkbook();
  return NextResponse.json({ folders, workbook });
}
```

- [ ] **Step 7: Workflow and env docs**

Create `.github/workflows/clients-nightly.yml`:

```yaml
# Nightly (02:00 IST): retry pending client/job folders on SharePoint and rebuild
# Clients/_Database/Client Database.xlsx. Uses the same CRON_SECRET as ingest.
name: Clients nightly rebuild

on:
  schedule:
    - cron: "30 20 * * *"
  workflow_dispatch: {}

jobs:
  rebuild:
    runs-on: ubuntu-latest
    steps:
      - name: Call clients cron endpoint
        run: |
          if [ -z "${{ secrets.CRON_SECRET }}" ]; then
            echo "CRON_SECRET repo secret not set — skipping."
            exit 0
          fi
          curl -fsS --max-time 290 \
            "https://lms.indefine.in/api/cron/clients?key=${{ secrets.CRON_SECRET }}"
```

In `.env.example`, after the `GRAPH_VIDEOS_FOLDER_ID=""` line add:

```bash
# Client onboarding: top-level folder (single segment, directly under the drive root)
# that holds Clients/<Client>/… and Clients/_Database/Client Database.xlsx.
GRAPH_CLIENTS_ROOT="Clients"
```

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/api/clients src/app/api/cron/clients .github/workflows/clients-nightly.yml .env.example
git commit -m "Clients: document upload, service admin, workbook rebuild and nightly cron

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Reports library (flat rows, filters, grouping)

**Files:**
- Create: `src/lib/clients/reports.ts`
- Modify: `scripts/verify-clients.ts` (append grouping assertions)

**Interfaces:**
- Consumes: `istMonth` from workbook; label maps from core; `departmentLabel` from ca-firm.
- Produces: `JobRow`, `ReportFilters`, `parseFilters(sp)`, `filtersToQuery(f)`, `loadJobRows(f)`, `GROUP_KEYS`, `GroupKey`, `keyOf(row, key)`, `summarize(rows, now?)`, `groupRows(rows, key)`, `GroupRow`, `isDone(status)`.

- [ ] **Step 1: Append the failing check**

Add to the imports at the top of `scripts/verify-clients.ts`:

```ts
import { groupRows, keyOf, parseFilters, summarize, type JobRow } from "../src/lib/clients/reports";
```

Inside the async IIFE, after the workbook assertions and before its `console.log`, add (and change that log to `"verify-clients: core + workbook + reports OK"`):

```ts
// Reports — pure grouping.
const row = (o: Partial<JobRow>): JobRow => ({
  id: "j", clientId: "c1", client: "Alpha", entityType: "PVT_LTD", city: "Chennai", fy: "2026-27", month: "2026-09",
  department: "TAX", service: "ITR filing", serviceTypeId: "s1", handlerId: "u1", handler: "H One", status: "IN_PROGRESS",
  dueOn: null, fees: null, turnover: 1_000_000, turnoverBand: "UNDER_40L", growthGoal: "MAINTAIN", createdAt: new Date("2026-09-01T00:00:00Z"), ...o,
});
const rows = [
  row({ id: "a", clientId: "c1", turnover: 1_000_000 }),
  row({ id: "b", clientId: "c1", turnover: 1_000_000, service: "TDS returns", status: "CLOSED" }),
  row({ id: "c", clientId: "c2", client: "Beta", turnover: 5_000_000, handlerId: "u2", handler: "H Two", dueOn: new Date("2026-08-01T00:00:00Z") }),
];
const now = new Date("2026-09-02T00:00:00Z");
assert.deepEqual(summarize(rows, now), { clients: 2, jobs: 3, open: 2, overdue: 1, turnover: 6_000_000 }); // turnover counted once per client
assert.equal(keyOf(rows[0], "department"), "Tax");
assert.equal(keyOf(rows[0], "band"), "Under ₹40 L");
const byHandler = groupRows(rows, "handler");
assert.deepEqual(byHandler.map((g) => [g.key, g.jobs, g.clients, g.open, g.done, g.turnover]), [["H One", 2, 1, 1, 1, 1_000_000], ["H Two", 1, 1, 1, 0, 5_000_000]]);
const f = parseFilters({ fy: "2026-27", department: "TAX", band: "BOGUS", from: "2026-09-01", to: "2026-09-30", status: "CLOSED" });
assert.equal(f.fy, "2026-27");
assert.equal(f.department, "TAX");
assert.equal(f.band, undefined);
assert.equal(f.status, "CLOSED");
assert.equal(f.from?.toISOString(), "2026-08-31T18:30:00.000Z"); // 1 Sep 00:00 IST
assert.equal(f.to?.toISOString(), "2026-09-30T18:29:59.999Z"); // 30 Sep 23:59:59.999 IST
assert.equal(parseFilters({ fy: "nope" }).fy, undefined);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/verify-clients.ts`
Expected: `Cannot find module '../src/lib/clients/reports'`.

- [ ] **Step 3: Write reports.ts**

```ts
// Reports: one flat row per job, filtered in SQL, grouped in memory. A 16-person firm
// has a few thousand jobs at most — no aggregate queries needed.
import type { Department, EntityType, GrowthGoal, JobStatus, TurnoverBand } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS, departmentLabel } from "@/lib/ca-firm";
import { ENTITY_TYPES, GROWTH_GOALS, JOB_STATUSES, TURNOVER_BANDS, isValidFy } from "./core";
import { istMonth } from "./workbook";

export type JobRow = {
  id: string; clientId: string; client: string; entityType: EntityType; city: string | null; fy: string; month: string;
  department: Department; service: string; serviceTypeId: string; handlerId: string; handler: string; status: JobStatus;
  dueOn: Date | null; fees: number | null; turnover: number; turnoverBand: TurnoverBand; growthGoal: GrowthGoal; createdAt: Date;
};

export type ReportFilters = {
  fy?: string; from?: Date; to?: Date; department?: Department; service?: string; handler?: string;
  band?: TurnoverBand; goal?: GrowthGoal; status?: JobStatus;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

export function parseFilters(sp: Record<string, string | undefined>): ReportFilters {
  return {
    fy: sp.fy && isValidFy(sp.fy) ? sp.fy : undefined,
    from: sp.from && DAY.test(sp.from) ? new Date(`${sp.from}T00:00:00+05:30`) : undefined,
    to: sp.to && DAY.test(sp.to) ? new Date(`${sp.to}T23:59:59.999+05:30`) : undefined,
    department: pick(sp.department, DEPARTMENTS),
    service: sp.service || undefined,
    handler: sp.handler || undefined,
    band: pick(sp.band, Object.keys(TURNOVER_BANDS) as TurnoverBand[]),
    goal: pick(sp.goal, Object.keys(GROWTH_GOALS) as GrowthGoal[]),
    status: pick(sp.status, Object.keys(JOB_STATUSES) as JobStatus[]),
  };
}

// Back to a query string (for the export link and drill-down links).
export function filtersToQuery(sp: Record<string, string | undefined>, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const k of ["fy", "from", "to", "department", "service", "handler", "band", "goal", "status", "group"])
    if (sp[k]) q.set(k, sp[k]!);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

export async function loadJobRows(f: ReportFilters): Promise<JobRow[]> {
  const jobs = await prisma.job.findMany({
    where: {
      fy: f.fy,
      handlerId: f.handler,
      serviceTypeId: f.service,
      status: f.status,
      serviceType: f.department ? { department: f.department } : undefined,
      client: f.band || f.goal ? { turnoverBand: f.band, growthGoal: f.goal } : undefined,
      createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
    },
    include: {
      client: { select: { name: true, entityType: true, city: true, turnover: true, turnoverBand: true, growthGoal: true } },
      serviceType: { select: { department: true, name: true } },
      handler: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return jobs.map((j) => ({
    id: j.id, clientId: j.clientId, client: j.client.name, entityType: j.client.entityType, city: j.client.city, fy: j.fy,
    month: istMonth(j.createdAt), department: j.serviceType.department, service: j.serviceType.name, serviceTypeId: j.serviceTypeId,
    handlerId: j.handlerId, handler: j.handler.name ?? j.handler.email, status: j.status, dueOn: j.dueOn, fees: j.fees,
    turnover: j.client.turnover, turnoverBand: j.client.turnoverBand, growthGoal: j.client.growthGoal, createdAt: j.createdAt,
  }));
}

export const GROUP_KEYS = {
  fy: "Financial year", month: "Month", department: "Department", service: "Service", handler: "Handler",
  band: "Turnover band", goal: "Growth goal", entity: "Entity type", city: "City",
} as const;
export type GroupKey = keyof typeof GROUP_KEYS;

export function keyOf(r: JobRow, g: GroupKey): string {
  switch (g) {
    case "fy": return r.fy;
    case "month": return r.month;
    case "department": return departmentLabel(r.department);
    case "service": return r.service;
    case "handler": return r.handler;
    case "band": return TURNOVER_BANDS[r.turnoverBand];
    case "goal": return GROWTH_GOALS[r.growthGoal];
    case "entity": return ENTITY_TYPES[r.entityType];
    case "city": return r.city ?? "—";
  }
}

export const isDone = (s: JobStatus) => s === "DELIVERED" || s === "CLOSED";

// Turnover is a client attribute: count each client once however many jobs it has.
function clientTurnover(rows: JobRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.clientId, r.turnover);
  return m;
}
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export function summarize(rows: JobRow[], now = new Date()) {
  const clients = clientTurnover(rows);
  return {
    clients: clients.size,
    jobs: rows.length,
    open: rows.filter((r) => !isDone(r.status)).length,
    overdue: rows.filter((r) => !isDone(r.status) && r.dueOn && r.dueOn < now).length,
    turnover: sum(clients),
  };
}

export type GroupRow = { key: string; jobs: number; clients: number; open: number; done: number; turnover: number };

export function groupRows(rows: JobRow[], g: GroupKey): GroupRow[] {
  const groups = new Map<string, JobRow[]>();
  for (const r of rows) {
    const k = keyOf(r, g);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const clients = clientTurnover(rs);
      const done = rs.filter((r) => isDone(r.status)).length;
      return { key, jobs: rs.length, clients: clients.size, open: rs.length - done, done, turnover: sum(clients) };
    })
    .sort((a, b) => b.jobs - a.jobs || a.key.localeCompare(b.key));
}
```

- [ ] **Step 4: Run the self-check and typecheck**

Run: `npx tsx scripts/verify-clients.ts && npx tsc --noEmit`
Expected: `verify-clients: core + workbook + reports OK` (update the final `console.log` text), no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clients/reports.ts scripts/verify-clients.ts
git commit -m "Clients: report rows, filters and grouping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Pages — layout, client list, Tools card, nav link

**Files:**
- Create: `src/app/clients/layout.tsx`
- Create: `src/app/clients/page.tsx`
- Modify: `src/app/tools/page.tsx` (TOOLS array)
- Modify: `src/app/dashboard/page.tsx:309` (nav)

**Interfaces:**
- Consumes: `canViewClients`, `isClientsAdmin`, label maps, `fyOptions` from core; `listHandlers` from services; `DEPARTMENTS`, `departmentLabel` from ca-firm.

- [ ] **Step 1: `src/app/clients/layout.tsx`**

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { canViewClients, isClientsAdmin } from "@/lib/clients/core";

export const dynamic = "force-dynamic";

const link = "px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition";

export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canViewClients(session.user)) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/clients" className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[-0.02em]">indefine</p>
              <p className="text-[10px] text-ink-faint uppercase tracking-[0.16em] font-extrabold">Clients</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/clients" className={link}>All clients</Link>
            <Link href="/clients/new" className={link}>Onboard</Link>
            <Link href="/clients/reports" className={link}>Reports</Link>
            {isClientsAdmin(session.user) && <Link href="/clients/admin/services" className={link}>Services</Link>}
            <Link href="/dashboard" className={`${link} flex items-center gap-2`}><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-[1180px] mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: `src/app/clients/page.tsx`**

```tsx
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS, departmentLabel } from "@/lib/ca-firm";
import { ENTITY_TYPES, JOB_STATUSES, TURNOVER_BANDS, fyOptions, keysOf } from "@/lib/clients/core";
import { listHandlers } from "@/lib/clients/services";
import { isDone } from "@/lib/clients/reports";
import { Plus, Users } from "lucide-react";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]";
const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function ClientsList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const handlers = await listHandlers();

  const jobWhere: Prisma.JobWhereInput = {};
  if (sp.fy) jobWhere.fy = sp.fy;
  if (sp.handler) jobWhere.handlerId = sp.handler;
  if (sp.status && sp.status in JOB_STATUSES) jobWhere.status = sp.status as keyof typeof JOB_STATUSES;
  if (sp.department && (DEPARTMENTS as string[]).includes(sp.department)) jobWhere.serviceType = { department: sp.department as (typeof DEPARTMENTS)[number] };

  const where: Prisma.ClientWhereInput = {};
  if (sp.q) where.OR = [{ name: { contains: sp.q, mode: "insensitive" } }, { pan: { contains: sp.q.toUpperCase() } }];
  if (sp.band && sp.band in TURNOVER_BANDS) where.turnoverBand = sp.band as keyof typeof TURNOVER_BANDS;
  if (Object.keys(jobWhere).length) where.jobs = { some: jobWhere };

  const clients = await prisma.client.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: { primaryHandler: { select: { name: true, email: true } }, jobs: { select: { status: true, updatedAt: true } } },
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Clients</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">Client database</h1>
          <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">Every client the firm handles, with their jobs and documents on SharePoint.</p>
        </div>
        <Link href="/clients/new" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop transition">
          <Plus className="w-4 h-4" /> Onboard client
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3 mb-6 bg-card border border-border rounded-2xl p-4 shadow-lift">
        <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-[11px] font-bold text-ink-mute">Name or PAN</span>
          <input name="q" defaultValue={sp.q ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">FY</span>
          <select name="fy" defaultValue={sp.fy ?? ""} className={field}><option value="">Any</option>{fyOptions().map((f) => <option key={f}>{f}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Department</span>
          <select name="department" defaultValue={sp.department ?? ""} className={field}><option value="">Any</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Handler</span>
          <select name="handler" defaultValue={sp.handler ?? ""} className={field}><option value="">Any</option>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Job status</span>
          <select name="status" defaultValue={sp.status ?? ""} className={field}><option value="">Any</option>{keysOf(JOB_STATUSES).map((s) => <option key={s} value={s}>{JOB_STATUSES[s]}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Turnover</span>
          <select name="band" defaultValue={sp.band ?? ""} className={field}><option value="">Any</option>{keysOf(TURNOVER_BANDS).map((b) => <option key={b} value={b}>{TURNOVER_BANDS[b]}</option>)}</select>
        </label>
        <button type="submit" className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition">Filter</button>
        <Link href="/clients" className="px-3 py-2 rounded-lg text-[13px] font-semibold text-ink-mute hover:bg-muted transition">Clear</Link>
      </form>

      {clients.length === 0 ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <Users className="w-8 h-8 mx-auto text-ink-faint mb-2" />
          <p className="font-semibold">No clients match</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card border border-border shadow-lift">
          <table className="w-full text-[13.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left">
              <tr><th className="px-4 py-3">Client</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">City</th><th className="px-4 py-3">Handler</th><th className="px-4 py-3">Turnover</th><th className="px-4 py-3">Open jobs</th><th className="px-4 py-3">Last activity</th></tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const open = c.jobs.filter((j) => !isDone(j.status)).length;
                const last = [c.updatedAt, ...c.jobs.map((j) => j.updatedAt)].reduce((a, b) => (b > a ? b : a));
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-4 py-3 font-semibold"><Link href={`/clients/${c.id}`} className="hover:text-brand-600">{c.name}</Link>{!c.active && <span className="ml-2 text-[10.5px] uppercase text-ink-faint">inactive</span>}</td>
                    <td className="px-4 py-3">{ENTITY_TYPES[c.entityType]}</td>
                    <td className="px-4 py-3">{c.city ?? "—"}</td>
                    <td className="px-4 py-3">{c.primaryHandler.name ?? c.primaryHandler.email}</td>
                    <td className="px-4 py-3">{TURNOVER_BANDS[c.turnoverBand]}</td>
                    <td className="px-4 py-3">{open} / {c.jobs.length}</td>
                    <td className="px-4 py-3 text-ink-mute">{fmt(last)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Tools card and dashboard nav**

In `src/app/tools/page.tsx`, add `Users` to the lucide import and append to the `TOOLS` array:

```ts
  {
    href: "/clients",
    title: "Client onboarding",
    tag: "Clients · Jobs · Documents",
    blurb:
      "Onboard a client, file their documents into SharePoint under the client's folder, track jobs by FY and handler, and report on the client base.",
    icon: Users,
    accent: "#0ea5e9",
  },
```

In `src/app/dashboard/page.tsx`, after the `Tools` nav `<Link>` (line ~309) add:

```tsx
          <Link href="/clients" className="px-4 py-2 rounded-full text-ink-mute font-semibold text-[13.5px] hover:text-ink transition">Clients</Link>
```

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/clients/layout.tsx src/app/clients/page.tsx src/app/tools/page.tsx src/app/dashboard/page.tsx
git commit -m "Clients: layout, client list, Tools card and nav link

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Onboarding form

**Files:**
- Create: `src/app/clients/ClientFields.tsx` (shared client-detail fields, used again in Task 10)
- Create: `src/app/clients/new/OnboardForm.tsx`
- Create: `src/app/clients/new/page.tsx`

**Interfaces:**
- Produces: `ClientFields({ value, onChange, handlers })`, `emptyClient(defaults)`, `type ClientFormValue` (all strings, matches `clientBodyZ` input).
- Consumes API from Task 5/6: `POST /api/clients`, `POST /api/clients/[id]/documents`.

- [ ] **Step 1: `src/app/clients/ClientFields.tsx`**

```tsx
"use client";

import { ENTITY_TYPES, GROWTH_GOALS, keysOf } from "@/lib/clients/core";
import type { Handler } from "@/lib/clients/services";

export type ClientFormValue = {
  name: string; entityType: string; pan: string; gstin: string; cin: string; industry: string; city: string;
  contactName: string; contactPhone: string; contactEmail: string; referralSource: string; turnover: string;
  growthGoal: string; growthNote: string; onboardedOn: string; primaryHandlerId: string;
};

export function emptyClient(d: Partial<ClientFormValue> = {}): ClientFormValue {
  return {
    name: "", entityType: "PVT_LTD", pan: "", gstin: "", cin: "", industry: "", city: "", contactName: "", contactPhone: "",
    contactEmail: "", referralSource: "", turnover: "", growthGoal: "MAINTAIN", growthNote: "",
    onboardedOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), primaryHandlerId: "", ...d,
  };
}

export const field = "w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[13.5px]";
export const label = "text-[11px] font-bold text-ink-mute";

export function ClientFields({ value, onChange, handlers }: { value: ClientFormValue; onChange: (v: ClientFormValue) => void; handlers: Handler[] }) {
  const set = (k: keyof ClientFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <label className="flex flex-col gap-1 sm:col-span-2"><span className={label}>Client name *</span><input required value={value.name} onChange={set("name")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Entity type *</span>
        <select value={value.entityType} onChange={set("entityType")} className={field}>{keysOf(ENTITY_TYPES).map((k) => <option key={k} value={k}>{ENTITY_TYPES[k]}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1"><span className={label}>Primary handler *</span>
        <select required value={value.primaryHandlerId} onChange={set("primaryHandlerId")} className={field}><option value="">Select…</option>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1"><span className={label}>PAN</span><input value={value.pan} onChange={set("pan")} placeholder="AAAAA9999A" className={`${field} uppercase`} /></label>
      <label className="flex flex-col gap-1"><span className={label}>GSTIN</span><input value={value.gstin} onChange={set("gstin")} className={`${field} uppercase`} /></label>
      <label className="flex flex-col gap-1"><span className={label}>CIN / LLPIN</span><input value={value.cin} onChange={set("cin")} className={`${field} uppercase`} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Industry</span><input value={value.industry} onChange={set("industry")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>City</span><input value={value.city} onChange={set("city")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Referral source</span><input value={value.referralSource} onChange={set("referralSource")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Contact person</span><input value={value.contactName} onChange={set("contactName")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Contact phone</span><input value={value.contactPhone} onChange={set("contactPhone")} inputMode="numeric" placeholder="10 digits" className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Contact email</span><input type="email" value={value.contactEmail} onChange={set("contactEmail")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Annual turnover (₹) *</span><input required type="number" min={0} step={1} value={value.turnover} onChange={set("turnover")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Onboarded on *</span><input required type="date" value={value.onboardedOn} onChange={set("onboardedOn")} className={field} /></label>
      <label className="flex flex-col gap-1"><span className={label}>Growth goal *</span>
        <select value={value.growthGoal} onChange={set("growthGoal")} className={field}>{keysOf(GROWTH_GOALS).map((k) => <option key={k} value={k}>{GROWTH_GOALS[k]}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2"><span className={label}>Growth note</span><textarea rows={2} value={value.growthNote} onChange={set("growthNote")} className={field} /></label>
    </div>
  );
}
```

- [ ] **Step 2: `src/app/clients/new/OnboardForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Upload, X } from "lucide-react";
import type { ServiceType } from "@prisma/client";
import { departmentLabel } from "@/lib/ca-firm";
import { KYC_DOC_TYPES } from "@/lib/clients/core";
import type { Handler } from "@/lib/clients/services";
import { ClientFields, emptyClient, field, label, type ClientFormValue } from "../ClientFields";

type Props = { services: ServiceType[]; handlers: Handler[]; fys: string[]; meId: string };
type Pending = { file: File; docType: string };

export function OnboardForm({ services, handlers, fys, meId }: Props) {
  const router = useRouter();
  const [client, setClient] = useState<ClientFormValue>(() => emptyClient({ primaryHandlerId: meId }));
  const [job, setJob] = useState({ department: services[0]?.department ?? "TAX", serviceTypeId: services[0]?.id ?? "", fy: fys[0], handlerId: meId, dueOn: "", fees: "" });
  const [docType, setDocType] = useState<string>("PAN");
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; existingId?: string } | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const deptServices = services.filter((s) => s.department === job.department);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list).map((file) => ({ file, docType }))]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUploadErrors([]);
    setBusy("Saving client…");
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client, job: { serviceTypeId: job.serviceTypeId, fy: job.fy, handlerId: job.handlerId, dueOn: job.dueOn, fees: job.fees } }),
      });
      const data = await res.json();
      if (!res.ok) { setError({ text: data.error || "Could not save", existingId: data.existingId }); return; }

      // Upload KYC files one doc type at a time; a failed file never blocks the others.
      const byType = new Map<string, File[]>();
      for (const p of files) byType.set(p.docType, [...(byType.get(p.docType) ?? []), p.file]);
      const failed: string[] = [];
      for (const [type, fs] of byType) {
        setBusy(`Uploading ${fs.length} file(s)…`);
        const fd = new FormData();
        fd.set("docType", type);
        for (const f of fs) fd.append("files", f);
        const up = await fetch(`/api/clients/${data.id}/documents`, { method: "POST", body: fd });
        const r = await up.json().catch(() => ({ failed: fs.map((f) => ({ name: f.name, error: "Upload failed" })) }));
        for (const f of r.failed ?? []) failed.push(`${f.name}: ${f.error}`);
      }
      if (failed.length) {
        setUploadErrors(failed);
        setBusy(null);
        setError({ text: "Client saved, but some files did not upload. Retry them from the client page.", existingId: data.id });
        return;
      }
      router.push(`/clients/${data.id}`);
    } catch (err) {
      setError({ text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 max-w-3xl">
      <section className="rounded-2xl bg-card border border-border shadow-lift p-5">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-4">Client</h2>
        <ClientFields value={client} onChange={setClient} handlers={handlers} />
      </section>

      <section className="rounded-2xl bg-card border border-border shadow-lift p-5">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-4">First job</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1"><span className={label}>Department *</span>
            <select value={job.department} onChange={(e) => { const d = e.target.value as ServiceType["department"]; const first = services.find((s) => s.department === d); setJob({ ...job, department: d, serviceTypeId: first?.id ?? "" }); }} className={field}>
              {[...new Set(services.map((s) => s.department))].map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className={label}>Service *</span>
            <select required value={job.serviceTypeId} onChange={(e) => setJob({ ...job, serviceTypeId: e.target.value })} className={field}>
              {deptServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className={label}>Financial year *</span>
            <select value={job.fy} onChange={(e) => setJob({ ...job, fy: e.target.value })} className={field}>{fys.map((f) => <option key={f}>{f}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1"><span className={label}>Job handler *</span>
            <select required value={job.handlerId} onChange={(e) => setJob({ ...job, handlerId: e.target.value })} className={field}><option value="">Select…</option>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1"><span className={label}>Due date</span><input type="date" value={job.dueOn} onChange={(e) => setJob({ ...job, dueOn: e.target.value })} className={field} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Fees (₹)</span><input type="number" min={0} value={job.fees} onChange={(e) => setJob({ ...job, fees: e.target.value })} className={field} /></label>
        </div>
      </section>

      <section className="rounded-2xl bg-card border border-border shadow-lift p-5">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-1">KYC documents</h2>
        <p className="text-[12.5px] text-ink-mute mb-3">Saved to SharePoint under Clients / {client.name || "<client>"} / KYC. Pick a type, then attach files of that type. Up to 50 MB each.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]">
            {Object.entries(KYC_DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-[13px] font-semibold cursor-pointer hover:bg-muted">
            <Upload className="w-4 h-4" /> Attach files
            <input type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {files.length > 0 && (
          <ul className="mt-3 divide-y divide-border text-[13px]">
            {files.map((p, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-3">
                <span><span className="font-semibold">{KYC_DOC_TYPES[p.docType as keyof typeof KYC_DOC_TYPES]}</span> · {p.file.name} <span className="text-ink-faint">({Math.ceil(p.file.size / 1024)} KB)</span></span>
                <button type="button" onClick={() => setFiles((f) => f.filter((_, j) => j !== i))} className="text-ink-faint hover:text-rose-600"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-[13px]">
          {error.text}{" "}
          {error.existingId && <Link href={`/clients/${error.existingId}`} className="underline font-semibold">Open client</Link>}
          {uploadErrors.length > 0 && <ul className="mt-1 list-disc pl-5">{uploadErrors.map((u) => <li key={u}>{u}</li>)}</ul>}
        </div>
      )}

      <button type="submit" disabled={!!busy} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-sm font-bold shadow-pop transition">
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {busy}</> : "Onboard client"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: `src/app/clients/new/page.tsx`**

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fyOptions } from "@/lib/clients/core";
import { listHandlers, listServiceTypes } from "@/lib/clients/services";
import { OnboardForm } from "./OnboardForm";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const [services, handlers] = await Promise.all([listServiceTypes(), listHandlers()]);
  return (
    <div>
      <div className="mb-6">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Clients · Onboard</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">New client</h1>
        <p className="text-ink-mute text-[15px] mt-1.5">Client details, the first job, and KYC documents. Folders are created on SharePoint automatically.</p>
      </div>
      <OnboardForm services={services} handlers={handlers} fys={fyOptions()} meId={session.user.id} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors. (`ServiceType` is imported as a type from `@prisma/client` in a client component; that is type-only and fine.)

```bash
git add src/app/clients/ClientFields.tsx src/app/clients/new
git commit -m "Clients: onboarding form with first job and KYC uploads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Client detail page (jobs, documents, edit, folder retry)

**Files:**
- Create: `src/app/api/clients/[id]/folders/route.ts` (retry pending folders for one client)
- Create: `src/app/clients/[id]/ClientPanels.tsx`
- Create: `src/app/clients/[id]/EditClient.tsx`
- Create: `src/app/clients/[id]/page.tsx`

**Interfaces:**
- `POST /api/clients/[id]/folders` → `200 { client: FolderStatus, jobsPending: number }`.
- `ClientPanels` props: `{ client, jobs, documents, services, handlers, fys, canManage, meId }` (shapes defined in the page).
- `EditClient` props: `{ client: ClientFormValue & { id: string; active: boolean }, handlers }`.

- [ ] **Step 1: `src/app/api/clients/[id]/folders/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients } from "@/lib/clients/core";
import { ensureClientFolder, ensureJobFolder } from "@/lib/clients/storage";

export const maxDuration = 60;

// "Retry" on the SharePoint banner: create whatever folders are still missing.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });
  const { id } = await params;
  await ensureClientFolder(id, session.user.id);
  const jobs = await prisma.job.findMany({ where: { clientId: id, graphFolderId: null }, select: { id: true } });
  let pending = 0;
  for (const j of jobs) if (!(await ensureJobFolder(j.id, session.user.id))) pending++;
  const client = await prisma.client.findUnique({ where: { id }, select: { folderStatus: true } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ client: client.folderStatus, jobsPending: pending });
}
```

- [ ] **Step 2: `src/app/clients/[id]/EditClient.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import type { Handler } from "@/lib/clients/services";
import { ClientFields, type ClientFormValue } from "../ClientFields";

export function EditClient({ client, handlers }: { client: ClientFormValue & { id: string; active: boolean }; handlers: Handler[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<ClientFormValue>(client);
  const [active, setActive] = useState(client.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/clients/${client.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...value, active }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error || "Could not save"); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm font-semibold hover:bg-muted"><Pencil className="w-4 h-4" /> Edit</button>;

  return (
    <form onSubmit={save} className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-6">
      <ClientFields value={value} onChange={setValue} handlers={handlers} />
      <label className="mt-4 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active client</label>
      {error && <p className="text-[12.5px] text-rose-600 mt-2">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-[13px] font-bold">{busy && <Loader2 className="w-4 h-4 animate-spin" />} Save</button>
        <button type="button" onClick={() => { setOpen(false); setValue(client); }} className="px-4 py-2 rounded-lg text-[13px] font-semibold text-ink-mute hover:bg-muted">Cancel</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: `src/app/clients/[id]/ClientPanels.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import type { ClientDocType, JobStatus, ServiceType } from "@prisma/client";
import { departmentLabel } from "@/lib/ca-firm";
import { DOC_TYPES, JOB_DOC_TYPES, JOB_STATUSES, KYC_DOC_TYPES, keysOf } from "@/lib/clients/core";
import type { Handler } from "@/lib/clients/services";

export type JobView = { id: string; fy: string; department: ServiceType["department"]; service: string; handlerId: string; status: JobStatus; dueOn: string; fees: string; notes: string; folderStatus: string; docCount: number };
export type DocView = { id: string; jobId: string | null; docType: ClientDocType; name: string; webUrl: string; uploadedBy: string; createdAt: string };

type Props = {
  clientId: string; folderStatus: string; jobs: JobView[]; documents: DocView[]; services: ServiceType[]; handlers: Handler[];
  fys: string[]; canManage: boolean; meId: string;
};

const field = "rounded-lg border border-border bg-page/60 px-2.5 py-1.5 text-[13px]";
const card = "rounded-2xl bg-card border border-border shadow-lift p-5";
const h2 = "text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3";

async function call(url: string, init: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}
const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function ClientPanels({ clientId, folderStatus, jobs, documents, services, handlers, fys, canManage, meId }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ ok: boolean; data: Record<string, unknown> }>) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(String(r.data.error ?? "Failed"));
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // --- add job ---
  const [nj, setNj] = useState({ department: services[0]?.department ?? "TAX", serviceTypeId: services[0]?.id ?? "", fy: fys[0], handlerId: meId, dueOn: "", fees: "" });
  const deptServices = services.filter((s) => s.department === nj.department);

  // --- upload ---
  const [target, setTarget] = useState<string>("KYC"); // "KYC" or a job id
  const [docType, setDocType] = useState<string>("PAN");
  const [uploadReport, setUploadReport] = useState<string[]>([]);
  const typeOptions = target === "KYC" ? KYC_DOC_TYPES : JOB_DOC_TYPES;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    fd.set("docType", docType);
    if (target !== "KYC") fd.set("jobId", target);
    for (const f of Array.from(files)) fd.append("files", f);
    setUploadReport([]);
    await run("upload", async () => {
      const r = await call(`/api/clients/${clientId}/documents`, { method: "POST", body: fd });
      const failed = (r.data.failed as Array<{ name: string; error: string }> | undefined) ?? [];
      setUploadReport(failed.map((f) => `${f.name}: ${f.error}`));
      return { ok: r.ok, data: { error: "None of the files uploaded — see the list below" } };
    });
  }

  const pendingJobs = jobs.filter((j) => j.folderStatus !== "READY").length;
  const kycDocs = documents.filter((d) => !d.jobId);

  return (
    <div className="space-y-6">
      {(folderStatus !== "READY" || pendingJobs > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-[13px] flex items-center justify-between gap-3">
          <span>SharePoint folders not created yet ({folderStatus !== "READY" ? "client" : ""}{folderStatus !== "READY" && pendingJobs ? " + " : ""}{pendingJobs ? `${pendingJobs} job(s)` : ""}). Uploads will fail until this is fixed.</span>
          <button onClick={() => run("folders", () => call(`/api/clients/${clientId}/folders`, { method: "POST" }))} disabled={!!busy} className="inline-flex items-center gap-1.5 font-bold"><RefreshCw className={`w-4 h-4 ${busy === "folders" ? "animate-spin" : ""}`} /> Retry</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-[13px]">{error}</div>}

      <section className={card}>
        <h2 className={h2}>Jobs ({jobs.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left">
              <tr><th className="py-2 pr-3">FY</th><th className="py-2 pr-3">Department</th><th className="py-2 pr-3">Service</th><th className="py-2 pr-3">Handler</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Due</th><th className="py-2 pr-3">Notes</th><th className="py-2 pr-3">Docs</th><th /></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-border">
                  <td className="py-2 pr-3 font-semibold">{j.fy}</td>
                  <td className="py-2 pr-3">{departmentLabel(j.department)}</td>
                  <td className="py-2 pr-3">{j.service}</td>
                  <td className="py-2 pr-3"><select value={j.handlerId} onChange={(e) => run(j.id, () => call(`/api/clients/jobs/${j.id}`, json({ handlerId: e.target.value }, "PATCH")))} className={field}>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></td>
                  <td className="py-2 pr-3"><select value={j.status} onChange={(e) => run(j.id, () => call(`/api/clients/jobs/${j.id}`, json({ status: e.target.value }, "PATCH")))} className={field}>{keysOf(JOB_STATUSES).map((s) => <option key={s} value={s}>{JOB_STATUSES[s]}</option>)}</select></td>
                  <td className="py-2 pr-3"><input type="date" defaultValue={j.dueOn} onBlur={(e) => { if (e.target.value !== j.dueOn) run(j.id, () => call(`/api/clients/jobs/${j.id}`, json({ dueOn: e.target.value }, "PATCH"))); }} className={field} /></td>
                  <td className="py-2 pr-3"><input defaultValue={j.notes} placeholder="Notes" onBlur={(e) => { if (e.target.value !== j.notes) run(j.id, () => call(`/api/clients/jobs/${j.id}`, json({ notes: e.target.value }, "PATCH"))); }} className={`${field} w-40`} /></td>
                  <td className="py-2 pr-3">{j.docCount}</td>
                  <td className="py-2 text-right">{canManage && j.docCount === 0 && <button title="Remove job" onClick={() => { if (confirm("Remove this job record?")) run(j.id, () => call(`/api/clients/jobs/${j.id}`, { method: "DELETE" })); }} className="text-ink-faint hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run("newjob", () => call(`/api/clients/${clientId}/jobs`, json({ serviceTypeId: nj.serviceTypeId, fy: nj.fy, handlerId: nj.handlerId, dueOn: nj.dueOn, fees: nj.fees }))); }}>
          <select value={nj.department} onChange={(e) => { const d = e.target.value as ServiceType["department"]; setNj({ ...nj, department: d, serviceTypeId: services.find((s) => s.department === d)?.id ?? "" }); }} className={field}>{[...new Set(services.map((s) => s.department))].map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}</select>
          <select value={nj.serviceTypeId} onChange={(e) => setNj({ ...nj, serviceTypeId: e.target.value })} className={field}>{deptServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={nj.fy} onChange={(e) => setNj({ ...nj, fy: e.target.value })} className={field}>{fys.map((f) => <option key={f}>{f}</option>)}</select>
          <select value={nj.handlerId} onChange={(e) => setNj({ ...nj, handlerId: e.target.value })} className={field}>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          <input type="date" value={nj.dueOn} onChange={(e) => setNj({ ...nj, dueOn: e.target.value })} className={field} title="Due date" />
          <input type="number" min={0} placeholder="Fees ₹" value={nj.fees} onChange={(e) => setNj({ ...nj, fees: e.target.value })} className={`${field} w-28`} />
          <button type="submit" disabled={!!busy || !nj.serviceTypeId} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-[13px] font-bold">{busy === "newjob" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add job</button>
        </form>
      </section>

      <section className={card}>
        <h2 className={h2}>Documents ({documents.length})</h2>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select value={target} onChange={(e) => { setTarget(e.target.value); setDocType(e.target.value === "KYC" ? "PAN" : "SOURCE_DATA"); }} className={field}>
            <option value="KYC">KYC (client-level)</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.fy} · {j.service}</option>)}
          </select>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={field}>{Object.entries(typeOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg border border-border bg-card text-[13px] font-semibold cursor-pointer hover:bg-muted">
            {busy === "upload" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload files
            <input type="file" multiple className="hidden" disabled={!!busy} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {uploadReport.length > 0 && <ul className="mb-3 text-[12.5px] text-rose-600 list-disc pl-5">{uploadReport.map((u) => <li key={u}>{u}</li>)}</ul>}

        <DocGroup title="KYC" docs={kycDocs} canManage={canManage} onDelete={(id) => run(id, () => call(`/api/clients/documents/${id}`, { method: "DELETE" }))} />
        {jobs.map((j) => (
          <DocGroup key={j.id} title={`${j.fy} · ${departmentLabel(j.department)} · ${j.service}`} docs={documents.filter((d) => d.jobId === j.id)} canManage={canManage} onDelete={(id) => run(id, () => call(`/api/clients/documents/${id}`, { method: "DELETE" }))} />
        ))}
      </section>
    </div>
  );
}

function DocGroup({ title, docs, canManage, onDelete }: { title: string; docs: DocView[]; canManage: boolean; onDelete: (id: string) => void }) {
  if (docs.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="text-[12px] font-bold text-ink-mute mb-1">{title}</div>
      <ul className="divide-y divide-border text-[13px]">
        {docs.map((d) => (
          <li key={d.id} className="py-2 flex items-center justify-between gap-3">
            <span><span className="font-semibold">{DOC_TYPES[d.docType]}</span> · {d.name} <span className="text-ink-faint">· {d.uploadedBy} · {d.createdAt}</span></span>
            <span className="flex items-center gap-3">
              <a href={d.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 font-semibold"><ExternalLink className="w-4 h-4" /> Open</a>
              {canManage && <button title="Unlink record (file stays on SharePoint)" onClick={() => { if (confirm("Remove this document record? The file stays on SharePoint.")) onDelete(d.id); }} className="text-ink-faint hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: `src/app/clients/[id]/page.tsx`**

```tsx
import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ENTITY_TYPES, GROWTH_GOALS, TURNOVER_BANDS, canManageClients, fyOptions } from "@/lib/clients/core";
import { listHandlers, listServiceTypes } from "@/lib/clients/services";
import { ClientPanels } from "./ClientPanels";
import { EditClient } from "./EditClient";

export const dynamic = "force-dynamic";

const ist = (d: Date | null) => (d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "");
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      primaryHandler: { select: { name: true, email: true } },
      jobs: { orderBy: [{ fy: "desc" }, { createdAt: "desc" }], include: { serviceType: true, _count: { select: { documents: true } } } },
      documents: { orderBy: { createdAt: "desc" }, include: { uploadedBy: { select: { name: true, email: true } } } },
    },
  });
  if (!client) notFound();
  const [services, handlers] = await Promise.all([listServiceTypes(), listHandlers()]);
  const canManage = canManageClients(session.user);

  const facts: Array<[string, string]> = [
    ["Entity", ENTITY_TYPES[client.entityType]], ["PAN", client.pan ?? "—"], ["GSTIN", client.gstin ?? "—"], ["CIN", client.cin ?? "—"],
    ["Industry", client.industry ?? "—"], ["City", client.city ?? "—"], ["Contact", [client.contactName, client.contactPhone, client.contactEmail].filter(Boolean).join(" · ") || "—"],
    ["Referral", client.referralSource ?? "—"], ["Turnover", `${inr(client.turnover)} (${TURNOVER_BANDS[client.turnoverBand]})`],
    ["Growth goal", `${GROWTH_GOALS[client.growthGoal]}${client.growthNote ? ` — ${client.growthNote}` : ""}`],
    ["Onboarded", ist(client.onboardedOn)], ["Primary handler", client.primaryHandler.name ?? client.primaryHandler.email],
  ];

  return (
    <div>
      <Link href="/clients" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4"><ArrowLeft className="w-4 h-4" /> All clients</Link>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Client{!client.active && " · inactive"}</p>
          <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">{client.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {client.graphFolderId && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-mute"><FolderOpen className="w-4 h-4" /> SharePoint: Clients / {client.folderName}</span>
          )}
          {canManage && (
            <EditClient
              handlers={handlers}
              client={{
                id: client.id, active: client.active, name: client.name, entityType: client.entityType, pan: client.pan ?? "", gstin: client.gstin ?? "",
                cin: client.cin ?? "", industry: client.industry ?? "", city: client.city ?? "", contactName: client.contactName ?? "",
                contactPhone: client.contactPhone ?? "", contactEmail: client.contactEmail ?? "", referralSource: client.referralSource ?? "",
                turnover: String(client.turnover), growthGoal: client.growthGoal, growthNote: client.growthNote ?? "",
                onboardedOn: ist(client.onboardedOn), primaryHandlerId: client.primaryHandlerId,
              }}
            />
          )}
        </div>
      </div>

      <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-3 rounded-2xl bg-card border border-border shadow-lift p-5 mb-6 text-[13.5px]">
        {facts.map(([k, v]) => <div key={k}><dt className="text-[11px] font-bold text-ink-faint uppercase tracking-wide">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}
      </dl>

      <ClientPanels
        clientId={client.id}
        folderStatus={client.folderStatus}
        jobs={client.jobs.map((j) => ({ id: j.id, fy: j.fy, department: j.serviceType.department, service: j.serviceType.name, handlerId: j.handlerId, status: j.status, dueOn: ist(j.dueOn), fees: j.fees?.toString() ?? "", notes: j.notes ?? "", folderStatus: j.folderStatus, docCount: j._count.documents }))}
        documents={client.documents.map((d) => ({ id: d.id, jobId: d.jobId, docType: d.docType, name: d.name, webUrl: d.webUrl, uploadedBy: d.uploadedBy.name ?? d.uploadedBy.email, createdAt: ist(d.createdAt) }))}
        services={services}
        handlers={handlers}
        fys={fyOptions()}
        canManage={canManage}
        meId={session.user.id}
      />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/api/clients/[id]/folders src/app/clients/[id]
git commit -m "Clients: client page with jobs, documents, edit and folder retry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Reports page and Excel export

**Files:**
- Create: `src/app/api/clients/reports/export/route.ts`
- Create: `src/app/clients/reports/RebuildButton.tsx`
- Create: `src/app/clients/reports/page.tsx`

**Interfaces:**
- `GET /api/clients/reports/export?<filters>` → `.xlsx` of the filtered job rows.
- Consumes: `parseFilters`, `filtersToQuery`, `loadJobRows`, `groupRows`, `summarize`, `keyOf`, `GROUP_KEYS` from reports; `addSheet`, `workbookBytes` from `@/lib/office-tools/xlsx`.

- [ ] **Step 1: `src/app/api/clients/reports/export/route.ts`**

```ts
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { departmentLabel } from "@/lib/ca-firm";
import { canViewClients, ENTITY_TYPES, GROWTH_GOALS, JOB_STATUSES, TURNOVER_BANDS } from "@/lib/clients/core";
import { loadJobRows, parseFilters } from "@/lib/clients/reports";
import { istDate } from "@/lib/clients/workbook";
import { addSheet, workbookBytes } from "@/lib/office-tools/xlsx";

export const runtime = "nodejs";

// Download the currently filtered job list as Excel.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await loadJobRows(parseFilters(sp));
  const columns = ["Client", "FY", "Month", "Department", "Service", "Handler", "Status", "Due on", "Fees (₹)", "Turnover (₹)", "Turnover band", "Growth goal", "Entity type", "City", "Created on"];
  const wb = new ExcelJS.Workbook();
  addSheet(wb, "Jobs", columns, rows.map((r) => ({
    Client: r.client, FY: r.fy, Month: r.month, Department: departmentLabel(r.department), Service: r.service, Handler: r.handler,
    Status: JOB_STATUSES[r.status], "Due on": r.dueOn ? istDate(r.dueOn) : "", "Fees (₹)": r.fees ?? "", "Turnover (₹)": r.turnover,
    "Turnover band": TURNOVER_BANDS[r.turnoverBand], "Growth goal": GROWTH_GOALS[r.growthGoal], "Entity type": ENTITY_TYPES[r.entityType],
    City: r.city ?? "", "Created on": istDate(r.createdAt),
  })));
  return new NextResponse(new Uint8Array(await workbookBytes(wb)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="client-jobs-${istDate(new Date())}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: `src/app/clients/reports/RebuildButton.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

export function RebuildButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function rebuild() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/clients/workbook", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? "Workbook rebuilt on SharePoint." : `Rebuild failed: ${data.error ?? res.status}`);
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={rebuild} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-60">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Rebuild database workbook
      </button>
      {msg && <span className="text-[12.5px] text-ink-mute">{msg}</span>}
    </span>
  );
}
```

- [ ] **Step 3: `src/app/clients/reports/page.tsx`**

```tsx
import Link from "next/link";
import { Download } from "lucide-react";
import { DEPARTMENTS, departmentLabel } from "@/lib/ca-firm";
import { GROWTH_GOALS, JOB_STATUSES, TURNOVER_BANDS, fyOptions, keysOf } from "@/lib/clients/core";
import { listHandlers, listServiceTypes } from "@/lib/clients/services";
import { GROUP_KEYS, filtersToQuery, groupRows, keyOf, loadJobRows, parseFilters, summarize, type GroupKey } from "@/lib/clients/reports";
import { RebuildButton } from "./RebuildButton";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]";
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const ist = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const group: GroupKey = sp.group && sp.group in GROUP_KEYS ? (sp.group as GroupKey) : "fy";
  const [rows, services, handlers] = await Promise.all([loadJobRows(parseFilters(sp)), listServiceTypes(true), listHandlers()]);
  const totals = summarize(rows);
  const groups = groupRows(rows, group);
  const drill = sp.drill ? rows.filter((r) => keyOf(r, group) === sp.drill) : null;

  const Sel = ({ name, label, children }: { name: string; label: string; children: React.ReactNode }) => (
    <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">{label}</span><select name={name} defaultValue={sp[name] ?? ""} className={field}><option value="">Any</option>{children}</select></label>
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Clients · Reports</p>
          <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">Client base</h1>
          <p className="text-ink-mute text-[15px] mt-1.5">Filter jobs, then group by year, month, department, service, handler, turnover band or growth goal.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href={`/api/clients/reports/export?${filtersToQuery(sp)}`} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold shadow-pop"><Download className="w-4 h-4" /> Download Excel</a>
          <RebuildButton />
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 mb-6 bg-card border border-border rounded-2xl p-4 shadow-lift">
        <Sel name="fy" label="FY">{fyOptions().map((f) => <option key={f}>{f}</option>)}</Sel>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Created from</span><input type="date" name="from" defaultValue={sp.from ?? ""} className={field} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">to</span><input type="date" name="to" defaultValue={sp.to ?? ""} className={field} /></label>
        <Sel name="department" label="Department">{DEPARTMENTS.map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}</Sel>
        <Sel name="service" label="Service">{services.map((s) => <option key={s.id} value={s.id}>{departmentLabel(s.department)} · {s.name}</option>)}</Sel>
        <Sel name="handler" label="Handler">{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Sel>
        <Sel name="band" label="Turnover band">{keysOf(TURNOVER_BANDS).map((b) => <option key={b} value={b}>{TURNOVER_BANDS[b]}</option>)}</Sel>
        <Sel name="goal" label="Growth goal">{keysOf(GROWTH_GOALS).map((g) => <option key={g} value={g}>{GROWTH_GOALS[g]}</option>)}</Sel>
        <Sel name="status" label="Status">{keysOf(JOB_STATUSES).map((s) => <option key={s} value={s}>{JOB_STATUSES[s]}</option>)}</Sel>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Group by</span><select name="group" defaultValue={group} className={field}>{(Object.keys(GROUP_KEYS) as GroupKey[]).map((k) => <option key={k} value={k}>{GROUP_KEYS[k]}</option>)}</select></label>
        <button type="submit" className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-bold transition">Apply</button>
        <Link href="/clients/reports" className="px-3 py-2 rounded-lg text-[13px] font-semibold text-ink-mute hover:bg-muted transition">Clear</Link>
      </form>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[["Clients", totals.clients], ["Jobs", totals.jobs], ["Open jobs", totals.open], ["Overdue", totals.overdue], ["Turnover in scope", inr(totals.turnover)]].map(([k, v]) => (
          <div key={String(k)} className="rounded-2xl bg-card border border-border shadow-lift p-4"><div className="text-[11px] font-bold text-ink-faint uppercase tracking-wide">{k}</div><div className="font-display font-extrabold text-2xl mt-1">{v}</div></div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-card border border-border shadow-lift mb-6">
        <table className="w-full text-[13.5px]">
          <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left"><tr><th className="px-4 py-3">{GROUP_KEYS[group]}</th><th className="px-4 py-3">Jobs</th><th className="px-4 py-3">Clients</th><th className="px-4 py-3">Open</th><th className="px-4 py-3">Done</th><th className="px-4 py-3">Turnover</th></tr></thead>
          <tbody>
            {groups.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-faint">No jobs match these filters.</td></tr>}
            {groups.map((g) => (
              <tr key={g.key} className={`border-t border-border hover:bg-muted/40 ${sp.drill === g.key ? "bg-brand-50" : ""}`}>
                <td className="px-4 py-3 font-semibold"><Link href={`/clients/reports?${filtersToQuery(sp, { drill: g.key })}`} className="hover:text-brand-600">{g.key}</Link></td>
                <td className="px-4 py-3">{g.jobs}</td><td className="px-4 py-3">{g.clients}</td><td className="px-4 py-3">{g.open}</td><td className="px-4 py-3">{g.done}</td><td className="px-4 py-3">{inr(g.turnover)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drill && (
        <div className="overflow-x-auto rounded-2xl bg-card border border-border shadow-lift">
          <div className="px-4 py-3 text-[12px] font-bold text-ink-mute">{GROUP_KEYS[group]}: {sp.drill} · {drill.length} job(s)</div>
          <table className="w-full text-[13.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left"><tr><th className="px-4 py-2">Client</th><th className="px-4 py-2">FY</th><th className="px-4 py-2">Service</th><th className="px-4 py-2">Handler</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Due</th></tr></thead>
            <tbody>
              {drill.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 font-semibold"><Link href={`/clients/${r.clientId}`} className="hover:text-brand-600">{r.client}</Link></td>
                  <td className="px-4 py-2">{r.fy}</td><td className="px-4 py-2">{departmentLabel(r.department)} · {r.service}</td><td className="px-4 py-2">{r.handler}</td>
                  <td className="px-4 py-2">{JOB_STATUSES[r.status]}</td><td className="px-4 py-2">{ist(r.dueOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors. If the inline `Sel` component trips the React "component defined inside render" lint rule during `next build`, move it above `ReportsPage` and pass `sp` as a prop.

```bash
git add src/app/api/clients/reports src/app/clients/reports
git commit -m "Clients: reports page with grouping, drill-down and Excel export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Service list admin page

**Files:**
- Create: `src/app/clients/admin/services/ServicesManager.tsx`
- Create: `src/app/clients/admin/services/page.tsx`

- [ ] **Step 1: `ServicesManager.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import type { ServiceType } from "@prisma/client";
import { DEPARTMENTS, departmentLabel } from "@/lib/ca-firm";

export function ServicesManager({ services }: { services: ServiceType[] }) {
  const router = useRouter();
  const [dept, setDept] = useState<ServiceType["department"]>("AUDIT");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(key: string, url: string, method: string, body: unknown) {
    setBusy(key);
    setError(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error || "Failed"); return false; }
    router.refresh();
    return true;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <form onSubmit={async (e) => { e.preventDefault(); if (await send("add", "/api/clients/services", "POST", { department: dept, name })) setName(""); }} className="rounded-2xl bg-card border border-border shadow-lift p-5 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Department</span>
          <select value={dept} onChange={(e) => setDept(e.target.value as ServiceType["department"])} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]">{DEPARTMENTS.filter((d) => d !== "GENERAL").map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[200px]"><span className="text-[11px] font-bold text-ink-mute">Service name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]" />
        </label>
        <button type="submit" disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-[13px] font-bold">{busy === "add" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add</button>
        {error && <p className="w-full text-[12.5px] text-rose-600">{error}</p>}
      </form>

      {DEPARTMENTS.filter((d) => services.some((s) => s.department === d)).map((d) => (
        <div key={d} className="rounded-2xl bg-card border border-border shadow-lift p-5">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2">{departmentLabel(d)}</h2>
          <ul className="divide-y divide-border text-[13.5px]">
            {services.filter((s) => s.department === d).map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                <span className={s.active ? "" : "text-ink-faint line-through"}>{s.name}</span>
                <button onClick={() => send(s.id, `/api/clients/services/${s.id}`, "PATCH", { active: !s.active })} disabled={!!busy} className="text-[12.5px] font-semibold text-ink-mute hover:text-ink">{s.active ? "Deactivate" : "Reactivate"}</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `page.tsx`**

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isClientsAdmin } from "@/lib/clients/core";
import { listServiceTypes } from "@/lib/clients/services";
import { ServicesManager } from "./ServicesManager";

export const dynamic = "force-dynamic";

export default async function ServicesAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isClientsAdmin(session.user)) redirect("/clients");
  const services = await listServiceTypes(true);
  return (
    <div>
      <div className="mb-5">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Clients · Admin</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">Services</h1>
        <p className="text-ink-mute text-[15px] mt-1.5">Services offered under each department. Deactivated services stay on existing jobs but disappear from the pickers.</p>
      </div>
      <ServicesManager services={services} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/clients/admin
git commit -m "Clients: admin page for the service list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Build, docs, final verification

**Files:**
- Modify: `docs/ARCHITECTURE.md` (append a short "Client onboarding" section)
- Modify: `README.md` (env var mention, if the README lists env vars)

- [ ] **Step 1: Docs**

Append to `docs/ARCHITECTURE.md`:

```markdown
## Client onboarding (`/clients`)

Client master, admin-editable `ServiceType` per department, `Job` per (client, service, FY)
with status/due date, and `ClientDocument` rows pointing at files on SharePoint under
`<GRAPH_CLIENTS_ROOT>/<Client>/KYC` and `<Client>/<FY>/<Department>/<Service>`. Postgres is
the source of truth; `src/lib/clients/workbook.ts` regenerates
`<GRAPH_CLIENTS_ROOT>/_Database/Client Database.xlsx` in full (debounced after saves,
nightly via `/api/cron/clients`, or the button on `/clients/reports`). Nothing in this
module deletes from SharePoint. Pure helpers are checked by `npm run verify:clients`.
Design: `docs/superpowers/specs/2026-09-02-client-onboarding-design.md`.
```

- [ ] **Step 2: Full verification**

Run, in order:

```bash
npx prisma validate
npx tsx scripts/verify-clients.ts
npx tsc --noEmit
npm run build
```

Expected: valid schema; `verify-clients: core + workbook + reports OK`; no TS errors; `next build` completes with `/clients`, `/clients/new`, `/clients/[id]`, `/clients/reports`, `/clients/admin/services` listed as dynamic routes. (`npm run build` runs `prisma generate` first; it does not need a database.)

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md README.md
git commit -m "Clients: architecture note

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand-off checklist for Lakshmanan (not automated)**

1. Railway: add env `GRAPH_CLIENTS_ROOT=Clients` (optional, defaults to `Clients`).
2. GitHub: the new workflow reuses the existing `CRON_SECRET` repo secret. Nothing to add.
3. Say "push" — then `git fetch && git rebase origin/main && git push origin main`. Railway deploys and `prisma db push` creates the tables.
4. Smoke test on lms.indefine.in: onboard one test client with one PDF, confirm the folder tree in SharePoint, the file, and `_Database/Client Database.xlsx` after ~30 s. Then delete the test client's rows via Prisma Studio and the folder by hand.
