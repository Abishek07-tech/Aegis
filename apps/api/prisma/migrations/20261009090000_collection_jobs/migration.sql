ALTER TABLE "CandidateAsset" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "CandidateAsset" ADD COLUMN "collectedAt" TIMESTAMP(3);
CREATE INDEX "CandidateAsset_sourceUrl_idx" ON "CandidateAsset"("sourceUrl");
CREATE UNIQUE INDEX "CandidateAsset_brandId_sourceUrl_key" ON "CandidateAsset"("brandId", "sourceUrl");

CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "scope" TEXT NOT NULL,
    "brandId" TEXT,
    "provider" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "assetsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "findings" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScanJob_status_idx" ON "ScanJob"("status");
CREATE INDEX "ScanJob_brandId_idx" ON "ScanJob"("brandId");
