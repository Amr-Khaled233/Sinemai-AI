-- Records that a producer adjusted the recommended package by hand, so the
-- sheet can say the reviewer signed off on an earlier version of it.
ALTER TABLE "ProjectRecommendation" ADD COLUMN "editedAt" TIMESTAMP(3);
