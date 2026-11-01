-- Checklist items belonged to the applications removed below, so they go too.

DELETE FROM "ChecklistItem";

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_batchId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_courseId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_studentId_fkey";

-- DropForeignKey
ALTER TABLE "ChecklistItem" DROP CONSTRAINT "ChecklistItem_applicationId_fkey";

-- DropIndex
DROP INDEX "ChecklistItem_applicationId_idx";

-- AlterTable
ALTER TABLE "ChecklistItem" DROP COLUMN "applicationId",
ADD COLUMN     "admissionId" TEXT NOT NULL;

-- DropTable
DROP TABLE "Application";

-- DropEnum
DROP TYPE "ApplicationStatus";

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "batchId" TEXT,
    "admissionDate" TIMESTAMP(3) NOT NULL,
    "feePlanId" TEXT,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admission_feePlanId_key" ON "Admission"("feePlanId");

-- CreateIndex
CREATE INDEX "Admission_studentId_deletedAt_idx" ON "Admission"("studentId", "deletedAt");

-- CreateIndex
CREATE INDEX "Admission_status_deletedAt_idx" ON "Admission"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Admission_courseId_idx" ON "Admission"("courseId");

-- CreateIndex
CREATE INDEX "Admission_batchId_idx" ON "Admission"("batchId");

-- CreateIndex
CREATE INDEX "Admission_admissionDate_idx" ON "Admission"("admissionDate");

-- CreateIndex
CREATE INDEX "ChecklistItem_admissionId_idx" ON "ChecklistItem"("admissionId");

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "FeePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Admissions replace applications, so they get the same protection against deletion.
CREATE TRIGGER no_delete BEFORE DELETE ON "Admission" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
