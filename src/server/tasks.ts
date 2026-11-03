import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { dateKeyStart, indiaDayRange } from "@/lib/format";
import type { CurrentUser } from "@/lib/session";
import { TASK_PAGE_SIZE, type TaskFilters } from "@/lib/tasks";
import type { Tx } from "@/server/audit";

/** Counsellors work from their own tasks. Tasks of soft-deleted people drop out for everyone. */
export function taskScope(user: CurrentUser): Prisma.TaskWhereInput {
  return {
    OR: [{ studentId: null }, { student: { deletedAt: null } }],
    ...(user.role === "COUNSELLOR" && { assigneeId: user.id }),
  };
}

function filtersWhere(user: CurrentUser, filters: TaskFilters, now: Date): Prisma.TaskWhereInput {
  const { end } = indiaDayRange(now);
  const due: Prisma.TaskWhereInput =
    filters.due === "overdue"
      ? { status: "OPEN", dueAt: { lt: now } }
      : filters.due === "today"
        ? { dueAt: { gte: indiaDayRange(now).start, lt: end } }
        : filters.due === "upcoming"
          ? { dueAt: { gte: end } }
          : {};

  return {
    AND: [
      taskScope(user),
      due,
      filters.status === "ALL" ? {} : { status: filters.status },
      filters.priority ? { priority: filters.priority } : {},
      filters.assignee && user.role !== "COUNSELLOR" ? { assigneeId: filters.assignee } : {},
      filters.q
        ? {
            OR: [
              { title: { contains: filters.q, mode: "insensitive" } },
              { student: { name: { contains: filters.q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
}

const TASK_SELECT = {
  id: true,
  title: true,
  type: true,
  priority: true,
  status: true,
  dueAt: true,
  reminderAt: true,
  assignee: { select: { id: true, name: true } },
  student: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

export type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

export async function listTasks(user: CurrentUser, filters: TaskFilters, now: Date) {
  const where = filtersWhere(user, filters, now);
  const total = await db.task.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const rows = await db.task.findMany({
    where,
    select: TASK_SELECT,
    orderBy: [{ dueAt: filters.status === "DONE" ? "desc" : "asc" }, { id: "asc" }],
    skip: (page - 1) * TASK_PAGE_SIZE,
    take: TASK_PAGE_SIZE,
  });
  return { rows, total, page, pageCount };
}

export type CalendarEvent = {
  kind: "task" | "demo";
  id: string;
  title: string;
  at: Date;
  isDone: boolean;
  isHighPriority: boolean;
  personName: string | null;
  studentId: string | null;
};

const MAX_CALENDAR_EVENTS = 500;

/** Open and finished tasks, plus demo classes, between two YYYY-MM-DD dates. */
export async function getCalendarEvents(
  user: CurrentUser,
  filters: TaskFilters,
  fromKey: string,
  toKeyExclusive: string,
): Promise<CalendarEvent[]> {
  const range = { gte: dateKeyStart(fromKey), lt: dateKeyStart(toKeyExclusive) };
  const assignee = filters.assignee && user.role !== "COUNSELLOR" ? filters.assignee : null;

  const [tasks, demos] = await Promise.all([
    db.task.findMany({
      where: {
        AND: [taskScope(user), { dueAt: range, status: { not: "CANCELLED" } }, assignee ? { assigneeId: assignee } : {}],
      },
      orderBy: { dueAt: "asc" },
      take: MAX_CALENDAR_EVENTS,
      select: { id: true, title: true, dueAt: true, status: true, priority: true, student: { select: { id: true, name: true } } },
    }),
    db.demoClass.findMany({
      where: {
        scheduledAt: range,
        cancelledAt: null,
        student: { deletedAt: null },
        ...(user.role === "COUNSELLOR" ? { counsellorId: user.id } : assignee ? { counsellorId: assignee } : {}),
      },
      orderBy: { scheduledAt: "asc" },
      take: MAX_CALENDAR_EVENTS,
      select: {
        id: true,
        scheduledAt: true,
        attended: true,
        student: { select: { id: true, name: true } },
        course: { select: { name: true } },
        batch: { select: { course: { select: { name: true } } } },
      },
    }),
  ]);

  const events: CalendarEvent[] = [
    ...tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      title: task.title,
      at: task.dueAt,
      isDone: task.status === "DONE",
      isHighPriority: task.priority === "HIGH" && task.status === "OPEN",
      personName: task.student?.name ?? null,
      studentId: task.student?.id ?? null,
    })),
    ...demos.map((demo) => ({
      kind: "demo" as const,
      id: demo.id,
      title: `Demo: ${demo.student.name}`,
      at: demo.scheduledAt,
      isDone: demo.attended !== null,
      isHighPriority: false,
      personName: demo.batch?.course.name ?? demo.course?.name ?? null,
      studentId: demo.student.id,
    })),
  ];
  return events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
}

/** The people a task can be given to. */
export function getTaskAssignees() {
  return db.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "COUNSELLOR"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** When someone takes over a lead, their open tasks and upcoming demos go with it. */
export async function moveOpenWork(tx: Tx, studentId: string, fromId: string, toId: string) {
  await tx.task.updateMany({ where: { studentId, status: "OPEN", assigneeId: fromId }, data: { assigneeId: toId } });
  await tx.demoClass.updateMany({
    where: { studentId, attended: null, cancelledAt: null, counsellorId: fromId },
    data: { counsellorId: toId },
  });
}
