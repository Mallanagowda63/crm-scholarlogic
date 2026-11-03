-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "key" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_key_key" ON "PipelineStage"("key");


-- Marks the stages the app moves people into, in databases that already exist.
UPDATE "PipelineStage" SET key = 'NEW' WHERE name = 'New';
UPDATE "PipelineStage" SET key = 'DEMO_SCHEDULED' WHERE name = 'Demo Scheduled';
UPDATE "PipelineStage" SET key = 'DEMO_ATTENDED' WHERE name = 'Demo Attended';
UPDATE "PipelineStage" SET key = 'ADMITTED' WHERE name = 'Admitted';
