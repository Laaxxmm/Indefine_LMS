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
| `FIRM_OS_CL_PATHS` | unset (off) | /clients folder links resolve to CL-{Code} sites and the client page shows the "Firm OS jobs" card. |
| `FIRM_OS_ECHO_AGENT` | unset (off) — **never on in prod** | Shows the internal Echo test agent. Staging only (golden-path e2e). |
| `FIRM_OS_ONBOARD_CONFIRM` | unset (= confirm) — **never `false` in prod** | A partner/manager must click Create before the onboarding saga runs. |
| `FIRM_OS_TURIA_BRIDGE` | unset (= `MANUAL`) | MANUAL checklists (ADR-003). `UI`/`API` are stubs that block. |
| `FIRM_OS_TURIA_UI` | unset (off) | UI automation against practice.turia.in — off until Turia confirms it is permitted. |
| `FIRM_OS_BREAK_NUDGE` (Phase 9) | unset (off) | LMS activity heartbeats + gentle break nudges (ADR-006: kept 7 days, aggregate only, never reported to managers). Tell staff what is collected **before** turning it on. Off = no heartbeat stored, no ping sent. |
| `FIRM_OS_HOLIDAYS` (Phase 9) | set to the firm's holidays | Comma-separated `YYYY-MM-DD` the coach skips when counting working days (the LMS has no holiday table); blank = weekends only. Not a feature flag — set it before Stage 1. |
| `FIRM_OS_COMPANION_EXTENSION_ORIGIN` (merged with Phase 10) | unset unless the extension id differs | CORS origin the companion API answers besides the extension's fixed id (`src/lib/companion/config.ts`). Not in `.env.example` yet. |
| Phase 10 comms | no flag | Comms drafts have no `FIRM_OS_*` switch: /comms is reached from the Firm OS pages only (not from LMS pages — `firm-os-flags-off.test.ts`). "Open in Outlook draft" and engagement-letter drafts need the delegated **Mail.ReadWrite** consent (§8). |
| Phase 11 flags | *fill in after merge* | Rate limits etc. — copy the names from `.env.example` after the merge and add rows here. |

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

## 3. Rollout gap — decide before Stage 1

With every `FIRM_OS_*` flag off (production default), Firm OS entry points are **already visible**,
because they are gated by role, not by a flag (`tests/regression/firm-os-flags-off.test.ts` pins this):

- `/dashboard` shows **Agents** (→ /agents) and, since Phase 9, **My day** (→ /coach) to every
  active user, plus the **My day** morning-board card to everyone with open Firm OS jobs — so the
  dashboard queries Firm OS jobs for every signed-in person even with all flags off;
- `/tools` and `/clients` show **Firm OS onboarding** (→ /onboard) to partners, managers and admins;
- `/admin` shows the **Firm OS** group (models, mistakes, cycle time, workspace modules) to LMS admins.
- /comms, /workspace, /search, /focus and /companion are linked only from Firm OS pages, never from an
  LMS page (pinned by `tests/regression/firm-os-flags-off.test.ts`).

The pages behind them work (draft packs only; no portal, no send), but the staged rollout below
("partners → 2 pilot staff → all") cannot be enforced by flags alone. Before Stage 1 choose one:

- **A (recommended):** add a master gate — e.g. `FIRM_OS_ENABLED` plus `FIRM_OS_PILOT_EMAILS`
  (comma-separated, like `WORK_TRACKER_EMAILS`) — checked by the Firm OS layouts, nav links and API
  guards; then update the allowlist in `firm-os-flags-off.test.ts` (it must then show *no* Firm OS
  link with the flags off). A code change (Phase 11 follow-up), with tests, before go-live.
- **B:** accept role-gated visibility and roll out by announcement only (staff can find /agents
  before they are told).

Decision: ☐ A  ☐ B — owner: ______________________ date: ____________

## 4. Feature-flag rollout plan

Every stage is reversible by switching flags off (§9). Move to the next stage only when its exit
criteria hold and the owner says so.

| Stage | Who | Turn on | Watch daily | Exit criteria |
|---|---|---|---|---|
| **0 — dark** (now) | nobody | nothing; all `FIRM_OS_*` off; SOP packs not seeded in prod | — | §1 preconditions met; §3 decided |
| **1 — partners** | partners only (pilot list = partners) | master gate for partners (§3 A); `FIRM_OS_CL_PATHS` for partners' clients only if the CL- sites exist; Phase 9–10 flags for partners | /admin/firm-os/models: cost/day vs `AI_DAILY_BUDGET_INR`, guardrail breaches, escalations; AuditEvent `close-refused`, `done-alert`; reconciler summaries; Railway error logs | 5 working days; ≥ 2 real onboardings and ≥ 5 approved packs reviewed by a partner; zero data-loss or wrong-folder incidents; partner sign-off |
| **2 — 2 pilot staff** | partners + 2 named staff (add to the pilot list) | same flags for the pilot list | as Stage 1, plus RBAC: pilot staff see only their assigned jobs; coach nudges respectful (≤ 3 break nudges/day, dismissible) | 10 working days; close loop reaches DONE on ≥ 10 jobs with Turia time logged; no RBAC leak; staff feedback taken |
| **3 — all staff** | everyone | master gate on for all; announce | same; weekly accuracy canary | owner's explicit yes |

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

- **Switch the flags off** (Railway variables → redeploy, ~2 min). The master gate (§3 A) hides every
  Firm OS entry point; with B, remove pilot users / set flags off and announce.
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
