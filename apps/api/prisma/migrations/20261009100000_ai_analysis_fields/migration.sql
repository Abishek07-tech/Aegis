ALTER TABLE "CandidateAsset" ADD COLUMN "aiAnalysisStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "CandidateAsset" ADD COLUMN "aiThreatIntent" TEXT;
ALTER TABLE "CandidateAsset" ADD COLUMN "aiRiskScore" INTEGER;
ALTER TABLE "CandidateAsset" ADD COLUMN "aiConfidence" DOUBLE PRECISION;
ALTER TABLE "CandidateAsset" ADD COLUMN "aiSummary" TEXT;
ALTER TABLE "CandidateAsset" ADD COLUMN "aiAnalyzedAt" TIMESTAMP(3);
CREATE INDEX "CandidateAsset_aiAnalysisStatus_idx" ON "CandidateAsset"("aiAnalysisStatus");
