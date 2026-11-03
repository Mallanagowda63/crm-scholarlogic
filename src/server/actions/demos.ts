"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getUserWithAccess, type CurrentUser } from "@/lib/session";
import { attendanceSchema, demoSchema } from "@/lib/validations/task";
import { recordAudit } from "@/server/audit";
import { ownedBy } from "@/server/leads";
import { advanceToStage } from "@/server/stages";

export type DemoResult = { ok: true } | { ok: false; error: string };

const NO_ACCESS = "You don't have permission to do that.";
const NOT_FOUND = "That demo class no longer exists or isn't assigned to you.";
const GENERIC_ERROR = "Something went wrong. Please try again.";
const FUTURE_ONLY = "Choose a date and time in the future";

const idSchema = z.string().min(1).max(64);

async function getEditor() {
  const user = await getUserWithAccess("students");
  return user && user.role !== "ACCOUNTS" ? user : null;
}

function revalidateDemo(studentId: string) {
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/tasks");
  revalidatePath("/leads");
}

function isFuture(date: Date) {
  return date.getTime() > Date.now() - 60_000;
}

async function resolveTarget(target: string) {
  const separator = target.indexOf(":");
  const kind = target.slice(0, separator);
  const id = target.slice(separator + 1);
  if (kind === "batch") {
    const batch = await db.batch.findFirst({
      where: { id, isActive: true },
      select: { id: true, course: { select: { name: true } } },
    });
    return batch && { data: { batchId: batch.id, courseId: null }, label: batch.course.name };
  }
  const course = await db.course.findFirst({ where: { id, isActive: true }, select: { id: true, name: true } });
  return course && { data: { batchId: null, courseId: course.id }, label: course.name };
}

export async function scheduleDemo(studentId: unknown, input: unknown): Promise<DemoResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(studentId);
  const parsed = demoSchema.safeParse(input);
  if (!id.success) return { ok: false, error: NOT_FOUND };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (!isFuture(scheduledAt)) return { ok: false, error: FUTURE_ONLY };

  try {
    const student = await db.student.findFirst({
      where: { id: id.data, ...ownedBy(user) },
      select: { id: true, assignedToId: true },
    });
    if (!student) return { ok: false, error: "That person no longer exists or isn't assigned to you." };
    const target = await resolveTarget(parsed.data.target);
    if (!target) return { ok: false, error: "That batch or course is no longer available." };

    await db.$transaction(async (tx) => {
      const demo = await tx.demoClass.create({
        data: { studentId: student.id, ...target.data, scheduledAt, counsellorId: student.assignedToId ?? user.id },
      });
      await tx.activity.create({
        data: {
          studentId: student.id,
          type: "DEMO_CLASS",
          body: `Demo class scheduled for ${target.label} on ${formatDateTime(scheduledAt)}`,
          metadata: { demoClassId: demo.id },
          actorId: user.id,
        },
      });
      await advanceToStage(tx, user, student.id, "Demo Scheduled");
      await recordAudit(tx, {
        actorId: user.id,
        action: "demo.scheduled",
        entityType: "DemoClass",
        entityId: demo.id,
        after: { studentId: student.id, scheduledAt: scheduledAt.toISOString() },
      });
    });
    revalidateDemo(student.id);
    return { ok: true };
  } catch (error) {
    console.error("scheduleDemo failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** Only a demo that's still waiting to happen can be changed, as the rest is history. */
async function findPendingDemo(user: CurrentUser, id: unknown) {
  const demoId = idSchema.safeParse(id);
  if (!demoId.success) return null;
  return db.demoClass.findFirst({
    where: {
      id: demoId.data,
      attended: null,
      cancelledAt: null,
      student: { deletedAt: null, ...ownedBy(user) },
    },
  });
}

export async function rescheduleDemo(id: unknown, scheduledAtInput: unknown): Promise<DemoResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = z.iso.datetime().safeParse(scheduledAtInput);
  if (!parsed.success) return { ok: false, error: "Choose a date and time" };
  const scheduledAt = new Date(parsed.data);
  if (!isFuture(scheduledAt)) return { ok: false, error: FUTURE_ONLY };

  try {
    const demo = await findPendingDemo(user, id);
    if (!demo) return { ok: false, error: NOT_FOUND };
    await db.$transaction(async (tx) => {
      await tx.demoClass.update({ where: { id: demo.id }, data: { scheduledAt } });
      await tx.activity.create({
        data: {
          studentId: demo.studentId,
          type: "DEMO_CLASS",
          body: `Demo class moved to ${formatDateTime(scheduledAt)}`,
          metadata: { demoClassId: demo.id },
          actorId: user.id,
        },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "demo.rescheduled",
        entityType: "DemoClass",
        entityId: demo.id,
        before: { scheduledAt: demo.scheduledAt.toISOString() },
        after: { scheduledAt: scheduledAt.toISOString() },
      });
    });
    revalidateDemo(demo.studentId);
    return { ok: true };
  } catch (error) {
    console.error("rescheduleDemo failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function cancelDemo(id: unknown): Promise<DemoResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };

  try {
    const demo = await findPendingDemo(user, id);
    if (!demo) return { ok: false, error: NOT_FOUND };
    await db.$transaction(async (tx) => {
      await tx.demoClass.update({ where: { id: demo.id }, data: { cancelledAt: new Date() } });
      await tx.activity.create({
        data: {
          studentId: demo.studentId,
          type: "DEMO_CLASS",
          body: "Demo class cancelled",
          metadata: { demoClassId: demo.id },
          actorId: user.id,
        },
      });
      await recordAudit(tx, { actorId: user.id, action: "demo.cancelled", entityType: "DemoClass", entityId: demo.id });
    });
    revalidateDemo(demo.studentId);
    return { ok: true };
  } catch (error) {
    console.error("cancelDemo failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function recordAttendance(id: unknown, input: unknown): Promise<DemoResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = attendanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  try {
    const demo = await findPendingDemo(user, id);
    if (!demo) return { ok: false, error: NOT_FOUND };
    if (demo.scheduledAt > new Date()) return { ok: false, error: "This demo class hasn't happened yet." };

    const { attended, feedback } = parsed.data;
    await db.$transaction(async (tx) => {
      await tx.demoClass.update({ where: { id: demo.id }, data: { attended, feedback } });
      await tx.activity.create({
        data: {
          studentId: demo.studentId,
          type: "DEMO_CLASS",
          body: `${attended ? "Attended demo class" : "Didn't attend demo class"}${feedback ? `. ${feedback}` : ""}`,
          metadata: { demoClassId: demo.id, attended },
          actorId: user.id,
        },
      });
      if (attended) await advanceToStage(tx, user, demo.studentId, "Demo Attended");
      await recordAudit(tx, {
        actorId: user.id,
        action: "demo.attendance_recorded",
        entityType: "DemoClass",
        entityId: demo.id,
        after: { attended },
      });
    });
    revalidateDemo(demo.studentId);
    return { ok: true };
  } catch (error) {
    console.error("recordAttendance failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
