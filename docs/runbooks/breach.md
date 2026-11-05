# Runbook: personal data breach (Firm OS / LMS)

- **Status:** Phase 11, 2026-11-05. Owner: the partner on duty (incident lead) + Firm OS lead engineer.
- **Scope:** any unauthorised access to, disclosure, change, loss or destruction of personal data the
  firm holds: client data (class A), staff data (class B) — see [data inventory](../dpdp/data-inventory.md).
- **Legal timelines (confirm with counsel; they change):** DPDP Act, 2023 s.8(6) and the DPDP Rules:
  intimate the **Data Protection Board** and **each affected person** without delay, and send the Board
  the detailed report within **72 hours** of becoming aware. CERT-In Directions (28 Apr 2022): report
  a cyber incident to **CERT-In within 6 hours** of noticing it (incident@cert-in.org.in).
  Professional duties to clients under the engagement letter also apply.

## 0. First 15 minutes

1. **Write down** the time you noticed, who told you, and what you saw (an incident note in a private
   Teams chat with the partners; not in a client channel).
2. **Name an incident lead** (a partner) and a technical lead. Everyone else stops changing systems.
3. **Preserve evidence before you change anything:** take a Railway Postgres snapshot (Railway →
   project → Postgres → Backups → *Create backup*); export the last 7 days of Railway logs for the web
   service; note the current deploy id.

## 1. Contain (within the first hour)

Do the steps that fit the incident; each is reversible.

| Situation | Action |
|---|---|
| A staff account is compromised | In Entra: block sign-in, revoke sessions, reset password/MFA. In the LMS: set the user inactive (`/admin/team`); end their app sessions with `UPDATE "Session" SET "expires" = now() WHERE "userId" = '<id>';` (an update, nothing deleted) |
| All app sessions must end | `UPDATE "Session" SET "expires" = now();` — everyone signs in again with Microsoft |
| Firm OS features must stop | Set every `FIRM_OS_*` flag to off in Railway (flags default OFF) and redeploy; the LMS keeps working |
| Model calls must stop | Remove `ANTHROPIC_API_KEY` and `XAI_API_KEY` in Railway: the ModelRouter fails closed and queues work for people |
| A secret may have leaked | Rotate it (table below), redeploy, then check its use in the provider's console |
| A SharePoint client site is exposed | SharePoint admin: remove the sharing link / external user; Purview audit log for that site |
| Suspected database exposure | Rotate the Postgres password (Railway → Postgres → Variables → regenerate), update `DATABASE_URL` everywhere, redeploy |
| Abuse of an API (bulk requests) | Lower the limit at once: `RATE_LIMIT_ONBOARD`, `RATE_LIMIT_AGENT_RUN`, `RATE_LIMIT_COMMS_DRAFT` (e.g. `1/1h`), redeploy. The limiter fails closed: if its table is unreachable, onboarding, agent runs and comms drafting answer 503 "The system is busy" until the database is back. Agent runs are also capped per process (`AGENT_RUN_CONCURRENCY`, default 2; `AGENT_RUN_QUEUE`, default 6 waiting) — set `AGENT_RUN_CONCURRENCY=1` to slow a burst further. Block the account as well |

**Secrets to rotate** (names only; values live in Railway and GitHub secrets): `AUTH_SECRET`,
`AUTH_MICROSOFT_ENTRA_ID_SECRET`, `MS_CLIENT_SECRET` (Graph app-only), the PnP certificate (SharePoint
site creation), `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `CRON_SECRET` (Railway **and**
the GitHub Actions secret), the secret-box key used by `src/lib/secret-box.ts` (re-encrypts the Turia
cookie and stored Graph tokens: re-connect afterwards), the Postgres password, `NEO_CENTRA`/Turia
session (re-capture after rotation). Never paste a secret into chat, a ticket or this repo.

## 2. Assess (hours 1–24)

Work out **what data, whose, how many, since when**. Useful queries (read-only; run in Railway's
query tab or `psql` against a restored copy where possible):

```sql
-- Who did what, around the incident window (every create/approve/close/export/escalation/spot-check)
SELECT "createdAt", "actorId", action, entity, "entityId", meta
FROM "AuditEvent" WHERE "createdAt" BETWEEN '<from>' AND '<to>' ORDER BY "createdAt";

-- Downloads (exports) of client deliverables in the window
SELECT * FROM "AuditEvent" WHERE action = 'export' AND "createdAt" > '<from>';

-- Model calls in the window (prompts are stored only as hashes of masked text)
SELECT "createdAt", agent, task, provider, tier, anonymized, status FROM "ModelCall" WHERE "createdAt" > '<from>';

-- Sessions active in the window
SELECT "userId", expires FROM "Session" WHERE expires > '<from>';
```

Also check: Entra sign-in logs (risky sign-ins, unfamiliar locations), Microsoft Purview audit for the
affected `CL-{Code}` sites, Railway deploy history (unexpected deploys), GitHub audit log (secrets,
workflow changes), and the provider dashboards (Anthropic usage spikes).

Classify each affected record with the [inventory](../dpdp/data-inventory.md) classes. Class A data
sent to a cloud model is masked by design; confirm `ModelCall.anonymized = true` for the calls in
question. A virus-scan engine is not configured (uploads are "not scanned — allowed with warning",
logged as `[upload]` lines): if malware is suspected, collect those log lines.

## 3. Notify

| Who | When | How | Owner |
|---|---|---|---|
| CERT-In | within 6 h of noticing a cyber incident | form on cert-in.org.in / incident@cert-in.org.in | technical lead |
| Data Protection Board | without delay; detailed report within 72 h | as prescribed by the DPDP Rules (portal / form in force) | incident lead |
| Each affected person (client principals, staff) | without delay | plain-language email from a partner's mailbox: what happened, what data, what we did, what they can do, contact person | incident lead |
| Affected clients (business contact) | same day as the decision to notify | call, then email | engagement partner |
| Microsoft / Railway / Anthropic | if their service was the vector | their security contact | technical lead |

Firm OS never sends client email itself: notices are written and sent by a partner.

## 4. Recover

1. Fix the root cause (patch, revoke access, tighten a policy); add a test that would have caught it.
2. Redeploy; run `npm run verify:firm-os`, `npx tsx scripts/verify-rbac.ts`, `npx tsx scripts/verify-audit-coverage.ts`.
3. Re-enable flags partner-first, then pilot staff, then all (go-live plan).
4. If data was changed, restore the affected rows from the snapshot taken in step 0 into a scratch
   database ([backup restore](backup-restore.md)) and copy back only what is needed; nothing is deleted.

## 5. Close

- Incident report within 5 working days: timeline, data and people affected, notifications sent (with
  times), root cause, fixes, follow-ups with owners. Record it as an AuditEvent
  (`action: "breach-report"`, entity `Incident`) and keep the report with the firm's compliance records.
- Review this runbook: anything that was slow or unclear gets fixed here.
