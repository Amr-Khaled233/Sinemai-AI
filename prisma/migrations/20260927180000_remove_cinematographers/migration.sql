-- Cinematographer matching is gone, and so are the vendor and DOP logins.
-- Nothing of either is kept: the table, its vector index and extension, the
-- columns sheets stored matches in, and the enum values that named them.

-- Rental companies have no logins.
ALTER TABLE "Vendor" DROP CONSTRAINT IF EXISTS "Vendor_userId_fkey";
DROP INDEX IF EXISTS "Vendor_userId_key";
ALTER TABLE "Vendor" DROP COLUMN IF EXISTS "userId";

-- Cinematographer profiles and their embeddings go first, so deleting their
-- old logins below cannot cascade into anything else.
DROP TABLE IF EXISTS "Dop" CASCADE;
DROP EXTENSION IF EXISTS "vector";

-- The vendor and cinematographer logins themselves, with anything they owned.
-- Only the admin and regular users remain.
DELETE FROM "User" WHERE "role" IN ('VENDOR', 'DOP');

ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('PRODUCER', 'ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'PRODUCER';
DROP TYPE "Role_old";

-- Matches stored on sheets, versions and half-finished runs.
ALTER TABLE "ProjectRecommendation" DROP COLUMN IF EXISTS "matchedDops";
ALTER TABLE "RecommendationVersion" DROP COLUMN IF EXISTS "matchedDops";
ALTER TABLE "AnalysisState" DROP COLUMN IF EXISTS "dops";

-- The matching agent's run log.
DELETE FROM "AgentRun" WHERE "agent" = 'DOP_MATCH';
UPDATE "AnalysisState" SET "retriedAgents" = array_remove("retriedAgents", 'DOP_MATCH');

ALTER TYPE "AgentName" RENAME TO "AgentName_old";
CREATE TYPE "AgentName" AS ENUM ('ORCHESTRATOR', 'SCRIPT_ANALYST', 'EQUIPMENT', 'VENDOR_BUDGET', 'CRITIC');
ALTER TABLE "AgentRun" ALTER COLUMN "agent" TYPE "AgentName" USING ("agent"::text::"AgentName");
DROP TYPE "AgentName_old";

-- A run paused on the old matching step carries on with pricing.
UPDATE "AnalysisState" SET "stage" = 'VENDOR_BUDGET' WHERE "stage" = 'DOPS';

ALTER TYPE "AnalysisStage" RENAME TO "AnalysisStage_old";
CREATE TYPE "AnalysisStage" AS ENUM (
  'PARSE', 'SCENES', 'CLARIFY', 'AWAITING_INPUT', 'EQUIPMENT', 'VENDOR_BUDGET',
  'CRITIC', 'RETRY', 'RESEARCH', 'ADVISE', 'ASSEMBLE', 'DONE', 'FAILED'
);
ALTER TABLE "AnalysisState" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "AnalysisState" ALTER COLUMN "stage" TYPE "AnalysisStage" USING ("stage"::text::"AnalysisStage");
ALTER TABLE "AnalysisState" ALTER COLUMN "stage" SET DEFAULT 'PARSE';
DROP TYPE "AnalysisStage_old";

-- Traces inside stored JSON: suggested cinematographers, the match query,
-- and the matching settings.
UPDATE "ProjectRecommendation" SET "advice" = "advice" - 'cinematographers'
  WHERE "advice" IS NOT NULL AND jsonb_typeof("advice") = 'object';
UPDATE "AnalysisState" SET "advice" = "advice" - 'cinematographers'
  WHERE "advice" IS NOT NULL AND jsonb_typeof("advice") = 'object';
UPDATE "ProjectRecommendation" SET "budgetBreakdown" = "budgetBreakdown" - 'dopQuery'
  WHERE jsonb_typeof("budgetBreakdown") = 'object';
UPDATE "RecommendationVersion" SET "budgetBreakdown" = "budgetBreakdown" - 'dopQuery'
  WHERE jsonb_typeof("budgetBreakdown") = 'object';
UPDATE "Setting" SET "value" = "value" - 'dopMatchMinScore' - 'dopMatchCount'
  WHERE "key" = 'platform' AND jsonb_typeof("value") = 'object';
