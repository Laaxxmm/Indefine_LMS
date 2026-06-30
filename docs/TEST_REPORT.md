# Indefine LMS — Test & Audit Report

Date: 2026-06-30 · Scope: full codebase (40 routes, all server actions, libs, schema).

> **What this is:** a code-level audit + build verification of every page, API route,
> server action, guardrail, and security boundary, plus a secret scan and a manual
> end-to-end checklist to run against the deployed app. Live click-through testing
> against production requires the M365 / Gemini / Postgres environment and is captured
> as the checklist in [§7](#7-manual-end-to-end-checklist-run-on-the-live-app).

---

## 1. Headline verdict

| Area | Result |
|---|---|
| Build (`next build`) | ✅ All 40 routes compile |
| Types (`tsc --noEmit`) | ✅ Clean |
| Secret scan (whole repo + git history) | ✅ **NO CREDENTIALS COMMITTED** |
| Quiz grading integrity | ✅ Server-side, score not forgeable |
| Quiz answer leakage | ✅ Correct answers stripped before client |
| AI quiz grounding guardrail | ✅ Verbatim-quote enforced, drop-on-fail |
| Auth & role enforcement | ✅ Every admin route/action re-checks role |
| Access control (published gate) | ⚠️ Gap found → **fixed in this pass** |
| Honor-system limits (watch %, timer) | ⚠️ Documented; recommended hardening listed |

No HIGH-severity issues. One real access-control gap was found and fixed; the remaining
items are LOW/MED and mostly inherent to an internal honor-system tool.

---

## 2. Build & route inventory

`next build` compiled cleanly. Routes (ƒ = dynamic / server-rendered):

- **Employee:** `/`, `/dashboard`, `/video/[id]`, `/quiz/[id]`, `/quiz/[id]/result`,
  `/leaderboard`, `/team`, `/team/[userId]`, `/initiatives`, `/checkin`, `/checkin/history`,
  `/recap`, `/recap/year`, `/wizard` (+ strengths/aspiration/quests/initiative/review).
- **Admin:** `/admin`, `/admin/video/[id]`, `/admin/auto-quiz`, `/admin/courses`,
  `/admin/assignments`, `/admin/team`, `/admin/branches`, `/admin/trajectory`,
  `/admin/approvals`, `/admin/checkins`, `/admin/attendance`, `/admin/kra`, `/admin/kra/[userId]`.
- **API:** `auth/[...nextauth]`, `video/[id]/stream`, `video/[id]/progress`,
  `quiz/[id]/start`, `quiz/[id]/submit`, `admin/quiz/generate`, `admin/quiz/from-video`,
  `admin/kra/export`.

---

## 3. Access-control audit

### Pages
- Every authenticated page calls `auth()` and redirects signed-out users to `/`.
- The **admin layout** (`src/app/admin/layout.tsx`) redirects non-admins to `/dashboard`,
  covering the entire `/admin/*` subtree; individual admin pages also re-check.
- Navigation (admin sidebar, dashboard header, video sidebar, wizard steps) was traced —
  no dead links or routes pointing at missing pages.

### API routes
| Route | Auth | Admin gate | Notes |
|---|---|---|---|
| `quiz/[id]/start` | ✅ 401 | — | Strips answers; **now** also blocks unpublished-course videos |
| `quiz/[id]/submit` | ✅ 401 | — | Ownership + double-submit guarded; server re-grades |
| `video/[id]/stream` | ✅ 401 | — | **Now** blocks unpublished-course videos (admins exempt) |
| `video/[id]/progress` | ✅ 401 | — | Monotonic; **now** blocks unpublished-course videos |
| `admin/quiz/generate` | ✅ 401 | ✅ | Admin-only |
| `admin/quiz/from-video` | ✅ 401 | ✅ | Admin-only; skips videos that already have a quiz |
| `admin/kra/export` | ✅ 401 | ✅ 403 | Admin-only; CSV escaped |

### Server actions
All 22 server-action files re-check auth/role inside the action (server actions are
independently-invocable, so the layout is correctly treated as non-authoritative).
Self-service writes derive the owner from `session.user.id` (never the client). Manager/peer
actions (endorsements, milestone approvals) enforce a manager-or-admin ownership gate.

---

## 4. Critical guardrail verification

| # | Guardrail | Verdict | Evidence |
|---|---|---|---|
| 1 | Quiz grading server-side, score not forgeable | ✅ PASS | `submit/route.ts` body accepts only `answers`; `gradeAttempt` uses server `isCorrect` |
| 2 | Correct answers stripped before client | ✅ PASS | `start/route.ts` → `toPublicQuestions` returns `{id,text}` only |
| 3 | AI questions grounded (verbatim quote, 1-correct, no dup, drop-on-fail) | ✅ PASS | `quiz-gen.ts` `validate()` + `isQuoteGrounded()` |
| 4 | Auto-quiz pipeline admin-only, skips existing quizzes | ✅ PASS | `from-video/route.ts` role check; `auto-quiz.ts` `has-quiz` skip |
| 5 | Stream requires auth; progress monotonic | ✅ PASS (hardened) | auth enforced; `Math.max` monotonic; **published gate added** |

---

## 5. Issues found, fixes applied & recommendations

### Fixed in this pass ✅
1. **Unpublished-video access (was: any authed user could stream/start any video by ID).**
   Added a `published`-course gate to `video/[id]/stream`, `video/[id]/progress`, and
   `quiz/[id]/start` (admins exempt so they can still preview). Matches the visibility rule
   the dashboard already uses.
2. **Misleading dead timer code** in `quiz/[id]/submit` (an empty `if (elapsed > limit)`
   block that looked like enforcement). Replaced with an honest comment: the timer is a
   client guard; the server grades fairly and no score can be forged.
3. **KRA report showed inactive users** (fixed earlier this session) — now filters `active`.

### Recommended (not changed — need a product decision)
| Sev | Item | Recommendation |
|---|---|---|
| MED | **Video completion is client-reported** — a crafted `POST …/progress {percent:100}` marks a video complete without watching, unlocking its quiz. Inherent to streamed video + honor system. | If stricter integrity is needed, accumulate watch time server-side across heartbeats and only honor `completed` when cumulative time ≈ duration. |
| MED | **Quiz timer not server-enforced** (grades whatever is submitted, any time). | Acceptable for best-score-wins + retakes. If strict timing matters, void/zero attempts submitted well past the limit. |
| LOW | **Result page reads score from URL params** (`/quiz/[id]/result`) — cosmetic only; leaderboard/KRA use the DB record, so nothing is awarded from the URL. | For polish, render the stored attempt from the DB by id. |
| LOW | **No range validation on some admin numeric inputs** (pass %, unlock %, points). Admin-only, so misconfiguration not attack. | Clamp ranges (e.g. 0–100, ≥0). |
| LOW | **Unbounded free-text** on self-service writes (check-ins, initiatives, wizard). | Cap field lengths in the actions. |
| LOW | **User sync mass-deactivation risk** — a partial Graph response could mark users inactive. | Add a `total === 0` (or large-drop) guard before deactivating. |
| LOW | **Admin role never auto-revoked** when an email leaves `ADMIN_EMAILS`. | Demote to EMPLOYEE on sync when no longer an admin/licensed. |
| LOW | **No `middleware.ts`** — protection is per-route (currently consistent). | Add a matcher over `/admin` + `/api/admin` as defense-in-depth. |

None of the above is exploitable for privilege escalation or data exfiltration in the
current two-role, ~16-user internal deployment.

---

## 6. Secret scan

Swept all tracked files (excluding `node_modules`/`.next`) and **git history** for API keys
(`AIza…`, `sk-`, `ghp_`, `xox…`), `client_secret`, `AUTH_SECRET`, private keys, JWTs, and
`postgresql://user:pass@` DSNs.

**Verdict: NO CREDENTIALS COMMITTED.**
- Only `.env.example` is tracked, with empty/placeholder values.
- `.env` is gitignored and absent from history.
- The `client_secret` occurrences in `graph.ts` are OAuth **field names**; the value comes
  from `process.env.MS_CLIENT_SECRET`.
- The Gemini key is sent via the `x-goog-api-key` header (never in a URL) and never logged.

---

## 7. Manual end-to-end checklist (run on the live app)

These need the deployed environment (M365 + Gemini + Postgres). Tick each on staging/prod.

### Auth & navigation
- [ ] Visiting any page while signed out redirects to `/`.
- [ ] Sign in with Microsoft 365 lands on `/dashboard`.
- [ ] A non-admin visiting `/admin` is redirected to `/dashboard`.
- [ ] An admin sees the Admin button + full sidebar.
- [ ] Sign out returns to `/` and protected pages are no longer reachable.

### Content & sync (admin)
- [ ] `/admin` → **Sync now** imports videos; re-running doesn't duplicate.
- [ ] **Sync users** pulls licensed M365 members; departed users drop off.
- [ ] `/admin/courses` shows modules + videos with quiz-status badges.

### Video & quiz (employee)
- [ ] A video plays; **speed buttons 0.5×–2×** work and are visible.
- [ ] Progress bar advances; quiz unlocks at the configured % watched.
- [ ] **Start quiz** → timer runs; answers can be changed before submit.
- [ ] **Submit** shows a server-graded score; correct answers were never exposed in network responses.
- [ ] Failing allows **Retake**; best score is what counts.
- [ ] Try `GET /api/video/<id>/stream` for a video in an **unpublished** course as a non-admin → expect 404.

### AI quizzes (admin)
- [ ] `/admin/video/[id]` → paste a script → **Generate & add** creates grounded questions.
- [ ] **Review first** shows drafts with source quotes; reject/edit/add works.
- [ ] Pasting <200 chars is rejected with a clear message.
- [ ] `/admin/auto-quiz` → **Generate** on one video transcribes + builds a quiz; completed videos show the green ✓ and can't be regenerated.

### KRA & attendance (admin)
- [ ] `/admin/kra` lists only **active** employees; date filter + **Download CSV** work.
- [ ] `/admin/attendance` imports a greytHR CSV, matches employees, and points appear on the leaderboard.

### Leaderboard & dashboard
- [ ] Podium shows top-3 with **fully visible names** (no clipping); branch/department filters work.
- [ ] Dashboard hero, wizard, and check-in render in the calm theme with no clashing colors.

### Security spot-checks
- [ ] As a non-admin, `POST /api/admin/quiz/generate` returns 401.
- [ ] `GET /api/admin/kra/export` as a non-admin returns 403.
- [ ] Submitting someone else's `attemptId` to `quiz/[id]/submit` returns 404.

---

## 8. How to reproduce the automated checks

```bash
npm install
npx tsc --noEmit        # types
npm run build           # production build (compiles all routes)
npm audit               # dependency vulnerabilities (currently 1 moderate, non-applicable)
```
