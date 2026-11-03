import { CalendarCheck } from "lucide-react";

import {
  AddChecklistItem,
  AdmissionActions,
  ChecklistToggle,
  CreateAdmissionButton,
  type AdmissionOptions,
} from "@/app/(app)/students/[id]/admission-forms";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatShortDate, indiaDateKey } from "@/lib/format";
import { getAdmissions, type Profile } from "@/server/students";

const STATUS_LABELS = { PENDING: "Pending", CONFIRMED: "Confirmed", CANCELLED: "Cancelled" } as const;
const MODE_LABELS = { OFFLINE: "Offline", ONLINE: "Online", HYBRID: "Hybrid" } as const;

async function getAdmissionOptions(): Promise<AdmissionOptions> {
  const courses = await db.course.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      batches: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          timing: true,
          capacity: true,
          _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
        },
      },
    },
  });
  return courses.map((course) => ({
    id: course.id,
    name: course.name,
    batches: course.batches.map((batch) => ({
      id: batch.id,
      label: `${batch.name}${batch.timing ? ` (${batch.timing})` : ""}, ${batch._count.enrollments} of ${batch.capacity} seats`,
    })),
  }));
}

export async function AdmissionTab({ profile, canEdit }: { profile: Profile; canEdit: boolean }) {
  const admissions = await getAdmissions(profile.id);
  const options = canEdit ? await getAdmissionOptions() : [];
  const hasActive = admissions.some((admission) => admission.status !== "CANCELLED");
  const today = indiaDateKey(new Date());
  const createButton = canEdit && !hasActive && (
    <CreateAdmissionButton
      studentId={profile.id}
      options={options}
      defaultCourseId={profile.courseInterestId ?? ""}
      today={today}
    />
  );

  if (admissions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CalendarCheck}
          title="No admission yet"
          description="Create an admission when this person decides to join."
          action={createButton}
          className="py-8"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {createButton && <div className="flex justify-end">{createButton}</div>}
      {admissions.map((admission) => {
        const required = admission.checklistItems.filter((item) => item.isRequired);
        const done = required.filter((item) => item.completedAt).length;
        const isActive = admission.status !== "CANCELLED";
        const courseOptions = options.find((course) => course.id === admission.courseId);
        return (
          <div key={admission.id} className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border bg-card p-5 shadow-xs">
              <h2 className="mb-3 text-sm font-semibold">{admission.course.name}</h2>
              <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[9rem_1fr]">
                {(
                  [
                    ["Status", STATUS_LABELS[admission.status]],
                    ["Admission date", formatShortDate(admission.admissionDate)],
                    [
                      "Batch",
                      admission.batch ? `${admission.batch.name} (${MODE_LABELS[admission.batch.mode]})` : "Not chosen yet",
                    ],
                    ["Timing", admission.batch?.timing ?? "—"],
                    ["Branch", admission.batch?.branch?.name ?? "—"],
                    ["Fee plan", admission.feePlan ? "Set up. See the Payments tab." : "Not set up yet"],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mb-1 sm:mb-0">{value}</dd>
                  </div>
                ))}
              </dl>
              {canEdit && isActive && (
                <AdmissionActions
                  admissionId={admission.id}
                  status={admission.status}
                  batchId={admission.batchId ?? ""}
                  batches={courseOptions?.batches ?? []}
                  isEnrolled={profile.stage.type === "WON"}
                  hasFeePlan={Boolean(admission.feePlanId)}
                />
              )}
            </section>
            <section className="rounded-xl border bg-card p-5 shadow-xs">
              <h2 className="mb-3 text-sm font-semibold">
                Documents checklist ({done} of {required.length} required)
              </h2>
              <ul className="space-y-1.5">
                {admission.checklistItems.map((item) => (
                  <li key={item.id}>
                    <ChecklistToggle
                      itemId={item.id}
                      name={item.name}
                      isDone={Boolean(item.completedAt)}
                      isRequired={item.isRequired}
                      canEdit={canEdit && isActive}
                    />
                  </li>
                ))}
              </ul>
              {canEdit && isActive && <AddChecklistItem admissionId={admission.id} />}
            </section>
          </div>
        );
      })}
    </div>
  );
}
