# Phase 12 — final QA gate runbook

The exact sequence the orchestrator runs after Phases 9, 10 and 11 are merged into
`firm-os/phase-0-inventory`. Every step must be green; a step that fails once in three runs is a
**flake and counts as red** (orchestrator loop rule 4). Fix, then restart from the step that failed.
Record each result (command, count, time IST) in PROGRESS.md "Log" and the test counts in the header.

Shell: Git Bash from the repo root. Package manager: npm (`pnpm x` in the spec = `npm run x`).

Steps 1–14 run anywhere (no database, no secrets). Steps 15–20 need staging and are **Blocked**
until a staging environment exists (PROGRESS "Blocked": staging DATABASE_URL, PnP certificate +
consent, ANTHROPIC_API_KEY, signed-in test accounts). Step 21 is the STOP.

---

## 0. Merge and prepare

```sh
git checkout firm-os/phase-0-inventory && git pull --ff-only   # if remote
git merge --no-edit <phase-9 branch> <phase-10 branch> <phase-11 branch>   # one at a time, resolve, test
npx prisma generate
git status   # clean
```

## 1. After-merge fix-ups (written ahead against the briefs — make them real)

1. **Chaos test that waits for Phase 11** — `tests/chaos/after-merge/`:
   ```sh
   # Phase 11: the reconciler writes nudges with CoachEvent.dedupeKey keyed by reason → this must now pass
   git mv tests/chaos/after-merge/duplicate-cron-concurrent.pending.ts tests/chaos/duplicate-cron-concurrent.test.ts
   # fix the relative imports after the move: "../../fakes" → "../fakes", "../support" → "./support"
   npx vitest run tests/chaos
   ```
   Before Phase 11 its three tests fail on purpose (verified 05–06 Nov 2026): three simultaneous
   reconciler runs → 3 reminders and 3 escalations per recipient; two simultaneous DONE re-checks →
   2 alerts per recipient; and a coach pre-filing reminder (reason `internal-due`) suppresses the
   reconciler's same-day close-loop reminder because `nudgeOnce` matches on kind alone. The expected
   keys follow the coordinator's note: `reminder:<job>:<user>:close-loop:<istDay>`,
   `escalation:<job>:<user>:close-loop:<istDay>`, `done-alert:<job>:<istDay>`.
   The Phase 9 coach chaos test is already live: `tests/chaos/coach-reminders-duplicate-cron.test.ts`.
2. **E2E selectors for the new pages** — confirm every marked line against the merged UI:
   ```sh
   grep -rn "PHASE 11:" tests/e2e-db
   ```
   Only `rbac-phase-10-11.spec.ts` still has Phase 11 tests (`@after-merge @phase-11`: spot checks,
   partner-only SOP decision). Keep the assertions; change selectors / routes only, then drop the
   `@after-merge` tags. `coach.spec.ts` (@phase-9) and `comms.spec.ts` + the comms denial (@phase-10)
   were confirmed against the merged UI on 06 Nov 2026.
3. **Flags-off regression allowlist** — `tests/regression/firm-os-flags-off.test.ts`. If a phase adds a
   Firm OS entry point to an LMS page (e.g. the coach board card on /dashboard), it must be hidden with
   its flag off; if it is deliberately visible, record that in `docs/go-live.md` §3 first, then extend
   the allowlist. Add any new `FIRM_OS_*` names to `FIRM_OS_FLAGS` in `tests/regression/support/render.ts`.
4. **Go-live doc** — copy the Phase 11 variables from `.env.example` into `docs/go-live.md` §2.4 / §2.5
   (Phases 9–10 are in).
5. **Visual render** picks up `/agents/spot-checks` automatically once it exists (step 14).

## 2. Lint

```sh
npm run lint            # "No ESLint warnings or errors"
```

## 3. Typecheck

```sh
npm run typecheck       # tsc --noEmit, no output
```

## 4. Unit + integration + chaos + regression, three times

```sh
for i in 1 2 3; do npm test || { echo "RED on run $i"; break; }; done
git status --porcelain src/lib/integrations/turia   # a run must not rewrite the Turia snapshot; if it did: git checkout -- <file>
```
Baseline at Phase 12 prep (06 Nov 2026, after the Phase 9 and 10 merges, before 11): chaos **46**
(8 files) and LMS regression **72** (5 files) inside the full suite (counts in PROGRESS). Load flake
seen during prep, before the Phase 10 merge raised the default `testTimeout` to 20 s: in 1 of 3 full
runs two heavy accuracy-harness tests timed out at 5 s (`accuracy-probes.test.ts`, `tax/index.test.ts`).
If anything times out again, it is red — raise that test's timeout with a reason, never retry.

## 5. Coverage (new modules ≥ 80 % lines)

```sh
npm run test:coverage   # thresholds.lines 80 on src/lib/{ai,agents,integrations,close-loop,audit,rbac}
```
Phase 9–11 modules (coach, comms, rbac, audit) must be inside the coverage include list
(`vitest.config.ts`) — check, and add them if a phase forgot.

## 6. Firm OS guards

```sh
npm run verify:firm-os  # no-skip, secrets, no-portal, no-delete, ai-boundary, ui-links, prompts
```

## 7. Phase 11 guards

```sh
npm run verify:rbac
npm run verify:audit-coverage
```
Both are Phase 11 deliverables. If either script is missing, Phase 11 is not complete → red.
Phase 10 should also have added a no-send guard (no `sendMail` / `/send` path; engagement-letter Send
became "Create Outlook draft") — run it if it exists under its own name, or confirm it is chained
into `verify:firm-os`.

## 8. Existing LMS checks (no secrets needed)

```sh
for s in verify:access verify:cron-auth verify:secret-box verify:graph-scopes verify:work verify:clients verify:office-tools verify:profit-split; do npm run $s || echo "RED $s"; done
```

## 9. Accuracy, all agents, three times each

```sh
for a in echo gst roc tax books audit; do
  for i in 1 2 3; do npm run accuracy -- --agent=$a || { echo "RED $a run $i"; exit 1; }; done
done
```
Thresholds (ADR to change): block recall ≥ 0.98 / precision ≥ 0.90; warn recall ≥ 0.90 / precision
≥ 0.80; figures exact to the rupee; schema 100 %; MistakeLog replay 100 %; 3/3 identical. Copy each
agent's scoreboard row into PROGRESS "Accuracy scoreboard". Any agent below threshold → phase red.

## 10. MistakeLog replay

The replay is part of every accuracy run (column "Replay" = approved mistakes caught on replay).
Confirm 100 % for every agent in step 9, then the framework tests:
```sh
npx vitest run src/lib/agents/core/mistakes.test.ts src/lib/agents/core/accuracy.test.ts
```

## 11. E2E smoke (local, no DB)

```sh
npm run e2e             # 4/4: signed-out visitors are redirected to sign-in
```

## 12. Build

```sh
npm run build           # prisma generate && next build
```

## 13. DB-backed specs load

```sh
npx playwright test --config playwright.db.config.ts --list
```
At prep: **26 tests in 12 files** (24 runnable now + 2 tagged `@after-merge` for Phase 11). All must load with no
environment set (nothing runs at import time).

## 14. Visual first look (local)

```sh
npx vitest run --config tests/regression/visual.vitest.config.ts
# open test-results/visual/index.html — every Firm OS page at 390 / 1280 / 1440
```
Look for overflow and broken layout before the staging UI pass (step 18). At prep (after the Phase 9 and 10 merges): 20/20 pages render (coach, comms, search, focus, companion, admin workspace included).

---

## Staging only — Blocked until staging exists

### 15. Staging preparation (once)

- Railway staging environment with its own Postgres; `npx prisma migrate deploy` against it.
- App variables as `docs/go-live.md` §2, plus for e2e: `FIRM_OS_ECHO_AGENT=1` (golden path runs the
  echo agent), `ANTHROPIC_API_KEY` (Tax Prep needs it), SharePoint PnP + Graph app-only consent,
  `CRON_SECRET`. The Phase 9–11 flags ON for the test accounts.
- Test accounts (active LMS users on staging, plain staff unless stated): partner (level PARTNER, not
  an LMS admin), manager (MANAGER), assignee, reviewer, other staff.
- Onboard one e2e client once (e.g. code `E2EQA`) so its CL- site and Compliance library exist.
- Save a signed-in storageState per account — a person signs in with Microsoft (MFA is never
  automated):
  ```sh
  mkdir -p .auth   # git-ignored? add ".auth/" to .gitignore before saving anything there
  npx playwright open --save-storage=.auth/partner.json  "$E2E_BASE_URL"   # sign in, then close the window
  # repeat for manager, assignee, reviewer, other
  ```
- Environment for `npm run e2e:db` (see `tests/e2e-db/support/env.ts`):
  `E2E_BASE_URL`, `DATABASE_URL` (staging), `E2E_PARTNER_STATE`, `E2E_MANAGER_STATE`,
  `E2E_ASSIGNEE_STATE`, `E2E_REVIEWER_STATE`, `E2E_OTHER_STAFF_STATE`, `E2E_ASSIGNEE_EMAIL`,
  `E2E_REVIEWER_EMAIL`, `E2E_OTHER_STAFF_EMAIL`, `E2E_ASSIGNEE_NAME`, `E2E_REVIEWER_NAME`,
  `E2E_CLIENT_CODE`, `CRON_SECRET`, and the app's `MS_*` / `SP_PNP_*` (the specs upload fixture
  inputs to ClientDocs and seed Final files through real Graph).

### 16. DB-backed golden paths, 3/3

```sh
npm run e2e:db          # playwright.db.config.ts --repeat-each=3; every test 3/3
```
Covers: (a) onboard; (b) gst incl. request changes → re-run → approve → Final; (c) roc, tax, books,
audit; (d) close-loop negatives + golden-path; (e) coach; (f) comms; (g) rbac + rbac-phase-10-11.
Before the Phase 9–11 pages exist: `npx playwright test --config playwright.db.config.ts --repeat-each=3 --grep-invert @after-merge`.

### 17. OWASP ZAP baseline — no High

```sh
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t "$E2E_BASE_URL" -r zap-baseline.html
```
Phase 11 QA gate: no High findings. Medium / Low: list in PROGRESS "Known gaps" with a decision.

### 18. UI pass and Lighthouse

Fill `docs/qa/ui-checklist.md` on staging (1280 / 1440 / 390, focus, 8pt grid, Lighthouse a11y ≥ 95
on every Firm OS page).

### 19. Backup / restore drill

Railway → Postgres → Backups → restore the latest snapshot into a scratch staging database →
`DATABASE_URL=<scratch> npx prisma migrate status` (up to date) → compare row counts of
`JobTask`, `AgentRun`, `Deliverable`, `TuriaSync`, `AuditEvent` with the source → note the restore time.

Then the DPDP retention purge (Phase 11, one allowlisted purge function): seed an `ActivityHeartbeat`
and a `CoachEvent` of kind `break` dated 8 days ago on the scratch database, run the purge, and check
both are gone while a 6-day-old one and every non-break CoachEvent remain; `AgentRun.inputs` past
`inputsPurgeAt` is cleared. The coach writes no AuditEvent for break data (ADR-006).

### 20. Live accuracy canary and the human checks

```sh
npm run accuracy:canary   # live model, staging ANTHROPIC_API_KEY
```
Then the human E2E checklist (`docs/go-live.md` §7) and the partner verification list (§8).

---

## 21. STOP

When 1–14 are green (and 15–20 green on staging, or each recorded as Blocked with its reason):

1. Write **"Ready for human go-live review"** at the top of PROGRESS.md with the final counts.
2. Open (do not merge) the PR `firm-os/phase-0-inventory → main` — or record "Blocked: no gh CLI".
3. **STOP.** Do not enable flags in prod, do not merge to `main`, do not announce. Wait for the
   owner's explicit yes (`docs/go-live.md` §10).
