-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS, or a DO block that ignores the duplicate). Additive only.
-- CreateTable
CREATE TABLE IF NOT EXISTS "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalRef" TEXT,
    "principalLabel" TEXT NOT NULL,
    "identifierHash" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT,
    "legalHold" TEXT,
    "handledById" TEXT,
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BreachIncident" (
    "id" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "affectedCount" INTEGER,
    "boardNotifiedAt" TIMESTAMP(3),
    "principalsNotifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreachIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkspaceSetting" (
    "userId" TEXT NOT NULL,
    "modules" JSONB,
    "focusMode" BOOLEAN,
    "companionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSetting_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoleWorkspaceDefault" (
    "role" TEXT NOT NULL,
    "modules" JSONB NOT NULL,
    "focusMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleWorkspaceDefault_pkey" PRIMARY KEY ("role")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompanionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CompanionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PrivacyRequest_status_dueAt_idx" ON "PrivacyRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PrivacyRequest_principalRef_idx" ON "PrivacyRequest"("principalRef");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BreachIncident_status_detectedAt_idx" ON "BreachIncident"("status", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CompanionToken_tokenHash_key" ON "CompanionToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CompanionToken_userId_idx" ON "CompanionToken"("userId");

