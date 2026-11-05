# Indefine LMS inventory (Firm OS Phase 0)

Snapshot of the repository as of 05 Nov 2026 (base `main` 33d113f plus the Phase 0 foundation
commits c61d885 and 5b2132d). Every item cites the file it was read from. Route lists were
produced by globbing `src/app/**/page.tsx` and `src/app/**/route.ts`, not by hand.

**Firm OS reuse** column:

| Mark | Meaning |
|---|---|
| REUSE | Firm OS calls or reads it as it is. No change to the LMS code. |
| EXTEND | Firm OS changes it additively, behind a `FIRM_OS_*` flag that defaults OFF (ADR-001). |
| LEAVE | No Firm OS change. Covered only by the Phase 12 LMS regression pass. |

Phase numbers refer to the orchestrator plan (Phase 0 inventory through Phase 12 QA, plus 2b).

## 1. Counts

| Item | Count | Source |
|---|---|---|
| Pages (`page.tsx`) | 71 | `src/app/**/page.tsx` |
| Route handlers (`route.ts`) | 59 (58 under `/api`, 1 at `/tools/office-tools/engagement-letter/editor`) | `src/app/**/route.ts` |
| **Routes total** | **130** | pages + route handlers |
| Layouts | 6 | `src/app/layout.tsx`, `admin/`, `clients/`, `tools/`, `wizard/`, `work/` |
| Cron endpoints | 6 | `src/app/api/cron/**` |
| GitHub workflows | 5 (+1 inactive copy under `docs/ci/`) | `.github/workflows/*.yml` |
| Environment variables read by code | 28 (incl. `NODE_ENV`, test-only `SB_TEST`, and NextAuth-implicit `AUTH_SECRET`/`AUTH_TRUST_HOST`) | grep `process.env.` in `src/`, `scripts/` |
| Prisma models | 64 (61 LMS + 3 Firm OS) in 15 sections; 29 enums | `prisma/schema.prisma` |
| Inline server actions (`"use server"`) | 26 files (legacy pages + `src/app/tools/client-ops/actions.ts`, `src/lib/approval-actions.ts`) | grep |

There is no `(portal)` route group and no `middleware.ts`; every page and handler calls `auth()` itself.

## 2. Layouts (page guards)

| Layout | Guard (from code) |
|---|---|
| `src/app/layout.tsx` | none (root shell) |
| `src/app/admin/layout.tsx` | signed in, else `/`; `isAdmin`, else `/dashboard` |
| `src/app/clients/layout.tsx` | signed in; `canViewClients` (`src/lib/clients/core.ts`) |
| `src/app/tools/layout.tsx` | signed in; `canUseCertificateTool` (active users) |
| `src/app/wizard/layout.tsx` | signed in |
| `src/app/work/layout.tsx` | signed in; `actorFrom(session)` (email allow-list `WORK_TRACKER_EMAILS`), else 404 |

## 3. Pages (71)

| # | URL | File | Module | Firm OS reuse | Phase |
|---|---|---|---|---|---|
| 1 | `/admin/approvals` | `src/app/admin/approvals/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 2 | `/admin/assignments` | `src/app/admin/assignments/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 3 | `/admin/attendance` | `src/app/admin/attendance/page.tsx` | Learning core (admin) | LEAVE | 9 may read AttendanceRecord (monthly totals only) |
| 4 | `/admin/auto-quiz` | `src/app/admin/auto-quiz/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 5 | `/admin/branches` | `src/app/admin/branches/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 6 | `/admin/checkins` | `src/app/admin/checkins/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 7 | `/admin/courses` | `src/app/admin/courses/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 8 | `/admin/kra/[userId]` | `src/app/admin/kra/[userId]/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 9 | `/admin/kra` | `src/app/admin/kra/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 10 | `/admin/live` | `src/app/admin/live/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 11 | `/admin` | `src/app/admin/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 12 | `/admin/settings` | `src/app/admin/settings/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 13 | `/admin/team` | `src/app/admin/team/page.tsx` | Learning core (admin) | REUSE | 0, 11 (level/role feed Firm OS roles) |
| 14 | `/admin/trajectory` | `src/app/admin/trajectory/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 15 | `/admin/video/[id]` | `src/app/admin/video/[id]/page.tsx` | Learning core (admin) | LEAVE | 12 (regression only) |
| 16 | `/checkin/history` | `src/app/checkin/history/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 17 | `/checkin` | `src/app/checkin/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 18 | `/clients/[id]` | `src/app/clients/[id]/page.tsx` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 19 | `/clients/admin/services` | `src/app/clients/admin/services/page.tsx` | Client onboarding | REUSE | 3 (ServiceType as service list) |
| 20 | `/clients/new` | `src/app/clients/new/page.tsx` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 21 | `/clients` | `src/app/clients/page.tsx` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 22 | `/clients/reports` | `src/app/clients/reports/page.tsx` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 23 | `/connect` | `src/app/connect/page.tsx` | Auth | EXTEND | 10 (new draft-only mail tier; no Mail.Send) |
| 24 | `/dashboard` | `src/app/dashboard/page.tsx` | Learning core | EXTEND | 9 (morning board embedded on dashboard) |
| 25 | `/initiatives` | `src/app/initiatives/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 26 | `/leaderboard` | `src/app/leaderboard/page.tsx` | Learning core | LEAVE | 12 (regression only) |
| 27 | `/` | `src/app/page.tsx` | Auth | REUSE | all (sign-in unchanged) |
| 28 | `/quiz/[id]` | `src/app/quiz/[id]/page.tsx` | Learning core | LEAVE | 12 (regression only) |
| 29 | `/quiz/[id]/result` | `src/app/quiz/[id]/result/page.tsx` | Learning core | LEAVE | 12 (regression only) |
| 30 | `/recap` | `src/app/recap/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 31 | `/recap/year` | `src/app/recap/year/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 32 | `/team/[userId]` | `src/app/team/[userId]/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 33 | `/team/approvals` | `src/app/team/approvals/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 34 | `/team` | `src/app/team/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 35 | `/tools/certificate-generator/[formatId]` | `src/app/tools/certificate-generator/[formatId]/page.tsx` | Certificates | LEAVE | 12 (regression only) |
| 36 | `/tools/certificate-generator/history` | `src/app/tools/certificate-generator/history/page.tsx` | Certificates | LEAVE | 12 (regression only) |
| 37 | `/tools/certificate-generator` | `src/app/tools/certificate-generator/page.tsx` | Certificates | LEAVE | 12 (regression only) |
| 38 | `/tools/client-ops/[id]` | `src/app/tools/client-ops/[id]/page.tsx` | Client ops (renewals) | LEAVE | - (web-hosting clients, not CA clients) |
| 39 | `/tools/client-ops` | `src/app/tools/client-ops/page.tsx` | Client ops (renewals) | LEAVE | - (web-hosting clients, not CA clients) |
| 40 | `/tools/neo-centra/how-it-works` | `src/app/tools/neo-centra/how-it-works/page.tsx` | Neo Centra | LEAVE | - |
| 41 | `/tools/neo-centra/incentives` | `src/app/tools/neo-centra/incentives/page.tsx` | Neo Centra | LEAVE | - |
| 42 | `/tools/neo-centra` | `src/app/tools/neo-centra/page.tsx` | Neo Centra | LEAVE | - |
| 43 | `/tools/office-tools/director-report` | `src/app/tools/office-tools/director-report/page.tsx` | Office Tools | LEAVE | - |
| 44 | `/tools/office-tools/engagement-letter` | `src/app/tools/office-tools/engagement-letter/page.tsx` | Engagement letters | LEAVE | 3 reads EngagementLetter only |
| 45 | `/tools/office-tools/gstr3b` | `src/app/tools/office-tools/gstr3b/page.tsx` | Office Tools | REUSE | 5 (GSTR-3B PDF parser), 7 (TDS challan parser) |
| 46 | `/tools/office-tools/history` | `src/app/tools/office-tools/history/page.tsx` | Office Tools | LEAVE | - |
| 47 | `/tools/office-tools/llp` | `src/app/tools/office-tools/llp/page.tsx` | Office Tools | LEAVE | - |
| 48 | `/tools/office-tools/mou` | `src/app/tools/office-tools/mou/page.tsx` | Office Tools | LEAVE | - |
| 49 | `/tools/office-tools` | `src/app/tools/office-tools/page.tsx` | Office Tools | LEAVE | - |
| 50 | `/tools/office-tools/partnership` | `src/app/tools/office-tools/partnership/page.tsx` | Office Tools | LEAVE | - |
| 51 | `/tools/office-tools/rental` | `src/app/tools/office-tools/rental/page.tsx` | Office Tools | LEAVE | - |
| 52 | `/tools/office-tools/tds-challan` | `src/app/tools/office-tools/tds-challan/page.tsx` | Office Tools | REUSE | 7 (TDS deducted vs deposited) |
| 53 | `/tools/office-tools/trust` | `src/app/tools/office-tools/trust/page.tsx` | Office Tools | LEAVE | - |
| 54 | `/tools` | `src/app/tools/page.tsx` | Tools hub | EXTEND | 3+ (tiles for new modules) |
| 55 | `/tools/sop-builder/[id]/edit` | `src/app/tools/sop-builder/[id]/edit/page.tsx` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 56 | `/tools/sop-builder/[id]` | `src/app/tools/sop-builder/[id]/page.tsx` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 57 | `/tools/sop-builder/admin` | `src/app/tools/sop-builder/admin/page.tsx` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 58 | `/tools/sop-builder/new` | `src/app/tools/sop-builder/new/page.tsx` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 59 | `/tools/sop-builder` | `src/app/tools/sop-builder/page.tsx` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 60 | `/tools/statutory-updates` | `src/app/tools/statutory-updates/page.tsx` | Statutory updates | REUSE | 5-6 (StatutoryPost as a 'novel' signal, read-only) |
| 61 | `/video/[id]` | `src/app/video/[id]/page.tsx` | Learning core | LEAVE | 12 (regression only) |
| 62 | `/wizard/aspiration` | `src/app/wizard/aspiration/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 63 | `/wizard/initiative` | `src/app/wizard/initiative/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 64 | `/wizard` | `src/app/wizard/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 65 | `/wizard/quests` | `src/app/wizard/quests/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 66 | `/wizard/review` | `src/app/wizard/review/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 67 | `/wizard/strengths` | `src/app/wizard/strengths/page.tsx` | Trajectory | LEAVE | 12 (regression only) |
| 68 | `/work/[id]` | `src/app/work/[id]/page.tsx` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 69 | `/work/board` | `src/app/work/board/page.tsx` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 70 | `/work` | `src/app/work/page.tsx` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 71 | `/work/week` | `src/app/work/week/page.tsx` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |

## 4. Route handlers (59)

"Guard" lists the access helpers each file calls (extracted from the source). Every non-cron,
non-relay handler also calls `auth()` from `src/lib/auth.ts`.

| # | URL | Methods | Guard (from code) | File | Module | Firm OS reuse | Phase |
|---|---|---|---|---|---|---|---|
| 1 | `/api/admin/kra/export` | GET | isActive isAdmin | `src/app/api/admin/kra/export/route.ts` | Learning core (admin) | LEAVE | 12 (regression only) |
| 2 | `/api/admin/live/ingest-due` | POST | isActive isAdmin | `src/app/api/admin/live/ingest-due/route.ts` | Learning core (admin) | LEAVE | 12 (regression only) |
| 3 | `/api/admin/quiz/from-video` | POST | isActive isAdmin | `src/app/api/admin/quiz/from-video/route.ts` | Learning core (admin) | LEAVE | 12 (regression only) |
| 4 | `/api/admin/quiz/generate` | POST | isActive isAdmin | `src/app/api/admin/quiz/generate/route.ts` | Learning core (admin) | LEAVE | 12 (regression only) |
| 5 | `/api/auth/[...nextauth]` | GET POST (re-export) | NextAuth | `src/app/api/auth/[...nextauth]/route.ts` | Auth | REUSE | all (SSO unchanged) |
| 6 | `/api/clients/[id]/documents` | POST | canViewClients | `src/app/api/clients/[id]/documents/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 7 | `/api/clients/[id]/folders` | POST | canViewClients | `src/app/api/clients/[id]/folders/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 8 | `/api/clients/[id]/jobs` | POST | canViewClients | `src/app/api/clients/[id]/jobs/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 9 | `/api/clients/[id]` | PATCH | canManageClients | `src/app/api/clients/[id]/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 10 | `/api/clients/documents/[docId]` | DELETE | canManageClients | `src/app/api/clients/documents/[docId]/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 11 | `/api/clients/jobs/[jobId]` | DELETE PATCH | canManageClients canViewClients | `src/app/api/clients/jobs/[jobId]/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 12 | `/api/clients/reports/export` | GET | canViewClients | `src/app/api/clients/reports/export/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 13 | `/api/clients` | POST | canViewClients | `src/app/api/clients/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 14 | `/api/clients/services/[serviceId]` | PATCH | isClientsAdmin | `src/app/api/clients/services/[serviceId]/route.ts` | Client onboarding | REUSE | 3 (ServiceType as service list) |
| 15 | `/api/clients/services` | POST | isClientsAdmin | `src/app/api/clients/services/route.ts` | Client onboarding | REUSE | 3 (ServiceType as service list) |
| 16 | `/api/clients/workbook` | POST | canViewClients | `src/app/api/clients/workbook/route.ts` | Client onboarding | EXTEND | 1 (CL-{Code} paths behind FIRM_OS_CL_PATHS), 3 (onboarding writes Client) |
| 17 | `/api/cron/clients` | GET | cronUnauthorized | `src/app/api/cron/clients/route.ts` | Cron | EXTEND | 1 (retry ensure-* for CL- trees) |
| 18 | `/api/cron/live/ingest` | GET | cronUnauthorized | `src/app/api/cron/live/ingest/route.ts` | Cron | LEAVE | - |
| 19 | `/api/cron/neo-centra` | GET | cronUnauthorized | `src/app/api/cron/neo-centra/route.ts` | Cron | REUSE | 8 (Turia session health signal) |
| 20 | `/api/cron/renewals` | GET | cronUnauthorized | `src/app/api/cron/renewals/route.ts` | Cron | LEAVE | - |
| 21 | `/api/cron/statutory` | GET | cronUnauthorized | `src/app/api/cron/statutory/route.ts` | Cron | LEAVE | - |
| 22 | `/api/cron/work` | GET | cronUnauthorized | `src/app/api/cron/work/route.ts` | Cron | EXTEND | 9 (morning board, reminders) |
| 23 | `/api/material/[id]` | GET | canAccessVideo isActive isAdmin | `src/app/api/material/[id]/route.ts` | Learning core | LEAVE | 12 (regression only) |
| 24 | `/api/quiz/[id]/start` | POST | canAccessVideo canStartAttempt isActive isAdmin | `src/app/api/quiz/[id]/start/route.ts` | Learning core | LEAVE | 12 (regression only) |
| 25 | `/api/quiz/[id]/submit` | POST | isActive | `src/app/api/quiz/[id]/submit/route.ts` | Learning core | LEAVE | 12 (regression only) |
| 26 | `/api/tools/certificate-generator/[issueId]/download` | GET | canUseCertificateTool isAdmin | `src/app/api/tools/certificate-generator/[issueId]/download/route.ts` | Certificates | LEAVE | 12 (regression only) |
| 27 | `/api/tools/certificate-generator/field-options/[id]` | DELETE | canUseCertificateTool | `src/app/api/tools/certificate-generator/field-options/[id]/route.ts` | Certificates | LEAVE | 12 (regression only) |
| 28 | `/api/tools/certificate-generator/field-options` | GET POST | canUseCertificateTool | `src/app/api/tools/certificate-generator/field-options/route.ts` | Certificates | LEAVE | 12 (regression only) |
| 29 | `/api/tools/certificate-generator/issue` | POST | canUseCertificateTool | `src/app/api/tools/certificate-generator/issue/route.ts` | Certificates | LEAVE | 12 (regression only) |
| 30 | `/api/tools/engagement-letters/[id]/approve` | POST | canUseOfficeTools | `src/app/api/tools/engagement-letters/[id]/approve/route.ts` | Engagement letters | LEAVE | 3 reads EngagementLetter only |
| 31 | `/api/tools/engagement-letters/[id]/file` | POST | canUseOfficeTools | `src/app/api/tools/engagement-letters/[id]/file/route.ts` | Engagement letters | LEAVE | 3 reads EngagementLetter only |
| 32 | `/api/tools/engagement-letters/[id]/send` | POST | canUseOfficeTools | `src/app/api/tools/engagement-letters/[id]/send/route.ts` | Engagement letters | LEAVE | - (human-clicked client send; guard allowlist H-3) |
| 33 | `/api/tools/engagement-letters` | POST | canUseOfficeTools | `src/app/api/tools/engagement-letters/route.ts` | Engagement letters | LEAVE | 3 reads EngagementLetter only |
| 34 | `/api/tools/neo-centra/hours-debug` | GET | canUseNeoCentra | `src/app/api/tools/neo-centra/hours-debug/route.ts` | Neo Centra | LEAVE | - |
| 35 | `/api/tools/neo-centra/hours-splits` | DELETE GET POST | canUseNeoCentra isNeoCentraAdmin | `src/app/api/tools/neo-centra/hours-splits/route.ts` | Neo Centra | LEAVE | - |
| 36 | `/api/tools/neo-centra/incentives` | GET POST | canUseNeoCentra isNeoCentraAdmin | `src/app/api/tools/neo-centra/incentives/route.ts` | Neo Centra | LEAVE | - |
| 37 | `/api/tools/neo-centra/internal-budgets` | DELETE GET POST | canUseNeoCentra isNeoCentraAdmin | `src/app/api/tools/neo-centra/internal-budgets/route.ts` | Neo Centra | LEAVE | - |
| 38 | `/api/tools/neo-centra/profit-splits` | DELETE GET POST | canUseNeoCentra isNeoCentraAdmin | `src/app/api/tools/neo-centra/profit-splits/route.ts` | Neo Centra | LEAVE | - |
| 39 | `/api/tools/neo-centra/turia-cookie` | GET POST | bearerUnauthorized canUseNeoCentra | `src/app/api/tools/neo-centra/turia-cookie/route.ts` | Neo Centra | REUSE | 3, 8 (encrypted Turia session for UiAutomationBridge) |
| 40 | `/api/tools/neo-centra/turia-debug` | GET | canUseNeoCentra | `src/app/api/tools/neo-centra/turia-debug/route.ts` | Neo Centra | LEAVE | - |
| 41 | `/api/tools/office-tools/doc/[tool]` | POST | canUseOfficeTools | `src/app/api/tools/office-tools/doc/[tool]/route.ts` | Office Tools | LEAVE | - |
| 42 | `/api/tools/office-tools/tax/[tool]` | POST | canUseOfficeTools | `src/app/api/tools/office-tools/tax/[tool]/route.ts` | Office Tools | REUSE | 5 (GSTR-3B PDF parser), 7 (TDS challan parser) |
| 43 | `/api/tools/sop-builder/analyze` | POST | canCreateSop | `src/app/api/tools/sop-builder/analyze/route.ts` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 44 | `/api/tools/sop-builder/grants/[userId]` | DELETE | isSopAdmin | `src/app/api/tools/sop-builder/grants/[userId]/route.ts` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 45 | `/api/tools/sop-builder/grants` | POST | isSopAdmin | `src/app/api/tools/sop-builder/grants/route.ts` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 46 | `/api/tools/sop-builder/sops/[id]/download` | GET | canViewSop | `src/app/api/tools/sop-builder/sops/[id]/download/route.ts` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 47 | `/api/tools/sop-builder/sops/[id]/versions` | POST | canEditSop | `src/app/api/tools/sop-builder/sops/[id]/versions/route.ts` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 48 | `/api/tools/sop-builder/sops` | POST | canEditSop | `src/app/api/tools/sop-builder/sops/route.ts` | SOP Builder | LEAVE | - (SopPack is separate; Gemini gap G-3) |
| 49 | `/api/tools/statutory/ingest` | POST | bearerUnauthorized | `src/app/api/tools/statutory/ingest/route.ts` | Statutory updates | REUSE | 5-6 (StatutoryPost as a 'novel' signal, read-only) |
| 50 | `/api/video/[id]/progress` | POST | canAccessVideo isActive isAdmin | `src/app/api/video/[id]/progress/route.ts` | Learning core | LEAVE | 12 (regression only) |
| 51 | `/api/video/[id]/stream` | GET | canAccessVideo isActive isAdmin | `src/app/api/video/[id]/stream/route.ts` | Learning core | LEAVE | 12 (regression only) |
| 52 | `/api/work/[id]` | PATCH | currentActor | `src/app/api/work/[id]/route.ts` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 53 | `/api/work/[id]/tasks` | POST | currentActor | `src/app/api/work/[id]/tasks/route.ts` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 54 | `/api/work/picks` | POST | currentActor | `src/app/api/work/picks/route.ts` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 55 | `/api/work/review` | POST | currentActor | `src/app/api/work/review/route.ts` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 56 | `/api/work` | POST | currentActor | `src/app/api/work/route.ts` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 57 | `/api/work/tasks/[taskId]` | PATCH | currentActor | `src/app/api/work/tasks/[taskId]/route.ts` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 58 | `/api/work/week` | PUT | currentActor | `src/app/api/work/week/route.ts` | Tech work tracker | LEAVE | 9 reuses its patterns, not its pages (gap G-7) |
| 59 | `/tools/office-tools/engagement-letter/editor` | GET | canUseOfficeTools | `src/app/tools/office-tools/engagement-letter/editor/route.ts` | Engagement letters | LEAVE | 3 reads EngagementLetter only |

## 5. Scheduled jobs (cron endpoints and workflows)

All cron handlers start with `cronUnauthorized(req)` (`src/lib/cron-auth.ts`, bearer `CRON_SECRET`).
Every workflow calls the hard-coded production host `https://lms.indefine.in` and exits 0 when the
`CRON_SECRET` repository secret is missing.

| Endpoint | Workflow | Schedule (UTC → IST) | What it does | Firm OS reuse |
|---|---|---|---|---|
| `/api/cron/live/ingest` | `.github/workflows/ingest-recordings.yml` | `*/15 * * * *` → every 15 min | Copy finished Teams recordings into L&D, publish, transcribe and quiz via Gemini, capture attendance (`src/lib/live/ingest.ts`) | LEAVE |
| `/api/cron/clients` | `.github/workflows/clients-nightly.yml` | `30 20 * * *` → 02:00 IST | Retry PENDING client/job folders, rebuild `Clients/_Database/Client Database.xlsx` (`src/lib/clients/storage.ts`, `workbook.ts`) | EXTEND, Phase 1 (retry CL- ensure-* calls) |
| `/api/cron/renewals` | `.github/workflows/renewals-nightly.yml` | `0 2 * * *` → 07:30 IST | RDAP + TLS expiry refresh for web-hosting clients (`src/lib/client-ops/refresh.ts`) | LEAVE |
| `/api/cron/statutory` | `.github/workflows/statutory-daily.yml` | `30 2 * * *` → 08:00 IST | Collect six server-reachable portals, Gemini summaries of new posts (`src/lib/statutory/*`) | LEAVE (data REUSE, Phase 5–6) |
| `/api/cron/work?job=morning\|friday\|close` | `.github/workflows/work-nudges.yml` | `30 3 * * 1-5` → 09:00 Mon–Fri; `30 10 * * 5` → 16:00 Fri; `30 14 * * *` → 20:00 daily | Teams nudges to the tech work tracker chat; carry picks; auto-pause (`src/lib/work/*`) | EXTEND, Phase 9 |
| `/api/cron/neo-centra` | none in repo (comment says "every 5 min", external scheduler) | – | Recompute the quarter's incentive snapshot from live Turia (`src/lib/neo-centra/incentive.ts`) | REUSE, Phase 8 (session-health signal) |

Notes:
- `docs/ci/verify-certs.yml` is a workflow file kept under `docs/`; GitHub does not run it.
- No workflow runs lint, typecheck or tests today (Phase 0 task 5 adds CI).
- `docs/ARCHITECTURE.md` §12 lists four jobs; `/api/cron/renewals` and `/api/cron/statutory` are missing there (documentation drift, not a code issue).
- Firm OS adds one cron in Phase 8 (close-loop reconciler, every 30 min in IST working hours). It follows the same pattern: `src/app/api/cron/<job>/route.ts` + a workflow + `cronUnauthorized`.

## 6. Environment variables

Read from code with `grep -rn "process.env" src scripts`, cross-checked against `.env.example`.

| Variable | Read in | In `.env.example` | Purpose | Firm OS reuse |
|---|---|---|---|---|
| `DATABASE_URL` | `src/lib/prisma.ts` | yes | Postgres | REUSE (staging DB for Firm OS work) |
| `AUTH_SECRET` | NextAuth v5 (implicit) | yes | Session encryption | REUSE |
| `AUTH_URL` | NextAuth; `src/app/api/cron/work/route.ts` (links in nudges) | yes | App base URL | REUSE |
| `AUTH_TRUST_HOST` | NextAuth (implicit) | yes | Behind Railway proxy | REUSE |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` | `src/lib/auth.ts`, `src/lib/graph.ts` | yes | Entra SSO; delegated token refresh | REUSE |
| `GRAPH_TOKEN_KEY` | `src/lib/graph.ts` (via `keyFromEnv`, `src/lib/secret-box.ts`) | yes | AES-GCM key for stored Graph tokens | REUSE |
| `GRAPH_DRIVE_ID` | `src/lib/sync.ts`, `src/lib/clients/storage.ts`, `src/lib/clients/workbook.ts`, `src/lib/live/ingest.ts`, `src/lib/live/schedule.ts`, `src/lib/office-tools/engagement-letters.ts`, `src/lib/sop/storage.ts`, `src/app/admin/live/page.tsx` | yes | The one drive used for L&D, Clients, SOPs, ELs | REUSE (legacy reads, ADR-004) |
| `GRAPH_VIDEOS_FOLDER_PATH` | `src/lib/sync.ts`, `src/lib/live/schedule.ts`, `src/lib/sop/storage.ts`, `src/app/admin/live/page.tsx`, `src/app/admin/video/[id]/page.tsx` | yes | L&D folder (also parent of `SOP/`) | LEAVE |
| `GRAPH_VIDEOS_FOLDER_ID` | `src/lib/sync.ts` | yes | Alternative to the path | LEAVE |
| `GRAPH_CLIENTS_ROOT` | `src/lib/clients/storage.ts` | yes (`Clients`) | Legacy client folder root | REUSE read-only (ADR-004) |
| `GRAPH_EL_ROOT` | `src/lib/office-tools/engagement-letters.ts` | **no** (defaults to `Engagement Letters`) | Engagement letter PDFs | LEAVE; add to `.env.example` (gap G-9) |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | `src/lib/graph.ts` | yes | App-only Graph token | REUSE (Phase 1 may add a separate PnP app, ADR-004) |
| `ADMIN_EMAILS` | `src/lib/auth.ts`, `src/lib/users-sync.ts` | yes | Auto-promote to ADMIN | REUSE (Firm OS `admin` role) |
| `WORK_TRACKER_EMAILS` | `src/lib/work/core.ts` | yes | `/work` allow-list; first is lead | LEAVE (see G-7) |
| `CRON_SECRET` | `src/lib/cron-auth.ts`, `scripts/verify-cron-auth.ts` | yes | Cron bearer secret | REUSE (Phase 8 reconciler) |
| `NEO_TURIA_ORG_ID` | `src/lib/neo-centra/turia.ts` | yes | Turia organisation id sent with every call | REUSE (ADR-003) |
| `NEO_TURIA_RELAY_TOKEN` | `src/app/api/tools/neo-centra/turia-cookie/route.ts` | yes | Extension → LMS cookie push | REUSE (ADR-003) |
| `NEO_TURIA_COOKIE_KEY` | `src/lib/neo-centra/turia.ts` (via `keyFromEnv`) | yes | Encrypts the stored Turia cookie | REUSE (ADR-003) |
| `NEO_CENTRA_DEBUG` | `src/app/api/tools/neo-centra/turia-debug/route.ts`, `hours-debug/route.ts` | yes | Exposes raw Turia payload endpoints | LEAVE; must stay unset in prod |
| `GEMINI_API_KEY` | `src/lib/gemini.ts`, `src/lib/quiz-gen.ts`, `src/lib/auto-quiz.ts`, `src/app/admin/auto-quiz/page.tsx`, `src/app/admin/video/[id]/page.tsx` | yes | Gemini (legacy AI) | LEAVE (ADR-002) |
| `GEMINI_MODEL` | `src/lib/gemini.ts` | yes | Optional model override | LEAVE |
| `STATUTORY_RELAY_TOKEN` | `src/app/api/tools/statutory/ingest/route.ts` | yes | statutory-extension → LMS push | LEAVE |
| `NODE_ENV` | `src/lib/prisma.ts`, certificate-generator pages/route | – | Runtime | – |
| `SB_TEST` | `scripts/verify-secret-box.ts` | – | Test-only | – |

`README.md`'s environment table omits `GRAPH_TOKEN_KEY`, `WORK_TRACKER_EMAILS`, `CRON_SECRET`, the
`NEO_*` variables and `STATUTORY_RELAY_TOKEN`; `.env.example` is the complete list (except `GRAPH_EL_ROOT`).

Variables Firm OS introduces (each added to `.env.example` by the phase that first reads it, never with
values): `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `LOCAL_LLM_BASE_URL` (empty in week 1), `MODEL_FAST`,
`MODEL_SMART`, `MODEL_HARD`, `ROUTER_MIN_CONF`, `AI_DAILY_BUDGET_INR`, SharePoint PnP app
credentials (Phase 1), and `FIRM_OS_*` feature flags (`FIRM_OS_CL_PATHS`, `FIRM_OS_ONBOARD_CONFIRM`, …),
all defaulting OFF (ADR-001, ADR-002).

## 7. Prisma models by schema section

`prisma/schema.prisma` uses `// -------------------- <Section> --------------------` headers. Some
models sit under a neighbouring header without one of their own; they are listed where they appear.

| # | Section (as in file) | Models | Enums | Firm OS reuse |
|---|---|---|---|---|
| 1 | Auth (NextAuth/Auth.js) | `User`, `DailyActivity`, `Branch`, `Account`, `Session`, `VerificationToken` | `EmployeeLevel`, `Department`, `Role` | `User`: REUSE (roles from `role`/`level`, ADR-001; assignee/reviewer). `Account`: REUSE (stored delegated Graph tokens). `DailyActivity`: LEAVE (one row per IST day, too coarse for break nudges). Others LEAVE. |
| 2 | Learning content | `Course`, `Module`, `Video`, `Material`, `VideoProgress` | – | LEAVE |
| 3 | Quizzes | `Quiz`, `Settings`, `Question`, `Option`, `QuizAttempt` | – | `Settings`: REUSE (singleton, e.g. Teams chat id). Others LEAVE. |
| 4 | Deadlines / KRA | `Deadline` | `DeadlineKind` | LEAVE |
| 5 | Assignments | `Assignment` | `AssignmentKind`, `AssignmentStatus` | LEAVE |
| 6 | Attendance (greytHR / Turia import) | `AttendanceRecord` | – | LEAVE (monthly totals only; Phase 9 may read) |
| 7 | Trajectory (performance OS) | `PerformanceCycle`, `TrackTarget`, `Quest`, `QuestMilestone`, `Initiative`, `InitiativeReaction`, `Endorsement`, `WeeklyCheckin`, `TrackSnapshot`, `TierAssignment` | `TrackKind`, `TierKind`, `QuestStatus`, `InitiativeStatus`, `ReactionKind`, `EndorsementKind` | LEAVE |
| 8 | Live sessions (Teams) | `LiveSession`, `LiveAttendance`; also `CertificateIssue`, `CertificateFieldOption` | `LiveSessionStatus` | LEAVE. `CertificateIssue.payload` holds client identifiers (DPDP inventory, Phase 11). |
| 9 | SOP Builder (Tools) | `Sop`, `SopVersion`, `SopEditor`, `SopView`; also `OfficeToolRun` | – | LEAVE (`SopPack` is a new, separate model) |
| 10 | Neo Centra · Incentives (Turia-fed) | `NeoTuriaSession`, `NeoDirectorMapping`, `NeoInternalBudget`, `NeoProfitSplit`, `NeoHoursSplit`, `NeoIncentiveSnapshot` | – | `NeoTuriaSession`: REUSE (encrypted Turia cookie, ADR-003). Others LEAVE. |
| 11 | Client onboarding | `Client`, `ServiceType`, `Job`, `ClientDocument` | `EntityType`, `TurnoverBand`, `GrowthGoal`, `FolderStatus`, `JobStatus`, `ClientDocType` | `Client`: EXTEND via `FirmClient` (no column changes); holds PAN, GSTIN, CIN, contact phone/email (ADR-006). `ServiceType`: REUSE. `Job`: REUSE as the legacy job; Firm OS `JobTask` links to it, never rewrites `Job.status`. `ClientDocument`: REUSE read-only (legacy file pointers). |
| 12 | Tech work tracker (/work) | `Work`, `WorkTask`, `WeekPlanWork`, `DayPick`, `WeekReview`, `WorkEvent` | `WorkStatus`, `WorkTaskStatus`, `DayPickOutcome`, `WorkEventKind` | LEAVE (append-only `WorkEvent` is the pattern for Firm OS state history) |
| 13 | Client ops: hosting & domain renewals | `OpsClient`, `OpsSubscription`, `OpsReminder` | `SubscriptionKind`, `BillingCycle` | LEAVE |
| 14 | Engagement letters (Office Tools) | `EngagementLetter`, `EngagementLetterEvent`; also `StatutoryPost`, `StatutorySource` | `EngagementLetterStatus` | `EngagementLetter`: REUSE read-only (Phase 3 shows the client's EL). `StatutoryPost`: REUSE read-only (Phase 5–6). Others LEAVE. |
| 15 | Firm OS: shared spine (added c61d885, migration `20261105190000_firm_os_spine`, CREATE only) | `FirmClient`, `ModelCall`, `AuditEvent` | `ModelProviderId`, `ModelTier`, `ModelCallStatus` | New. `Client` gained only the Prisma back-relation `firmClient FirmClient?` (no column). |

Models still to come (additive, later phases): `Engagement`, `SopPack`, `JobTask`, `AgentRun`,
`ChecklistResult`, `MistakeLog`, `Deliverable`, `TuriaSync`, `CommsDraft`, `CoachEvent`.

## 8. Integrations

### 8.1 Microsoft Graph — `src/lib/graph.ts` (1,017 lines), `src/lib/graph-scopes.ts`

Tokens:
- `getAppOnlyToken()` — client credentials with `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET`, cached in memory. Used first for drive reads/writes, user sync and streaming.
- `getUserGraphToken(userId, required = ELEVATED_SCOPES)` — delegated token from the `Account` row, refreshed with exactly the required scopes, sealed at rest with `GRAPH_TOKEN_KEY` (`sealGraphToken`, `src/lib/secret-box.ts`).
- Scope tiers (`src/lib/graph-scopes.ts`): `SIGNIN_SCOPES` (identity only, no refresh token), `ELEVATED_SCOPES` (adds `Files.ReadWrite.All`, `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, transcript/artifact read; granted at `/connect`), `LEAD_SCOPES` (adds `Chat.Create`, `ChatMessage.Send`), `MAIL_SCOPES` (`Mail.Send`, granted at `/connect?mail=1`). README documents app permissions `Files.ReadWrite.All` and `User.Read.All`.
- Entra group membership is **not** read anywhere today (no `groups` claim, no `memberOf` call). Firm OS role mapping from the Partners/Staff groups is new work (ADR-001).

Exported functions by effect:

| Effect | Functions |
|---|---|
| Read | `listSubfolderNames`, `listVideosRecursive`, `listFolderVideos`, `getStreamUrl`, `listOrgUsers`, `resolveFolderId`, `getItemParentId`, `listMyRecordings`, `listUserRecordings`, `pollCopyStatus`, `fetchMeetingTranscript`, `meetingHasEnded`, `listAttendanceRecords`, `resolveOnlineMeetingId`, `downloadDriveItem` |
| Create / update | `ensureFolder` (idempotent), `uploadFileToFolder`, `uploadFileToFolderId`, `uploadFileContent`, `copyDriveItem`, `createTeamsEvent`, `updateTeamsEvent`, `applyMeetingSettings` |
| Move / rename | `moveDriveItem` — callers `src/lib/clients/storage.ts:137` (`renameClientFolder`), `src/lib/live/schedule.ts:220` |
| **Delete** | `deleteEvent` (`DELETE /me/events/{id}`, line 464) — callers `src/lib/live/schedule.ts:176`, `:362`. `deleteDriveItem` (`DELETE /drives/{d}/items/{i}`, line 747) — caller `src/lib/live/ingest.ts:337` (`repullRecording`, removes a wrongly copied recording) |
| **Send** | `sendMailAsUser` (`POST /me/sendMail`, line 992) — caller `src/app/api/tools/engagement-letters/[id]/send/route.ts:51` (staff click, emails an EL PDF to the client from their own mailbox) |

Outside `graph.ts`, `src/lib/work/teams.ts` posts directly to `https://graph.microsoft.com/v1.0/chats`
(create chat, post message) with the lead's delegated token.

Firm OS reuse: REUSE the token helpers, `ensureFolder`, upload and read functions through a thin
`src/lib/integrations/sharepoint/graph-client.ts` that re-exports only non-destructive functions
(Phase 1). LEAVE `deleteEvent`, `deleteDriveItem`, `moveDriveItem`, `sendMailAsUser`: Firm OS code
must not import them (guard H-1 to H-4).

### 8.2 Legacy client folder layout — `GRAPH_CLIENTS_ROOT` (`src/lib/clients/storage.ts`, `workbook.ts`)

All on drive `GRAPH_DRIVE_ID`; root is a single segment under the drive root, default `Clients`.

```
<GRAPH_CLIENTS_ROOT>/
  _Database/Client Database.xlsx                 regenerated in full (workbook.ts)
  <Client.folderName>/
    KYC/                                         client-level ClientDocument rows (jobId null)
    <FY e.g. 2026-27>/<Department label>/<Service>/   one folder per Job (ensureJobFolder)
```

- Folder ids are stored on `Client.graphFolderId` and `Job.graphFolderId`; `folderStatus` PENDING/READY/FAILED drives the nightly retry.
- Department label comes from `src/lib/ca-firm.ts` via `safeName` (e.g. "Admin / Ops" becomes "Admin - Ops").
- Uploads up to 50 MB; file names `"<DocType> - <original name>"`.
- The module never deletes on SharePoint; `DELETE /api/clients/documents/[docId]` unlinks the DB row only.
- Same drive, other roots: `<GRAPH_VIDEOS_FOLDER_PATH>/` (L&D videos) and `<GRAPH_VIDEOS_FOLDER_PATH>/SOP/<Department>/` (`src/lib/sop/storage.ts`); `<GRAPH_EL_ROOT>/<client>/EL_<client>_FY..pdf` (`src/lib/office-tools/engagement-letters.ts`).

Firm OS reuse: REUSE read-only. Path A (`CL-{Code}` sites) is the only target for new deliverables;
the legacy layout stays readable, nothing is moved or deleted (ADR-004). Phase 1 owns
`scripts/map-legacy-folders.ts` (dry-run report only).

### 8.3 Turia via Neo Centra — `src/lib/neo-centra/turia.ts`

- Transport: `POST https://practice.turia.in/api/<endpoint>` with JSON `{ action, data: {..., organizationId}, organizationId }` and header `Cookie: <firm session cookie>`. `organizationId` is `NEO_TURIA_ORG_ID`.
- Authentication: a browser session cookie, not an API credential. The cookie (including the HttpOnly `accessToken`) is captured by `neo-centra-extension/` (`chrome.cookies.getAll`) from a director's logged-in Turia tab and pushed every 5 minutes to `POST /api/tools/neo-centra/turia-cookie` with `Authorization: Bearer NEO_TURIA_RELAY_TOKEN`, or pasted by a partner. Stored in `NeoTuriaSession` (single row id 1) sealed with `NEO_TURIA_COOKIE_KEY`; the server refuses to store it without the key.
- Endpoints/actions called (all reads): `utilities/organizationUserListNew`, `task/list`, `task/get`, `leads/list`, `invoice/list`, `timesheet/list`. The extension's keep-alive also calls `task/taskListStatusCount` from the browser (`neo-centra-extension/background.js`).
- Writes: **none**. No create/update/close/time-log action exists anywhere in the repo. Note that every read is an HTTP POST (Turia's RPC style), so a guard cannot tell reads from writes by method; it must allowlist actions.
- Failure handling: 401/403/451 or non-JSON response → `TuriaSessionError` ("refresh the cookie").
- Documentation: none. `neo-centra-extension/README.md` states "Turia has no API"; `turia.ts` describes the calls as "Turia's internal API". No Turia API key, client id or docs exist in the repo.
- Debug: `turia-debug` and `hours-debug` routes return raw Turia payloads when `NEO_CENTRA_DEBUG=1`.

Firm OS reuse: REUSE the encrypted session and read calls for `UiAutomationBridge` read-first
(Phase 3, 8). ManualBridge is the default (ADR-003). Dashboard link `https://practice.turia.in/`
(`src/app/dashboard/page.tsx:687`) LEAVE.

### 8.4 greytHR — attendance CSV import

- No greytHR API. Links to `https://streamlining.greythr.com/` on `/dashboard` (`src/app/dashboard/page.tsx:678`) and in the importer.
- `/admin/attendance`: the monthly greytHR attendance CSV is parsed in the browser (`src/app/admin/attendance/AttendanceImporter.tsx`), saved by a server action in `src/app/admin/attendance/page.tsx` into `AttendanceRecord` (working days, present days, late marks, `source = "greytHR"`), scored by `src/lib/attendance.ts` (≥95% → 10 points …).
- No punch-in/out timestamps are stored.

Firm OS reuse: LEAVE. The Phase 9 break nudge specifies "greytHR punch-in + LMS heartbeats"; the
punch-in signal does not exist in the LMS (gap G-6).

### 8.5 Work nudges — `src/lib/work/`, Teams

- `/work` is a two-person tech work tracker gated by `WORK_TRACKER_EMAILS` (outsiders get 404). Rules in `core.ts`, writes in `db.ts`, append-only `WorkEvent`.
- `/api/cron/work` jobs: `morning` (names users with no pick today), `friday` (week review pending), `close` (carry picks, auto-pause).
- `src/lib/work/teams.ts` posts plain text to one Teams chat ("Tech Work") as the lead, via `getUserGraphToken(lead, LEAD_SCOPES)`; chat id stored in `Settings.workTeamsChatId`. Internal only.

Firm OS reuse: EXTEND the cron entry and REUSE the Teams posting pattern for the Daily Coach
(Phase 9). The `/work` pages themselves are not the place for firm JobTasks (gap G-7).

### 8.6 SOP Builder — `src/lib/sop/`

- `/tools/sop-builder`: author describes a procedure → `analyzeSopRequest` (Gemini guardrail + brief) → `generateSop` (structured JSON) → `render.ts` builds a .docx → `storage.ts` saves to `<L&D>/SOP/<Department>/`. Versions in `SopVersion`; `SopEditor` grants per department (`src/lib/sop/access.ts`).
- Gemini callers: `src/lib/sop/gemini.ts` via `callGemini`; free text is sent unmasked (gap G-3).

Firm OS reuse: LEAVE. Firm OS `SopPack` (versioned checklists and calendars) is a separate model;
SOP Word documents may be linked from a pack as references.

### 8.7 Office Tools — `src/lib/office-tools/`

- `registry.ts` lists nine tools: rental, MOU, partnership, trust, LLP deeds, engagement letter, GSTR-3B, TDS challan, director's report.
- Tax parsers: `tools/gstr3b.ts` and `tools/tdsChallan.ts` parse uploaded PDFs with `pdf-parse` (`pdf.ts`) into Excel (`exceljs`, `xlsx.ts`). Local only: no network, no AI, nothing stored; each run logged in `OfficeToolRun` (`audit.ts`).
- Document generators render Word via `docx.ts`. Engagement letters: own state machine (`engagement-letter-flow.ts`), PDFs under `GRAPH_EL_ROOT`, email via `sendMailAsUser` on a staff click (H-3).

Firm OS reuse: REUSE the GSTR-3B parser (Phase 5, prior-return input) and TDS challan parser
(Phase 7, deducted vs deposited) as deterministic extractors. Others LEAVE.

### 8.8 Certificate generator — `src/lib/certificates/`

- Twelve ICAI formats plus audit report and drafts (`templates/`), rendered deterministically; `CertificateIssue` stores the input payload and template hash, not the file. No network, no AI.
- `templates/format-vi.ts:141` contains the text `https://www.incometax.gov.in/iec/foportal/` as certificate wording (no call).

Firm OS reuse: LEAVE (Phase 12 regression).

### 8.9 Statutory updates — `src/lib/statutory/`, `statutory-extension/`

- Server collectors (`src/lib/statutory/cloud.ts`, run by `/api/cron/statutory`), all `GET`/`HEAD` of public pages, no login:
  `www.incometax.gov.in/iec/foportal/latest-news`, `www.labour.gov.in` (WordPress JSON API), `www.icai.org`, `cbic-gst.gov.in` (tickers), `ptax.karnataka.gov.in`, `www.gstcouncil.gov.in`, `pib.gov.in/PressReleasePage.aspx` (press release text). `docText()` also fetches whatever document URL a post links to. `egazette.gov.in` appears only as a filter string.
- Browser extension (`statutory-extension/`, runs on an office PC in India because six portals refuse non-Indian IPs; pushes to `POST /api/tools/statutory/ingest` with `STATUTORY_RELAY_TOKEN`): `www.incometaxindia.gov.in` (public search API, `POST /o/search/v1.0/search` query), `taxinformation.cbic.gov.in`, `www.gst.gov.in/newsandupdates`, `www.mca.gov.in`, `www.epfo.gov.in`, `esic.gov.in`. `statutory-extension.zip` at the repo root is a packaged copy.
- Read-only throughout: no credentials, no form submission, no filing. `tdscpc.gov.in` is not referenced anywhere.
- Summaries: `src/lib/statutory/digest.ts` sends post title and the first ~1,800 characters of public document text to Gemini (`callGemini`). Public data only.

Firm OS reuse: REUSE `StatutoryPost` read-only as a signal for `difficulty = 'novel'` (Phase 5–6).
The collectors stay as they are; the no-portal guard must allowlist them (H-6).

### 8.10 Client ops (renewals) — `src/lib/client-ops/`

Web-hosting clients (`OpsClient`), deliberately separate from CA `Client` (`docs/client-ops.md`).
Public lookups only: RDAP via `rdap.org` and a TLS handshake on port 443. Reminders are drafted as
`mailto:` text, not sent. Writes via server actions in `src/app/tools/client-ops/actions.ts`.
Firm OS reuse: LEAVE.

### 8.11 Gemini — `src/lib/gemini.ts` and every caller

`src/lib/gemini.ts` exports `resolveGeminiModel`, `isThinkingModel`, `callGemini`; it calls
`generativelanguage.googleapis.com` with `GEMINI_API_KEY`. Three files bypass `callGemini` and call
the endpoint directly. None of these calls go through a router or anonymizer.

| File | Called from | Transport | Data sent | Client-data exposure |
|---|---|---|---|---|
| `src/lib/gemini.ts` | below | `fetch` to Gemini REST | prompt as given | n/a |
| `src/lib/quiz-gen.ts` | `/api/admin/quiz/generate`, `/admin/video/[id]` (server action), `src/lib/auto-quiz.ts` | direct `fetch` (lines 290-309) | admin-pasted script/notes or a video transcript | Low: training content; admin could paste client material |
| `src/lib/distill.ts` | `src/lib/auto-quiz.ts` | direct `fetch` (lines 91-97) | long transcripts | Same as source transcript |
| `src/lib/transcribe.ts` | `src/lib/auto-quiz.ts` | direct `fetch`, Gemini Files API upload then `DELETE` (line 215) | full video bytes | **Medium**: includes Teams live-session recordings ingested automatically every 15 min; a session may discuss real client matters |
| `src/lib/auto-quiz.ts` | `/api/admin/quiz/from-video`, `src/lib/live/ingest.ts` (cron) | orchestrates the three above | Teams meeting transcript (`fetchMeetingTranscript`) or video | **Medium**, as above |
| `src/lib/sop/gemini.ts` | `/api/tools/sop-builder/analyze`, `src/lib/sop/service.ts` (`/api/tools/sop-builder/sops`, `.../versions`) | `callGemini` | staff free text: title, purpose, procedure description | **Medium**: free text from any SOP author, unmasked; may include client names or identifiers used as examples |
| `src/lib/statutory/digest.ts` | `/api/cron/statutory`, `/api/tools/statutory/ingest` | `callGemini` | public portal post titles and text | None (public) |

Firm OS reuse: LEAVE on Gemini (ADR-002). All Firm OS AI goes through `src/lib/ai/router.ts`.

### 8.12 Shared infrastructure

| File | Purpose | Firm OS reuse |
|---|---|---|
| `src/lib/auth.ts`, `src/lib/auth-handlers.ts` | NextAuth v5, Entra, database sessions, ADMIN_EMAILS promotion | REUSE |
| `src/lib/access.ts` | `isActive`, `isAdmin`, `isPartner`, `isManagement` | REUSE; `src/lib/rbac/policy.ts` composes it (ADR-001) |
| `src/lib/ist.ts` | The firm's clock (only file naming `Asia/Kolkata`) | REUSE (calendar engine, coach, reconciler) |
| `src/lib/cron-auth.ts` | `cronUnauthorized`, `bearerUnauthorized` (constant time) | REUSE |
| `src/lib/secret-box.ts` | AES-GCM seal/open, `keyFromEnv` | REUSE (anonymizer token map at rest, ADR-006) |
| `src/lib/settings.ts` | Singleton settings row | REUSE |
| `src/lib/ca-firm.ts` | Departments, levels, labels | REUSE |
| `src/lib/prisma.ts` | Prisma client | REUSE |
| `src/components/ui.ts` | Class strings and `call()` fetch wrapper | REUSE (single design system) |
| `tailwind.config.ts` | Brand tokens (`brand-500 #5b4be6`, `ink`, `card`) | REUSE; Firm OS extends, does not add a second palette |

## 9. Hazards the Firm OS guard scripts must handle

Existing code that a naive repository-wide grep would flag. The guards (`verify:no-portal`,
`verify:no-delete`, `verify:ai-boundary`, and Phase 10's no-`sendMail` test) should allowlist exactly
these paths, by file, with a reference to this section, and fail on anything new.

| Id | Hazard | Where | Why it exists | Guard handling |
|---|---|---|---|---|
| H-1 | `deleteDriveItem` export | `src/lib/graph.ts:747`; caller `src/lib/live/ingest.ts:337` | Removes a wrongly copied training recording on re-pull | Allow in these two files; forbid import from `src/lib/{ai,agents,integrations,close-loop,audit,rbac}` and Firm OS routes |
| H-2 | `deleteEvent` export | `src/lib/graph.ts:464`; callers `src/lib/live/schedule.ts:176`, `:362` | Cancels a scheduled Teams training session | Same as H-1 |
| H-3 | `sendMailAsUser` export | `src/lib/graph.ts:992`; caller `src/app/api/tools/engagement-letters/[id]/send/route.ts:51` | Human-clicked client email of an engagement letter | Allow these two files; Phase 10 test asserts no other caller |
| H-4 | `moveDriveItem` (rename/move) | `src/lib/graph.ts:725`; callers `src/lib/clients/storage.ts:137`, `src/lib/live/schedule.ts:220` | LMS client-folder rename; live-session folder relocation | Not a delete, but Firm OS must not move legacy folders (ADR-004); forbid in Firm OS dirs |
| H-5 | Prisma hard deletes in LMS code | `src/app/admin/{assignments,attendance,branches,courses,page}.tsx`, `src/app/admin/video/[id]/page.tsx`, `src/app/api/clients/jobs/[jobId]/route.ts:37` (`Job`, refused while documents attached), `src/app/api/clients/documents/[docId]/route.ts:13` (unlinks `ClientDocument`, file stays), `src/app/api/tools/certificate-generator/field-options/[id]/route.ts`, `src/app/api/tools/neo-centra/{hours-splits,internal-budgets,profit-splits}/route.ts`, `src/app/api/tools/sop-builder/grants/[userId]/route.ts`, `src/app/initiatives/page.tsx`, `src/app/wizard/{initiative,quests}/page.tsx`, `src/lib/live/{ingest,attendance}.ts`, `src/lib/users-sync.ts:85` (sessions of deactivated users), `src/lib/work/db.ts:220` | Existing LMS behaviour | Scope `verify:no-delete` to Firm OS dirs and the Turia/SharePoint adapters; do not retrofit LMS |
| H-6 | Government domains in code | `src/lib/statutory/cloud.ts:70` (`www.incometax.gov.in`, matches the forbidden pattern), plus `labour.gov.in`, `cbic-gst.gov.in`, `ptax.karnataka.gov.in`, `gstcouncil.gov.in`, `pib.gov.in`; `src/lib/statutory/portals.ts:7`; `src/lib/certificates/templates/format-vi.ts:141` (text only); `statutory-extension/{background.js,collectors.js,manifest.json}` (`www.gst.gov.in`, `www.mca.gov.in`, `incometaxindia.gov.in`, `taxinformation.cbic.gov.in`, `epfo.gov.in`, `esic.gov.in`); `statutory-extension.zip` (binary) | Read-only public news collection; certificate wording | Allowlist these files; no other file may name `gst.gov.in`, `mca.gov.in`, `incometax.gov.in`, `tdscpc.gov.in`. Skip or separately check the `.zip`. |
| H-7 | Gemini calls outside a router | `src/lib/gemini.ts`, `src/lib/quiz-gen.ts:290-309`, `src/lib/distill.ts:91-97`, `src/lib/transcribe.ts:81,143,160,215` (direct `generativelanguage.googleapis.com`); `src/lib/sop/gemini.ts`, `src/lib/statutory/digest.ts` (via `callGemini`) | Legacy LMS AI (ADR-002) | Allowlist these files; `@anthropic-ai/sdk`, xAI and any LLM endpoint permitted only in `src/lib/ai/providers/*`; no Firm OS file may import `@/lib/gemini` |
| H-8 | Turia reads are HTTP POSTs | `src/lib/neo-centra/turia.ts:57`, `neo-centra-extension/background.js:34` | Turia's RPC style | Guard Turia writes by action name, not HTTP method; Firm OS Turia adapter exposes no delete |
| H-9 | Raw Turia payload endpoints | `src/app/api/tools/neo-centra/turia-debug/route.ts`, `hours-debug/route.ts` | Diagnostics, gated by `NEO_CENTRA_DEBUG` | Keep unset in prod (Phase 11 check) |
| H-10 | Teams chat post outside `graph.ts` | `src/lib/work/teams.ts` | Internal nudges as the lead | Internal only; Firm OS coach must not post to client chats |

## 10. Known gaps and items needing a human

| Id | Item | Effect on Firm OS | Owner / action |
|---|---|---|---|
| G-1 | No documented Turia API in the repo; integration uses a browser session cookie against internal endpoints | ManualBridge is the default (ADR-003) | **Blocked / needs human**: ask Turia for API documentation and credentials |
| G-2 | Gemini auto-transcription of Teams live-session recordings and transcripts runs unattended (cron) and unmasked | Possible client data to a cloud model outside DPDP controls | Known gap, ADR-002/006; partner to decide whether client matters are ever discussed in recorded sessions |
| G-3 | SOP Builder sends free text unmasked to Gemini | Same | Known gap; candidate: route through the anonymizer in a later phase, or a UI notice |
| G-4 | Entra group membership not read; roles today are `role` (ADMIN/EMPLOYEE) and `level` (PARTNER …) | Firm OS role mapping from groups needs a groups claim or `GroupMember.Read.All` | **Needs human** if admin consent is required (ADR-001) |
| G-5 | SharePoint site creation (`CL-{Code}` sites joined to the hub) needs SharePoint admin rights; current app documents `Files.ReadWrite.All` only | Phase 1 `ensureClientSite` | **Needs human**: PnP app `381abf0e-…` certificate/secret and admin consent (ADR-004) |
| G-6 | greytHR data is monthly CSV only; no punch-in timestamps | Phase 9 break nudge cannot use greytHR punch-in | Use LMS activity heartbeats only (new, 7-day retention, ADR-006); greytHR API access would need a human decision |
| G-7 | `/work` is a two-person tech tracker behind an email allow-list; the plan expects assignee JobTasks "on /work" | Firm OS jobs need a home visible to all staff | Phase 3/9 decision: show JobTasks on `/dashboard` (coach) and `/agents`; reuse `/work` patterns and cron, not its pages |
| G-8 | `docs/ARCHITECTURE.md` §12 omits two crons; README env table incomplete | Documentation only | Fix when those docs are next edited |
| G-9 | `GRAPH_EL_ROOT` missing from `.env.example` | Documentation only | Add placeholder in a code PR |
| G-10 | `verify-statutory.ts` exists in `scripts/` but has no `npm run` entry | Not run by anyone | Add script entry in a code PR |
| G-11 | All workflows hard-code `https://lms.indefine.in` | Staging crons need their own URL | Phase 8 reconciler workflow should take the host from a secret/variable |

## 11. Firm OS phase map (what each phase reuses)

| Phase | Reuses from the LMS |
|---|---|
| 0 | `access.ts` predicates (baseline unit test), verify-script convention, this inventory |
| 1 | `graph.ts` token + folder + upload functions, `clients/storage.ts` layout (read-only), `/api/cron/clients` |
| 2 | `secret-box.ts` (token map at rest), `ModelCall` table |
| 3 | `/clients` and `Client`/`ServiceType`/`Job`, `FirmClient`, `EngagementLetter` (read), Neo Centra session (UiAutomationBridge), `ist.ts` |
| 4 | `components/ui.ts`, `exceljs`/`docx` already in dependencies, `WorkEvent` append-only pattern |
| 5 | Office Tools GSTR-3B parser, `StatutoryPost` |
| 6 | `StatutoryPost` |
| 7 | Office Tools TDS challan parser |
| 8 | `cron-auth.ts`, workflow pattern, Neo Centra session health, Graph reads for deliverable verification |
| 9 | `/dashboard`, `/api/cron/work`, `work/teams.ts` posting pattern, `ist.ts` |
| 10 | `/connect` scope tiers (new draft-only tier) |
| 11 | `access.ts`, `AuditEvent`, `OfficeToolRun` audit pattern |
| 12 | Whole LMS regression: SSO, `/work` nudges, `/tools` (SOP Builder, GSTR-3B/TDS, certificates), greytHR/Turia links |
