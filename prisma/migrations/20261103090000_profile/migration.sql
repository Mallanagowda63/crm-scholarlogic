-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'FOLLOW_UP';

-- DropIndex
DROP INDEX "AcademicRecord_studentId_idx";

-- DropIndex
DROP INDEX "Document_studentId_idx";

-- AlterTable
ALTER TABLE "AcademicRecord" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AcademicRecord_studentId_deletedAt_idx" ON "AcademicRecord"("studentId", "deletedAt");

-- CreateIndex
CREATE INDEX "Document_studentId_deletedAt_idx" ON "Document"("studentId", "deletedAt");


-- These are student records too, so they get the same protection against deletion.
CREATE TRIGGER no_delete BEFORE DELETE ON "AcademicRecord" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
