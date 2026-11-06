-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS, or a DO block that ignores the duplicate). Additive only.
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FirmService" AS ENUM ('GST', 'ROC', 'IncomeTax', 'TDS', 'Books', 'Audit', 'Engagement');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JobTaskState" AS ENUM ('DRAFT', 'ASSIGNED', 'IN_PREP', 'AGENT_DONE', 'IN_REVIEW', 'APPROVED', 'FILED_BY_HUMAN', 'CLOSING', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MistakeStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TuriaSyncStatus" AS ENUM ('PENDING', 'CHECKLIST_ISSUED', 'CONFIRMED', 'CLOSED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Engagement" (
    "id" TEXT NOT NULL,
    "firmClientId" TEXT NOT NULL,
    "service" "FirmService" NOT NULL,
    "frequency" TEXT NOT NULL,
    "assigneeId" TEXT,
    "reviewerId" TEXT,
    "firstPeriod" TEXT,
    "sopPackKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SopPack" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "major" INTEGER NOT NULL,
    "minor" INTEGER NOT NULL,
    "patch" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "calendar" JSONB,
    "checklist" JSONB,
    "bufferDays" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "approvedById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobTask" (
    "id" TEXT NOT NULL,
    "firmClientId" TEXT NOT NULL,
    "engagementId" TEXT,
    "lmsJobId" TEXT,
    "service" "FirmService" NOT NULL,
    "fy" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" "JobTaskState" NOT NULL DEFAULT 'DRAFT',
    "assigneeId" TEXT,
    "reviewerId" TEXT,
    "statutoryDueOn" TIMESTAMP(3),
    "internalDueOn" TIMESTAMP(3),
    "sopPackVersion" TEXT,
    "needsPartnerReview" BOOLEAN NOT NULL DEFAULT false,
    "ackRef" TEXT,
    "filedById" TEXT,
    "filedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobTaskEvent" (
    "id" TEXT NOT NULL,
    "jobTaskId" TEXT NOT NULL,
    "fromState" "JobTaskState",
    "toState" "JobTaskState" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentRun" (
    "id" TEXT NOT NULL,
    "jobTaskId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "sopPackVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "reviewNotes" TEXT,
    "inputs" JSONB,
    "inputsPurgeAt" TIMESTAMP(3),
    "figures" JSONB,
    "needsPartnerReview" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChecklistResult" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" JSONB,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MistakeLog" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "ruleProposal" JSONB NOT NULL,
    "example" JSONB,
    "agentRunId" TEXT,
    "status" "MistakeStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "promotedToVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MistakeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Deliverable" (
    "id" TEXT NOT NULL,
    "jobTaskId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spPath" TEXT NOT NULL,
    "driveId" TEXT,
    "driveItemId" TEXT,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TuriaSync" (
    "id" TEXT NOT NULL,
    "jobTaskId" TEXT,
    "firmClientId" TEXT,
    "operation" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "TuriaSyncStatus" NOT NULL DEFAULT 'PENDING',
    "turiaRef" TEXT,
    "minutesLogged" INTEGER,
    "evidence" JSONB,
    "confirmedById" TEXT,
    "spotChecked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TuriaSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OnboardingRun" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "plan" JSONB,
    "status" TEXT NOT NULL,
    "steps" JSONB,
    "error" TEXT,
    "firmClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommsDraft" (
    "id" TEXT NOT NULL,
    "firmClientId" TEXT NOT NULL,
    "jobTaskId" TEXT,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "outlookDraftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommsDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoachEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "jobTaskId" TEXT,
    "payload" JSONB,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Engagement_firmClientId_service_key" ON "Engagement"("firmClientId", "service");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SopPack_key_active_idx" ON "SopPack"("key", "active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SopPack_key_version_key" ON "SopPack"("key", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobTask_assigneeId_state_idx" ON "JobTask"("assigneeId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobTask_state_idx" ON "JobTask"("state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobTask_internalDueOn_idx" ON "JobTask"("internalDueOn");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobTask_firmClientId_service_fy_period_title_key" ON "JobTask"("firmClientId", "service", "fy", "period", "title");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobTaskEvent_jobTaskId_createdAt_idx" ON "JobTaskEvent"("jobTaskId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRun_jobTaskId_startedAt_idx" ON "AgentRun"("jobTaskId", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRun_agent_startedAt_idx" ON "AgentRun"("agent", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChecklistResult_agentRunId_idx" ON "ChecklistResult"("agentRunId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MistakeLog_agent_status_idx" ON "MistakeLog"("agent", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deliverable_jobTaskId_kind_idx" ON "Deliverable"("jobTaskId", "kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuriaSync_jobTaskId_idx" ON "TuriaSync"("jobTaskId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TuriaSync_firmClientId_idx" ON "TuriaSync"("firmClientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OnboardingRun_createdById_createdAt_idx" ON "OnboardingRun"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommsDraft_firmClientId_createdAt_idx" ON "CommsDraft"("firmClientId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CoachEvent_userId_createdAt_idx" ON "CoachEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CoachEvent_kind_createdAt_idx" ON "CoachEvent"("kind", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_firmClientId_fkey" FOREIGN KEY ("firmClientId") REFERENCES "FirmClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_firmClientId_fkey" FOREIGN KEY ("firmClientId") REFERENCES "FirmClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "JobTaskEvent" ADD CONSTRAINT "JobTaskEvent_jobTaskId_fkey" FOREIGN KEY ("jobTaskId") REFERENCES "JobTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_jobTaskId_fkey" FOREIGN KEY ("jobTaskId") REFERENCES "JobTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ChecklistResult" ADD CONSTRAINT "ChecklistResult_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_jobTaskId_fkey" FOREIGN KEY ("jobTaskId") REFERENCES "JobTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TuriaSync" ADD CONSTRAINT "TuriaSync_jobTaskId_fkey" FOREIGN KEY ("jobTaskId") REFERENCES "JobTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

