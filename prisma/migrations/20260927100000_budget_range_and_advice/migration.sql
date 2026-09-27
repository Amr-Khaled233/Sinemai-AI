-- The producer states a budget as a range of money rather than picking a
-- tier, and the finished sheet carries the advisor's read beyond the catalog
-- (duration, risky and costly scenes, suggested people and equipment).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AnalysisStage" ADD VALUE 'RESEARCH';
ALTER TYPE "AnalysisStage" ADD VALUE 'ADVISE';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "budgetMax" INTEGER,
ADD COLUMN     "budgetMin" INTEGER;

-- AlterTable
ALTER TABLE "ProjectRecommendation" ADD COLUMN     "advice" JSONB;

-- AlterTable
ALTER TABLE "AnalysisState" ADD COLUMN     "advice" JSONB,
ADD COLUMN     "adviceNotes" JSONB;

