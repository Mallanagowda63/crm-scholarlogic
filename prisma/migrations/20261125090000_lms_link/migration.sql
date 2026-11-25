-- Links to the ScholarLogic LMS records these rows are copied from (scripts/sync-lms.mjs).
ALTER TABLE "User" ADD COLUMN "lmsId" TEXT;
ALTER TABLE "Student" ADD COLUMN "lmsId" TEXT;
ALTER TABLE "Course" ADD COLUMN "lmsId" TEXT;
ALTER TABLE "Batch" ADD COLUMN "lmsId" TEXT;

CREATE UNIQUE INDEX "User_lmsId_key" ON "User"("lmsId");
CREATE UNIQUE INDEX "Student_lmsId_key" ON "Student"("lmsId");
CREATE UNIQUE INDEX "Course_lmsId_key" ON "Course"("lmsId");
CREATE UNIQUE INDEX "Batch_lmsId_key" ON "Batch"("lmsId");

-- The standard pipeline (same as the seed), for a production database that was never seeded.
INSERT INTO "PipelineStage" ("id", "name", "color", "position", "type", "key") VALUES
  ('stage_new', 'New', '#64748B', 0, 'OPEN', 'NEW'),
  ('stage_contacted', 'Contacted', '#0EA5E9', 1, 'OPEN', NULL),
  ('stage_demo_scheduled', 'Demo Scheduled', '#8B5CF6', 2, 'OPEN', 'DEMO_SCHEDULED'),
  ('stage_demo_attended', 'Demo Attended', '#6366F1', 3, 'OPEN', 'DEMO_ATTENDED'),
  ('stage_interested', 'Interested', '#F59E0B', 4, 'OPEN', NULL),
  ('stage_admitted', 'Admitted', '#14B8A6', 5, 'OPEN', 'ADMITTED'),
  ('stage_enrolled', 'Enrolled', '#22C55E', 6, 'WON', NULL),
  ('stage_lost', 'Lost', '#EF4444', 7, 'LOST', NULL)
ON CONFLICT DO NOTHING;

-- Where synced records come from
INSERT INTO "LeadSource" ("id", "name", "isActive", "key") VALUES
  ('src_lms', 'ScholarLogic LMS', true, 'lms'),
  ('src_registration_form', 'Registration form', true, 'registration_form')
ON CONFLICT DO NOTHING;
