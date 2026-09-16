-- CreateEnum
CREATE TYPE "AnalysisType" AS ENUM ('BUSINESS_SUMMARY', 'CUSTOMER_ANALYSIS', 'SALES_ANALYSIS', 'PRODUCT_ANALYSIS', 'CAMPAIGN_ANALYSIS', 'TREND_ANALYSIS');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "BusinessAnalysis" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "analysisType" "AnalysisType" NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "status" "AnalysisStatus" NOT NULL,
    "summary" TEXT,
    "resultJson" JSONB,
    "dataSnapshotJson" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessQuestion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "contextJson" JSONB,
    "status" "QuestionStatus" NOT NULL,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessAnalysis_businessId_createdAt_idx" ON "BusinessAnalysis"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessAnalysis_businessId_analysisType_idx" ON "BusinessAnalysis"("businessId", "analysisType");

-- CreateIndex
CREATE INDEX "BusinessAnalysis_businessId_status_idx" ON "BusinessAnalysis"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessAnalysis_businessId_idempotencyKey_key" ON "BusinessAnalysis"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BusinessQuestion_businessId_createdAt_idx" ON "BusinessQuestion"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessQuestion_businessId_userId_idx" ON "BusinessQuestion"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessQuestion_businessId_idempotencyKey_key" ON "BusinessQuestion"("businessId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "BusinessAnalysis" ADD CONSTRAINT "BusinessAnalysis_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAnalysis" ADD CONSTRAINT "BusinessAnalysis_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessQuestion" ADD CONSTRAINT "BusinessQuestion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessQuestion" ADD CONSTRAINT "BusinessQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
