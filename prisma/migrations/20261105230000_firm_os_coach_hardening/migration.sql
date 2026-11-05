-- AlterTable
ALTER TABLE "FirmClient" ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "TuriaSync" ADD COLUMN     "spotCheckNote" TEXT,
ADD COLUMN     "spotCheckedAt" TIMESTAMP(3),
ADD COLUMN     "spotCheckedById" TEXT;

-- AlterTable
ALTER TABLE "CoachEvent" ADD COLUMN     "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "ActivityHeartbeat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "ActivityHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachPreference" (
    "userId" TEXT NOT NULL,
    "breakNudges" BOOLEAN NOT NULL DEFAULT true,
    "snoozeUntil" TIMESTAMP(3),
    "morningBoard" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ActivityHeartbeat_userId_at_idx" ON "ActivityHeartbeat"("userId", "at");

-- CreateIndex
CREATE INDEX "ActivityHeartbeat_at_idx" ON "ActivityHeartbeat"("at");

-- CreateIndex
CREATE UNIQUE INDEX "CoachEvent_dedupeKey_key" ON "CoachEvent"("dedupeKey");

