-- AlterTable (re-runnable: a boot may retry this after an interrupted first attempt)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "elevatedAt" TIMESTAMP(3);
