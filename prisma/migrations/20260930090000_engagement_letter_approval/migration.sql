-- Engagement letters: unsigned draft sent for client approval before signing.
-- Re-runnable, per scripts/migrate.mjs.

ALTER TYPE "EngagementLetterStatus" ADD VALUE IF NOT EXISTS 'DRAFT_UPLOADED' AFTER 'DRAFT';
ALTER TYPE "EngagementLetterStatus" ADD VALUE IF NOT EXISTS 'SENT_FOR_APPROVAL' AFTER 'DRAFT_UPLOADED';
ALTER TYPE "EngagementLetterStatus" ADD VALUE IF NOT EXISTS 'APPROVED' AFTER 'SENT_FOR_APPROVAL';

ALTER TABLE "EngagementLetter" ADD COLUMN IF NOT EXISTS "draftItemId" TEXT;
ALTER TABLE "EngagementLetter" ADD COLUMN IF NOT EXISTS "draftWebUrl" TEXT;
ALTER TABLE "EngagementLetter" ADD COLUMN IF NOT EXISTS "draftSentAt" TIMESTAMP(3);
ALTER TABLE "EngagementLetter" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
