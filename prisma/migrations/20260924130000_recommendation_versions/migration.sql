-- Frozen copies of a sheet, so a producer can see what a re-analysis or a
-- package edit actually changed.
CREATE TABLE "RecommendationVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "label" TEXT,
    "equipmentPackage" JSONB NOT NULL,
    "matchedDops" JSONB NOT NULL,
    "matchedVendors" JSONB NOT NULL,
    "budgetBreakdown" JSONB NOT NULL,
    "sceneSummary" JSONB NOT NULL,
    "estimatedBudgetLow" INTEGER NOT NULL,
    "estimatedBudgetMid" INTEGER NOT NULL,
    "estimatedBudgetHigh" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "budgetTier" "BudgetTier" NOT NULL,
    "criticPassed" BOOLEAN NOT NULL DEFAULT true,
    "criticNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rationaleText" TEXT NOT NULL DEFAULT '',
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationVersion_projectId_version_key" ON "RecommendationVersion"("projectId", "version");

-- CreateIndex
CREATE INDEX "RecommendationVersion_projectId_createdAt_idx" ON "RecommendationVersion"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "RecommendationVersion" ADD CONSTRAINT "RecommendationVersion_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
