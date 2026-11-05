-- AlterTable
ALTER TABLE "CertificateIssue" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "EngagementLetter" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "CertificateIssue_clientId_idx" ON "CertificateIssue"("clientId");

-- CreateIndex
CREATE INDEX "EngagementLetter_clientId_idx" ON "EngagementLetter"("clientId");

