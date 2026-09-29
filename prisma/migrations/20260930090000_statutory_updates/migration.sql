-- Statutory updates digest (Tools). Re-runnable, per scripts/migrate.mjs.

-- CreateTable
CREATE TABLE IF NOT EXISTS "StatutoryPost" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "section" TEXT,
    "docType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issueDate" TEXT,
    "uploadDate" TEXT,
    "postedOn" TEXT NOT NULL,
    "dateBasis" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altUrl" TEXT,
    "text" TEXT,
    "area" TEXT,
    "tag" TEXT,
    "summary" TEXT,
    "note" TEXT,
    "summarizedAt" TIMESTAMP(3),
    "summaryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StatutoryPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StatutorySource" (
    "portal" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "fetched" INTEGER NOT NULL,
    "inRange" INTEGER NOT NULL,
    "via" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StatutorySource_pkey" PRIMARY KEY ("portal")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StatutoryPost_key_key" ON "StatutoryPost"("key");
CREATE INDEX IF NOT EXISTS "StatutoryPost_postedOn_idx" ON "StatutoryPost"("postedOn");
CREATE INDEX IF NOT EXISTS "StatutoryPost_summarizedAt_idx" ON "StatutoryPost"("summarizedAt");
