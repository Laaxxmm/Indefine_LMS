# Runbook: backup restore drill (Railway Postgres → staging)

- **Status:** Phase 11, 2026-11-05. **Blocked — needs Railway access** (a person with the Railway
  project role that can see backups and create services). Nothing here has been run yet; the first
  drill result goes into PROGRESS.md.
- **Why:** orchestrator Phase 11 "backups verified (Railway PG snapshot restore drill to staging)". A
  backup counts only once it has been restored and checked.
- **How often:** before go-live, then quarterly, and after any schema change that adds a trigger or
  extension (the restore must carry them, e.g. `JobTask_done_guard`).
- **Data note:** the restored copy holds production personal data (class A/B). Keep it inside the
  Railway project, give access only to the people doing the drill, and remove the drill database after
  sign-off (it is a copy; production is never touched by this runbook).

## Targets

| Measure | Target |
|---|---|
| RPO (data that may be lost) | ≤ 24 h (Railway daily backups) |
| RTO (time to a working app on the restored data) | ≤ 2 h |

## A. Prepare (10 min)

1. Railway → project **Indefine LMS** → **production** environment → Postgres service → **Backups**.
   Confirm backups are enabled and note the newest backup's time (this is the RPO evidence).
2. Note production row counts to compare later (read-only, Railway → Postgres → *Query*):
   ```sql
   SELECT 'User' t, count(*) FROM "User" UNION ALL
   SELECT 'Client', count(*) FROM "Client" UNION ALL
   SELECT 'FirmClient', count(*) FROM "FirmClient" UNION ALL
   SELECT 'JobTask', count(*) FROM "JobTask" UNION ALL
   SELECT 'JobTaskEvent', count(*) FROM "JobTaskEvent" UNION ALL
   SELECT 'AgentRun', count(*) FROM "AgentRun" UNION ALL
   SELECT 'Deliverable', count(*) FROM "Deliverable" UNION ALL
   SELECT 'TuriaSync', count(*) FROM "TuriaSync" UNION ALL
   SELECT 'AuditEvent', count(*) FROM "AuditEvent" UNION ALL
   SELECT '_prisma_migrations', count(*) FROM "_prisma_migrations";
   ```
3. Start a stopwatch (RTO).

## B. Restore into a new database in the staging environment

Railway restores a volume backup into its own service, so restoring production's backup "in place"
would overwrite production. Use one of these instead:

**B1. Railway backup restore into a copy (preferred when available).**
1. In the **staging** environment, add a new Postgres service named `pg-restore-drill` (empty).
2. In production's Postgres → Backups, choose the newest backup → **Restore**, and pick the drill
   service / staging environment as the target if the UI offers it. If the UI only offers restoring
   into the same service, **stop** and use B2 — never restore over production.

**B2. Logical copy with pg_dump / pg_restore (always works).** From a trusted machine with
PostgreSQL 16 client tools and the Railway CLI (`railway login`):
```bash
# Production connection string, read from Railway (do not paste it anywhere else)
railway link            # choose the project, environment "production", service "Postgres"
export PROD_URL="$(railway variables --kv | sed -n 's/^DATABASE_PUBLIC_URL=//p')"

# Drill database: the new empty service in staging
railway link            # environment "staging", service "pg-restore-drill"
export DRILL_URL="$(railway variables --kv | sed -n 's/^DATABASE_PUBLIC_URL=//p')"

pg_dump --format=custom --no-owner --no-acl --file=prod.dump "$PROD_URL"
pg_restore --no-owner --no-acl --exit-on-error --dbname="$DRILL_URL" prod.dump
shred -u prod.dump      # the dump holds personal data; remove it from the machine
```
The dump includes functions and triggers (`firm_os_jobtask_done_guard`, `JobTask_done_guard`).

## C. Verify the data (20 min)

Against `DRILL_URL`:
1. Row counts from A.2 match (allow for rows written after the backup time).
2. Migrations all applied: `DATABASE_URL="$DRILL_URL" npx prisma migrate status` → "Database schema is up to date".
3. The DONE trigger came across:
   ```sql
   SELECT tgname FROM pg_trigger WHERE tgname = 'JobTask_done_guard';            -- 1 row
   SELECT proname FROM pg_proc WHERE proname = 'firm_os_jobtask_done_guard';     -- 1 row
   ```
4. The trigger works (the spec rolls everything back, so it leaves the copy unchanged):
   `DATABASE_URL="$DRILL_URL" npx playwright test --config playwright.db.config.ts done-trigger`
5. Spot-check five recent `JobTask` rows and their `JobTaskEvent` history against production.

## D. Verify the app (20 min)

1. Point the **staging** web service's `DATABASE_URL` at the drill database (Railway variable
   reference to `pg-restore-drill`), keep every `FIRM_OS_*` flag as it is on staging, redeploy.
2. Sign in with Microsoft as a partner; open `/dashboard`, `/clients`, `/agents`, `/agents/spot-checks`.
3. `curl -fsS -H "Authorization: Bearer $CRON_SECRET_STAGING" https://<staging-host>/api/cron/firm-os/close-loop`
   returns JSON (it is a no-op outside IST working hours).
4. Stop the stopwatch: that is the measured RTO.

## E. Record and clean up

1. Add to PROGRESS.md (Log): date, backup time used, RPO (now − backup time), RTO, counts matched
   (yes/no), trigger present (yes/no), app checks passed, who ran it.
2. Point staging's `DATABASE_URL` back to its own database and redeploy.
3. With the partner's OK, remove the `pg-restore-drill` service (a copy of production data that is
   no longer needed — DPDP minimisation). Production and its backups are not affected.

## If the drill fails

Treat a failed restore as an incident: open an item under "Blocked / needs human" with what failed,
keep the evidence, and do not change production backups until the cause is known.
