# PROGRESS — Indefine Firm OS
Current phase: 0 — Inventory & ADRs (1, 2 running in parallel) | Branch: firm-os/phase-0-inventory | Last green: 2026-11-05 18:54 IST
Tests: unit 2/2 · integration 0/0 · e2e 0/0 · accuracy: GST P=– R=– | ROC – | TAX – | BOOKS – | AUDIT –
Model mode: CLAUDE_ONLY + LOCAL_STUB(fail-closed)

## Phase checklist (✅ only when QA gate green)
- [ ] 0 Inventory & ADRs
- [ ] 1 Path A finish + /clients → CL-{Code}
- [ ] 2 ModelRouter + anonymizer + local stub
- [ ] 3 Onboarding Agent
- [ ] 4 Task-agent framework
- [ ] 5 GST Prep
- [ ] 6 ROC Prep + Tax Prep
- [ ] 7 Books Close + Audit Assist
- [ ] 8 Close loop
- [ ] 9 Daily Coach
- [ ] 10 Client Comms drafts
- [ ] 11 Hardening
- [ ] 12 Foolproof QA (STOP for human go-live)
- [ ] 2b Local open-weight wiring (WEEK 2)

## Current phase tasks
Phase 0
- [x] 1a Baseline: `npm ci`, `prisma generate`, `tsc --noEmit` green, `next lint` green (no warnings). Repo had no test framework — Vitest 3.2 + coverage-v8 + Playwright 1.64 added.
- [ ] 1b Smoke test per existing route (/dashboard, /clients, /work, /tools) behind mocked session
- [ ] 2 docs/inventory.md
- [ ] 3 ADR-001 … ADR-006
- [x] 4a PROGRESS.md bootstrapped; npm scripts `verify:no-skip|secrets|no-portal|no-delete|ai-boundary` registered
- [ ] 4b Guard scripts implemented and passing
- [ ] 5 CI workflow (lint, typecheck, unit, verify-*; e2e on PR)

Shared foundation (commit c61d885): additive Prisma section "Firm OS: shared spine" — `FirmClient`, `ModelCall`, `AuditEvent` + enums; migration `20261105190000_firm_os_spine` (CREATE only, no ALTER/DROP of LMS columns).

## Feature test registry   (feature → test file → status)
| Feature | Test file | Status |
|---|---|---|
| LMS access predicates (baseline) | tests/unit/access.test.ts | green |

## Accuracy scoreboard     (agent → fixture set → precision → recall → threshold → pass/fail → date)
_None yet (from Phase 5)._

## Decisions (ADR index)
- Package manager is npm (repo convention): spec's `pnpm x` = `npm run x`.
- Pages follow the existing flat layout `src/app/<module>/` — the repo has no `(portal)` route group.
- ADR-001 … ADR-006: in progress (docs/adr/).

## Blocked / needs human   (what · why · exact action · since)
_None yet._

## Known gaps / tech debt
- `npm ci` on npm 11 skips install scripts not covered by `allowScripts` (prisma, esbuild); run `npx prisma generate` after install locally.
- No local Postgres/Docker on this machine: DB-backed integration and e2e runs need a staging DB.

## Log                      (IST time · phase · what · tests)
- 18:48 · 0 · Cloned Indefine_LMS, branch firm-os/phase-0-inventory from main 33d113f · –
- 18:52 · 0 · Baseline typecheck + lint green · –
- 18:54 · 0 · Test tooling + Firm OS schema spine committed (c61d885) · unit 2/2
- 18:56 · 0/1/2 · Parallel agents started: P0 docs, P0 guards+CI, P1 SharePoint, P2 ModelRouter · –
