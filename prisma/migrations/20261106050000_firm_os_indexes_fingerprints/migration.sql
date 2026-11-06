-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS, or a DO block that ignores the duplicate). Additive only.
-- AlterTable
ALTER TABLE "Deliverable" ADD COLUMN IF NOT EXISTS     "cTag" TEXT,
ADD COLUMN IF NOT EXISTS     "quickXorHash" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobTask_reviewerId_state_idx" ON "JobTask"("reviewerId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobTask_state_doneAt_idx" ON "JobTask"("state", "doneAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRun_inputsPurgeAt_idx" ON "AgentRun"("inputsPurgeAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChecklistResult_agentRunId_status_idx" ON "ChecklistResult"("agentRunId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CoachEvent_userId_kind_createdAt_idx" ON "CoachEvent"("userId", "kind", "createdAt");

