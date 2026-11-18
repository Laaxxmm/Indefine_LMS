-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS, or a DO block that ignores the duplicate). Additive only.
-- AlterTable
ALTER TABLE "CertificateIssue" ADD COLUMN IF NOT EXISTS     "clientId" TEXT;

-- AlterTable
ALTER TABLE "EngagementLetter" ADD COLUMN IF NOT EXISTS     "clientId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CertificateIssue_clientId_idx" ON "CertificateIssue"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EngagementLetter_clientId_idx" ON "EngagementLetter"("clientId");

