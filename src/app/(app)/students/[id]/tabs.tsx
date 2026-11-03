import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  GraduationCap,
  History,
  IndianRupee,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import {
  AcademicRecordButton,
  CompleteFollowUpButton,
  DocumentStatusSelect,
  DocumentUploadForm,
  InlineNoteForm,
  RemoveAcademicButton,
  RemoveDocumentButton,
} from "@/app/(app)/students/[id]/profile-forms";
import { ActivityTypeFilter } from "@/app/(app)/students/[id]/activity-filter";
import { DemoActions, ScheduleDemoButton } from "@/app/(app)/students/[id]/demo-forms";
import { Pager } from "@/app/(app)/students/pager";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatRupees, formatShortDate, formatTime } from "@/lib/format";
import { BOARD_LABELS } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { ACTIVITY_PAGE_SIZE, payableAmount } from "@/lib/students";
import { cn } from "@/lib/utils";
import {
  getAcademicRecords,
  getActivities,
  getAdmissions,
  getDemoClasses,
  getDemoOptions,
  getDocuments,
  getFeePlans,
  getOpenFollowUps,
  type ActivityRow,
  type Profile,
} from "@/server/students";

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Details({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[9rem_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="mb-1 min-w-0 break-words sm:mb-0">{value || <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

const ACTIVITY_STYLE: Record<ActivityRow["type"], { icon: LucideIcon; label: string }> = {
  CALL: { icon: Phone, label: "Call" },
  EMAIL: { icon: Mail, label: "Email" },
  WHATSAPP: { icon: MessageCircle, label: "WhatsApp" },
  NOTE: { icon: NotebookPen, label: "Note" },
  STAGE_CHANGE: { icon: Shuffle, label: "Stage change" },
  DEMO_CLASS: { icon: GraduationCap, label: "Demo class" },
  FOLLOW_UP: { icon: CalendarClock, label: "Follow-up" },
};

function Timeline({ activities }: { activities: ActivityRow[] }) {
  // Grouped by day, in the order they already arrive.
  const days: { day: string; items: ActivityRow[] }[] = [];
  for (const activity of activities) {
    const day = formatShortDate(activity.occurredAt);
    const current = days[days.length - 1];
    if (current?.day === day) current.items.push(activity);
    else days.push({ day, items: [activity] });
  }

  return (
    <div className="space-y-5">
      {days.map(({ day, items }) => (
        <div key={day}>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{day}</h3>
          <ol className="space-y-3">
            {items.map((activity) => {
              const { icon: Icon, label } = ACTIVITY_STYLE[activity.type];
              return (
                <li key={activity.id} className="flex gap-3" data-activity-type={activity.type}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{label}</span>
                      {activity.actor && ` · ${activity.actor.name}`} · {formatTime(activity.occurredAt)}
                    </p>
                    <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{activity.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

const PRIORITY_LABEL = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;

export async function OverviewTab({ profile, canEdit }: { profile: Profile; canEdit: boolean }) {
  // Accounts sees contact details for fee conversations, and nothing about counselling.
  const [followUps, demos, recent] = canEdit
    ? await Promise.all([
        getOpenFollowUps(profile.id),
        getDemoClasses(profile.id),
        getActivities(profile.id, { take: 5 }),
      ])
    : [[], [], null];
  const demoOptions = canEdit ? await getDemoOptions() : null;
  const now = new Date();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Contact">
        <Details
          items={[
            ["Phone", formatPhone(profile.phone)],
            ["Alternate phone", profile.alternatePhone && formatPhone(profile.alternatePhone)],
            ["Email", profile.email],
            ["City", profile.city],
            ["Parent", profile.parentName],
            ["Parent's phone", profile.parentPhone && formatPhone(profile.parentPhone)],
          ]}
        />
      </Panel>

      <Panel title="Enquiry">
        <Details
          items={[
            ["Course of interest", profile.courseInterest?.name],
            ["Target exam", profile.targetExam?.name],
            ["Current class", profile.currentClass],
            ["Source", profile.source?.name],
            ["Budget", profile.budget !== null && formatRupees(profile.budget)],
            ["Preferred intake", profile.preferredIntake],
            ["Enquired", formatShortDate(profile.createdAt)],
            ["Last contacted", profile.lastContactedAt && formatDateTime(profile.lastContactedAt)],
          ]}
        />
      </Panel>

      {canEdit && (
        <>
          <Panel title="Open follow-ups">
            {followUps.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled. Use Schedule follow-up above to add one.</p>
            ) : (
              <ul className="space-y-3">
                {followUps.map((task) => {
                  const isOverdue = task.dueAt < now;
                  return (
                    <li key={task.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{task.title}</p>
                        <p className={cn("text-xs text-muted-foreground", isOverdue && "font-medium text-destructive")}>
                          {isOverdue && "Overdue · "}
                          {formatDateTime(task.dueAt)} · {PRIORITY_LABEL[task.priority]} · {task.assignee.name}
                        </p>
                      </div>
                      <CompleteFollowUpButton taskId={task.id} title={task.title} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Demo classes" action={demoOptions && <ScheduleDemoButton studentId={profile.id} options={demoOptions} />}>
            {demos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No demo classes yet.</p>
            ) : (
              <ul className="space-y-4">
                {demos.map((demo) => (
                  <li key={demo.id} className="text-sm">
                    <p className="font-medium">
                      {demo.batch ? `${demo.batch.course.name}, ${demo.batch.name}` : demo.course?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(demo.scheduledAt)} ·{" "}
                      {demo.attended === null ? "Not yet held" : demo.attended ? "Attended" : "Didn't attend"} ·{" "}
                      {demo.counsellor.name}
                    </p>
                    {demo.feedback && <p className="mt-0.5 text-muted-foreground">{demo.feedback}</p>}
                    {demo.attended === null && (
                      <DemoActions
                        demoId={demo.id}
                        scheduledAt={demo.scheduledAt}
                        hasHappened={demo.scheduledAt <= now}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="lg:col-span-2">
            <Panel
              title="Recent activity"
              action={
                <Link
                  href={`/students/${profile.id}?tab=activity`}
                  scroll={false}
                  className="text-sm text-primary-soft-foreground hover:underline"
                >
                  View all
                </Link>
              }
            >
              {recent && recent.rows.length > 0 ? (
                <Timeline activities={recent.rows} />
              ) : (
                <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

export async function ActivityTab({
  studentId,
  page,
  type,
}: {
  studentId: string;
  page: number;
  type?: ActivityRow["type"];
}) {
  const { rows, total, pageCount } = await getActivities(studentId, { types: type, page });
  const hrefFor = (target: number) => {
    const params = new URLSearchParams({ tab: "activity" });
    if (type) params.set("type", type);
    if (target > 1) params.set("page", String(target));
    return `/students/${studentId}?${params}`;
  };

  return (
    <>
      <ActivityTypeFilter studentId={studentId} type={type} />
      <Card className="p-5">
        {rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nothing here yet"
            description={type ? "Try a different activity type." : "Calls, notes and stage changes will appear here."}
            className="py-8"
          />
        ) : (
          <Timeline activities={rows} />
        )}
      </Card>
      {total > ACTIVITY_PAGE_SIZE && (
        <Pager summary={`${total.toLocaleString("en-IN")} entries`} page={page} pageCount={pageCount} hrefFor={hrefFor} />
      )}
    </>
  );
}

export async function NotesTab({ studentId, page, canEdit }: { studentId: string; page: number; canEdit: boolean }) {
  const { rows, total, pageCount } = await getActivities(studentId, { types: "NOTE", page });
  return (
    <>
      {canEdit && <InlineNoteForm studentId={studentId} />}
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={NotebookPen}
            title="No notes yet"
            description="Anything worth remembering about this person goes here."
            className="py-8"
          />
        </Card>
      ) : (
        <Card className="p-5">
          <Timeline activities={rows} />
        </Card>
      )}
      {total > ACTIVITY_PAGE_SIZE && (
        <Pager
          summary={`${total.toLocaleString("en-IN")} notes`}
          page={page}
          pageCount={pageCount}
          hrefFor={(target) => `/students/${studentId}?tab=notes${target > 1 ? `&page=${target}` : ""}`}
        />
      )}
    </>
  );
}

export async function AcademicsTab({ profile, canEdit }: { profile: Profile; canEdit: boolean }) {
  const records = await getAcademicRecords(profile.id);
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Panel title="Current studies">
        <Details
          items={[
            ["Class", profile.currentClass],
            ["Board", profile.board && BOARD_LABELS[profile.board]],
            ["School", profile.schoolName],
            ["Target exam", profile.targetExam?.name],
          ]}
        />
      </Panel>
      <Panel title="Past results" action={canEdit && <AcademicRecordButton studentId={profile.id} />}>
        {records.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No results recorded"
            description="Add past exam results to help with counselling."
            className="py-8"
          />
        ) : (
          <ul className="divide-y">
            {records.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {record.qualification}
                    {record.score && <span className="font-normal text-muted-foreground"> · {record.score}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {record.institution} · {record.year}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center">
                    <AcademicRecordButton studentId={profile.id} record={record} />
                    <RemoveAcademicButton recordId={record.id} label={record.qualification} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export async function DocumentsTab({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const documents = await getDocuments(studentId);
  return (
    <>
      {canEdit && <DocumentUploadForm studentId={studentId} />}
      {documents.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Upload report cards, ID proofs and other documents here."
            className="py-8"
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((document) => (
                <TableRow key={document.id}>
                  <TableCell>
                    <span className="block font-medium">{document.type}</span>
                    <span className="block max-w-56 truncate text-xs text-muted-foreground">{document.fileName}</span>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {formatShortDate(document.createdAt)}
                    {document.uploadedBy && <span className="block text-xs">{document.uploadedBy.name}</span>}
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <DocumentStatusSelect documentId={document.id} status={document.status} label={document.fileName} />
                    ) : (
                      document.status
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <a
                        href={`/students/${studentId}/documents/${document.id}`}
                        aria-label={`Download ${document.fileName}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
                      >
                        <Download />
                      </a>
                      {canEdit && <RemoveDocumentButton documentId={document.id} label={document.fileName} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

const ADMISSION_STATUS = { PENDING: "Pending", CONFIRMED: "Confirmed", CANCELLED: "Cancelled" } as const;
const BATCH_MODE = { OFFLINE: "Offline", ONLINE: "Online", HYBRID: "Hybrid" } as const;

export async function AdmissionTab({ studentId }: { studentId: string }) {
  const admissions = await getAdmissions(studentId);
  if (admissions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CalendarCheck}
          title="No admission yet"
          description="The admission and its documents checklist appear here once this person joins."
          className="py-8"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {admissions.map((admission) => {
        const required = admission.checklistItems.filter((item) => item.isRequired);
        const done = required.filter((item) => item.completedAt).length;
        return (
          <div key={admission.id} className="grid gap-4 lg:grid-cols-2">
            <Panel title={admission.course.name}>
              <Details
                items={[
                  ["Status", ADMISSION_STATUS[admission.status]],
                  ["Admission date", formatShortDate(admission.admissionDate)],
                  [
                    "Batch",
                    admission.batch ? `${admission.batch.name} (${BATCH_MODE[admission.batch.mode]})` : "Not chosen yet",
                  ],
                  ["Timing", admission.batch?.timing],
                  ["Branch", admission.batch?.branch?.name],
                  ["Fee plan", admission.feePlan ? "Set up. See the Payments tab." : "Not set up yet"],
                ]}
              />
            </Panel>
            <Panel title={`Documents checklist (${done} of ${required.length} required)`}>
              <ul className="space-y-2">
                {admission.checklistItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    {item.completedAt ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="Not done" />
                    )}
                    {item.name}
                    {!item.isRequired && <span className="text-xs text-muted-foreground">Optional</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        );
      })}
      <p className="text-sm text-muted-foreground">Managing admissions and ticking off documents arrives in Phase 6.</p>
    </div>
  );
}

const METHOD_LABEL = { UPI: "UPI", CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Bank transfer" } as const;

export async function PaymentsTab({ studentId }: { studentId: string }) {
  const plans = await getFeePlans(studentId);
  const now = new Date();
  if (plans.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={IndianRupee}
          title="No fee plan yet"
          description="Instalments and payments appear here once a fee plan is set up."
          className="py-8"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {plans.map((plan) => {
        const payable = payableAmount(plan);
        const paid = plan.payments.reduce((sum, payment) => sum + payment.amount, 0);
        return (
          <div key={plan.id} className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-3" aria-label={`Fee summary for ${plan.course.name}`}>
              {(
                [
                  ["Total payable", payable, `Includes ${plan.gstRateBps / 100}% GST`],
                  ["Paid", paid, `${plan.payments.length} ${plan.payments.length === 1 ? "payment" : "payments"}`],
                  ["Balance", payable - paid, plan.discountAmount > 0 ? `After ${formatRupees(plan.discountAmount)} discount` : plan.course.name],
                ] as const
              ).map(([label, amount, note]) => (
                <div key={label} className="rounded-xl border bg-card p-4 shadow-xs">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{formatRupees(amount)}</dd>
                  <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
                </div>
              ))}
            </dl>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Instalments">
                <ul className="divide-y">
                  {plan.instalments.map((instalment) => {
                    const received = instalment.payments.reduce((sum, payment) => sum + payment.amount, 0);
                    const isPaid = received >= instalment.amount;
                    const isOverdue = !isPaid && instalment.dueDate < now;
                    return (
                      <li key={instalment.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <div>
                          <p className="font-medium">Instalment {instalment.sequence}</p>
                          <p className="text-xs text-muted-foreground">Due {formatShortDate(instalment.dueDate)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium tabular-nums">{formatRupees(instalment.amount)}</p>
                          <p
                            className={cn(
                              "text-xs text-muted-foreground",
                              isPaid && "text-emerald-700 dark:text-emerald-400",
                              isOverdue && "font-medium text-destructive",
                            )}
                          >
                            {isPaid ? "Paid" : isOverdue ? "Overdue" : "Upcoming"}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>

              <Panel title="Payments received">
                {plan.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payments yet.</p>
                ) : (
                  <ul className="divide-y">
                    {plan.payments.map((payment) => (
                      <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium">{formatShortDate(payment.paidAt)}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {METHOD_LABEL[payment.method]}
                            {payment.receipt && ` · ${payment.receipt.number}`}
                          </p>
                        </div>
                        <p className="font-medium tabular-nums">{formatRupees(payment.amount)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        );
      })}
      <p className="text-sm text-muted-foreground">Recording payments and downloading receipts arrives in Phase 6.</p>
    </div>
  );
}
