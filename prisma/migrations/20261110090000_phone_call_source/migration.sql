-- AlterTable
ALTER TABLE "LeadSource" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_key_key" ON "LeadSource"("key");

-- Quick add from call tags new leads with this source. An existing "Phone Call" source is reused.
INSERT INTO "LeadSource" ("id", "name", "isActive", "key")
VALUES ('src_phone_call', 'Phone Call', true, 'phone_call')
ON CONFLICT ("name") DO UPDATE SET "key" = 'phone_call';
