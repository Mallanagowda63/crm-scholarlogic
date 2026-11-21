-- CreateTable
CREATE TABLE "MonthlyFigure" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "admissions" INTEGER,
    "walkIns" INTEGER,
    "plannedCandidates" INTEGER,
    "instagramPosts" INTEGER,
    "instagramLeads" INTEGER,
    "metaLeads" INTEGER,
    "googleLeads" INTEGER,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyFigure_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MonthlyFigure_month_check" CHECK ("month" BETWEEN 1 AND 12)
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyFigure_year_month_key" ON "MonthlyFigure"("year", "month");

-- The admin dashboard counts these sources by key, so admins can rename them.
INSERT INTO "LeadSource" ("id", "name", "isActive", "key") VALUES
  ('src_walk_in', 'Walk-in', true, 'walk_in'),
  ('src_instagram', 'Instagram', true, 'instagram'),
  ('src_meta_ads', 'Meta Ads', true, 'meta_ads'),
  ('src_google_ads', 'Google Ads', true, 'google_ads')
ON CONFLICT ("name") DO UPDATE SET "key" = EXCLUDED."key";
