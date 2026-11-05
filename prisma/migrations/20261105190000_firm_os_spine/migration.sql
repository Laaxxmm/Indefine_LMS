-- CreateEnum
CREATE TYPE "ModelProviderId" AS ENUM ('claude', 'grok', 'local');

-- CreateEnum
CREATE TYPE "ModelTier" AS ENUM ('FAST', 'SMART', 'HARD', 'LOCAL');

-- CreateEnum
CREATE TYPE "ModelCallStatus" AS ENUM ('OK', 'SCHEMA_FAIL', 'LOW_CONFIDENCE', 'PROVIDER_ERROR', 'QUEUED_FOR_HUMAN', 'BUDGET_REFUSED');

-- CreateTable
CREATE TABLE "FirmClient" (
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
CREATE TABLE "ModelCall" (
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
CREATE TABLE "AuditEvent" (
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
CREATE UNIQUE INDEX "FirmClient_lmsClientId_key" ON "FirmClient"("lmsClientId");

-- CreateIndex
CREATE UNIQUE INDEX "FirmClient_clientCode_key" ON "FirmClient"("clientCode");

-- CreateIndex
CREATE INDEX "ModelCall_runId_idx" ON "ModelCall"("runId");

-- CreateIndex
CREATE INDEX "ModelCall_createdAt_idx" ON "ModelCall"("createdAt");

-- CreateIndex
CREATE INDEX "ModelCall_agent_createdAt_idx" ON "ModelCall"("agent", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entity_entityId_idx" ON "AuditEvent"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "FirmClient" ADD CONSTRAINT "FirmClient_lmsClientId_fkey" FOREIGN KEY ("lmsClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

