-- Re-runnable: the boot script (scripts/migrate.mjs) retries a half-applied migration, so every
-- statement is guarded (IF NOT EXISTS, or a DO block that ignores the duplicate). Additive only.
-- AlterTable
ALTER TABLE "Sop" ADD COLUMN IF NOT EXISTS "graphFolderId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SopImage" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SopImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SopImage_sopId_idx" ON "SopImage"("sopId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SopImage" ADD CONSTRAINT "SopImage_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
