import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";
import { ACTIVITY_PAGE_SIZE, STUDENTS_PAGE_SIZE } from "@/lib/students";
import type { Tx } from "@/server/audit";
import { ownedBy, searchWhere } from "@/server/leads";

/**
 * Who can see whose profile. Counsellors see their own people, and accounts
 * sees people who have reached admission, as they're the ones with fees.
 */
export function viewableWhere(user: CurrentUser): Prisma.StudentWhereInput {
  if (user.role === "ACCOUNTS") {
    return { OR: [{ stage: { type: "WON" } }, { admissions: { some: { deletedAt: null } } }] };
  }
  return ownedBy(user);
}

export async function getProfile(user: CurrentUser, id: string) {
  return db.student.findFirst({
    where: { AND: [{ id }, viewableWhere(user)] },
    include: {
      stage: { select: { id: true, name: true, color: true, type: true } },
      source: { select: { name: true } },
      courseInterest: { select: { name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });
}

export type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;

export async function listStudents(
  user: CurrentUser,
  filters: { q: string; course: string; page: number },
) {
  const where: Prisma.StudentWhereInput = {
    AND: [
      viewableWhere(user),
      { stage: { type: "WON" } },
      searchWhere(filters.q),
      filters.course ? { courseInterestId: filters.course } : {},
    ],
  };
  const total = await db.student.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / STUDENTS_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const rows = await db.student.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * STUDENTS_PAGE_SIZE,
    take: STUDENTS_PAGE_SIZE,
    select: {
      id: true,
      name: true,
      phone: true,
      degree: true,
      degreeStream: true,
      courseInterest: { select: { name: true } },
      assignedTo: { select: { name: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        orderBy: { enrolledAt: "desc" },
        take: 1,
        select: { enrolledAt: true, batch: { select: { name: true } } },
      },
    },
  });
  return { rows, total, page, pageCount };
}

/** Keeps the quick-filter date on the student in step with their earliest open follow-up. */
export async function syncNextFollowUp(tx: Tx, studentId: string) {
  const next = await tx.task.findFirst({
    where: { studentId, status: "OPEN" },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });
  await tx.student.update({ where: { id: studentId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
}

export async function getActivities(
  studentId: string,
  options: { types?: Prisma.ActivityWhereInput["type"]; page?: number; take?: number } = {},
) {
  const where: Prisma.ActivityWhereInput = { studentId, ...(options.types ? { type: options.types } : {}) };
  const take = options.take ?? ACTIVITY_PAGE_SIZE;
  const [total, rows] = await Promise.all([
    db.activity.count({ where }),
    db.activity.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: ((options.page ?? 1) - 1) * take,
      take,
      include: { actor: { select: { name: true } } },
    }),
  ]);
  return { rows, total, pageCount: Math.max(1, Math.ceil(total / take)) };
}

export type ActivityRow = Awaited<ReturnType<typeof getActivities>>["rows"][number];

export function getOpenFollowUps(studentId: string) {
  return db.task.findMany({
    where: { studentId, status: "OPEN" },
    orderBy: { dueAt: "asc" },
    take: 5,
    select: { id: true, title: true, dueAt: true, priority: true, assignee: { select: { name: true } } },
  });
}

export function getDemoClasses(studentId: string) {
  return db.demoClass.findMany({
    where: { studentId, cancelledAt: null },
    orderBy: { scheduledAt: "desc" },
    include: {
      course: { select: { name: true } },
      batch: { select: { name: true, timing: true, course: { select: { name: true } } } },
      counsellor: { select: { name: true } },
    },
  });
}

export async function getDemoOptions() {
  const [courses, batches] = await Promise.all([
    db.course.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.batch.findMany({
      where: { isActive: true },
      orderBy: [{ course: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, timing: true, course: { select: { name: true } } },
    }),
  ]);
  return { courses, batches };
}

export type DemoOptions = Awaited<ReturnType<typeof getDemoOptions>>;

export function getAcademicRecords(studentId: string) {
  return db.academicRecord.findMany({ where: { studentId }, orderBy: [{ year: "desc" }, { id: "asc" }] });
}

export function getDocuments(studentId: string) {
  return db.document.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });
}

export function getAdmissions(studentId: string) {
  return db.admission.findMany({
    where: { studentId },
    orderBy: { admissionDate: "desc" },
    include: {
      course: { select: { name: true } },
      batch: { select: { name: true, timing: true, mode: true, branch: { select: { name: true } } } },
      feePlan: { select: { id: true } },
      checklistItems: { orderBy: [{ isRequired: "desc" }, { name: "asc" }] },
    },
  });
}

export function getFeePlans(studentId: string) {
  return db.feePlan.findMany({
    where: { studentId, cancelledAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      course: { select: { name: true } },
      instalments: {
        where: { cancelledAt: null },
        orderBy: { sequence: "asc" },
        // Nested reads aren't filtered by the soft-delete rules, so this says so itself.
        include: {
          payments: { where: { deletedAt: null }, select: { id: true, amount: true } },
        },
      },
      // Cancelled payments are included, so their receipts stay visible on the record.
      payments: {
        orderBy: { paidAt: "desc" },
        include: { receipt: { select: { number: true } } },
      },
    },
  });
}
