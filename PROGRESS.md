# PROGRESS — Indefine Firm OS
Current phase: 1 + 2 (parallel) | Branch: firm-os/phase-0-inventory | Last green: 2026-11-05 19:40 IST
Tests: unit 56/56 · integration 0/0 · e2e 4/4 (smoke, local, no DB) · accuracy: GST P=– R=– | ROC – | TAX – | BOOKS – | AUDIT –
Model mode: CLAUDE_ONLY + LOCAL_STUB(fail-closed)

## Phase checklist (✅ only when QA gate green)
- [x] 0 Inventory & ADRs ✅ (QA gate green 19:40 IST)
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
- [x] 1b Route smoke tests: tests/unit/routes/* (13 tests, full server render behind mocked session; signed-out → redirect /)
- [x] 2 docs/inventory.md — 130 routes (71 pages, 59 handlers), 6 crons, 28 env vars, 64 models, 12 integrations, hazards H-1…H-10
- [x] 3 ADR-001 … ADR-006 in docs/adr/
- [x] 4a PROGRESS.md bootstrapped; npm scripts `verify:no-skip|secrets|no-portal|no-delete|ai-boundary` registered
- [x] 4b Guard scripts: scripts/lib/guards.ts + 5 CLIs, 41 rule tests; all OK on repo
- [x] 5 .github/workflows/firm-os-ci.yml (checks job + e2e job with postgres:16 on PR) — not yet run on GitHub

Phase 0 QA gate: `next build` green · verify-* 5/5 pass · 6 ADRs · inventory covers every route in src/app (glob) · existing verify:access|cron-auth|secret-box|graph-scopes|work|clients|office-tools|profit-split pass without secrets.

Shared foundation (commit c61d885): additive Prisma section "Firm OS: shared spine" — `FirmClient`, `ModelCall`, `AuditEvent` + enums; migration `20261105190000_firm_os_spine` (CREATE only, no ALTER/DROP of LMS columns).

## Feature test registry   (feature → test file → status)
| Feature | Test file | Status |
|---|---|---|
| LMS access predicates (baseline) | tests/unit/access.test.ts | green |
| Guard rules (no-skip, secrets, no-portal, no-delete, ai-boundary) | scripts/lib/guards.test.ts | green (41) |
| Route smoke /dashboard /clients /work /tools | tests/unit/routes/*.test.ts | green (13) |
| E2E smoke: signed-out redirect | tests/e2e/smoke.spec.ts | green 4/4 local |

## Accuracy scoreboard     (agent → fixture set → precision → recall → threshold → pass/fail → date)
_None yet (from Phase 5)._

## Decisions (ADR index)
- Package manager is npm (repo convention): spec's `pnpm x` = `npm run x`.
- Pages follow the existing flat layout `src/app/<module>/` — the repo has no `(portal)` route group.
- ADR-001 Extend LMS · ADR-002 ModelRouter · ADR-003 Turia (ManualBridge default — no documented Turia API) · ADR-004 SharePoint Path A · ADR-005 Close loop for DONE · ADR-006 DPDP data classes (docs/adr/).
- Guard allowlists (frozen, Firm OS dirs never allowlistable): LEGACY_PORTAL_READONLY = src/lib/statutory/cloud.ts, statutory-extension/{background.js,collectors.js,manifest.json} (public news reads), src/lib/certificates/templates/format-vi.ts (certificate wording only, no network allowed). LEGACY_GEMINI = src/lib/{gemini,quiz-gen,distill,transcribe}.ts.
- verify:no-delete scope is Firm OS code only; legacy LMS deletes (graph.ts deleteDriveItem/deleteEvent, ~20 Prisma deletes) documented in inventory H-1…H-5.

## Blocked / needs human   (what · why · exact action · since)
- Turia API docs/credentials · ADR-003 · ask Turia for a documented API + credentials, and confirm UI automation is permitted · 2026-11-05
- PnP app 381abf0e-… certificate + SharePoint/Entra admin consent for site creation · Phase 1 ensureClientSite · upload cert, grant consent · 2026-11-05
- Entra group → role mapping · nothing reads groups today · add groups claim (or GroupMember.Read.All consent) to the Entra app · 2026-11-05
- Push branches / open PRs · no gh CLI on this machine · human approval to push firm-os/* branches · 2026-11-05

## Known gaps / tech debt
- `npm ci` on npm 11 skips install scripts not covered by `allowScripts` (prisma, esbuild); run `npx prisma generate` after install locally.
- No local Postgres/Docker on this machine: DB-backed integration and e2e runs need a staging DB; `prisma migrate deploy` on a fresh DB not yet exercised (CI e2e job will).
- Legacy Gemini calls outside the router: live-session recordings/transcripts (transcribe.ts, auto-quiz.ts, live/ingest.ts) and SOP Builder free text go to Gemini unmasked (ADR-002/006, inventory H-7) — needs a partner decision.
- Engagement-letter send (sendMailAsUser) is an existing client-facing send; Phase 10 "no sendMail" guard must allowlist that legacy route explicitly.
- /work is a two-person tech tracker behind an email allow-list — JobTasks will surface on /dashboard + /agents instead (inventory G-7).
- greytHR is a monthly CSV only — Phase 9 break nudge needs an LMS activity heartbeat (G-6).
- Workflows hard-code https://lms.indefine.in (staging crons need a variable) (G-11).

## Log                      (IST time · phase · what · tests)
- 18:48 · 0 · Cloned Indefine_LMS, branch firm-os/phase-0-inventory from main 33d113f · –
- 18:52 · 0 · Baseline typecheck + lint green · –
- 18:54 · 0 · Test tooling + Firm OS schema spine committed (c61d885) · unit 2/2
- 18:56 · 0/1/2 · Parallel agents started: P0 docs, P0 guards+CI, P1 SharePoint, P2 ModelRouter · –
- 19:05 · 0 · Full Firm OS schema (JobTask state machine etc.) committed 08fe596, additive only · unit 2/2
- 19:25 · 0 · Merged inventory + ADRs (072802e) · –
- 19:32 · 0 · Merged guards, route smoke, Playwright, CI · unit 56/56, verify 5/5
- 19:40 · 0 · next build green → Phase 0 QA gate ✅ · unit 56/56 · e2e 4/4
