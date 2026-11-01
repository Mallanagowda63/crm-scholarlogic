-- A demo class must be booked into a batch or, if undecided, a course.
ALTER TABLE "DemoClass" ADD CONSTRAINT "DemoClass_batch_or_course"
  CHECK ("batchId" IS NOT NULL OR "courseId" IS NOT NULL);
