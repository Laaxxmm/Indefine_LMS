# Indefine LMS

Internal Learning Management System for a CA firm (~16 employees, multi-branch ready).
Streams training videos from a shared OneDrive/SharePoint folder, gates each video
behind an MCQ quiz, generates quizzes with AI, tracks per-employee progress and
attendance, and rolls everything into a KRA-linked leaderboard and a quarterly
performance "Trajectory".

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind · Prisma · PostgreSQL ·
NextAuth v5 (Microsoft Entra ID) · Microsoft Graph API · Google Gemini · Railway.

> **No credentials live in this repo.** Every secret is read from environment variables;
> `.env` is gitignored and only `.env.example` (with empty placeholders) is tracked.

---

## Documentation

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Site map + full **flowcharts** (auth, sync, quiz, AI, KRA, trajectory) |
| [docs/EMPLOYEE_GUIDE.md](docs/EMPLOYEE_GUIDE.md) | Employee handout — how to use the portal |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | End-to-end audit results + manual test checklist |

---

## Features

**Learning**
- Microsoft 365 SSO (single sign-on; no separate passwords)
- OneDrive/SharePoint video streaming via Graph (videos never re-hosted)
- Video player with resume, **playback speed (0.5×–2×)**, and monotonic watch tracking
- MCQ quizzes: server-side grading, timer, unlock at % watched, retakes, best-score-wins

**AI quiz generation (Gemini)**
- Paste a script → generate up to **100** grounded questions (batched), review or add live
- **Auto-quiz**: Gemini watches each video, transcribes it, and builds a grounded quiz —
  no script needed; completed videos show a persistent ✓
- **Guardrails**: every question must cite a verbatim quote from the source, or it's dropped

**Performance & KRA**
- Deadlines (monthly/quarterly/yearly/custom) with on-time vs late points
- Attendance import from **greytHR** monthly CSV → KRA points
- KRA appraisal report with date-range filter, per-employee detail page, and CSV export
- Leaderboard (people + branches) showing the full score breakdown
- "Trajectory": Growth Wizard, 6 tracks, tiers, weekly check-ins, initiatives, year-end Recap

**Admin**
- One-click OneDrive sync + M365 licensed-user sync
- Quiz editor, courses/modules/deadlines, assignments, team & branch management

---

## Screenshots

Add screenshots to `docs/screenshots/` and link them here. Suggested captures are
listed in the [employee guide appendix](docs/EMPLOYEE_GUIDE.md#appendix--screenshot-checklist).

---

## One-time setup

### 1. Microsoft Entra (Azure AD) app registration

In [entra.microsoft.com](https://entra.microsoft.com) → **App registrations** → **New registration**:

- **Name:** Indefine LMS
- **Supported account types:** Single tenant
- **Redirect URI:** Web → `http://localhost:3000/api/auth/callback/microsoft-entra-id`
  (add your Railway prod URL too once deployed)

Then under the app:
- **Certificates & secrets** → new client secret → copy the secret **value**
- **API permissions** → Microsoft Graph:
  - **Delegated:** `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Files.Read.All`
  - **Application:** `Files.ReadWrite.All`, `User.Read.All` (server-side video listing + user
    sync + copying a live-session recording out of the recorder's OneDrive — read-only
    `Files.Read.All` is enough for everything except that last copy)
  - Click **Grant admin consent** (required for application permissions)

### 2. OneDrive/SharePoint video folder

Find the **drive id** and the **videos folder path** (Graph Explorer:
`GET /me/drive` for the drive id, then browse to your videos folder). These map to
`GRAPH_DRIVE_ID` and `GRAPH_VIDEOS_FOLDER_PATH`.

### 3. Database

Provision a PostgreSQL (Railway or local) and set `DATABASE_URL`.

### 4. Gemini (AI quizzes — optional)

Create a key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
and set `GEMINI_API_KEY`. Leave `GEMINI_MODEL` blank to auto-detect a working model.
Without a key, the AI panels show a "set GEMINI_API_KEY" note and the rest of the app works.

### 5. Environment & run

```bash
cp .env.example .env     # then fill in every value (see table below)
npm install
npx prisma db push       # create the database schema
npm run dev              # http://localhost:3000
```

Sign in with a Microsoft account whose email is in `ADMIN_EMAILS` — that user becomes
`ADMIN` on first login. Then go to **/admin → Sync now** to import videos.

---

## Environment variables

Names and purpose only — **never commit real values**. See `.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | NextAuth session encryption secret (`openssl rand -base64 32`) |
| `AUTH_URL` | App base URL (`http://localhost:3000` / your Railway domain) |
| `AUTH_TRUST_HOST` | `true` behind Railway's proxy |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra application (client) ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra client secret value |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `GRAPH_DRIVE_ID` | Drive holding the videos |
| `GRAPH_VIDEOS_FOLDER_PATH` | Path to the videos folder within the drive |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | App-only Graph access (server-side listing + user sync) |
| `ADMIN_EMAILS` | Comma-separated admin emails (auto-promoted to ADMIN) |
| `GEMINI_API_KEY` | Google Gemini key (optional — enables AI quizzes) |
| `GEMINI_MODEL` | Optional model override; blank = auto-detect |

---

## Deploying to Railway

1. Push this repo to GitHub.
2. Railway → **New Project** → **Deploy from GitHub repo**.
3. Add a **PostgreSQL** service in the same project (Railway injects `DATABASE_URL`).
4. Set the remaining variables from the table above in the service **Variables** tab.
5. Set `AUTH_URL` to your Railway domain and add the matching `/api/auth/callback/...`
   redirect URI to the Entra app.
6. Build: `npm run build` · Start: `npm start` (the start script runs `prisma db push`).

---

## Project layout

```
src/
  app/
    page.tsx                 sign-in
    dashboard/               employee landing
    video/[id]/              player + heartbeat + speed control
    quiz/[id]/               MCQ player, result
    leaderboard/ team/ initiatives/ checkin/ recap/ wizard/
    admin/                   overview, video quiz editor, auto-quiz, courses,
                             attendance, kra, team, branches, trajectory, …
    api/
      auth/[...nextauth]/    NextAuth handlers
      video/[id]/stream      fresh Graph download URL
      video/[id]/progress    watch heartbeat
      quiz/[id]/start|submit start (answers stripped) / submit (server re-grade)
      admin/quiz/generate    AI quiz drafts (review)
      admin/quiz/from-video  transcribe + auto-generate
      admin/kra/export       KRA CSV
  lib/
    auth.ts prisma.ts graph.ts sync.ts users-sync.ts
    quiz.ts quiz-gen.ts gemini.ts transcribe.ts auto-quiz.ts
    kra.ts attendance.ts trajectory.ts gamification.ts checkins.ts …
  middleware.ts              redirects unauthenticated users to /
prisma/schema.prisma         full data model
docs/                        architecture, employee guide, test report
```

---

## Security model (summary)

- **Database sessions** so role changes/revocations apply immediately.
- Every `/admin/*` page redirects non-admins; every admin API returns `401` for non-admins.
- **Quizzes are graded server-side** — clients never receive correct answers or report scores.
- **AI questions are grounded** — each must quote the source verbatim or it's dropped.
- **No video re-hosting** — only metadata is stored; each play resolves a short-lived URL.
- App-only Graph token for consistent listing, with a delegated fallback.

See [docs/TEST_REPORT.md](docs/TEST_REPORT.md) for the full audit.
