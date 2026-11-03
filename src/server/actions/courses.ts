"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { dateKeyStart } from "@/lib/format";
import { getUserWithAccess } from "@/lib/session";
import { batchSchema, courseSchema } from "@/lib/validations/fees";
import { recordAudit } from "@/server/audit";

export type CourseResult = { ok: true } | { ok: false; error: string };

const NO_ACCESS = "You don't have permission to do that.";
const GENERIC_ERROR = "Something went wrong. Please try again.";
const idSchema = z.string().min(1).max(64);

/** Everyone in the module can look, but only admins change courses and batches. */
async function getAdmin() {
  const user = await getUserWithAccess("courses");
  return user?.role === "ADMIN" ? user : null;
}

const isUniqueError = (error: unknown) => (error as { code?: string })?.code === "P2002";

export async function saveCourse(id: unknown, input: unknown): Promise<CourseResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { gstPercent, ...values } = parsed.data;
  const data = { ...values, gstRateBps: gstPercent };

  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const courseId = idSchema.parse(id);
        const before = await tx.course.findUniqueOrThrow({ where: { id: courseId } });
        await tx.course.update({ where: { id: courseId }, data });
        await recordAudit(tx, {
          actorId: user.id,
          action: "course.updated",
          entityType: "Course",
          entityId: courseId,
          before: { code: before.code, name: before.name, fee: before.fee, gstRateBps: before.gstRateBps },
          after: { code: data.code, name: data.name, fee: data.fee, gstRateBps: data.gstRateBps },
        });
      } else {
        const course = await tx.course.create({ data });
        await recordAudit(tx, {
          actorId: user.id,
          action: "course.created",
          entityType: "Course",
          entityId: course.id,
          after: { code: data.code, name: data.name, fee: data.fee },
        });
      }
    });
    revalidatePath("/courses");
    return { ok: true };
  } catch (error) {
    if (isUniqueError(error)) return { ok: false, error: "Another course already uses that code." };
    console.error("saveCourse failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function setCourseActive(id: unknown, isActive: unknown): Promise<CourseResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const courseId = idSchema.safeParse(id);
  if (!courseId.success || typeof isActive !== "boolean") return { ok: false, error: GENERIC_ERROR };
  try {
    await db.$transaction(async (tx) => {
      await tx.course.update({ where: { id: courseId.data }, data: { isActive } });
      await recordAudit(tx, {
        actorId: user.id,
        action: isActive ? "course.restored" : "course.archived",
        entityType: "Course",
        entityId: courseId.data,
      });
    });
    revalidatePath("/courses");
    return { ok: true };
  } catch (error) {
    console.error("setCourseActive failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function saveBatch(courseId: unknown, batchId: unknown, input: unknown): Promise<CourseResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parentId = idSchema.safeParse(courseId);
  const parsed = batchSchema.safeParse(input);
  if (!parentId.success) return { ok: false, error: GENERIC_ERROR };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { startDate, endDate, ...values } = parsed.data;
  const data = {
    ...values,
    startDate: dateKeyStart(startDate),
    endDate: endDate ? dateKeyStart(endDate) : null,
  };

  try {
    if (batchId) {
      const id = idSchema.parse(batchId);
      const filled = await db.enrollment.count({ where: { batchId: id, status: "ACTIVE" } });
      if (data.capacity < filled) {
        return { ok: false, error: `This batch already has ${filled} students, so its capacity can't go below that.` };
      }
      await db.$transaction(async (tx) => {
        await tx.batch.update({ where: { id }, data });
        await recordAudit(tx, {
          actorId: user.id,
          action: "batch.updated",
          entityType: "Batch",
          entityId: id,
          after: { name: data.name, capacity: data.capacity },
        });
      });
    } else {
      await db.$transaction(async (tx) => {
        const batch = await tx.batch.create({ data: { ...data, courseId: parentId.data } });
        await recordAudit(tx, {
          actorId: user.id,
          action: "batch.created",
          entityType: "Batch",
          entityId: batch.id,
          after: { name: data.name, capacity: data.capacity },
        });
      });
    }
    revalidatePath("/courses");
    return { ok: true };
  } catch (error) {
    if (isUniqueError(error)) return { ok: false, error: "This course already has a batch with that name." };
    console.error("saveBatch failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function setBatchActive(id: unknown, isActive: unknown): Promise<CourseResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const batchId = idSchema.safeParse(id);
  if (!batchId.success || typeof isActive !== "boolean") return { ok: false, error: GENERIC_ERROR };
  try {
    await db.$transaction(async (tx) => {
      await tx.batch.update({ where: { id: batchId.data }, data: { isActive } });
      await recordAudit(tx, {
        actorId: user.id,
        action: isActive ? "batch.restored" : "batch.archived",
        entityType: "Batch",
        entityId: batchId.data,
      });
    });
    revalidatePath("/courses");
    return { ok: true };
  } catch (error) {
    console.error("setBatchActive failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
