import { db } from "@/lib/db";
import { summarisePlan } from "@/lib/fees";
import { indiaDateKey, dateKeyStart } from "@/lib/format";
import type { CurrentUser } from "@/lib/session";
import { ownedBy } from "@/server/leads";

/** Every live fee plan with its position worked out. Used by the Fees page and dashboards. */
export async function getPlanSummaries(now: Date) {
  const plans = await db.feePlan.findMany({
    where: { cancelledAt: null, student: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      totalAmount: true,
      discountAmount: true,
      gstRateBps: true,
      createdAt: true,
      student: { select: { id: true, name: true, phone: true } },
      course: { select: { id: true, name: true } },
      instalments: {
        where: { cancelledAt: null },
        orderBy: { sequence: "asc" },
        select: { id: true, sequence: true, amount: true, dueDate: true },
      },
      payments: { where: { deletedAt: null }, select: { amount: true, paidAt: true } },
    },
  });
  return plans.map((plan) => ({ ...plan, summary: summarisePlan(plan, now) }));
}

export type PlanWithSummary = Awaited<ReturnType<typeof getPlanSummaries>>[number];

export function startOfIndiaMonth(now: Date) {
  return dateKeyStart(`${indiaDateKey(now).slice(0, 7)}-01`);
}

export function getAwaitingFeePlan() {
  return db.admission.findMany({
    where: { feePlanId: null, status: { not: "CANCELLED" }, student: { deletedAt: null } },
    orderBy: { admissionDate: "desc" },
    take: 100,
    select: {
      id: true,
      admissionDate: true,
      student: { select: { id: true, name: true } },
      course: { select: { name: true, fee: true } },
    },
  });
}

export function getRecentPayments(skip: number, take: number) {
  return Promise.all([
    db.payment.count({ where: { feePlan: { student: { deletedAt: null } } } }),
    db.payment.findMany({
      where: { feePlan: { student: { deletedAt: null } } },
      orderBy: [{ paidAt: "desc" }, { id: "asc" }],
      skip,
      take,
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        paidAt: true,
        receipt: { select: { number: true } },
        feePlan: { select: { student: { select: { id: true, name: true } }, course: { select: { name: true } } } },
      },
    }),
  ]);
}

export async function getAdmissionsList(
  user: CurrentUser,
  filters: { q: string; status: string; page: number },
  pageSize: number,
) {
  const where = {
    AND: [
      { student: { deletedAt: null, ...ownedBy(user) } },
      filters.status ? { status: filters.status as "PENDING" | "CONFIRMED" | "CANCELLED" } : {},
      filters.q ? { student: { name: { contains: filters.q, mode: "insensitive" as const } } } : {},
    ],
  };
  const total = await db.admission.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(filters.page, pageCount);
  const rows = await db.admission.findMany({
    where,
    orderBy: [{ admissionDate: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      status: true,
      admissionDate: true,
      feePlanId: true,
      student: { select: { id: true, name: true, assignedTo: { select: { name: true } } } },
      course: { select: { name: true } },
      batch: { select: { name: true } },
      checklistItems: { select: { isRequired: true, completedAt: true } },
    },
  });
  return { rows, total, page, pageCount };
}

export function getCoursesWithSeats() {
  return db.course.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      batches: {
        orderBy: [{ isActive: "desc" }, { startDate: "asc" }],
        include: {
          branch: { select: { name: true } },
          _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
        },
      },
    },
  });
}

export function getBranches() {
  return db.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
