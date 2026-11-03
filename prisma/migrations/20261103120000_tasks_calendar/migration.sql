-- AlterTable
ALTER TABLE "DemoClass" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");

