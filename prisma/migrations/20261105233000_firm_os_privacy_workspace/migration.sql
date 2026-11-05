-- CreateTable
CREATE TABLE "PrivacyRequest" (
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
CREATE TABLE "BreachIncident" (
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
CREATE TABLE "WorkspaceSetting" (
    "userId" TEXT NOT NULL,
    "modules" JSONB,
    "focusMode" BOOLEAN,
    "companionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSetting_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RoleWorkspaceDefault" (
    "role" TEXT NOT NULL,
    "modules" JSONB NOT NULL,
    "focusMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleWorkspaceDefault_pkey" PRIMARY KEY ("role")
);

-- CreateTable
CREATE TABLE "CompanionToken" (
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
CREATE INDEX "PrivacyRequest_status_dueAt_idx" ON "PrivacyRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_principalRef_idx" ON "PrivacyRequest"("principalRef");

-- CreateIndex
CREATE INDEX "BreachIncident_status_detectedAt_idx" ON "BreachIncident"("status", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanionToken_tokenHash_key" ON "CompanionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CompanionToken_userId_idx" ON "CompanionToken"("userId");

