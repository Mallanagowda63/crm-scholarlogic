"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { getUserWithAccess, type CurrentUser } from "@/lib/session";
import { reminderTime } from "@/lib/tasks";
import { taskSchema, type TaskFormValues } from "@/lib/validations/task";
import { recordAudit, type Tx } from "@/server/audit";
import { ownedBy } from "@/server/leads";
import { syncNextFollowUp } from "@/server/students";
import { taskScope } from "@/server/tasks";

export type TaskResult = { ok: true } | { ok: false; error: string; field?: keyof TaskFormValues };

const NO_ACCESS = "You don't have permission to do that.";
const NOT_FOUND = "That task no longer exists or isn't assigned to you.";
const GENERIC_ERROR = "Something went wrong. Please try again.";
const PAST_DATE = "Choose a date and time in the future";

const idSchema = z.string().min(1).max(64);

function revalidateTasks(studentIds: (string | null | undefined)[] = []) {
  revalidatePath("/tasks");
  revalidatePath("/leads");
  for (const id of studentIds) if (id) revalidatePath(`/students/${id}`);
}

async function findLinkableStudent(user: CurrentUser, id: string) {
  return db.student.findFirst({ where: { id, ...ownedBy(user) }, select: { id: true } });
}

async function resolveAssignee(user: CurrentUser, requested: string) {
  if (user.role === "COUNSELLOR" || !requested) return user.id;
  const assignee = await db.user.findFirst({
    where: { id: requested, isActive: true, role: { in: ["ADMIN", "COUNSELLOR"] } },
    select: { id: true },
  });
  return assignee?.id ?? null;
}

async function logTaskActivity(tx: Tx, studentId: string | null, actorId: string, body: string, taskId: string) {
  if (!studentId) return;
  await tx.activity.create({
    data: { studentId, type: "FOLLOW_UP", body, metadata: { taskId }, actorId },
  });
}

export async function createTask(input: unknown): Promise<TaskResult> {
  const user = await getUserWithAccess("tasks");
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { reminderMinutes, assigneeId, studentId, ...values } = parsed.data;

  const dueAt = new Date(values.dueAt);
  if (dueAt.getTime() < Date.now() - 60_000) return { ok: false, error: PAST_DATE, field: "dueAt" };

  try {
    const assignee = await resolveAssignee(user, assigneeId);
    if (!assignee) return { ok: false, error: "Choose an active team member.", field: "assigneeId" };
    if (studentId && !(await findLinkableStudent(user, studentId))) {
      return { ok: false, error: "That person no longer exists or isn't assigned to you." };
    }

    await db.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          ...values,
          dueAt,
          reminderAt: reminderTime(dueAt, Number(reminderMinutes)),
          assigneeId: assignee,
          createdById: user.id,
          studentId: studentId || null,
        },
      });
      await logTaskActivity(tx, task.studentId, user.id, `Task scheduled: ${task.title}`, task.id);
      if (task.studentId) await syncNextFollowUp(tx, task.studentId);
      await recordAudit(tx, {
        actorId: user.id,
        action: "task.created",
        entityType: "Task",
        entityId: task.id,
        after: { title: task.title, assigneeId: assignee, studentId: task.studentId },
      });
    });
    revalidateTasks([studentId]);
    return { ok: true };
  } catch (error) {
    console.error("createTask failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function getTaskForEdit(
  id: unknown,
): Promise<
  | { ok: true; values: TaskFormValues; studentName: string | null; status: "OPEN" | "DONE" | "CANCELLED" }
  | { ok: false; error: string }
> {
  const user = await getUserWithAccess("tasks");
  if (!user) return { ok: false, error: NO_ACCESS };
  const taskId = idSchema.safeParse(id);
  if (!taskId.success) return { ok: false, error: NOT_FOUND };

  const task = await db.task.findFirst({
    where: { AND: [{ id: taskId.data }, taskScope(user)] },
    include: { student: { select: { name: true } } },
  });
  if (!task) return { ok: false, error: NOT_FOUND };

  const minutes = task.reminderAt ? Math.round((task.dueAt.getTime() - task.reminderAt.getTime()) / 60_000) : 0;
  return {
    ok: true,
    status: task.status,
    studentName: task.student?.name ?? null,
    values: {
      title: task.title,
      description: task.description ?? "",
      type: task.type,
      priority: task.priority,
      dueAt: task.dueAt.toISOString(),
      reminderMinutes: minutes === 15 || minutes === 60 || minutes === 1440 ? (String(minutes) as "15" | "60" | "1440") : "0",
      assigneeId: task.assigneeId,
      studentId: task.studentId ?? "",
    },
  };
}

export async function updateTask(id: unknown, input: unknown): Promise<TaskResult> {
  const user = await getUserWithAccess("tasks");
  if (!user) return { ok: false, error: NO_ACCESS };
  const taskId = idSchema.safeParse(id);
  const parsed = taskSchema.safeParse(input);
  if (!taskId.success) return { ok: false, error: NOT_FOUND };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { reminderMinutes, assigneeId, studentId, ...values } = parsed.data;

  try {
    const task = await db.task.findFirst({ where: { AND: [{ id: taskId.data }, taskScope(user)] } });
    if (!task) return { ok: false, error: NOT_FOUND };

    // Date inputs only hold whole minutes, so seconds alone don't count as a change.
    const requestedDue = new Date(values.dueAt);
    const dueChanged = Math.floor(requestedDue.getTime() / 60_000) !== Math.floor(task.dueAt.getTime() / 60_000);
    const dueAt = dueChanged ? requestedDue : task.dueAt;
    // An overdue task can keep its date while other details are edited.
    if (dueChanged && dueAt.getTime() < Date.now() - 60_000) return { ok: false, error: PAST_DATE, field: "dueAt" };

    const assignee = await resolveAssignee(user, assigneeId);
    if (!assignee) return { ok: false, error: "Choose an active team member.", field: "assigneeId" };
    const newStudentId = studentId || null;
    if (newStudentId && newStudentId !== task.studentId && !(await findLinkableStudent(user, newStudentId))) {
      return { ok: false, error: "That person no longer exists or isn't assigned to you." };
    }

    const reminderAt = reminderTime(dueAt, Number(reminderMinutes));
    const reminderChanged = reminderAt?.getTime() !== task.reminderAt?.getTime();

    await db.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: {
          ...values,
          dueAt,
          reminderAt,
          // A changed time deserves a fresh reminder.
          ...(reminderChanged && { reminderSentAt: null }),
          assigneeId: user.role === "COUNSELLOR" ? task.assigneeId : assignee,
          studentId: newStudentId,
        },
      });
      if (task.studentId) await syncNextFollowUp(tx, task.studentId);
      if (newStudentId && newStudentId !== task.studentId) await syncNextFollowUp(tx, newStudentId);
      await recordAudit(tx, {
        actorId: user.id,
        action: "task.updated",
        entityType: "Task",
        entityId: task.id,
        before: { title: task.title, dueAt: task.dueAt.toISOString(), assigneeId: task.assigneeId },
        after: { title: values.title, dueAt: dueAt.toISOString(), assigneeId: assignee },
      });
    });
    revalidateTasks([task.studentId, newStudentId]);
    return { ok: true };
  } catch (error) {
    console.error("updateTask failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

const STATUS_WORDS = { OPEN: "reopened", DONE: "completed", CANCELLED: "cancelled" } as const;

export async function setTaskStatus(id: unknown, status: unknown): Promise<TaskResult> {
  const user = await getUserWithAccess("tasks");
  if (!user) return { ok: false, error: NO_ACCESS };
  const taskId = idSchema.safeParse(id);
  const newStatus = z.enum(["OPEN", "DONE", "CANCELLED"]).safeParse(status);
  if (!taskId.success || !newStatus.success) return { ok: false, error: NOT_FOUND };

  try {
    const task = await db.task.findFirst({ where: { AND: [{ id: taskId.data }, taskScope(user)] } });
    if (!task) return { ok: false, error: NOT_FOUND };
    if (task.status === newStatus.data) return { ok: true };

    await db.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: { status: newStatus.data, completedAt: newStatus.data === "DONE" ? new Date() : null },
      });
      await logTaskActivity(tx, task.studentId, user.id, `Task ${STATUS_WORDS[newStatus.data]}: ${task.title}`, task.id);
      if (task.studentId) await syncNextFollowUp(tx, task.studentId);
      await recordAudit(tx, {
        actorId: user.id,
        action: `task.${STATUS_WORDS[newStatus.data]}`,
        entityType: "Task",
        entityId: task.id,
        before: { status: task.status },
        after: { status: newStatus.data },
      });
    });
    revalidateTasks([task.studentId]);
    return { ok: true };
  } catch (error) {
    console.error("setTaskStatus failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
