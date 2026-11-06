-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS, or a DO block that ignores the duplicate). Additive only.
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ModelProviderId" AS ENUM ('claude', 'grok', 'local');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ModelTier" AS ENUM ('FAST', 'SMART', 'HARD', 'LOCAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ModelCallStatus" AS ENUM ('OK', 'SCHEMA_FAIL', 'LOW_CONFIDENCE', 'PROVIDER_ERROR', 'QUEUED_FOR_HUMAN', 'BUDGET_REFUSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "FirmClient" (
    "id" TEXT NOT NULL,
    "lmsClientId" TEXT NOT NULL,
    "clientCode" TEXT NOT NULL,
    "turiaClientRef" TEXT,
    "clSiteUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirmClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ModelCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agent" TEXT,
    "task" TEXT NOT NULL,
    "provider" "ModelProviderId",
    "model" TEXT,
    "tier" "ModelTier",
    "privacy" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "anonymized" BOOLEAN NOT NULL DEFAULT false,
    "status" "ModelCallStatus" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costInr" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "promptHash" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FirmClient_lmsClientId_key" ON "FirmClient"("lmsClientId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FirmClient_clientCode_key" ON "FirmClient"("clientCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ModelCall_runId_idx" ON "ModelCall"("runId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ModelCall_createdAt_idx" ON "ModelCall"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ModelCall_agent_createdAt_idx" ON "ModelCall"("agent", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_entity_entityId_idx" ON "AuditEvent"("entity", "entityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FirmClient" ADD CONSTRAINT "FirmClient_lmsClientId_fkey" FOREIGN KEY ("lmsClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

