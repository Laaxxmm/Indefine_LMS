# Indefine Firm OS — go-live checklist

> **STOP. Nothing in this document is done by an agent.** No `FIRM_OS_*` flag is enabled in
> production, nothing is merged to `main`, and nothing is announced to staff until the owner
> (Lakshmanan A) gives an explicit **yes** after reading this checklist. Phase 12 ends with
> "Ready for human go-live review" in PROGRESS.md — that is a request for review, not a release.

Prepared during Phase 12 (QA prep, 05 Nov 2026). Owner: Lakshmanan A — Indefine / SRCA & Associates.
Production: lms.indefine.in on Railway. Staging: a Railway branch environment with its own Postgres.
The final QA gate that must be green before this checklist is used: `docs/qa/phase-12-runbook.md`.

---

## 1. Preconditions (all must be true)

- [ ] Phases 0–11 ✅ in PROGRESS.md with green QA gates; Phase 12 runbook steps 1–12 green on the
      merged branch, staging steps 13–17 green on staging (`docs/qa/phase-12-runbook.md`).
- [ ] Accuracy scoreboard above thresholds for all five agents, 3/3 runs, MistakeLog replay 100 %.
- [ ] Human E2E checklist (§7) ticked on staging.
- [ ] UI checklist (`docs/qa/ui-checklist.md`) complete and passing.
- [ ] Partner verification items (§8) answered — every legal threshold the agents use is confirmed.
- [ ] Railway Postgres snapshot restore drill done on staging (Phase 11) and the restore time noted.
- [ ] DPDP retention runs on staging (Phase 11 purge): `ActivityHeartbeat` and `CoachEvent` rows of
      kind `break` older than 7 days are gone (ADR-006 break data; the coach writes no AuditEvent for
      it); `AgentRun.inputs` cleared after `inputsPurgeAt` (≤ 30 days). Nothing else is purged.
- [ ] Close-loop reminders and coach reminders coexist: a coach pre-filing reminder (reason
      `internal-due`) does not suppress the reconciler's same-day "filed but not closed" reminder
      (reason `close-loop`) — `tests/chaos/duplicate-cron-concurrent.test.ts` green after Phase 11.
- [ ] PR `firm-os/phase-0-inventory → main` reviewed by the owner (the agent never merges).
- [ ] **Deploy path checked (incident 06 Nov 2026, see §9.1):** the Railway Start / Pre-deploy command
      is `npm start` only — no `prisma db push` (the boot script `scripts/migrate.mjs` runs
      `prisma migrate deploy`); every new migration has been applied to a copy of the production
      database (staging) before merging; the CI step "Firm OS migrations re-run cleanly" is green.

## 2. Railway environment variables (production service)

Secrets go only in Railway variables (prod) and `.env.local` (dev) — never in chat or git.
"Default" is what the code uses when the variable is blank.

### 2.1 Existing LMS (unchanged — confirm present, do not alter)

`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL` (https://lms.indefine.in), `AUTH_TRUST_HOST`,
`AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
(must name the firm's tenant — a `/common/` issuer refuses every sign-in, by design),
`GRAPH_TOKEN_KEY`, `GRAPH_DRIVE_ID`, `GRAPH_VIDEOS_FOLDER_PATH` / `GRAPH_VIDEOS_FOLDER_ID`,
`GRAPH_CLIENTS_ROOT`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `ADMIN_EMAILS`,
`WORK_TRACKER_EMAILS`, `CRON_SECRET`, `NEO_TURIA_ORG_ID`, `NEO_TURIA_RELAY_TOKEN`,
`NEO_TURIA_COOKIE_KEY`, `NEO_CENTRA_DEBUG` (unset in prod), `GEMINI_API_KEY`, `GEMINI_MODEL`,
`STATUTORY_RELAY_TOKEN`.

### 2.2 Firm OS — AI (ModelRouter, `src/lib/ai/config.ts`)

| Variable | Set in prod | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **required** | — | console.anthropic.com. Without it every model step falls back to a person (onboarding asks all questions; LLM checklist rules become "check by hand"; Tax Prep's AIS match fails the run). |
| `XAI_API_KEY` | optional | empty = Grok off | Claude-outage failover (masked, same anonymizer). Chaos-tested: `tests/chaos/model-outage.test.ts`. |
| `LOCAL_LLM_BASE_URL` | **leave EMPTY** | empty | Week 1: local stub fails closed; `local-only` tasks queue for a person. Set only in Phase 2b. |
| `LOCAL_LLM_MODEL` | leave empty | `local-open-weight` | Phase 2b. |
| `MODEL_FAST` / `MODEL_SMART` / `MODEL_HARD` | blank | `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-opus-5-5` | Re-confirm current IDs before go-live. |
| `GROK_MODEL`, `GROK_PRICE_IN_USD_PER_MTOK`, `GROK_PRICE_OUT_USD_PER_MTOK` | only with Grok | `grok-4`, 3, 15 | Grok price unverified — confirm. |
| `ROUTER_MIN_CONF` | blank | 0.75 | Below this the router escalates a tier. |
| `AI_DAILY_BUDGET_INR` | **set explicitly** (e.g. 1000) | 1000 | Per IST day across all runs; 0 = no cap (do not use 0 in prod). Chaos-tested: run FAILS cleanly, job stays IN_PREP. |
| `USD_INR` | blank or current rate | 88 | Cost accounting only. |
| `AI_MAX_OUTPUT_TOKENS`, `AI_TIMEOUT_MS` | blank | 4096, 60000 | |
| `GUARDRAIL_MAX_SCHEMA_FAIL_RATE`, `GUARDRAIL_MAX_ESCALATION_RATE`, `GUARDRAIL_MAX_ABSTAIN_RATE`, `GUARDRAIL_MAX_UNGROUNDED_RATE`, `GUARDRAIL_MAX_DISAGREEMENT_RATE`, `GUARDRAIL_MAX_OVERRIDE_RATE`, `GUARDRAIL_MIN_SAMPLE` | blank | 0.10, 0.25, 0.30, 0.02, 0.10, 0.30, 5 | ADR-008 drift alarms on /admin/firm-os/models. Not in `.env.example` yet. |

### 2.3 Firm OS — SharePoint Path A (`src/lib/integrations/sharepoint/config.ts`)

| Variable | Set in prod | Default | Notes |
|---|---|---|---|
| `SP_TENANT_HOST` | blank | `srcaassociate.sharepoint.com` | |
| `SP_HUB_SITE_URL` | blank | `https://<host>/sites/Indefine-Compliance` | Must be registered as a hub site (SP admin center). |
| `SP_TENANT_ID` | blank | `MS_TENANT_ID`, then `<tenant>.onmicrosoft.com` | |
| `SP_PNP_CLIENT_ID` | blank | `381abf0e-e427-417f-9b45-651e8ca823ec` | PnP app, Sites.FullControl.All, admin consented. |
| `SP_PNP_CERT_KEY_PEM` | **required** | — | Private key of the cert uploaded to the PnP app (one line with `\n` is fine). |
| `SP_PNP_CERT_KEY_PASSPHRASE` | if encrypted | — | |
| `SP_PNP_CERT_PEM` or `SP_PNP_CERT_THUMBPRINT` | **one required** | — | |
| `SP_SITE_OWNER` | **required** | — | UPN made owner of new CL- sites (app-only site creation needs one). |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | already set (LMS) | — | Graph app-only: grant **Sites.ReadWrite.All + Group.Read.All** (application) with admin consent. |

Before enabling anything, run `npm run verify:patha` against prod (read-only) and fix gaps only with
the ensure-* functions.

### 2.4 Firm OS — feature flags (all OFF in prod until §4)

| Flag | Prod value now | Meaning |
|---|---|---|
| `FIRM_OS_ENABLED` | unset (off) | The Firm OS master switch (§3). Off: Firm OS is closed for everyone and LMS pages show and query nothing of it. On: the workspace module settings decide per role and person. |
| `FIRM_OS_CL_PATHS` | unset (off) | /clients folder links resolve to CL-{Code} sites and the client page shows the "Firm OS jobs" card. Its own switch (folder layout), independent of `FIRM_OS_ENABLED`: keep it off until Stage 1. |
| `FIRM_OS_ECHO_AGENT` | unset (off) — **never on in prod** | Shows the internal Echo test agent. Staging only (golden-path e2e). |
| `FIRM_OS_ONBOARD_CONFIRM` | unset (= confirm) — **never `false` in prod** | A partner/manager must click Create before the onboarding saga runs. |
| `FIRM_OS_TURIA_BRIDGE` | unset (= `MANUAL`) | MANUAL checklists (ADR-003). `UI`/`API` are stubs that block. |
| `FIRM_OS_TURIA_UI` | unset (off) | UI automation against practice.turia.in — off until Turia confirms it is permitted. |
| `FIRM_OS_BREAK_NUDGE` (Phase 9) | unset (off) | LMS activity heartbeats + gentle break nudges (ADR-006: kept 7 days, aggregate only, never reported to managers). Tell staff what is collected **before** turning it on. Off = no heartbeat stored, no ping sent. |
| `FIRM_OS_HOLIDAYS` (Phase 9) | set to the firm's holidays | Comma-separated `YYYY-MM-DD` the coach skips when counting working days (the LMS has no holiday table); blank = weekends only. Not a feature flag — set it before Stage 1. |
| `FIRM_OS_COMPANION_EXTENSION_ORIGIN` (merged with Phase 10) | unset unless the extension id differs | CORS origin the companion API answers besides the extension's fixed id (`src/lib/companion/config.ts`). Not in `.env.example` yet. |
| Phase 10 comms | `FIRM_OS_ENABLED` + the comms module | Comms drafts follow the master switch and the workspace settings like every Firm OS module (§3). "Open in Outlook draft" and engagement-letter drafts need the delegated **Mail.ReadWrite** consent (§8). |
| `RATE_LIMIT_ONBOARD`, `RATE_LIMIT_AGENT_RUN`, `RATE_LIMIT_COMMS_DRAFT` (Phase 11) | blank | `30/1h`, `20/1h`, `30/1h` per user (`src/lib/hardening/rate-limit.ts`); over the limit → 429 with Retry-After. Changing a limit is a threshold change (partner). |

`FIRM_OS_ONBOARD_CONFIRM`, `FIRM_OS_TURIA_BRIDGE`, `FIRM_OS_TURIA_UI` and the `GUARDRAIL_*` variables are
read by the code but missing from `.env.example` — add them there (owner of `.env.example`).

### 2.5 GitHub Actions (crons)

- Repository secret `CRON_SECRET` = the Railway value (all `/api/cron/*` routes are bearer-only).
- `.github/workflows/firm-os-close-loop.yml` (every 30 min, Mon–Sat 09:00–19:00 IST) and the other
  workflows hard-code `https://lms.indefine.in` (inventory G-11): staging crons need a variable.
- `.github/workflows/firm-os-coach.yml` (Phase 9): `/api/cron/firm-os/coach?job=morning` 09:00 IST,
  `?job=reminders` every 30 min 09:00–19:00 IST Mon–Sat, `?job=summary` Fridays 16:00 IST. Each job
  checks its own IST window; every nudge is written once (CoachEvent.dedupeKey). Delivery is in-app
  only (/coach and the dashboard card) — no Teams or e-mail to staff.
- `.github/workflows/firm-os-retention.yml` (Phase 11): `/api/cron/firm-os/retention` daily 02:30 IST —
  the DPDP retention purge (docs/dpdp/retention.md). Confirm its first runs on staging (§1).

## 3. Master switch and pilot rollout (`FIRM_OS_ENABLED` + workspace settings)

Firm OS has one master switch, **`FIRM_OS_ENABLED`** (default **off**; `1`/`true`/`on`/`yes` = on;
`src/lib/workspace/flag.ts`). Below it, the workspace module settings (/admin/firm-os/workspace)
decide who sees which module. There is no separate pilot e-mail list: the pilot is a set of people
whose Firm OS modules are switched on in the workspace settings.

**Off (production default).** Firm OS is closed for everyone, admins and partners included:

- no Firm OS link, card or query on any LMS page — the dashboard shows no Agents, My day, Next task,
  Client messages or Search, no morning-board card and no break-nudge ping, and reads no Firm OS table;
  /tools and /clients show no Firm OS onboarding; the command palette (Ctrl/⌘+K) is not mounted;
- the Firm OS modules — onboard, agents (with /focus and /workspace), coach, comms, search — and the
  companion, spot checks and the admin Firm OS pages send people to the dashboard, which says in a
  plain sentence that Firm OS is not switched on yet (`/dashboard?module-off=firm-os`);
- the workspace settings are not even read (`loadWorkspace` returns the LMS modules each role may use,
  exactly as before Firm OS — staff keep /clients);
- **one exception:** /admin/firm-os/workspace stays open to LMS admins, so the role defaults can be
  prepared before the switch goes on. Its page says that Firm OS is off and the settings are not yet used.
- Firm OS APIs: the security integration adds one line at the top of each handler under
  `src/app/api/firm-os/**` — `if (!firmOsEnabled()) return firmOsOffResponse();` (404 with the same plain
  sentence) — except the workspace settings routes (`workspace/roles/[role]`, `workspace/users/[userId]`),
  which stay open with their page. `workspace/next-task` is already closed through `isModuleEnabled`. The
  Firm OS crons (`close-loop`, `coach`) skip with `if (!firmOsEnabled()) return firmOsOffCronResponse();`
  (200, so the GitHub Action does not fail); the DPDP `retention` cron keeps running.

`tests/regression/firm-os-flags-off.test.ts` pins the off state: no Firm OS link on the LMS pages and
no Firm OS or workspace-settings query, with /admin/firm-os/workspace the only allowed entry point.

**On.** The workspace settings govern, per role default and per person. A switched-on module never
grants access the role does not have. Without saved role defaults the built-in ones apply (staff:
learning, leaderboard, work, tools, agents, coach, search; managers add clients, comms, onboard;
partners and admins everything) — so **save the role defaults before turning the switch on**.

**Pilot procedure** (Stage 1 and 2 in §4):

1. With the switch still off, an admin opens /admin/firm-os/workspace and saves role defaults
   **without** the Firm OS modules (onboard, agents, coach, comms, search), focus mode off.
2. Set `FIRM_OS_ENABLED=1` in Railway and redeploy. Nobody sees a Firm OS module yet.
3. Switch the Firm OS modules on for the pilot people under **People** (Stage 1: the partners;
   Stage 2: add the two named staff). Allow the companion per person there if wanted.
4. Stage 3: add the Firm OS modules to the role defaults; clear the pilot people's own lists so they
   follow their role again.

Rollback at any stage: set `FIRM_OS_ENABLED` off (§9). Saved settings stay for the next time it is on.

## 4. Feature-flag rollout plan

Every stage is reversible by switching flags off (§9). Move to the next stage only when its exit
criteria hold and the owner says so.

| Stage | Who | Turn on | Watch daily | Exit criteria |
|---|---|---|---|---|
| **0 — dark** (now) | nobody | nothing; all `FIRM_OS_*` off (`FIRM_OS_ENABLED` included); SOP packs not seeded in prod; role defaults saved without the Firm OS modules (§3 step 1) | — | §1 preconditions met |
| **1 — partners** | partners only | `FIRM_OS_ENABLED=1`, then the Firm OS modules switched on per partner (§3 steps 2–3); `FIRM_OS_CL_PATHS` for partners' clients only if the CL- sites exist; Phase 9–10 flags | /admin/firm-os/models: cost/day vs `AI_DAILY_BUDGET_INR`, guardrail breaches, escalations; AuditEvent `close-refused`, `done-alert`; reconciler summaries; Railway error logs | 5 working days; ≥ 2 real onboardings and ≥ 5 approved packs reviewed by a partner; zero data-loss or wrong-folder incidents; partner sign-off |
| **2 — 2 pilot staff** | partners + 2 named staff | the Firm OS modules switched on for the two staff (workspace settings → People) | as Stage 1, plus RBAC: pilot staff see only their assigned jobs; coach nudges respectful (≤ 3 break nudges/day, dismissible) | 10 working days; close loop reaches DONE on ≥ 10 jobs with Turia time logged; no RBAC leak; staff feedback taken |
| **3 — all staff** | everyone | the Firm OS modules added to the role defaults (§3 step 4); announce | same; weekly accuracy canary | owner's explicit yes |

Never in prod at any stage: `FIRM_OS_ECHO_AGENT`, `FIRM_OS_ONBOARD_CONFIRM=false`,
`FIRM_OS_TURIA_UI=true` (until Turia confirms), `LOCAL_LLM_BASE_URL` (until Phase 2b).

## 5. Seed the SOP packs — only after partner review

The runner refuses to run an agent without an active SopPack (`NO_SOP_PACK`). Packs are versioned and
never edited in place. Seed each **after** a partner has reviewed that agent's verify notes (§8) and
record the approver. Run once per database (staging first, then prod), by a person with DB access:

```sh
# GST (dedicated seed; create-only, idempotent)
npx tsx -e "import { PrismaClient } from '@prisma/client'; import { seedGstSopPack } from './src/lib/agents/gst/seed'; const db = new PrismaClient(); seedGstSopPack(db, { approvedById: '<partner user id>' }).then((r) => { console.log(r); return db.\$disconnect(); });"

# ROC, Tax, Books, Audit (v1.0.0 from each agent's built-in checklist; create-only)
for k in roc tax books audit; do npx tsx -e "
import { PrismaClient } from '@prisma/client'; import { getAgent } from './src/lib/agents/registry';
const db = new PrismaClient(); const a = getAgent('$k')!; const c = a.defaultChecklist; const [major, minor, patch] = c.version.split('.').map(Number);
db.sopPack.findFirst({ where: { key: a.sopPackKey, active: true } }).then((x) => x ? (console.log('exists', x.version), null)
  : db.sopPack.create({ data: { key: a.sopPackKey, version: c.version, major, minor, patch, title: a.title, checklist: JSON.parse(JSON.stringify(c)), active: true, approvedById: '<partner user id>', changeNote: 'v1.0.0 after partner review' } }))
  .then((r) => { if (r) console.log('created', r.key, r.version); return db.\$disconnect(); });"; done
```

Script entry requested for this (not yet in package.json): `seed:sop-packs` → `scripts/seed-firm-os.ts`
(named in the orchestrator ARCHITECTURE; not built).

- [ ] GST pack seeded — approved by ____________  · [ ] ROC · [ ] Tax · [ ] Books · [ ] Audit

## 6. Prompt lock and accuracy gate — re-run on the release commit

On the exact commit that will be merged (all from `docs/qa/phase-12-runbook.md`):

- [ ] `npm run verify:prompts` — prompts.lock.json matches every registered model task (ADR-008).
- [ ] `npm run accuracy -- --agent=gst|roc|tax|books|audit|echo`, each **3×**, all pass; scoreboard
      copied to PROGRESS.
- [ ] MistakeLog replay 100 % (part of the accuracy run).
- [ ] Live canary on staging once `ANTHROPIC_API_KEY` is set there: `npm run accuracy:canary`
      (recorded-mode accuracy proves the code path; only the canary exercises the live model).

## 7. Human E2E checklist (orchestrator spec, on staging)

- [ ] Sign in with Microsoft as partner → /onboard → type one sentence → answer ≤ 2 rounds of questions → plan preview correct.
- [ ] Create → CL-{Code} site visible under Indefine-Compliance hub; FY tree correct; Turia client present (or Manual checklist completed).
- [ ] Assignee sees jobs with due dates on /work and morning board. *(Firm OS jobs are on /agents and the dashboard board card — /work is the two-person tech tracker, inventory G-7.)*
- [ ] Upload fixture registers → run GST Prep → checklist flags make sense → approve → file in `Final/`.
- [ ] Mark filed (enter ARN) → close Turia → job DONE; cycle time shown.
- [ ] Try to mark DONE without Turia close → refused.
- [ ] No button anywhere submits to a government portal or sends client email.

Automated counterparts (staging, `npm run e2e:db`): onboard, gst (incl. request changes → re-run),
roc, tax, books, audit, golden-path, close-loop, rbac, coach, comms, rbac-phase-10-11 (its Phase 11
tests run after that merge).

## 8. Partner verification (from PROGRESS "Blocked / needs human")

Approval of a feature cannot verify law. Each item needs a partner's answer, recorded in the pack's
verify notes or PROGRESS, before the corresponding agent's SOP pack is seeded (§5):

- [ ] **Calendar defaults** — QRMP GSTR-3B 22nd/24th state groups vs current CBIC notification; AGM day-counting convention; ITR non-audit due date under the Income-tax Act 2025 / Finance Act 2026 (kept 31 Jul); DIR-3 KYC frequency (kept annual 30 Sep); 2025-Act form names for TDS / advance tax.
- [ ] **Onboarding catalog** — JOB_CATALOG per entity type (`src/lib/agents/onboarding/planner.ts`); PAN 4th-character rule per entity (`validators.ts`); calendar rules missing for Books close, Audit, Engagement letter, LLP Form 11/8; AGM date not captured at onboarding (AOC-4 / MGT-7 / ADT-1 stay pending).
- [ ] **GST** (`src/lib/agents/gst/config.ts` GST_VERIFY_NOTES) — B2CL > ₹1,00,000 (N 12/2024); s.50(1) 18 % on the cash portion; GSTR-3B late fee ₹50/day (nil ₹20) + AATO caps (N 19/2021); QRMP 22nd/24th groups (N 82/2020); 2B tolerance ₹1 (firm SOP); rule 37 180 days, proportional; RCM list + rates (legal, GTA 5 %, security, director, sponsorship, unregistered commercial rent N 09/2024-R); HSN 4/6 digits (N 78/2020); e-invoice > ₹5 cr (N 10/2023); s.34(2) and s.16(4) 30 Nov; 17(5) categories; set-off order (s.49/49A, rule 88A, Circular 98).
- [ ] **Small-company limits FY 2025-26 (decisive)** — were s.2(85) limits raised to ₹10 cr paid-up / ₹100 cr turnover w.e.f. 1 Dec 2025 (cite the G.S.R.)? Until confirmed only ₹4 cr / ₹40 cr (2022) apply.
- [ ] **ROC / Tax** (data.ts verify notes + "Verify" sheet) — CSR thresholds on PBT; AGM 6/9/15 months; AOC-4 / MGT-7 / ADT-1 day counting; fee and additional-fee tables; DIR-3 KYC frequency; rotation classes; FY 2025-26 slabs, 87A ₹12 L / ₹60 k with marginal relief, surcharge caps, CG 20 % / 12.5 %, 44AD / 44ADA limits, 44AB, 43B(h) 15/45 days, advance tax + 234B/C, 234F, ITR-1/4 limits. Income-tax Act 2025 (tax year 2026-27) rates are stored unverified; the tax agent refuses that year until a partner publishes verified numbers.
- [ ] **Books / Audit** (config.ts verify notes) — bank match windows 5/31 days; unreconciled > 30 days; expense spike > 50 % and ≥ ₹50 k; TDS deposit 7th / 30 Apr (2025-Act equivalent?); materiality 1 % of revenue, PM 75 %; variance ≥ PM and ≥ 20 %; minimum sample 25, MUS factor 3.0; CARO exemption limits; s.138 thresholds; severities (GST mismatch / negative cash / suspense = warn; TDS not deposited, BRS difference = block).
- [ ] **Agent conventions** — TDS warn-before-due / block-on-due; audit sample below SOP minimum = block; GST drafts conservative (time-barred credit note excluded, abstained-bill ITC held back); no input for cancelled documents (Table 13 cancelled always 0).

Other human actions still open (PROGRESS "Blocked"): Turia API docs/credentials (ADR-003; MANUAL
until then); PnP certificate + SharePoint/Entra admin consent; Entra groups claim for role mapping;
Graph app-only creds + consent; SP_SITE_OWNER + hub registration; ANTHROPIC_API_KEY (+ optional
XAI_API_KEY); delegated Mail.ReadWrite on the sign-in app with admin consent (comms and engagement-letter
Outlook drafts; staff reconnect at /connect?mail=1); staging DATABASE_URL; opening the PR (no gh CLI
on the build machine).

## 9. Rollback

- **Switch the flags off** (Railway variables → redeploy, ~2 min). `FIRM_OS_ENABLED` off closes every
  Firm OS module and entry point for everyone (§3); to take back one person or module only, switch it
  off in the workspace settings instead (takes effect on their next page load).
- **No data loss.** Firm OS migrations are additive only (new tables / columns; no drop or rename of
  LMS columns — guarded by review and `verify:*`). Turning Firm OS off leaves JobTasks, runs,
  deliverable records and audit events in place for when it is turned back on. Nothing in Firm OS
  deletes SharePoint files, Turia records or LMS data (no delete path; `verify:no-delete`).
- **Documents stay where they are:** drafts in `CL-{Code}/Compliance/FY…/{Service}/{Period}/Working`,
  approved packs in `Final/`. Turia stays the source of truth for tasks and time.
- **Do not roll back the database** to undo Firm OS. A schema rollback is not needed (additive) and a
  data restore would discard LMS activity since the snapshot. Restore only for a real incident, using
  the drilled procedure (§1).
- **In-flight work after rollback:** jobs mid-close stay in CLOSING; when Firm OS is re-enabled the
  reconciler resumes (it never reopens DONE jobs). Onboardings left RUNNING by a crash are taken over
  after 10 minutes on Retry (`tests/chaos/db-restart-saga.test.ts`; see the UI note there).

### 9.1 Incident 06 Nov 2026 — boot crash loop after the Firm OS merge (resolved)

- **What happened:** PR #70 merged 09:33 IST; Railway deployed `main`. Its start path ran
  `prisma db push` before `npm start`, which created the Firm OS tables and enums straight from
  `schema.prisma` without recording migrations. `npm start` then ran `prisma migrate deploy`, and the
  first Firm OS migration failed on `CREATE TYPE "ModelProviderId"` (already exists). The boot script
  marks a half-applied migration rolled back and retries it, so every restart failed the same way.
  lms.indefine.in returned 502 from about 09:44 to 10:15 IST. No LMS data was changed or lost (only
  new, empty Firm OS objects were created).
- **Fix (PR #71, merged 10:15):** every Firm OS migration is re-runnable (enums and constraints in
  DO blocks that ignore only the duplicate error; `CREATE TABLE / INDEX IF NOT EXISTS`;
  `ADD COLUMN IF NOT EXISTS`). The next boot recorded the migrations over the existing objects and
  started; Firm OS stays off (`FIRM_OS_ENABLED` unset). `tests/unit/migrations-rerunnable.test.ts`
  enforces the pattern and CI re-applies every Firm OS migration with psql on Postgres 16.
- **Why a rollback would not have helped:** the previous release would also run `db push`, now with
  the old schema, which tries to drop the new tables (refused without `--accept-data-loss`, so the
  boot fails). Fix forward instead.
- **Lessons (now preconditions in §1):** remove `prisma db push` from the Railway start path; apply
  every migration to a copy of the production database before merging; check how the platform
  actually starts the app, not only `package.json`.

## 10. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Owner (go-live yes / no) | Lakshmanan A | ☐ yes ☐ no | |
| Partner — tax / GST / ROC verification (§8) | | ☐ verified | |
| Partner — audit / books verification (§8) | | ☐ verified | |
| Partner — SOP packs reviewed and seeded (§5) | | ☐ done | |
| IT / admin — Railway variables, consents, crons (§2) | | ☐ done | |
| QA — Phase 12 runbook green, UI checklist passed | | ☐ done | |

---

**STOP.** No flags enabled in prod, no merge to `main`, no announcement until the human's explicit
**yes** in the sign-off table above.
