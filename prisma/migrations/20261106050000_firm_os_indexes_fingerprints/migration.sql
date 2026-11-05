-- AlterTable
ALTER TABLE "Deliverable" ADD COLUMN     "cTag" TEXT,
ADD COLUMN     "quickXorHash" TEXT;

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "JobTask_reviewerId_state_idx" ON "JobTask"("reviewerId", "state");

-- CreateIndex
CREATE INDEX "JobTask_state_doneAt_idx" ON "JobTask"("state", "doneAt");

-- CreateIndex
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_inputsPurgeAt_idx" ON "AgentRun"("inputsPurgeAt");

-- CreateIndex
CREATE INDEX "ChecklistResult_agentRunId_status_idx" ON "ChecklistResult"("agentRunId", "status");

-- CreateIndex
CREATE INDEX "CoachEvent_userId_kind_createdAt_idx" ON "CoachEvent"("userId", "kind", "createdAt");

