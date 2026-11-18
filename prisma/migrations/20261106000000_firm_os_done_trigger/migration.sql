-- ADR-005 database backstop (owner-approved, Phase 11). A JobTask may enter DONE only inside the
-- close-loop gate's transaction: src/lib/agents/core/state-db.ts runs
--   SELECT set_config('firm_os.close_gate', <job id>, true)
-- for the CLOSING -> DONE edge only, after the state machine accepted a valid CloseGateToken, and
-- immediately before the UPDATE. Any other UPDATE that moves a row into DONE raises check_violation.
-- The setting is transaction-local (is_local = true), so it cannot leak to another transaction.
--
-- Additive: one function and one trigger; no table, column or data change. Re-runnable (the boot
-- script may retry a half-applied migration): CREATE OR REPLACE for the function, and the trigger is
-- created only if it does not exist yet. Exercised against Postgres only (CI e2e job runs
-- `prisma migrate deploy` on postgres:16); unit tests cover the set_config hook with a fake client.

CREATE OR REPLACE FUNCTION firm_os_jobtask_done_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."state" = 'DONE' AND OLD."state" IS DISTINCT FROM NEW."state" THEN
    IF current_setting('firm_os.close_gate', true) IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'JobTask % may enter DONE only through the close-loop gate (ADR-005)', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'JobTask_done_guard' AND tgrelid = '"JobTask"'::regclass
  ) THEN
    CREATE TRIGGER "JobTask_done_guard"
      BEFORE UPDATE OF "state" ON "JobTask"
      FOR EACH ROW
      EXECUTE FUNCTION firm_os_jobtask_done_guard();
  END IF;
END
$$;
