# PROGRESS — Indefine Firm OS
Current phase: 3 + 4 (parallel) | Branch: firm-os/phase-0-inventory | Last green: 2026-11-05 21:35 IST
Tests: unit+integration 1198/1198 (43 files; Firm OS coverage 99.7% lines / 97.4% branches) · e2e 4/4 (smoke, local, no DB) · accuracy: GST P=– R=– | ROC – | TAX – | BOOKS – | AUDIT –
Model mode: CLAUDE_ONLY + LOCAL_STUB(fail-closed) | Turia bridge: MANUAL (ADR-003)

## Phase checklist (✅ only when QA gate green)
- [x] 0 Inventory & ADRs ✅ (QA gate green 19:40 IST)
- [x] 1 Path A finish + /clients → CL-{Code} ✅ (20:25 IST; live verify-patha Blocked — creds)
- [x] 2 ModelRouter + anonymizer + local stub ✅ (20:25 IST; live Claude smoke Blocked — key)
- [ ] 3 Onboarding Agent — code complete, unit/integration green; QA gate pending e2e 3/3 (Blocked: staging DB + partner session)
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

Phase 1 (merged from worktree branch, commits 6509370…09ae301)
- [x] 1 docs/folder-contract.md
- [x] 2 paths.ts — clSiteUrl, deliverablePath, fyLabel (IST), periodLabel, validateClientCode; 100% branches
- [x] 3 graph-client.ts (GET/POST only, no delete/move/rename; 429/5xx retry w/ Retry-After) · sp-auth.ts (PnP cert RS256 assertion) · clfolders.ts ensureClientSite / ensureFyTree / ensureClientLists / ensureClientUploadGroup — idempotency test: 2nd run = 0 writes
- [x] 4 scripts/verify-patha.ts (`npm run verify:patha`) — **Blocked** (exit 2): no MS_* / SP_PNP_* creds on this machine
- [x] 5 FIRM_OS_CL_PATHS on /clients (off = unchanged, FirmClient not queried) · scripts/map-legacy-folders.ts dry-run (`npm run map:legacy-folders`) — Blocked: needs DATABASE_URL
QA gate: paths 100% branches · Graph mocked · verify-patha Blocked with reason · idempotency test green · verify:no-delete OK · verify:clients OK before/after.

Phase 2 (merged, commits 03466a2…dbc8a0e)
- [x] 1 providers claude (output_config.format JSON, own backoff, no sampling params — API rejects temperature), grok (fetch, disabled w/o key), local stub (fail-closed)
- [x] 2 anonymizer — PAN, GSTIN (mod-36), Aadhaar (Verhoeff), CIN/LLPIN, DIN, TAN, IFSC+a/c, phone, email, DOB, PIN, dictionary names; 250 synthetic strings zero leaks + exact round-trip; business strings survive
- [x] 3 router decideRoute + run, budget guard (per-run + AI_DAILY_BUDGET_INR), ModelCall logging (masked-prompt sha256), /admin/firm-os/models usage page
- [x] 4 router tests: 18 decideRoute rows + 28 run cases incl. payload leak spy
QA gate: router + anonymizer green · verify:ai-boundary OK · src/lib/ai 99.5% lines.

Phase 4 (in progress)
- [x] 2 checklist.ts — rules as data, deterministic registry, LLM rules need quote+location, MistakeLog-promoted rules (source 'mistake')
- [x] 3 templates.ts — XLSX/DOCX fixed header block, Indian grouping, draft label, sha256; deterministic output
- [x] state.ts + state-db.ts — JobTask state machine (81-pair table test), single-transaction transition + JobTaskEvent, optimistic concurrency; DONE only with a single-use CloseGateToken minted by close-loop/gate.ts (Phase 8)
- [ ] 1 runner.ts · 4 mistakes.ts · 5 review UI /agents · 6 scripts/accuracy.ts (agent running)
Phase 3 (in progress)
- [x] 6 calendar.ts + calendar-defaults.ts — rules as data; GSTR-1/3B (QRMP state groups), GSTR-9/9C, TDS, advance tax, ITR, AOC-4, MGT-7, DIR-3 KYC, ADT-1, MSME-1; internal due = statutory − buffer, rolled back past weekends
- [x] 1 /onboard chat page (partner/manager only; links on /tools and /clients nav)
- [x] 2 extractor (router, anonymize-then-cloud) + clarifier (≤ 5 missing fields per turn; falls back to questions if the router fails)
- [x] 3 validators in code: PAN, GSTIN checksum + state + embedded PAN, CIN/LLPIN, client-code uniqueness, assignee exists
- [x] 4 plan preview; FIRM_OS_ONBOARD_CONFIRM (default true) requires "Create"
- [x] 5 saga (LMS client via new src/lib/clients/service.ts shared with POST /api/clients → Turia ManualBridge → ensureClientSite/ensureFyTree → Engagement + JobTasks via calendar planner → summary); resumable; SharePoint BlockedError → step BLOCKED with action
- [x] 7 failure at each of 6 steps + resume, no duplicates, no deletes
- [ ] e2e 3/3: tests/e2e-db/onboard.spec.ts via `npm run e2e:db` (playwright.db.config.ts, --repeat-each=3) — **Blocked**: staging DB, E2E_PARTNER_STATE, ANTHROPIC_API_KEY

Shared foundation (commit c61d885): additive Prisma section "Firm OS: shared spine" — `FirmClient`, `ModelCall`, `AuditEvent` + enums; migration `20261105190000_firm_os_spine` (CREATE only, no ALTER/DROP of LMS columns).

## Feature test registry   (feature → test file → status)
| Feature | Test file | Status |
|---|---|---|
| LMS access predicates (baseline) | tests/unit/access.test.ts | green |
| Guard rules (no-skip, secrets, no-portal, no-delete, ai-boundary) | scripts/lib/guards.test.ts | green (41) |
| Route smoke /dashboard /clients /work /tools | tests/unit/routes/*.test.ts | green (13) |
| E2E smoke: signed-out redirect | tests/e2e/smoke.spec.ts | green 4/4 local |
| SharePoint paths / FY / periods | src/lib/integrations/sharepoint/paths.test.ts | green |
| Graph client, PnP auth, config | src/lib/integrations/sharepoint/{graph-client,sp-auth,config}.test.ts | green |
| ensure* idempotency (fake SharePoint) | src/lib/integrations/sharepoint/clfolders.integration.test.ts | green |
| Path A gap check | src/lib/integrations/sharepoint/patha-check.test.ts | green |
| /clients CL links + legacy map | client-links.test.ts, legacy-map.test.ts, tests/unit/routes/client-detail.test.ts | green |
| No destructive ops (Path A) | src/lib/integrations/sharepoint/no-destructive.test.ts | green |
| Anonymizer (250 synthetic, zero leaks) | src/lib/ai/__tests__/anonymizer.test.ts | green (279) |
| Router policy + leak spy | src/lib/ai/__tests__/router.test.ts | green |
| Providers | src/lib/ai/providers/__tests__/*.test.ts | green (23) |
| Model usage aggregation | src/lib/ai/__tests__/usage.test.ts | green |
| JobTask state machine + transition service | src/lib/agents/core/state.test.ts, state-db.test.ts | green (171) |
| Checklist engine | src/lib/agents/core/checklist.test.ts | green (30) |
| Deliverable templates + INR format | src/lib/agents/core/templates.test.ts, format.test.ts | green (54) |
| Statutory calendar | src/lib/agents/core/calendar.test.ts | green (69) |
| RBAC firmRole / canOnboard | src/lib/rbac/policy.test.ts | green |
| Turia adapter + ManualBridge | src/lib/integrations/turia/turia.test.ts | green |
| Onboarding extractor (20 fixtures), clarifier, validators, planner, plan | src/lib/agents/onboarding/*.test.ts | green |
| Onboarding saga (fail at each step + resume) | src/lib/agents/onboarding/saga.test.ts | green |
| Client creation service (shared) | tests/unit/clients-service.test.ts | green |
| /onboard page + API (403/400) | tests/unit/routes/onboard*.test.ts | green |
| E2E onboarding golden path | tests/e2e-db/onboard.spec.ts | Blocked (staging DB) |

## Accuracy scoreboard     (agent → fixture set → precision → recall → threshold → pass/fail → date)
_None yet (from Phase 5)._

## Decisions (ADR index)
- Package manager is npm (repo convention): spec's `pnpm x` = `npm run x`.
- Pages follow the existing flat layout `src/app/<module>/` — the repo has no `(portal)` route group.
- ADR-001 Extend LMS · ADR-002 ModelRouter · ADR-003 Turia (ManualBridge default — no documented Turia API) · ADR-004 SharePoint Path A · ADR-005 Close loop for DONE · ADR-006 DPDP data classes (docs/adr/).
- Guard allowlists (frozen, Firm OS dirs never allowlistable): LEGACY_PORTAL_READONLY = src/lib/statutory/cloud.ts, statutory-extension/{background.js,collectors.js,manifest.json} (public news reads), src/lib/certificates/templates/format-vi.ts (certificate wording only, no network allowed). LEGACY_GEMINI = src/lib/{gemini,quiz-gen,distill,transcribe}.ts.
- Models (env-overridable): FAST claude-haiku-5-5 · SMART claude-sonnet-5-5 · HARD claude-opus-5-5 · Grok grok-4 (price unverified, configurable). USD_INR 88, ROUTER_MIN_CONF 0.75, AI_DAILY_BUDGET_INR 1000. `judgement` difficulty routes SMART→HARD (spec silent). Local-model calls are not masked (data stays on LAN); ModelCall hash always of masked prompt.
- Onboarding: LMS Client.turnover is required, so turnover is a clarifier question (not defaulted). Existing client with same name/PAN is linked, not duplicated. Turia task issued only for the first period of each series. Firm OS UI keeps the LMS brand theme (violet) instead of the spec's teal fallback — spec says extend the existing theme. `isManager` added to src/lib/access.ts (MANAGER, SENIOR_MANAGER).
- JobTask edges added beyond spec: IN_PREP→IN_REVIEW (manual prep, no agent); FILED_BY_HUMAN/CLOSING→APPROVED retract-filing (manager/partner, note). No CLOSING→FILED_BY_HUMAN, nothing out of DONE. Ack ref required for GST/ROC/IncomeTax/TDS.
- Calendar: AGM-relative forms count AGM day as day 1 (configurable `countAgmDay`); statutory dates never moved, only flagged on non-working days.
- Path A: SP_SITE_OWNER required for app-only site creation; default period folders GST/Books 12 months, TDS Q1–Q4, others Annual; uploads stay on the legacy layout under the flag.
- verify:no-delete scope is Firm OS code only; legacy LMS deletes (graph.ts deleteDriveItem/deleteEvent, ~20 Prisma deletes) documented in inventory H-1…H-5.

## Blocked / needs human   (what · why · exact action · since)
- Turia API docs/credentials · ADR-003 · ask Turia for a documented API + credentials, and confirm UI automation is permitted · 2026-11-05
- PnP app 381abf0e-… certificate + SharePoint/Entra admin consent for site creation · Phase 1 ensureClientSite · upload cert, grant consent · 2026-11-05
- Entra group → role mapping · nothing reads groups today · add groups claim (or GroupMember.Read.All consent) to the Entra app · 2026-11-05
- Graph app-only creds + consent · verify-patha / ensure* · set MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET in .env.local; grant Graph application Sites.ReadWrite.All + Group.Read.All with admin consent · 2026-11-05
- SP_SITE_OWNER + hub registration · site creation · set owner UPN; confirm Indefine-Compliance is registered as a hub site (SP admin center → Active sites → Hub) · 2026-11-05
- ANTHROPIC_API_KEY (and optional XAI_API_KEY) · live router smoke call · put in .env.local / Railway · 2026-11-05
- Staging DATABASE_URL · map-legacy-folders report, /admin/firm-os/models view, DB e2e · provide Railway staging branch DB · 2026-11-05
- **Partner verification of calendar defaults** · CA judgement · confirm: QRMP 3B 22nd/24th state groups vs current CBIC notification; AGM day-counting convention; ITR non-audit due date under Income-tax Act 2025 / Finance Act 2026 (kept 31 Jul); DIR-3 KYC frequency (kept annual 30 Sep); 2025-Act form names for TDS/advance tax · 2026-11-05
- **Partner sign-off on onboarding catalog** · CA judgement · review JOB_CATALOG per entity type (src/lib/agents/onboarding/planner.ts) and PAN 4th-char rule per entity (validators.ts); calendar rules missing for Books close, Audit, Engagement letter, LLP Form 11/8; AGM date not captured at onboarding so AOC-4/MGT-7/ADT-1 stay pending · 2026-11-05
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
- 19:45 · 3/4 · Agent started: Phase 4 core (state machine, checklist, templates) + Phase 3 calendar · –
- 20:15 · 2 · Merged ModelRouter/anonymizer/providers/usage page · 423/423
- 20:20 · 1 · Merged Path A (paths, graph client, clfolders, verify-patha, /clients flag); .env.example conflict resolved (both sections) · 648/648
- 20:25 · 1/2 · Coverage 99.7% lines, next build green → Phase 1 ✅, Phase 2 ✅ · 648/648
- 20:28 · 3 · Agent started: Phase 3 onboarding (rbac, Turia ManualBridge, extractor, saga, /onboard) · –
- 20:38 · 3/4 · Merged agent core (state machine, checklist, templates, calendar) · 974/974
- 20:40 · 4 · Agent started: Phase 4 runner, echo agent, mistakes, accuracy harness, /agents review UI · –
- 21:30 · 3 · Merged onboarding (rbac, Turia ManualBridge, extractor/clarifier/validators, saga, /onboard); added playwright.db.config.ts + npm run e2e:db · 1198/1198
- 21:35 · 3 · next build green; Phase 3 QA gate waits on e2e 3/3 (Blocked: staging DB) · 1198/1198
