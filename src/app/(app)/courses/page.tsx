import { BookOpen, Users } from "lucide-react";
import type { Metadata } from "next";

import {
  ArchiveToggle,
  BatchButton,
  CourseButton,
  type BatchInitial,
  type CourseInitial,
} from "@/app/(app)/courses/course-forms";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { formatRupees, formatShortDate, indiaDateKey } from "@/lib/format";
import { requireModuleAccess } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getBranches, getCoursesWithSeats } from "@/server/fees";

export const metadata: Metadata = { title: "Courses" };

const MODE_LABELS = { OFFLINE: "Offline", ONLINE: "Online", HYBRID: "Hybrid" } as const;

export default async function CoursesPage() {
  const user = await requireModuleAccess("courses");
  const canManage = user.role === "ADMIN";
  const [courses, branches] = await Promise.all([getCoursesWithSeats(), canManage ? getBranches() : []]);

  return (
    <>
      <PageHeader
        title="Courses"
        description="Courses, fees, batches and seat availability."
        actions={canManage && <CourseButton />}
      />

      {courses.length === 0 ? (
        <Card>
          <EmptyState icon={BookOpen} title="No courses yet" description="Add your first course to start taking admissions." />
        </Card>
      ) : (
        <div className="space-y-4">
          {courses.map((course) => {
            const initial: CourseInitial = {
              id: course.id,
              code: course.code,
              name: course.name,
              description: course.description ?? "",
              fee: String(course.fee / 100),
              durationMonths: String(course.durationMonths),
              gstPercent: String(course.gstRateBps / 100),
            };
            const seats = course.batches
              .filter((batch) => batch.isActive)
              .reduce(
                (total, batch) => ({
                  filled: total.filled + batch._count.enrollments,
                  capacity: total.capacity + batch.capacity,
                }),
                { filled: 0, capacity: 0 },
              );
            return (
              <section
                key={course.id}
                aria-label={course.name}
                className={cn("rounded-xl border bg-card p-5 shadow-xs", !course.isActive && "opacity-60")}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold tracking-tight">
                      {course.name}
                      {!course.isActive && <span className="ml-2 text-xs font-normal text-muted-foreground">Archived</span>}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {course.code} · {formatRupees(course.fee)} + {course.gstRateBps / 100}% GST · {course.durationMonths}{" "}
                      {course.durationMonths === 1 ? "month" : "months"} · {seats.filled} of {seats.capacity} seats filled
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                      <BatchButton courseId={course.id} courseName={course.name} branches={branches} />
                      <CourseButton initial={initial} />
                      <ArchiveToggle kind="course" id={course.id} name={course.name} isActive={course.isActive} />
                    </div>
                  )}
                </div>

                {course.batches.length > 0 && (
                  <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {course.batches.map((batch) => {
                      const filled = batch._count.enrollments;
                      const percent = Math.min(100, Math.round((filled / batch.capacity) * 100));
                      const batchInitial: BatchInitial = {
                        id: batch.id,
                        name: batch.name,
                        timing: batch.timing ?? "",
                        mode: batch.mode,
                        branchId: batch.branchId ?? "",
                        startDate: indiaDateKey(batch.startDate),
                        endDate: batch.endDate ? indiaDateKey(batch.endDate) : "",
                        capacity: String(batch.capacity),
                      };
                      return (
                        <li
                          key={batch.id}
                          data-batch={batch.name}
                          className={cn("rounded-lg border p-3 text-sm", !batch.isActive && "opacity-60")}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{batch.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {[batch.timing, MODE_LABELS[batch.mode], batch.branch?.name].filter(Boolean).join(" · ")}
                              </p>
                              <p className="text-xs text-muted-foreground">Starts {formatShortDate(batch.startDate)}</p>
                            </div>
                            {canManage && (
                              <div className="flex shrink-0 items-center">
                                <BatchButton
                                  courseId={course.id}
                                  courseName={course.name}
                                  branches={branches}
                                  initial={batchInitial}
                                />
                                <ArchiveToggle kind="batch" id={batch.id} name={batch.name} isActive={batch.isActive} compact />
                              </div>
                            )}
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Users className="size-3.5" aria-hidden />
                            <span>
                              {filled} of {batch.capacity} seats
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`${batch.name} seats filled`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percent}
                            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className={cn("h-full rounded-full bg-primary", percent >= 100 && "bg-destructive")}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
