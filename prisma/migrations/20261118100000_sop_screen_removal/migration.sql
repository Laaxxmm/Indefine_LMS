-- SOP review H1: a screen can be removed (its picture blanked, never deleted), and a version whose
-- Word file in OneDrive was written before a screen in it was removed is flagged (graphFiledAt).
-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS). Additive only.
-- AlterTable
ALTER TABLE "SopImage" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);
ALTER TABLE "SopImage" ADD COLUMN IF NOT EXISTS "removedById" TEXT;

-- AlterTable
ALTER TABLE "SopVersion" ADD COLUMN IF NOT EXISTS "graphFiledAt" TIMESTAMP(3);
