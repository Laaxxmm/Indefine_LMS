-- Turia -> Firm OS read-only task pull (ADR-003 amendment, owner decision 06 Nov 2026).
-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS). Additive only: new nullable / defaulted columns and new tables.

-- AlterTable
ALTER TABLE "JobTask" ADD COLUMN IF NOT EXISTS "agentless" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobTask" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "JobTask" ADD COLUMN IF NOT EXISTS "turiaMissingAt" TIMESTAMP(3);
ALTER TABLE "JobTask" ADD COLUMN IF NOT EXISTS "turiaNote" TEXT;
ALTER TABLE "JobTask" ADD COLUMN IF NOT EXISTS "turiaTaskId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TuriaTaskMirror" (
    "id" TEXT NOT NULL,
    "identity" TEXT,
    "taskName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "clientCode" TEXT,
    "department" TEXT,
    "status" TEXT,
    "statusName" TEXT,
    "dueOn" TIMESTAMP(3),
    "completedOn" TIMESTAMP(3),
    "turiaCreatedOn" TIMESTAMP(3),
    "assignees" JSONB NOT NULL,
    "reviewers" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "appliedHash" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastChangedAt" TIMESTAMP(3) NOT NULL,
    "missingSince" TIMESTAMP(3),
    "closeCheckedAt" TIMESTAMP(3),
    "jobTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TuriaTaskMirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TuriaPersonLink" (
    "turiaUserId" TEXT NOT NULL,
    "turiaName" TEXT NOT NULL,
    "turiaEmail" TEXT,
    "userId" TEXT,
    "matchedBy" TEXT NOT NULL,
    "updatedById" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TuriaPersonLink_pkey" PRIMARY KEY ("turiaUserId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TuriaClientLink" (
    "key" TEXT NOT NULL,
    "turiaName" TEXT NOT NULL,
    "turiaCode" TEXT,
    "lmsClientId" TEXT,
    "firmClientId" TEXT,
    "status" TEXT NOT NULL,
    "updatedById" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TuriaClientLink_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TuriaTaskRule" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "department" TEXT,
    "namePattern" TEXT NOT NULL,
    "service" "FirmService" NOT NULL,
    "title" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "useAgent" BOOLEAN NOT NULL DEFAULT true,
    "calendarRuleId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TuriaTaskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TuriaPullRun" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedById" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "counts" JSONB,
    "preview" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TuriaPullRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TuriaPullLock" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "holder" TEXT,
    "lockUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TuriaPullLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TuriaTaskMirror_jobTaskId_key" ON "TuriaTaskMirror"("jobTaskId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuriaTaskMirror_clientKey_idx" ON "TuriaTaskMirror"("clientKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuriaTaskMirror_lastSeenAt_idx" ON "TuriaTaskMirror"("lastSeenAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuriaPersonLink_userId_idx" ON "TuriaPersonLink"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuriaClientLink_lmsClientId_idx" ON "TuriaClientLink"("lmsClientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuriaTaskRule_position_idx" ON "TuriaTaskRule"("position");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuriaPullRun_startedAt_idx" ON "TuriaPullRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobTask_turiaTaskId_key" ON "JobTask"("turiaTaskId");
