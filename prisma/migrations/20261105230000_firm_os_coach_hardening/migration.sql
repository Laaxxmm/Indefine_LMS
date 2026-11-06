-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS, or a DO block that ignores the duplicate). Additive only.
-- AlterTable
ALTER TABLE "FirmClient" ADD COLUMN IF NOT EXISTS     "preferredLanguage" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "TuriaSync" ADD COLUMN IF NOT EXISTS     "spotCheckNote" TEXT,
ADD COLUMN IF NOT EXISTS     "spotCheckedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "spotCheckedById" TEXT;

-- AlterTable
ALTER TABLE "CoachEvent" ADD COLUMN IF NOT EXISTS     "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ActivityHeartbeat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "ActivityHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoachPreference" (
    "userId" TEXT NOT NULL,
    "breakNudges" BOOLEAN NOT NULL DEFAULT true,
    "snoozeUntil" TIMESTAMP(3),
    "morningBoard" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ActivityHeartbeat_userId_at_idx" ON "ActivityHeartbeat"("userId", "at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ActivityHeartbeat_at_idx" ON "ActivityHeartbeat"("at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CoachEvent_dedupeKey_key" ON "CoachEvent"("dedupeKey");

