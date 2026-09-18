# Client ops — hosting & domain renewals

`/tools/client-ops`. Tracks the renewable services the studio runs for web clients: what
expires when, what we pay the provider, what we bill the client, and whether a reminder has
gone out.

## Not the CA client list

`OpsClient` is deliberately separate from `Client`. Those are the firm's audit/tax/ROC
clients; these are web/hosting accounts — a different list of people and different billing.
Keeping them apart means neither tool can corrupt the other's data.

## No credentials, ever

The tool stores no usernames, passwords or API keys, and there is no field to put them in.
Two public lookups keep the dates honest instead (`src/lib/client-ops/lookup.ts`):

| Source | Answers | Writes to |
|---|---|---|
| **RDAP** (`rdap.org` bootstrap) | registry expiry for `domain` | `expiresOn` — the registry date *is* the renewal deadline, so it overwrites what was typed, and the previous value is kept in `checkNote` |
| **TLS handshake** on port 443 | certificate expiry for `sslHost` | `sslExpiresOn` — **never** `expiresOn` |

Keeping them apart is the point: a Let's Encrypt certificate renews about every 90 days
while the hosting bill is yearly, so writing a certificate date into the billing column
would invent an expiry every quarter. A certificate inside `CERT_ALARM_DAYS` (15) is listed
on the dashboard even when its billing date is years out, and it never counts toward the
money totals.

The TLS probe sets `rejectUnauthorized: false` on purpose — an expired or mismatched
certificate is exactly the case worth reporting, and a rejected handshake would hide the
date. Nothing is sent over the socket; it reads the presented certificate and hangs up.

Failures are recorded, not hidden: unregistered domains, TLDs without RDAP, dead DNS and
timeouts all land in the row's `checkNote`, and a failed probe keeps the last known
certificate date.

## Refresh

`runChecks()` in `src/lib/client-ops/refresh.ts` is the single implementation, called from:

- the **Refresh checks** button on the dashboard, and
- `GET /api/cron/renewals`, driven nightly by `.github/workflows/renewals-nightly.yml`
  with the shared `CRON_SECRET` (same handshake as the other cron routes).

## Reminders

The app sends no email. It drafts the message, the team sends it (or opens the prefilled
`mailto:`), then marks it sent — which writes an `OpsReminder` row: who asked which client
for what, and when. Provider invoice amounts are entered by hand; there is no provider API
sync.
