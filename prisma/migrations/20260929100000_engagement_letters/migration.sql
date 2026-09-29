-- Engagement letter register (Office Tools). Re-runnable, per scripts/migrate.mjs.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "EngagementLetterStatus" AS ENUM ('DRAFT', 'SIGNED', 'SENT', 'CLIENT_SIGNED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "EngagementLetter" (
    "id" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" "EngagementLetterStatus" NOT NULL DEFAULT 'DRAFT',
    "graphDriveId" TEXT,
    "signedItemId" TEXT,
    "signedWebUrl" TEXT,
    "clientSignedItemId" TEXT,
    "clientSignedWebUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EngagementLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EngagementLetterEvent" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "data" JSONB,
    "byId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngagementLetterEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EngagementLetter_clientName_fy_key" ON "EngagementLetter"("clientName", "fy");
CREATE INDEX IF NOT EXISTS "EngagementLetter_updatedAt_idx" ON "EngagementLetter"("updatedAt");
CREATE INDEX IF NOT EXISTS "EngagementLetterEvent_letterId_at_idx" ON "EngagementLetterEvent"("letterId", "at");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "EngagementLetterEvent" ADD CONSTRAINT "EngagementLetterEvent_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "EngagementLetter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
