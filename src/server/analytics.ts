import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { addDaysToKey, dateKeyStart, formatKey, indiaDateKey, weekdayOfKey } from "@/lib/format";
import type { CurrentUser } from "@/lib/session";
import { ownedBy } from "@/server/leads";
import { taskScope } from "@/server/tasks";

export type DateRange = { from: string; to: string };

export function rangeWhere({ from, to }: DateRange) {
  return { gte: dateKeyStart(from), lt: dateKeyStart(addDaysToKey(to, 1)) };
}

export type ChartPoint = { label: string; value: number };

export async function getLeadKpis(user: CurrentUser, now: Date) {
  const today = indiaDateKey(now);
  const scope = ownedBy(user);
  const count = (from: string) => db.student.count({ where: { ...scope, createdAt: { gte: dateKeyStart(from) } } });
  const yearAgo = addDaysToKey(today, -365);

  const [newToday, newThisWeek, newThisMonth, recentTotal, recentEnrolled, overdueFollowUps, admissionsThisMonth] =
    await Promise.all([
      count(today),
      count(addDaysToKey(today, -weekdayOfKey(today))),
      count(`${today.slice(0, 7)}-01`),
      count(yearAgo),
      db.student.count({ where: { ...scope, createdAt: { gte: dateKeyStart(yearAgo) }, stage: { type: "WON" } } }),
      db.task.count({ where: { AND: [taskScope(user), { status: "OPEN", dueAt: { lt: now } }] } }),
      db.admission.count({
        where: {
          status: { not: "CANCELLED" },
          admissionDate: { gte: dateKeyStart(`${today.slice(0, 7)}-01`) },
          student: { deletedAt: null, ...scope },
        },
      }),
    ]);

  return {
    newToday,
    newThisWeek,
    newThisMonth,
    conversionRate: recentTotal === 0 ? 0 : (recentEnrolled / recentTotal) * 100,
    overdueFollowUps,
    admissionsThisMonth,
  };
}

/**
 * How many people ever reached each stage, as a true funnel. Moving on or being
 * lost later doesn't remove someone from the stages they already passed through.
 */
export async function getFunnel(user: CurrentUser, range?: DateRange): Promise<ChartPoint[]> {
  const stages = await db.pipelineStage.findMany({
    where: { type: { not: "LOST" } },
    orderBy: { position: "asc" },
    select: { name: true, position: true },
  });
  const owner = user.role === "COUNSELLOR" ? Prisma.sql`AND s."assignedToId" = ${user.id}` : Prisma.empty;
  const period = range
    ? Prisma.sql`AND s."createdAt" >= ${rangeWhere(range).gte} AND s."createdAt" < ${rangeWhere(range).lt}`
    : Prisma.empty;

  // Raw SQL because it reads inside the activity's JSON, so it spells out the soft-delete rule itself.
  const reached = await db.$queryRaw<{ top: number | null; people: bigint }[]>`
    SELECT top, COUNT(*) AS people FROM (
      SELECT s.id, MAX(ps.position) AS top
      FROM "Student" s
      LEFT JOIN (
        SELECT "studentId", metadata->>'to' AS stage FROM "Activity" WHERE type = 'STAGE_CHANGE'
      ) moves ON moves."studentId" = s.id
      LEFT JOIN "PipelineStage" current_stage ON current_stage.id = s."stageId"
      LEFT JOIN "PipelineStage" ps
        ON ps.type <> 'LOST' AND (ps.name = moves.stage OR ps.id = current_stage.id)
      WHERE s."deletedAt" IS NULL ${owner} ${period}
      GROUP BY s.id
    ) per_person
    GROUP BY top`;

  return stages.map(({ name, position }, index) => ({
    label: name,
    value: reached.reduce((sum, row) => {
      // Someone lost straight from the first stage has no recorded position, but did reach it.
      const top = row.top ?? stages[0].position;
      return top >= position || index === 0 ? sum + Number(row.people) : sum;
    }, 0),
  }));
}

export async function getLeadsBySource(user: CurrentUser, range: DateRange) {
  const [sources, students] = await Promise.all([
    db.leadSource.findMany({ select: { id: true, name: true } }),
    db.student.findMany({
      where: { ...ownedBy(user), createdAt: rangeWhere(range) },
      select: { sourceId: true, stage: { select: { type: true } } },
    }),
  ]);
  const rows = [...sources, { id: null, name: "Not recorded" }].map(({ id, name }) => {
    const matching = students.filter((student) => student.sourceId === id);
    const enrolled = matching.filter((student) => student.stage.type === "WON").length;
    return {
      source: name,
      leads: matching.length,
      enrolled,
      conversion: matching.length === 0 ? 0 : (enrolled / matching.length) * 100,
    };
  });
  return rows.filter((row) => row.leads > 0).sort((a, b) => b.leads - a.leads);
}

function lastMonths(now: Date, count: number) {
  const [year, month] = indiaDateKey(now).split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

function bucketByMonth(months: string[], items: { at: Date; amount: number }[]): ChartPoint[] {
  const totals = new Map(months.map((month) => [month, 0]));
  for (const { at, amount } of items) {
    const key = indiaDateKey(at).slice(0, 7);
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  return months.map((month) => ({
    label: formatKey(`${month}-01`, { month: "short", year: "2-digit" }),
    value: totals.get(month) ?? 0,
  }));
}

export async function getAdmissionsTrend(user: CurrentUser, now: Date, count = 6) {
  const months = lastMonths(now, count);
  const admissions = await db.admission.findMany({
    where: {
      status: { not: "CANCELLED" },
      admissionDate: { gte: dateKeyStart(`${months[0]}-01`) },
      student: { deletedAt: null, ...ownedBy(user) },
    },
    select: { admissionDate: true },
  });
  return bucketByMonth(months, admissions.map(({ admissionDate }) => ({ at: admissionDate, amount: 1 })));
}

export async function getCollectionsTrend(now: Date, count = 6) {
  const months = lastMonths(now, count);
  const payments = await db.payment.findMany({
    where: { paidAt: { gte: dateKeyStart(`${months[0]}-01`) }, feePlan: { student: { deletedAt: null } } },
    select: { paidAt: true, amount: true },
  });
  return bucketByMonth(months, payments.map(({ paidAt, amount }) => ({ at: paidAt, amount })));
}

export async function getCounsellorPerformance(range: DateRange, now: Date) {
  const period = rangeWhere(range);
  const counsellors = await db.user.findMany({
    where: { role: "COUNSELLOR", isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      assignedStudents: {
        where: { deletedAt: null, createdAt: period },
        select: { stage: { select: { type: true } } },
      },
      demoClasses: {
        where: { cancelledAt: null, attended: true, scheduledAt: period, student: { deletedAt: null } },
        select: { id: true },
      },
      assignedTasks: {
        where: {
          status: "OPEN",
          dueAt: { lt: now },
          OR: [{ studentId: null }, { student: { deletedAt: null } }],
        },
        select: { id: true },
      },
    },
  });
  const payments = await db.payment.findMany({
    where: { paidAt: period, feePlan: { student: { deletedAt: null } } },
    select: { amount: true, feePlan: { select: { student: { select: { assignedToId: true } } } } },
  });

  return counsellors
    .map((counsellor) => {
      const leads = counsellor.assignedStudents.length;
      const enrolled = counsellor.assignedStudents.filter((student) => student.stage.type === "WON").length;
      return {
        id: counsellor.id,
        name: counsellor.name,
        leads,
        enrolled,
        conversion: leads === 0 ? 0 : (enrolled / leads) * 100,
        demosAttended: counsellor.demoClasses.length,
        overdueFollowUps: counsellor.assignedTasks.length,
        collected: payments
          .filter((payment) => payment.feePlan.student.assignedToId === counsellor.id)
          .reduce((sum, payment) => sum + payment.amount, 0),
      };
    })
    .sort((a, b) => b.enrolled - a.enrolled || b.collected - a.collected || a.name.localeCompare(b.name));
}

export async function getRevenueByCourse(range: DateRange) {
  const payments = await db.payment.findMany({
    where: { paidAt: rangeWhere(range), feePlan: { student: { deletedAt: null } } },
    select: { amount: true, feePlan: { select: { course: { select: { name: true } } } } },
  });
  const totals = new Map<string, { collected: number; payments: number }>();
  for (const { amount, feePlan } of payments) {
    const current = totals.get(feePlan.course.name) ?? { collected: 0, payments: 0 };
    totals.set(feePlan.course.name, { collected: current.collected + amount, payments: current.payments + 1 });
  }
  return [...totals.entries()]
    .map(([course, values]) => ({ course, ...values }))
    .sort((a, b) => b.collected - a.collected);
}

export async function getTodaysFollowUps(user: CurrentUser, now: Date) {
  const endOfToday = dateKeyStart(addDaysToKey(indiaDateKey(now), 1));
  return db.task.findMany({
    where: { AND: [taskScope(user), { status: "OPEN", dueAt: { lt: endOfToday } }] },
    orderBy: { dueAt: "asc" },
    take: 8,
    select: {
      id: true,
      title: true,
      dueAt: true,
      student: { select: { id: true, name: true } },
      assignee: { select: { name: true } },
    },
  });
}

export function getRecentActivity(user: CurrentUser) {
  return db.activity.findMany({
    where: { student: { deletedAt: null, ...ownedBy(user) } },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 8,
    select: {
      id: true,
      type: true,
      body: true,
      occurredAt: true,
      actor: { select: { name: true } },
      student: { select: { id: true, name: true } },
    },
  });
}
