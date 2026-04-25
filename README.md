# Indefine LMS

Internal Learning Management System for ~16 employees. Streams NotebookLM-generated
videos from a shared OneDrive folder, gates each video behind an MCQ quiz, tracks
per-employee progress, and rolls everything up into a leaderboard for KRA/appraisal.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind · Prisma · PostgreSQL ·
NextAuth v5 (Microsoft Entra ID / Azure AD) · Microsoft Graph API.

---

## Status

- [x] **Phase 1** — Microsoft 365 SSO, OneDrive sync, video player with heartbeat, dashboard, leaderboard
- [x] **Phase 2** — Quiz player (timer, MCQ, server-side grading, attempts), admin quiz editor
- [x] **Phase 3** — Deadlines (monthly/quarterly/yearly/custom), course-completion detection, KRA scoring on leaderboard, dashboard countdown widget
- [x] **Phase 4** — Date-range KRA dashboard, per-employee printable detail page, CSV export

### KRA report (admin)

`/admin/kra` — pick an appraisal window (defaults to the current April–March
financial year). Shows every employee with videos completed, quiz points,
deadline points, and total score for the window. Two outputs:

- **CSV:** one file with three sections — summary table, per-deadline rows,
  best-quiz-per-user rows. Filters all by `dueAt` / `submittedAt` inside the window.
- **Printable detail page:** `/admin/kra/[userId]` — clean print stylesheet
  (light background, black text). "Print / save as PDF" button uses the
  browser's native PDF printer, so no extra dependency.

### Course completion + KRA scoring

A user "completes a course" when:
1. Every video in every module of that course has `VideoProgress.completed = true`
2. Every quiz attached to those videos has at least one `QuizAttempt.passed = true`

The completion timestamp is the latest of those events. For each `Deadline` on
the course, we compare `completedAt` to `dueAt`:

| Outcome | Points awarded |
|---|---|
| Completed before `dueAt` | `pointsOnTime` |
| Completed after `dueAt` | `pointsLate` |
| Not yet completed, `dueAt` in future | 0 (state: `pending`) |
| Not yet completed, `dueAt` passed | 0 (state: `missed`) |

Final leaderboard score per user:
`videos × 10 + Σ(best-quiz % / 10) + Σ(deadline points awarded)`

Admin sets deadlines at **/admin/courses**.

### Quiz flow

1. User watches a video → server tracks % watched (monotonic).
2. Once they hit `unlockAtPercent` (default 90%), the quiz unlocks.
3. They click **Start quiz** → `POST /api/quiz/[id]/start` creates a `QuizAttempt` and returns
   the questions with correct answers stripped.
4. Client renders MCQs with a sticky timer (color goes red in the last 30s).
5. On submit (manual or auto on timeout) → `POST /api/quiz/[id]/submit`. The server re-grades
   using its own copy of `isCorrect` (clients never see it), enforces the timer
   with a 5s grace, and stores `score`, `maxScore`, `percent`, `passed`, and the
   raw `answers` JSON for review.
6. User lands on `/quiz/[id]/result` with their score and a Retake button if they didn't pass.
7. Best score per quiz feeds the leaderboard.

---

## One-time setup

### 1. Microsoft Entra (Azure AD) app registration

In [entra.microsoft.com](https://entra.microsoft.com) → **App registrations** → **New registration**:

- **Name:** Indefine LMS
- **Supported account types:** Single tenant (your org only)
- **Redirect URI:** Web → `http://localhost:3000/api/auth/callback/microsoft-entra-id`
  (add your Railway prod URL too once deployed)

After creation, note the **Application (client) ID** and **Directory (tenant) ID**.

Then under the new app:

- **Certificates & secrets** → New client secret → copy the secret **value** (not the ID)
- **API permissions** → Add a permission → Microsoft Graph:
  - **Delegated:** `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Files.Read.All`
  - **Application:** `Files.Read.All` (so the server can list videos for any user)
  - Click **Grant admin consent for {tenant}** at the top — required for application perms

### 2. Find your OneDrive video folder IDs

You need `GRAPH_DRIVE_ID` and `GRAPH_VIDEOS_FOLDER_ID`.

Easiest path — Graph Explorer ([developer.microsoft.com/graph/graph-explorer](https://developer.microsoft.com/graph/graph-explorer)) signed in as someone with access:

```
GET https://graph.microsoft.com/v1.0/me/drive          → driveId is `id`
GET https://graph.microsoft.com/v1.0/me/drive/root/children
```

Navigate into the videos folder and grab its `id` for `GRAPH_VIDEOS_FOLDER_ID`.

If videos live on a SharePoint site instead of personal OneDrive:

```
GET /sites?search={sitename}
GET /sites/{site-id}/drives
GET /drives/{drive-id}/root/children
```

### 3. Database

Provision a Postgres on Railway (or local). Copy the connection string into `DATABASE_URL`.

### 4. Environment

```bash
cp .env.example .env
# fill in every value
```

Then push the schema:

```bash
npm install
npx prisma db push
```

### 5. Run

```bash
npm run dev
# http://localhost:3000
```

Sign in with a Microsoft account whose email matches `ADMIN_EMAILS` in `.env`.
On first login that user gets `ADMIN` role automatically. Then go to **/admin** →
**Sync now** to pull videos from OneDrive.

---

## Deploying to Railway

1. Push this repo to GitHub.
2. Railway → **New Project** → **Deploy from GitHub repo**.
3. Add a Postgres service in the same project. Railway auto-injects `DATABASE_URL`.
4. Set the rest of the env vars from `.env.example` in the service Variables tab.
5. Set `AUTH_URL` to your Railway domain (e.g. `https://lms-indefine.up.railway.app`)
   and add the same `/api/auth/callback/microsoft-entra-id` URI to the Entra app.
6. Build command: `npm run build`. Start command: `npm start`.
7. Add a release/deploy command: `npx prisma db push` (or set up migrations).

---

## Project layout

```
src/
  app/
    page.tsx                    sign-in
    dashboard/page.tsx          employee landing
    video/[id]/                 player + heartbeat
    quiz/[id]/                  Phase 2 stub
    admin/page.tsx              OneDrive sync, video list
    leaderboard/page.tsx
    api/
      auth/[...nextauth]/       NextAuth handlers
      video/[id]/stream         resolves a fresh Graph download URL
      video/[id]/progress       receives heartbeat updates
  lib/
    auth.ts                     NextAuth config (Entra provider, Prisma adapter)
    prisma.ts                   shared Prisma client
    graph.ts                    Graph API helpers (app-only + delegated tokens)
    sync.ts                     imports OneDrive folder into DB
  middleware.ts                 redirects unauthed users to /
prisma/schema.prisma            full data model
```

---

## Why this design

- **No video re-hosting.** OneDrive holds the bytes; we only store metadata (driveId +
  itemId). Each play resolves a fresh short-lived stream URL via Graph, so videos
  stay private and storage costs nothing extra.
- **App-only Graph token** for video listing/streaming so the experience is the
  same for every user regardless of their personal OneDrive permissions. Falls
  back to the user's delegated token if app-only isn't granted yet.
- **Database sessions** (not JWT) so admin role flips and revocations take effect
  immediately, and so the user's Graph access_token is fetchable from the DB
  for the delegated fallback path.
- **Monotonic progress** — we never lower `percent` on the server, even if the
  user scrubs back. Quiz unlock only triggers forward.
