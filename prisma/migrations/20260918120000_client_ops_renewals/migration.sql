-- Client ops: hosting/domain renewals and billing reminders.
-- Separate from the CA-firm `Client` table on purpose: different people, different billing.

-- CreateEnum
CREATE TYPE "SubscriptionKind" AS ENUM ('DOMAIN', 'HOSTING', 'VERCEL', 'RAILWAY', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "OpsClient" (
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
CREATE TABLE "OpsSubscription" (
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
CREATE TABLE "OpsReminder" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "OpsReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpsClient_name_key" ON "OpsClient"("name");

-- CreateIndex
CREATE INDEX "OpsClient_active_idx" ON "OpsClient"("active");

-- CreateIndex
CREATE INDEX "OpsSubscription_clientId_idx" ON "OpsSubscription"("clientId");

-- CreateIndex
CREATE INDEX "OpsSubscription_expiresOn_idx" ON "OpsSubscription"("expiresOn");

-- CreateIndex
CREATE INDEX "OpsSubscription_active_expiresOn_idx" ON "OpsSubscription"("active", "expiresOn");

-- CreateIndex
CREATE INDEX "OpsReminder_subscriptionId_idx" ON "OpsReminder"("subscriptionId");

-- CreateIndex
CREATE INDEX "OpsReminder_sentAt_idx" ON "OpsReminder"("sentAt");

-- AddForeignKey
ALTER TABLE "OpsClient" ADD CONSTRAINT "OpsClient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsSubscription" ADD CONSTRAINT "OpsSubscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OpsClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsSubscription" ADD CONSTRAINT "OpsSubscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsReminder" ADD CONSTRAINT "OpsReminder_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "OpsSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsReminder" ADD CONSTRAINT "OpsReminder_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
