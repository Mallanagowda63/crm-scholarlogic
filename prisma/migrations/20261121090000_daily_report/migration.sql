-- CreateTable
CREATE TABLE "DailyReportDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyReportDelivery_userId_day_key" ON "DailyReportDelivery"("userId", "day");

-- AddForeignKey
ALTER TABLE "DailyReportDelivery" ADD CONSTRAINT "DailyReportDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
