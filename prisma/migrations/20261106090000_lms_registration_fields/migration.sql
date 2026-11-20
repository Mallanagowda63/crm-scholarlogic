-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "address" TEXT,
ADD COLUMN     "college" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "degree" TEXT,
ADD COLUMN     "degreeScore" TEXT,
ADD COLUMN     "degreeStream" TEXT,
ADD COLUMN     "joiningDate" DATE,
ADD COLUMN     "passOutYear" INTEGER,
ADD COLUMN     "preferredMode" "BatchMode",
ADD COLUMN     "tenthScore" TEXT,
ADD COLUMN     "twelfthScore" TEXT;

-- CreateIndex
CREATE INDEX "Student_passOutYear_idx" ON "Student"("passOutYear");

