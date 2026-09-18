-- Client ops: hosting/domain renewals and billing reminders.
-- Separate from the CA-firm `Client` table on purpose: different people, different billing.
--
-- Re-runnable, per scripts/migrate.mjs: Prisma does not wrap a migration in a transaction,
-- so a boot that dies mid-file leaves part of this applied. Every statement below is
-- guarded, which makes the retry after `migrate resolve --rolled-back` a no-op for whatever
-- already exists.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SubscriptionKind" AS ENUM ('DOMAIN', 'HOSTING', 'VERCEL', 'RAILWAY', 'EMAIL', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "OpsClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contact" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OpsSubscription" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "SubscriptionKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "expiresOn" TIMESTAMP(3) NOT NULL,
    "cycle" "BillingCycle" NOT NULL DEFAULT 'YEARLY',
    "costPaid" DOUBLE PRECISION,
    "chargeAmount" DOUBLE PRECISION NOT NULL,
    "renewalLink" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "domain" TEXT,
    "sslHost" TEXT,
    "sslExpiresOn" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "checkNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OpsReminder" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "OpsReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OpsClient_name_key" ON "OpsClient"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OpsClient_active_idx" ON "OpsClient"("active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OpsSubscription_clientId_idx" ON "OpsSubscription"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OpsSubscription_expiresOn_idx" ON "OpsSubscription"("expiresOn");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OpsSubscription_active_expiresOn_idx" ON "OpsSubscription"("active", "expiresOn");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OpsReminder_subscriptionId_idx" ON "OpsReminder"("subscriptionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OpsReminder_sentAt_idx" ON "OpsReminder"("sentAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "OpsClient" ADD CONSTRAINT "OpsClient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "OpsSubscription" ADD CONSTRAINT "OpsSubscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OpsClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "OpsSubscription" ADD CONSTRAINT "OpsSubscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "OpsReminder" ADD CONSTRAINT "OpsReminder_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "OpsSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "OpsReminder" ADD CONSTRAINT "OpsReminder_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
