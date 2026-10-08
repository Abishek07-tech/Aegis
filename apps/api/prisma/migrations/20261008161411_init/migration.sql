-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficialAsset" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficialAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateAsset" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "brandId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficialAsset_brandId_idx" ON "OfficialAsset"("brandId");

-- CreateIndex
CREATE INDEX "OfficialAsset_type_idx" ON "OfficialAsset"("type");

-- CreateIndex
CREATE INDEX "CandidateAsset_status_idx" ON "CandidateAsset"("status");

-- CreateIndex
CREATE INDEX "CandidateAsset_brandId_idx" ON "CandidateAsset"("brandId");

-- AddForeignKey
ALTER TABLE "OfficialAsset" ADD CONSTRAINT "OfficialAsset_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAsset" ADD CONSTRAINT "CandidateAsset_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
