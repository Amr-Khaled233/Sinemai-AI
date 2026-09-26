-- A run can pause after the breakdown to ask the producer what the brief and
-- the script leave open, then carry on with the answers.
ALTER TYPE "AnalysisStage" ADD VALUE 'CLARIFY' AFTER 'SCENES';
ALTER TYPE "AnalysisStage" ADD VALUE 'AWAITING_INPUT' AFTER 'CLARIFY';

ALTER TABLE "AnalysisState" ADD COLUMN "questions" JSONB,
ADD COLUMN "answers" JSONB;
