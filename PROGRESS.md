# PROGRESS — Indefine Firm OS
Current phase: 9 · 10 · 11 · 12-prep (parallel) | Branch: firm-os/phase-0-inventory | Last green: 2026-11-05 23:45 IST
Tests: unit+integration 2411/2411 (114 files; Firm OS coverage 99.7% lines / 97.4% branches) · e2e 4/4 (smoke, local, no DB) · accuracy (recorded mode, hardened harness): echo pass | GST pass (26) | ROC pass (24) | TAX pass (22) | BOOKS pass (22) | AUDIT pass (22) · ADR-008 guardrails enforced — audit round 2 data fixes merged; harness items with guardrails work
Model mode: CLAUDE_ONLY + LOCAL_STUB(fail-closed) | Turia bridge: MANUAL (ADR-003)

## Phase checklist (✅ only when QA gate green)
- [x] 0 Inventory & ADRs ✅ (QA gate green 19:15 IST)
- [x] 1 Path A finish + /clients → CL-{Code} ✅ (19:25 IST; live verify-patha Blocked — creds)
- [x] 2 ModelRouter + anonymizer + local stub ✅ (19:25 IST; live Claude smoke Blocked — key)
- [ ] 3 Onboarding Agent — code complete, unit/integration green; QA gate pending e2e 3/3 (Blocked: staging DB + partner session)
- [x] 4 Task-agent framework ✅ (20:35 IST)
- [ ] 5 GST Prep — gate green in recorded mode (23 fixtures, input sensitivity 23/23, replay 3/3); independent audit pending; DB e2e Blocked
- [ ] 6 ROC Prep + Tax Prep — both gates green in recorded mode (22 + 22 fixtures, input sensitivity 22/22 each); independent audit pending; DB e2e Blocked
- [ ] 7 Books Close + Audit Assist — both gates green in recorded mode (15 + 15 fixtures); independent audit pending; DB e2e Blocked
- [ ] 8 Close loop — code complete, close-loop tests green; QA gate pending golden-path e2e (needs GST agent + staging DB); review-screen buttons in progress
- [ ] 9 Daily Coach
- [ ] 10 Client Comms drafts
- [ ] 11 Hardening
- [ ] 12 Foolproof QA (STOP for human go-live)
- [ ] 13 Plain-language errors (owner request) — wave B, after current merges. Include: GST messages print amounts ungrouped (₹10800.00) → formatInr; register roc/tax abstention rules in views.ts ABSTENTION_RULES so their insufficient_evidence questions show on the review screen
- [ ] 14 AI guardrails to industry standards — OWASP LLM Top 10 (2025) + NIST AI RMF (ADR-009)
- [ ] 15 Search & retrieval · corrections with history · DPDP data-principal rights + breach register
- [ ] 16 Admin workspace settings (modules per user/role) · focus mode · guided workspace
- [ ] 17 Companion side-panel extension (read-only task steps beside any site)
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

Phase 8 (merged, 6 commits from worktree branch)
- [x] 1 gate.ts — canClose: Final deliverable in deliverablePath Final folder, live-verified via Graph (exists, same item, size > 0, sha256) · TuriaSync closeTask CLOSED, minutes > 0 · FILED_BY_HUMAN→CLOSING with ack ref where required; closeJob mints the token, CLOSING→DONE as system:close-gate with evidence JSON; AuditEvent per attempt; ~10% deterministic spot-check flag
- [x] 2 hooks.ts — APPROVED → copyToFinal (finalizeRun, idempotent); FILED_BY_HUMAN → Turia closeTask checklist + CLOSING; cycleTimes()
- [x] 3 reconcile.ts + /api/cron/firm-os/close-loop (Mon–Sat 09:00–19:00 IST) + .github/workflows/firm-os-close-loop.yml (every 30 min); 15-min reminder, 24-h escalation, once per person/job/day; DONE file re-verified — alert, never reopen; DB backstop check on DONE events
- [x] 4 /api/firm-os/jobs/[id]/{filed,turia-close,state}; state→DONE returns 403 gate-required
- [x] 5 /admin/firm-os/cycle-time — median / p90 per service, person, client; bottleneck stage
- [x] Review screen: Mark filed (ack ref required for GST/ROC/IncomeTax/TDS) → Close in Turia (ref + minutes) → gate reasons / DONE chip + cycle time; approve/submit/request-changes fire the close-loop hook via injected afterTransition; tests/e2e-db/golden-path.spec.ts (+ negative case) — runs echo until gst lands (E2E_AGENT=gst)
- [ ] QA e2e golden path onboard → GST → approve → filed → Turia close → DONE — **Blocked**: staging DB (+ GST agent merge)

Phase 4 (in progress)
- [x] 2 checklist.ts — rules as data, deterministic registry, LLM rules need quote+location, MistakeLog-promoted rules (source 'mistake')
- [x] 3 templates.ts — XLSX/DOCX fixed header block, Indian grouping, draft label, sha256; deterministic output
- [x] state.ts + state-db.ts — JobTask state machine (81-pair table test), single-transaction transition + JobTaskEvent, optimistic concurrency; DONE only with a single-use CloseGateToken minted by close-loop/gate.ts (Phase 8)
- [x] 1 runner.ts — runAgent(def, jobTaskId, deps): SopPack + approved MistakeLog rules → inputs → router extract → deterministic compute (paise) → checklist → deliverables → Working/ (_v{attempt}) → AgentRun/ChecklistResult/Deliverable rows → AGENT_DONE; failure leaves IN_PREP
- [x] 4 mistakes.ts — propose → partner/manager decide → new SopPack minor version; nothing auto-promotes
- [x] 5 /agents, /agents/[agent], /agents/[agent]/runs/[id] review (checklist left, deliverable preview right, Request changes / Approve pack bar; no portal/send button — asserted); /agents/mistakes + /admin/firm-os/mistakes
- [x] 6 scripts/accuracy.ts (`npm run accuracy -- --agent=echo`) — P/R per severity, exact figures in paise, schema, mistake replay, 3× determinism
QA gate: echo framework tests green · harness self-test: perfect → P=R=1 pass; corrupted (missed block flag, ₹1 off) → fail exit 1; nondeterministic fake → fail · mistake-promotion integration test green · next build green.
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

UI audit (owner request: every button, navigation, flow, breadcrumb) — merged a0363c3
- [x] scripts/verify-ui-links.ts (`npm run verify:ui-links`, chained into verify:firm-os): route map from src/app incl. methods; every href/redirect/router.push and every call()/fetch to /api checked; 439 targets; 0 errors before and after (no broken links existed — all defects were semantic)
- [x] 27 defects fixed: nav gating = page guard (Agents, mistake log), current-section highlight (NavLink), one label for nav/title/back links, admin sidebar "Firm OS" group + phone menu (was missing below lg), confirm steps with consequence text (Approve pack, mistake decisions, Create, Mark filed), no double-run window, state-specific idle copy, exact state names on chips, DD MMM YYYY without "Sept", AA contrast, focus rings, phone overflow (page was 756px at 390px), agent titles instead of keys, empty states per role
- [x] Flow gap built: "Waiting for you" on /agents — each person's actionable jobs with Run agent / Open pack / Review pack
- [x] Follow-ups: "Re-run with a note" from AGENT_DONE (new route …/runs/[id]/rerun); "Retract filing" for managers/partners with note + confirm (ack ref cleared, kept in history); "Close in Turia" → "Record Turia close"; flagged read-only "Firm OS jobs" card on /clients/[id] (no query with the flag off); dashboard Clients link gated with canViewClients
- Visual check: SSR pages + compiled Tailwind in the browser pane at 390/1280/1440; no page-level overflow after fixes. Not verifiable here: real sign-in, client-side interactions, Lighthouse.

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
| SharePoint upload/copy/deliverable store | src/lib/integrations/sharepoint/{upload,deliverable-store}.test.ts | green |
| Agent runner + echo agent | src/lib/agents/core/runner.test.ts | green |
| Mistake promotion loop | src/lib/agents/core/mistakes.test.ts | green |
| Accuracy scoring + harness self-test | src/lib/agents/core/accuracy*.test.ts | green |
| /agents pages + API (403/400, no portal button) | tests/unit/routes/agents*.test.ts | green |
| GST parsers, compute/set-off, rules, model tasks, agent | src/lib/agents/gst/__tests__/*.test.ts | green (145) |
| ROC Prep (AGM dates, fees, classification, CSR, rotation) | src/lib/agents/roc/*.test.ts | green (117) |
| Tax Prep (regimes, 87A, surcharge, CG, 44AD/ADA, advance tax, 43B(h)) | src/lib/agents/tax/*.test.ts | green (109) |
| Books Close (TB, BRS, TDS/GST tie-out, classify) | src/lib/agents/books/*.test.ts | green (146) |
| Audit Assist (sampling, leads, CARO, opinion guard) | src/lib/agents/audit/*.test.ts | green (122) |
| Review close actions + approve hook | tests/unit/routes/close-loop-panel.test.ts, src/lib/close-loop/approve-hook.test.ts | green |
| Close gate (missing file, wrong path, sha mismatch, size 0, Turia open, minutes 0, both present → DONE) | src/lib/close-loop/gate.test.ts | green |
| Reconciler (thresholds, idempotent cron, out-of-hours no-op, deleted-after-DONE alert) | src/lib/close-loop/reconcile.test.ts | green |
| Hooks + cycle time | src/lib/close-loop/{hooks,cycle-time}.test.ts | green |
| Close-loop routes + cron auth | tests/unit/routes/close-loop-api.test.ts | green |
| Cycle-time admin page | tests/unit/routes/cycle-time.test.ts | green |

## Accuracy scoreboard     (agent → fixture set → precision → recall → threshold → pass/fail → date)
| Agent | Fixture set | Block P/R | Warn P/R | Figures | Schema | Replay | 3× | Result | Date |
|---|---|---|---|---|---|---|---|---|---|
| echo (framework self-test) | accuracy/echo (6) | 1.000/1.000 (n=1) | 1.000/1.000 (n=3) | 6/6 | 6/6 | 1/1 | 6/6 | pass — code path only, see audit | 05 Nov 2026 20:46 IST |

**Hardened harness (21:17 IST):** recorded mode gates deterministic flags on thresholds; LLM flags must match recordings exactly; support (tp/fp/fn) shown; input-sensitivity probe mandatory for production agents; thin sets refused (gst/roc/tax ≥ 15, books/audit ≥ 10, ≥1 block + ≥1 warn expected, clean/typical-gap/trap each present); LLM evidence must quote the rule's context. The five audit probes are permanent self-tests and all FAIL as they should.

| gst | accuracy/gst (23) | det. block 1.000/1.000 (10/0/0) | det. warn 1.000/1.000 (13/0/0); LLM warn 1/0/0 match | 23/23 | 23/23 | 3/3 | 23/23 code path | pass · input sensitivity 23/23 · clean 3 / gap 3 / trap 17 | 05 Nov 2026 21:33 IST |
| roc | accuracy/roc (22) | det. block 1.000/1.000 (11/0/0) | det. warn 1.000/1.000 (9/0/0); LLM warn 1/0/0 match | 22/22 | 22/22 | 3/3 | 22/22 code path | pass · input sensitivity 22/22 · clean 5 / gap 3 / trap 14 | 05 Nov 2026 21:40 IST |
| tax | accuracy/tax (22) | det. block 1.000/1.000 (8/0/0) | det. warn 1.000/1.000 (11/0/0); LLM warn 1/0/0 match | 22/22 | 22/22 | 3/3 | 22/22 code path | pass · input sensitivity 22/22 · clean 5 / gap 2 / trap 15 | 05 Nov 2026 21:41 IST |
| books | accuracy/books (15) | det. block 1.000/1.000 (3/0/0) | det. warn 1.000/1.000 (10/0/0) | 15/15 | 15/15 | 3/3 | 15/15 code path | pass · input sensitivity 15/15 · clean 4 / gap 5 / trap 6 | 05 Nov 2026 21:40 IST |
| audit | accuracy/audit (15) | det. block 1.000/1.000 (2/0/0) | det. warn 1.000/1.000 (9/0/0); LLM warn 1/0/0 match | 15/15 | 15/15 | 3/3 | 15/15 code path | pass · input sensitivity 15/15 · clean 2 / gap 6 / trap 7 | 05 Nov 2026 21:40 IST |
| echo (hardened) | accuracy/echo (6) | det. block 1.000/1.000 (1/0/0) | det. warn 1.000/1.000 (2/0/0) | 6/6 | 6/6 | 1/1 | 6/6 code path | pass · input sensitivity 6/6 | 05 Nov 2026 21:17 IST |

**Independent accuracy audit round 2 (fable model, ~21:55 IST, read-only, all six agents):** every gate passes and re-runs byte-identical; C1 resolved for every agent (inputs parsed in code; independent ±₹1 probes on gst and books caught by figures); 31 fixtures recomputed by hand across the five agents — **no figure mismatch** (GST set-off per rule 88A incl. deficits-first, s.50 interest, late fee, rule 37 proportional; BRS; TDS due dates; materiality, CARO para 1(2), MUS interval; AGM/AOC-4/MGT-7 arithmetic, CSR averaging; FY 2025-26 slabs, 87A marginal relief (checked against the Act text), 44AD, 234B/C, 288A/B). Findings:
- **H1 HIGH** — unverified small-company limits (₹10 cr / ₹100 cr "w.e.f. 1 Dec 2025") applied in ROC and Audit; expected values share the assumption, so the gate cannot catch it. → **fixed (8ce3ac1)**: only partner-verified limits apply (2022: ₹4 cr / ₹40 cr); a warn flag when classification depends on the unverified set; fixtures corrected.
- **M1** model-dependent rules (gst.rcm-liability, roc.financials-tie, tax.ais-not-in-books …) gated as deterministic → label by provenance via task ruleIds (guardrails agent).
- **M2** input sensitivity proves only one file is read → per-file probes (guardrails agent).
- **M3** GST fixtures pin a subset of figures → **fixed**: 18-key core set pinned in all 23 fixtures, enforced by a test.
- **M4** → **fixed**: books.tds-due-soon (warn) before the due date, tds-not-deposited (block) on/after it; partner to confirm SOP.
- **M5** tax depends on roc helpers → move to core (guardrails agent).
- **M6** → **fixed**: two mixed-size MUS fixtures (items ≥ interval, multi-hit items), every audit fixture pins random start + fingerprint48; verified by an independent scratch calculator; seed change now fails the gate.
- **Coverage guard gap** — counts/labels pass with little substance → per-rule coverage row: every rule expected to fail in ≥1 and pass in ≥1 fixture (guardrails agent).
- L1 → **fixed**: books block support 6, audit 5 (opening TB off by ₹1, BRS differences both directions, prior-year unmapped group, sample below minimum — now block, partner to confirm) · L3 → **fixed**: GST Table 13 gaps shown as "to be explained", cancelled stays 0 · L2 ADR-008 framework layers not yet enforced (in progress) · L3 GST docs table shows series gaps as "cancelled" · L4 stale recordings housekeeping.

**Independent accuracy audit (fable model, 20:46 IST, read-only):** echo figures recomputed independently 6/6 match; flags hand-derived 6/6 agree; thresholds equal the spec; P/R maths correct; self-test fails as it should; mistake replay genuinely depends on the promoted rule. Findings:
- **C1 CRITICAL** — scored pipeline never read input/: figures + deterministic rules derived from recorded.json; ₹1 input change and an injected duplicate ref still passed. → harness fix in progress (echo parses input in code; mandatory input-sensitivity probe for production agents). Phases 5–7 agents told to parse input in code.
- **H1 HIGH** — LLM evidence quote/location not checked against the document (a fabricated quote passed). → engine to require the quote verbatim in the rule's context.
- **H2 HIGH** — LLM-sourced flags are self-fulfilling in recorded mode. → split P/R by rule kind; gate deterministic only in recorded mode, LLM rules in live mode (Phase 2b).
- **M1** support counts hidden · **M2** "3× identical" tautological under recordings · **M3** thin fixture sets pass trivially · **L1–L3** minor. → all in the harness fix.

## Decisions (ADR index)
- Package manager is npm (repo convention): spec's `pnpm x` = `npm run x`.
- Pages follow the existing flat layout `src/app/<module>/` — the repo has no `(portal)` route group.
- ADR-001 Extend LMS · ADR-002 ModelRouter · ADR-003 Turia (ManualBridge default — no documented Turia API) · ADR-004 SharePoint Path A · ADR-005 Close loop for DONE · ADR-006 DPDP data classes (docs/adr/).
- Guard allowlists (frozen, Firm OS dirs never allowlistable): LEGACY_PORTAL_READONLY = src/lib/statutory/cloud.ts, statutory-extension/{background.js,collectors.js,manifest.json} (public news reads), src/lib/certificates/templates/format-vi.ts (certificate wording only, no network allowed). LEGACY_GEMINI = src/lib/{gemini,quiz-gen,distill,transcribe}.ts.
- Models (env-overridable): FAST claude-haiku-5-5 · SMART claude-sonnet-5-5 · HARD claude-opus-5-5 · Grok grok-4 (price unverified, configurable). USD_INR 88, ROUTER_MIN_CONF 0.75, AI_DAILY_BUDGET_INR 1000. `judgement` difficulty routes SMART→HARD (spec silent). Local-model calls are not masked (data stays on LAN); ModelCall hash always of masked prompt.
- ADR-008 Agent guardrails — **enforced** (merged 23:05): runner refuses undeclared tasks (ScopeViolationError, NO_SCOPE/INVALID_SCOPE → 409); system prompt = FIRM_PREAMBLE + department preamble + task prompt; closed schemas (abstainable enums, strings ≤ 300) checked statically; grounding (quote in source, groundedNumber); validators via router contradictions (recorded router runs them too); agreement double-call for high-stakes rules; inputSniff before any model call; prompts.lock.json + `npm run verify:prompts` (10 tasks) in verify:firm-os; drift rates + guardrail-breach on /admin/firm-os/models (thresholds env-overridable: schema-fail 10%, escalation 25%, abstain 30%, ungrounded 2%, disagreement 10%, override 30%); harness rows: scope, violations, unbounded strings, ungrounded, insufficient_evidence, agreement, per-file input sensitivity, per-rule coverage (every rule fails and passes somewhere), model-dependent flags labelled by provenance. ROC helpers moved to core (util, checklist-sheet, guardrails/shared).
- **Owner decisions 2026-11-05 ("go with recommended")**: small-company limits = only partner-verified ₹4 cr/₹40 cr apply (unverified ₹10 cr/₹100 cr → warn); engagement-letter Send → create Outlook draft (no send path anywhere); ADR-007 accepted; DONE DB trigger added (Phase 11); partners perform Turia spot checks (UI in Phase 11); "waiting on client" convention accepted; CoachEvent.dedupeKey unique; GST drafts conservative (time-barred CN excluded, abstained-bill ITC held back); books prior-month TB check added; TDS warn-before-due/block-on-due and audit sample-below-minimum = block kept. Partner-verification items (legal thresholds) stay flagged — approval cannot verify law.
- ADR-007 (proposed): Graph upload needs PUT — one create-only PUT path with conflictBehavior=fail; versions instead of overwrite; enforced by no-destructive.test.ts. Needs owner confirmation.
- Review comments stored as AuditEvent (action comment) — no schema change. Mistake decisions also at /agents/mistakes because the /admin layout admits LMS admins only.
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
- **Partner verification — GST** (src/lib/agents/gst/config.ts GST_VERIFY_NOTES): B2CL > ₹1,00,000 (N 12/2024); s.50(1) 18% on cash portion; 3B late fee ₹50/day (nil ₹20) + AATO caps (N 19/2021); QRMP 22nd/24th groups (N 82/2020); 2B tolerance ₹1 (firm SOP); rule 37 180 days proportional; RCM list + rates (legal, GTA 5%, security, director, sponsorship, unregistered commercial rent N 09/2024-R); HSN 4/6 digits (N 78/2020); e-invoice > ₹5 cr (N 10/2023); s.34(2) and s.16(4) 30 Nov; 17(5) categories; set-off order per s.49/49A/rule 88A/Circular 98 · 2026-11-05
- **Small-company limits for FY 2025-26 (decisive)** · audit H1 · confirm whether s.2(85) limits were raised to ₹10 cr paid-up / ₹100 cr turnover w.e.f. 1 Dec 2025 (cite the G.S.R.); until confirmed only ₹4 cr / ₹40 cr (2022) apply · 2026-11-05
- **Partner verification — ROC/Tax** (data.ts verify notes + "Verify" sheet in each workbook): small company ₹4 cr/₹40 cr → ₹10 cr/₹100 cr from 1 Dec 2025 (confirm G.S.R.); CSR thresholds read on PBT; AGM 6/9/15 months; AOC-4/MGT-7/ADT-1 day counting; fee and additional-fee tables; DIR-3 KYC frequency; rotation classes; tax FY 2025-26 slabs, 87A ₹12L/₹60k with marginal relief, surcharge caps, CG rates 20%/12.5%, 44AD/44ADA limits, 44AB, 43B(h) 15/45 days, advance tax + 234B/C, 234F, ITR-1/4 limits. **Income-tax Act 2025 (tax year 2026-27) rates are stored as unverified and the tax agent refuses that year until a partner publishes verified numbers.** · 2026-11-05
- **Partner verification — Books/Audit** (config.ts verify notes): bank match windows 5/31 days; unreconciled > 30 days; expense spike > 50% and ≥ ₹50k; TDS deposit 7th / 30 Apr (2025-Act equivalent?); materiality 1% revenue, PM 75%; variance ≥ PM and ≥ 20%; min sample 25, MUS factor 3.0; CARO exemption limits; small company ₹10 cr / ₹100 cr (Dec 2025 amendment — confirm); s.138 thresholds; severities (GST mismatch / negative cash / suspense = warn; TDS not deposited, BRS difference = block) · 2026-11-05
- **Agent conventions to confirm (round-2 fixes)**: TDS warn-before-due / block-on-due; audit sample below SOP minimum = block; should draft GST figures exclude a time-barred credit note (GST 12) and ITC on a bill the model abstained on (GST 23)?; books has no prior-month TB balance check; no input for cancelled documents (Table 13 cancelled always 0) · 2026-11-05
- **Seed SopPacks** · runner loads the active SopPack from DB · run the seed functions (gst seed.ts; books/audit publish v1.0.0 from defaultChecklist) on staging/prod after partner review · 2026-11-05
- Push + PR firm-os/phase-0-inventory → main · owner will do GitHub tomorrow (push attempt stopped while waiting for sign-in) · never merged by the agent · 2026-11-05

## Known gaps / tech debt
- `npm ci` on npm 11 skips install scripts not covered by `allowScripts` (prisma, esbuild); run `npx prisma generate` after install locally.
- No local Postgres/Docker on this machine: DB-backed integration and e2e runs need a staging DB; `prisma migrate deploy` on a fresh DB not yet exercised (CI e2e job will).
- Legacy Gemini calls outside the router: live-session recordings/transcripts (transcribe.ts, auto-quiz.ts, live/ingest.ts) and SOP Builder free text go to Gemini unmasked (ADR-002/006, inventory H-7) — needs a partner decision.
- Engagement-letter send (sendMailAsUser) is an existing client-facing send; Phase 10 "no sendMail" guard must allowlist that legacy route explicitly.
- /work is a two-person tech tracker behind an email allow-list — JobTasks will surface on /dashboard + /agents instead (inventory G-7).
- greytHR is a monthly CSV only — Phase 9 break nudge needs an LMS activity heartbeat (G-6).
- Workflows hard-code https://lms.indefine.in (staging crons need a variable) (G-11).
- Tax v1 not modelled: 234C proviso for later CG/dividends, MAT (info flag), grandfathering/indexation/s.54, brought-forward CG/HP losses, HRA, AOP/BOI; ROC: MSME-1/DPT-3 late fees. Tax imports helpers from src/lib/agents/roc (util, grounding, checklistSheet) — move to core with the ADR-008 framework work.
- GST v1.0.0 not covered: exports/SEZ, imports, ISD, amendments (B2BA/CDNRA), CDNUR, e-way bill checks, s.50(3) interest, interest on rule 37 reversals.
- compute() receives no SopPack, so GST rates live in module config; rule gst.pack-config blocks if pack and code disagree. Better: framework passes pack params to compute.
- LMS UI oddities left for the owner (UI audit): /clients /work /tools headers don't wrap at 390px or mark the current section (could adopt NavLink); ink-faint text ≈ 2:1 contrast across LMS incl. shared h2 in ui.ts; "Sept" from en-IN in ist.ts; dashboard emoji; /clients shows legacy "Onboard" next to "Firm OS onboarding"; admin "Videos & Quizzes" not highlighted on /admin/video/[id].
- AgentRun.inputs purge job (inputsPurgeAt, ≤ 30 days) not built yet — Phase 11.
- Accuracy `--provider` reserved for Phase 2b (exits 2).
- Log times before 20:31 were first written as estimates; corrected from commit timestamps.

## Log                      (IST time · phase · what · tests)
- 18:48 · 0 · Cloned Indefine_LMS, branch firm-os/phase-0-inventory from main 33d113f · –
- 18:52 · 0 · Baseline typecheck + lint green · –
- 18:54 · 0 · Test tooling + Firm OS schema spine (c61d885) · unit 2/2
- 18:56 · 0/1/2 · Parallel agents started: P0 docs, P0 guards+CI, P1 SharePoint, P2 ModelRouter · –
- 19:00 · 0 · Full Firm OS schema (JobTask state machine etc.), additive only (08fe596) · unit 2/2
- 19:11 · 0 · Merged inventory + ADRs (1c585b8) · –
- 19:13 · 0 · Merged guards, route smoke, Playwright, CI (0088f5d) · unit 56/56, verify 5/5
- 19:15 · 0 · next build green → Phase 0 ✅ (153ad9b) · 56/56 · e2e 4/4
- 19:16 · 3/4 · Agent started: agent core (state machine, checklist, templates, calendar) · –
- 19:22 · 2 · Merged ModelRouter/anonymizer/providers/usage page · 423/423
- 19:23 · 1 · Merged Path A; .env.example conflict resolved · 648/648
- 19:25 · 1/2 · Coverage 99.7%, build green → Phase 1 ✅, Phase 2 ✅ (ef02ccc) · 648/648
- 19:28 · 3 · Agent started: onboarding · –
- 19:38 · 3/4 · Merged agent core (76d1f0f) · 974/974
- 19:41 · 4 · Agent started: runner, echo, mistakes, accuracy, /agents UI · –
- 20:19 · 3 · Merged onboarding; playwright.db.config.ts + npm run e2e:db (38953de) · 1198/1198
- 20:22 · 8 · Agent started: close loop (gate, hooks, reconciler cron, routes, cycle-time page) · –
- 20:30 · 4 · Merged runner/mistakes/accuracy/review UI (0017eb1); npm run accuracy added · 1324/1324 · accuracy echo pass
- 20:35 · 4 · next build green → Phase 4 ✅; ADR-007 proposed · 1324/1324
- 20:37 · 5/6/7 · Agents started: GST Prep; ROC + Tax Prep; Books Close + Audit Assist · –
- 20:46 · 4 · Independent accuracy audit (fable): echo numbers verified; harness findings C1, H1, H2, M1–M3 · –
- 20:52 · 4 · Harness-hardening agent started; Phases 5–7 agents briefed on the findings · –
- 20:58 · 8 · Merged close loop (gate, hooks, reconciler + workflow, routes, cycle-time page); guard scope + cron/firm-os, rbac, audit · 1492/1492
- 21:00 · 8 · next build green; agent started for review-screen close actions + golden-path e2e spec · 1492/1492
- 21:05 · 4 · Fixed two framework tests that assumed echo is the only agent (22cd632, 58589f8) · green
- 21:08 · ui · UI navigation/flow audit + ui-links verifier agent started (owner request) · –
- 21:10 · all · ADR-008 agent guardrails written; GST/ROC/Tax/Books/Audit agents briefed · –
- 21:17 · 4 · Merged hardened accuracy harness (audit C1, H1, H2, M1–M3 fixed; probes as self-tests) · 68 files green · echo pass
- 21:19 · guardrails · ADR-008 implementation agent started · –
- 21:27 · 8 · Merged review-screen close actions + approve hook + golden-path e2e spec; resolved agents.test.ts import conflict with the harness fix · 1561/1561 · build green
- 21:33 · 5 · Merged GST Prep (23 fixtures; ADR-008 tasks gst.classify-ledgers, gst.read-hsn) · 1706/1706 · gst pass
- 21:40 · 7 · Merged Books Close + Audit Assist; registry conflict resolved (all agents kept); *.snap eol=lf · 1974/1974 · books, audit pass
- 21:41 · 5/7 · Fable auditor re-run requested for gst, books, audit (+ hardened harness) · –
- 21:43 · 6 · Merged ROC Prep + Tax Prep (22 + 22 fixtures; 4 real bugs found by hand-checking, fixed); registry conflict resolved · 2200/2200 · all six agents pass · build green
- 21:55 · 5–7 · Independent audit round 2 (fable): all six pass, 31 fixtures hand-recomputed with no mismatch; H1 + M1–M6 + coverage gap → fix agent started, harness items sent to guardrails agent · –
- 22:05 · ui · Merged UI audit (27 fixes, ui-links verifier, Waiting-for-you list); resolved agents.test.ts conflict; two tests updated for registered agents · 2236/2236 · all six accuracy gates pass · build green
- 22:06 · ui · Follow-up agent started: re-run, retract filing, Record Turia close wording, client-page jobs, dashboard link · –
- 22:40 · ui · Merged UI follow-ups (re-run, retract filing, Record Turia close, client-page jobs, dashboard link); fixed one timeout flake (cold-import test → 30 s) · 2252/2252 ×3 · build green
- 22:55 · 5–7 · Merged audit round-2 data fixes (H1 small-company limits behind partner verification, M3, M4, M6, L1, L3); roc 24 / books 19 / audit 20 fixtures · 2293/2293 · all six pass
- 23:00 · all · Owner: "go with recommended", approval to continue and complete; start remaining phases in parallel · –
- 23:02 · 9–11 · Schema for coach/comms/hardening (CoachEvent.dedupeKey, ActivityHeartbeat, CoachPreference, RateLimitBucket, FirmClient.preferredLanguage, spot-check fields), additive (b1c331c) · green
- 23:05 · guardrails · Merged ADR-008 enforcement across all six agents; verify:prompts + accuracy:canary scripts · 2397/2397 · all six pass
- 23:10 · 9/10/11/12 · Agents started in parallel: Daily Coach; Client comms drafts (+ engagement-letter → Outlook draft); Hardening (+ DONE trigger, dedupe, spot-checks); Phase 12 QA prep; owner-decision fixes (GST conservative drafts, books prior TB, open questions on review screen). Phase 2b not startable (LOCAL_LLM_BASE_URL empty) · –
- 23:20 · 13–17 · Owner requests: industry-standard guardrails, plain-language errors, DPDP security, search/retrieval, corrections, admin per-user settings, focus mode, guided workspace/side panel. Schema (PrivacyRequest, BreachIncident, WorkspaceSetting, RoleWorkspaceDefault, CompanionToken) additive (fe87d3d); guard scope extended. Wave A agents started: guardrail standards, search, corrections + DPDP rights, workspace/focus, companion extension. GitHub push stopped at owner's request · –
- 23:45 · decisions · Merged owner-decision fixes: GST time-barred credit notes excluded from draft figures, ITC on abstained bills held back (itcHeldBackPaise), books.prior-tb-balanced (warn), Open questions card on the review screen · 2411/2411 · gst 26, books 22 pass
