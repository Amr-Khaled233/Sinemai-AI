-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PRODUCER', 'VENDOR', 'DOP', 'ADMIN');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('COMMERCIAL', 'SHORT_FILM', 'SERIES', 'FEATURE', 'DOCUMENTARY');

-- CreateEnum
CREATE TYPE "BudgetTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'SCRIPT_UPLOADED', 'ANALYZING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ParsedFormat" AS ENUM ('FOUNTAIN', 'FDX', 'PDF', 'TXT', 'PASTED');

-- CreateEnum
CREATE TYPE "IntExt" AS ENUM ('INTERIOR', 'EXTERIOR');

-- CreateEnum
CREATE TYPE "TimeOfDay" AS ENUM ('DAY', 'NIGHT', 'DAWN_DUSK');

-- CreateEnum
CREATE TYPE "Complexity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CameraMovement" AS ENUM ('STATIC', 'HANDHELD', 'STEADICAM_GIMBAL', 'CRANE_DOLLY', 'DRONE');

-- CreateEnum
CREATE TYPE "DayNightSuitability" AS ENUM ('DAY', 'NIGHT', 'BOTH');

-- CreateEnum
CREATE TYPE "InquiryTargetType" AS ENUM ('DOP', 'VENDOR');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('SENT', 'READ', 'REPLIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AgentName" AS ENUM ('ORCHESTRATOR', 'SCRIPT_ANALYST', 'EQUIPMENT', 'DOP_MATCH', 'VENDOR_BUDGET', 'CRITIC');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'OK', 'RETRIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisStage" AS ENUM ('PARSE', 'SCENES', 'EQUIPMENT', 'DOPS', 'VENDOR_BUDGET', 'CRITIC', 'RETRY', 'ASSEMBLE', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "Role" NOT NULL DEFAULT 'PRODUCER',
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "crNumber" TEXT,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'SA',
    "addressLine" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dop" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayNameAr" TEXT,
    "bio" TEXT NOT NULL DEFAULT '',
    "bioAr" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'SA',
    "dayRate" INTEGER,
    "yearsExperience" INTEGER,
    "portfolioLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "styleTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reelThumbUrl" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "embedding" vector(1536),
    "embeddingText" TEXT,
    "embeddedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EquipmentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "nameAr" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "summaryEn" TEXT NOT NULL DEFAULT '',
    "summaryAr" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "suitableLightingComplexity" "Complexity"[] DEFAULT ARRAY[]::"Complexity"[],
    "suitableMovementTypes" "CameraMovement"[] DEFAULT ARRAY[]::"CameraMovement"[],
    "budgetTier" "BudgetTier"[] DEFAULT ARRAY[]::"BudgetTier"[],
    "dayNightSuitability" "DayNightSuitability" NOT NULL DEFAULT 'BOTH',
    "specialCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "indicativeDayRate" INTEGER,
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorInventoryItem" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "dailyRate" INTEGER NOT NULL,
    "weeklyRate" INTEGER,
    "monthlyRate" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "quantityTotal" INTEGER NOT NULL DEFAULT 1,
    "quantityAvailable" INTEGER NOT NULL DEFAULT 1,
    "city" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityBlock" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL,
    "budgetTier" "BudgetTier" NOT NULL,
    "visualStyleTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "city" TEXT NOT NULL DEFAULT 'Riyadh',
    "shootStartDate" DATE,
    "shootEndDate" DATE,
    "synopsis" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "parsedFormat" "ParsedFormat" NOT NULL,
    "rawText" TEXT NOT NULL,
    "pageCount" INTEGER,
    "sceneCount" INTEGER NOT NULL DEFAULT 0,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "slug" TEXT,
    "bodyExcerpt" TEXT NOT NULL,
    "intExt" "IntExt",
    "timeOfDay" "TimeOfDay",
    "lightingComplexity" "Complexity",
    "lightingNotes" TEXT,
    "cameraMovement" "CameraMovement",
    "specialRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedHours" DOUBLE PRECISION,
    "pageEighths" INTEGER,
    "analyzedAt" TIMESTAMP(3),

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRecommendation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recommendedEquipmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "equipmentPackage" JSONB NOT NULL DEFAULT '[]',
    "equipmentRationale" TEXT NOT NULL DEFAULT '',
    "matchedDops" JSONB NOT NULL DEFAULT '[]',
    "matchedVendors" JSONB NOT NULL DEFAULT '[]',
    "estimatedBudgetLow" INTEGER NOT NULL DEFAULT 0,
    "estimatedBudgetMid" INTEGER NOT NULL DEFAULT 0,
    "estimatedBudgetHigh" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "budgetBreakdown" JSONB NOT NULL DEFAULT '{}',
    "rationaleText" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "criticNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criticPassed" BOOLEAN NOT NULL DEFAULT true,
    "sceneSummary" JSONB NOT NULL DEFAULT '{}',
    "modelVersions" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "fromUserId" TEXT NOT NULL,
    "targetType" "InquiryTargetType" NOT NULL,
    "dopId" TEXT,
    "vendorId" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "status" "InquiryStatus" NOT NULL DEFAULT 'SENT',
    "readAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryMessage" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InquiryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agent" "AgentName" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT,
    "systemPrompt" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "criticFlag" TEXT,
    "errorText" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "errorText" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StyleTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewRate" (
    "id" TEXT NOT NULL,
    "roleSlug" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "budgetTier" "BudgetTier" NOT NULL,
    "dayRate" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CrewRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetTierConfig" (
    "tier" "BudgetTier" NOT NULL,
    "minTotal" INTEGER NOT NULL,
    "maxTotal" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetTierConfig_pkey" PRIMARY KEY ("tier")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AnalysisState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" "AnalysisStage" NOT NULL DEFAULT 'PARSE',
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "sceneCursor" INTEGER NOT NULL DEFAULT 0,
    "sceneTotal" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "equipment" JSONB,
    "dops" JSONB,
    "vendorBudget" JSONB,
    "critic" JSONB,
    "retriedAgents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criticRound" INTEGER NOT NULL DEFAULT 0,
    "errorText" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Company_crNumber_key" ON "Company"("crNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_userId_key" ON "Vendor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_companyId_key" ON "Vendor"("companyId");

-- CreateIndex
CREATE INDEX "Vendor_status_idx" ON "Vendor"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Dop_userId_key" ON "Dop"("userId");

-- CreateIndex
CREATE INDEX "Dop_status_idx" ON "Dop"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentCategory_slug_key" ON "EquipmentCategory"("slug");

-- CreateIndex
CREATE INDEX "Equipment_categoryId_idx" ON "Equipment"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_brand_model_key" ON "Equipment"("brand", "model");

-- CreateIndex
CREATE INDEX "VendorInventoryItem_equipmentId_idx" ON "VendorInventoryItem"("equipmentId");

-- CreateIndex
CREATE INDEX "VendorInventoryItem_city_idx" ON "VendorInventoryItem"("city");

-- CreateIndex
CREATE UNIQUE INDEX "VendorInventoryItem_vendorId_equipmentId_key" ON "VendorInventoryItem"("vendorId", "equipmentId");

-- CreateIndex
CREATE INDEX "AvailabilityBlock_itemId_startDate_endDate_idx" ON "AvailabilityBlock"("itemId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Script_projectId_key" ON "Script"("projectId");

-- CreateIndex
CREATE INDEX "Scene_scriptId_idx" ON "Scene"("scriptId");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_scriptId_order_key" ON "Scene"("scriptId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRecommendation_projectId_key" ON "ProjectRecommendation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_projectId_idx" ON "ShareLink"("projectId");

-- CreateIndex
CREATE INDEX "Inquiry_dopId_idx" ON "Inquiry"("dopId");

-- CreateIndex
CREATE INDEX "Inquiry_vendorId_idx" ON "Inquiry"("vendorId");

-- CreateIndex
CREATE INDEX "Inquiry_fromUserId_lastMessageAt_idx" ON "Inquiry"("fromUserId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "InquiryMessage_inquiryId_createdAt_idx" ON "InquiryMessage"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_projectId_agent_idx" ON "AgentRun"("projectId", "agent");

-- CreateIndex
CREATE INDEX "AgentToolCall_runId_idx" ON "AgentToolCall"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "StyleTag_slug_key" ON "StyleTag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CrewRate_roleSlug_budgetTier_key" ON "CrewRate"("roleSlug", "budgetTier");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisState_projectId_key" ON "AnalysisState"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "RateLimit_windowEnd_idx" ON "RateLimit"("windowEnd");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dop" ADD CONSTRAINT "Dop_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EquipmentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInventoryItem" ADD CONSTRAINT "VendorInventoryItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInventoryItem" ADD CONSTRAINT "VendorInventoryItem_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "AvailabilityBlock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "VendorInventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRecommendation" ADD CONSTRAINT "ProjectRecommendation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_dopId_fkey" FOREIGN KEY ("dopId") REFERENCES "Dop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryMessage" ADD CONSTRAINT "InquiryMessage_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryMessage" ADD CONSTRAINT "InquiryMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisState" ADD CONSTRAINT "AnalysisState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex
-- pgvector's HNSW index tops out at 2000 dimensions, which is why DOP
-- embeddings are generated at 1536 (text-embedding-3-large, shortened).
CREATE INDEX IF NOT EXISTS "dop_embedding_hnsw"
  ON "Dop" USING hnsw (embedding vector_cosine_ops);
