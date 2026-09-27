-- Scenes flagged for the producer's attention right after the breakdown:
-- a new analysis stage, the flags on the running analysis, and on the sheet.
ALTER TYPE "AnalysisStage" ADD VALUE 'FLAG_SCENES' AFTER 'SCENES';

ALTER TABLE "AnalysisState" ADD COLUMN "sceneFlags" JSONB;
ALTER TABLE "ProjectRecommendation" ADD COLUMN "sceneFlags" JSONB;
