# Runbook: OWASP ZAP baseline scan (Phase 11 QA gate)

- **Status:** Phase 11, 2026-11-05. **Blocked — needs a running staging deployment** (Railway staging
  URL) and a machine with Docker. Not run yet.
- **Gate:** orchestrator Phase 11 QA gate "OWASP ZAP baseline (or equivalent) no High findings on staging".
- **What it is:** the ZAP *baseline* scan spiders the site for a minute and reports passive findings
  (headers, cookies, information leaks). It sends no attack payloads, so it is safe to run on staging.

## Before you start

1. Staging is deployed from the branch under test, with production-like settings (`NODE_ENV=production`,
   HTTPS, `AUTH_URL` = the staging URL) and every `FIRM_OS_*` flag as planned for go-live.
2. Check the security headers are live (any HTML page):
   ```bash
   curl -sI https://<staging-host>/ | grep -iE "content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin-opener"
   ```
   Expect all seven (values in `src/lib/hardening/security-headers.ts`).
3. Do not point the scan at production.

## Run (unauthenticated: sign-in page, public assets, every API route's 401)

```bash
mkdir -p zap && chmod 777 zap
docker run --rm -v "$(pwd)/zap:/zap/wrk:rw" -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
    -t https://<staging-host>/ \
    -m 2 \
    -r zap-report.html -J zap-report.json -w zap-report.md \
    -I
```

`-m 2` spiders for 2 minutes; `-I` keeps warnings from failing the exit code, because the gate is
decided on risk level below, not on ZAP's default WARN/FAIL mapping.

## Run (authenticated: Firm OS pages and APIs)

Sign in to staging in a browser as a **test partner account** made for this scan, copy the
`__Secure-authjs.session-token` cookie value from the browser's developer tools, and pass it as a
header (the value is a staging-only session; end it afterwards from `/admin/team` or by expiring it):

```bash
docker run --rm -v "$(pwd)/zap:/zap/wrk:rw" -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t https://<staging-host>/agents -m 3 -I \
    -r zap-auth.html -J zap-auth.json \
    -z "-config replacer.full_list(0).description=session \
        -config replacer.full_list(0).enabled=true \
        -config replacer.full_list(0).matchtype=REQ_HEADER \
        -config replacer.full_list(0).matchstr=Cookie \
        -config replacer.full_list(0).replacement=__Secure-authjs.session-token=<SESSION_TOKEN>"
```

The baseline scan is passive: it does not click buttons or post forms, so it cannot approve, file
or change anything.

## Pass criteria

1. **No High findings** in either report:
   ```bash
   jq '[.site[].alerts[] | select(.riskcode == "3")] | length' zap/zap-report.json   # must print 0
   jq '[.site[].alerts[] | select(.riskcode == "3")] | length' zap/zap-auth.json     # must print 0
   ```
2. Every **Medium** finding is either fixed or listed below as accepted, with a reason and an owner.
3. Reports (`zap-report.html`, `zap-auth.html`) are attached to the Phase 11 QA note in PROGRESS.md.
   They contain URLs only; delete the session token from your shell history.

## Findings expected and accepted (review each run)

| ZAP rule | Risk | Why it may appear | Decision |
|---|---|---|---|
| 10055 CSP: script-src unsafe-inline / style-src unsafe-inline | Medium | The App Router bootstraps with inline scripts; React style props | Accepted until nonces are added (security-headers.ts header comment). Owner: Firm OS lead |
| 10055 CSP: wildcard directive (`https://*.sharepoint.com`) | Medium | Training video and images stream from SharePoint download URLs | Accepted: the firm's tenant host varies per drive; restrict to `srcaassociate.sharepoint.com` once confirmed |
| 10049 Storable and cacheable content | Info | Static assets | Accepted |
| 10096 Timestamp disclosure | Low/Info | IST dates in pages | Accepted |

Anything else at Medium or above: open a fix before the gate is marked green. A High finding blocks
the phase.

## After the scan

- Remove the test partner's session (`UPDATE "Session" SET "expires" = now() WHERE "userId" = '<test user id>';` on staging).
- Record in PROGRESS.md: date, staging deploy id, High = 0 (yes/no), Mediums and their decisions.
