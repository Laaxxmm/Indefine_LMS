# ADR-001: Extend the LMS, do not build greenfield

- **Status:** Accepted, 2026-11-05
- **Deciders:** Lakshmanan A (owner); Firm OS lead engineer
- **Related:** `docs/inventory.md`, ADR-002 … ADR-006

## Context

Indefine LMS (lms.indefine.in, Railway) already gives every staff member Microsoft 365 sign-in,
a client master with SharePoint folders (`/clients`), Turia reads (Neo Centra), Teams nudges
(`/work`), and the office tools staff use daily. Firm OS adds onboarding, task agents, a
mandatory close loop, a model router, a daily coach and client-message drafts. A second
application would duplicate sign-in, roles, Graph access, the client list and the design
system, and staff would have two portals.

The repository has its own conventions (README "Conventions for new code", `docs/ARCHITECTURE.md`
§10). The orchestrator spec was written before reading them and differs in a few places (pnpm, a
`(portal)` route group, server actions).

## Decision

Firm OS is built inside this repository, following its conventions. Where the spec and the repo
differ, the repo wins:

| Topic | Decision |
|---|---|
| Package manager | npm (the repo has `package-lock.json`). The spec's `pnpm x` means `npm run x`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e`, `npm run verify:*`. |
| Pages | Flat layout `src/app/<module>/`, as every existing module does: `src/app/onboard/`, `src/app/agents/` (incl. `agents/[agent]/`), `src/app/coach/`, `src/app/comms/`, `src/app/admin/firm-os/`. The repo has no `(portal)` route group, so none is added. |
| Server code | Route handlers under `src/app/api/firm-os/**/route.ts` (auth → zod parse → one lib call → JSON), called from `"use client"` panels through `call()` in `src/components/ui.ts`. No new server actions. Cron handlers under `src/app/api/cron/<job>/` with `cronUnauthorized`. |
| Library code | `src/lib/ai`, `src/lib/agents`, `src/lib/integrations`, `src/lib/close-loop`, `src/lib/audit`, `src/lib/rbac`. Each follows the module template: pure rules in `core.ts`-style files, I/O in `db.ts`/service files. |
| Tests | Vitest (unit, integration) and Playwright (e2e) are added alongside the existing assert-based `scripts/verify-*.ts`, which stay and keep running. Guard scripts are `scripts/verify-<name>.ts` in the same style. |
| Roles | Reuse `src/lib/access.ts` (`isActive`, `isAdmin`, `isPartner`, `isManagement`). Firm OS roles `partner`, `manager`, `staff`, `admin` are derived in `src/lib/rbac/policy.ts`: `admin` = `isAdmin`; `partner` = `isPartner` (`level = PARTNER`) or member of Entra group Partners `e5583268-4c8c-4abf-8b35-3ef1f0d37a78`; `manager` = `level` in `MANAGER`, `SENIOR_MANAGER`, `ASSISTANT_MANAGER`; `staff` = any other active user, or member of Entra group Staff `67ed1191-302b-495a-913b-b93cc6ee118d`. No inline `role`/`level` string comparisons outside `access.ts`/`policy.ts`. |
| Schema | Additive only: one section `// -------------------- Firm OS: shared spine --------------------` at the end of `prisma/schema.prisma` (later Firm OS models join it). No drop, rename or type change of an existing LMS column. Migrations written with `prisma migrate diff`, read, committed. The first one (`20261105190000_firm_os_spine`) is CREATE-only. |
| Feature flags | `FIRM_OS_*` environment flags, all default OFF in production. Disabled means the LMS behaves exactly as before. |
| Dates, design | Dates through `src/lib/ist.ts`. Styling extends the existing Tailwind tokens and `ui.ts` class strings; no second design system. |
| Deletes | None on user data, SharePoint or Turia (unchanged LMS rule; ADR-004, ADR-005). |

## Consequences

- Staff keep one sign-in and one portal; Firm OS screens appear only when flags are on.
- Firm OS inherits LMS constraints: database sessions, the single Graph drive, Railway memory limits (`--max-old-space-size=384` in `npm start`).
- Entra group membership is not read anywhere today. Mapping roles from the Partners/Staff groups needs either a `groups` claim in the token or a Graph `GroupMember.Read.All`/`User.Read.All` lookup; if admin consent is needed it goes under "Blocked / needs human". Until then roles come from `level`/`role` alone.
- LMS regressions are a real risk; Phase 12 re-tests SSO, `/work` nudges, `/tools` and the greytHR/Turia links.
- The spec's file paths that say `src/app/(portal)/…` are read as `src/app/…`.

## Alternatives considered

1. **Greenfield Firm OS app** sharing the database. Rejected: duplicates auth, Graph tokens, roles, UI; two deploys; two places staff look.
2. **Separate service behind the LMS** (API only). Rejected for now: adds a network hop and a second secret store for no isolation benefit at 16 staff.
3. **Adopt pnpm and a `(portal)` route group as the spec says.** Rejected: changes the lockfile and the layout of a live app for no functional gain.
