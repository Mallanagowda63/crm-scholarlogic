"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { dateKeyStart } from "@/lib/format";
import { getUserWithAccess, type CurrentUser } from "@/lib/session";
import { admissionSchema } from "@/lib/validations/fees";
import { recordAudit } from "@/server/audit";
import { ownedBy } from "@/server/leads";
import { advanceToStage, EnrolmentError, takeSeat } from "@/server/stages";

export type AdmissionResult = { ok: true } | { ok: false; error: string };

const NO_ACCESS = "You don't have permission to do that.";
const NOT_FOUND = "That admission no longer exists or isn't assigned to you.";
const GENERIC_ERROR = "Something went wrong. Please try again.";
const idSchema = z.string().min(1).max(64);

const DEFAULT_CHECKLIST = [
  { name: "Latest school report card", isRequired: true },
  { name: "Student ID proof", isRequired: true },
  { name: "Parent ID proof", isRequired: true },
  { name: "Passport-size photo", isRequired: true },
  { name: "Scholarship test result", isRequired: false },
];

async function getEditor() {
  return getUserWithAccess("admissions");
}

function revalidateAdmission(studentId: string) {
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/admissions");
  revalidatePath("/fees");
  revalidatePath("/leads");
  revalidatePath("/students");
  revalidatePath("/courses");
}

async function validBatchFor(courseId: string, batchId: string | null) {
  if (!batchId) return true;
  const batch = await db.batch.findFirst({ where: { id: batchId, courseId, isActive: true }, select: { id: true } });
  return Boolean(batch);
}

export async function createAdmission(studentId: unknown, input: unknown): Promise<AdmissionResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(studentId);
  const parsed = admissionSchema.safeParse(input);
  if (!id.success) return { ok: false, error: NOT_FOUND };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { courseId, batchId, admissionDate } = parsed.data;

  try {
    const student = await db.student.findFirst({ where: { id: id.data, ...ownedBy(user) }, select: { id: true } });
    if (!student) return { ok: false, error: "That person no longer exists or isn't assigned to you." };
    const active = await db.admission.count({ where: { studentId: student.id, status: { not: "CANCELLED" } } });
    if (active > 0) return { ok: false, error: "This person already has an admission." };
    const course = await db.course.findFirst({ where: { id: courseId, isActive: true }, select: { id: true } });
    if (!course) return { ok: false, error: "That course is no longer available." };
    if (!(await validBatchFor(courseId, batchId))) return { ok: false, error: "That batch doesn't belong to this course." };

    await db.$transaction(async (tx) => {
      const admission = await tx.admission.create({
        data: {
          studentId: student.id,
          courseId,
          batchId,
          admissionDate: dateKeyStart(admissionDate),
          checklistItems: { create: DEFAULT_CHECKLIST },
        },
      });
      await tx.activity.create({
        data: { studentId: student.id, type: "NOTE", body: "Admission created", metadata: { admissionId: admission.id }, actorId: user.id },
      });
      await advanceToStage(tx, user, student.id, "Admitted");
      await recordAudit(tx, {
        actorId: user.id,
        action: "admission.created",
        entityType: "Admission",
        entityId: admission.id,
        after: { studentId: student.id, courseId, batchId },
      });
    });
    revalidateAdmission(student.id);
    return { ok: true };
  } catch (error) {
    console.error("createAdmission failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

async function findOwnAdmission(user: CurrentUser, id: unknown) {
  const admissionId = idSchema.safeParse(id);
  if (!admissionId.success) return null;
  return db.admission.findFirst({
    where: { id: admissionId.data, student: { deletedAt: null, ...ownedBy(user) } },
    include: { student: { select: { stage: { select: { type: true } } } } },
  });
}

export async function setAdmissionBatch(id: unknown, batchId: unknown): Promise<AdmissionResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsedBatch = z.string().max(64).safeParse(batchId);
  if (!parsedBatch.success) return { ok: false, error: GENERIC_ERROR };

  try {
    const admission = await findOwnAdmission(user, id);
    if (!admission) return { ok: false, error: NOT_FOUND };
    if (admission.status === "CONFIRMED") {
      return { ok: false, error: "Move this student out of Enrolled before changing their batch." };
    }
    const newBatch = parsedBatch.data || null;
    if (!(await validBatchFor(admission.courseId, newBatch))) {
      return { ok: false, error: "That batch doesn't belong to this course." };
    }
    await db.$transaction(async (tx) => {
      await tx.admission.update({ where: { id: admission.id }, data: { batchId: newBatch } });
      await recordAudit(tx, {
        actorId: user.id,
        action: "admission.batch_changed",
        entityType: "Admission",
        entityId: admission.id,
        before: { batchId: admission.batchId },
        after: { batchId: newBatch },
      });
    });
    revalidateAdmission(admission.studentId);
    return { ok: true };
  } catch (error) {
    console.error("setAdmissionBatch failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function cancelAdmission(id: unknown): Promise<AdmissionResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };

  try {
    const admission = await findOwnAdmission(user, id);
    if (!admission) return { ok: false, error: NOT_FOUND };
    if (admission.status === "CONFIRMED" || admission.student.stage.type === "WON") {
      return { ok: false, error: "Move this student out of Enrolled before cancelling their admission." };
    }
    if (admission.feePlanId) {
      return { ok: false, error: "Cancel the fee plan first. Accounts can do this from the Payments tab." };
    }
    await db.$transaction(async (tx) => {
      await tx.admission.update({ where: { id: admission.id }, data: { status: "CANCELLED" } });
      await recordAudit(tx, { actorId: user.id, action: "admission.cancelled", entityType: "Admission", entityId: admission.id });
    });
    revalidateAdmission(admission.studentId);
    return { ok: true };
  } catch (error) {
    console.error("cancelAdmission failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function setChecklistItem(itemId: unknown, isDone: unknown): Promise<AdmissionResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(itemId);
  if (!id.success || typeof isDone !== "boolean") return { ok: false, error: GENERIC_ERROR };

  try {
    const item = await db.checklistItem.findFirst({
      where: { id: id.data, admission: { deletedAt: null, student: { deletedAt: null, ...ownedBy(user) } } },
      select: { id: true, name: true, admission: { select: { id: true, studentId: true } } },
    });
    if (!item) return { ok: false, error: NOT_FOUND };
    await db.$transaction(async (tx) => {
      await tx.checklistItem.update({ where: { id: item.id }, data: { completedAt: isDone ? new Date() : null } });
      await recordAudit(tx, {
        actorId: user.id,
        action: isDone ? "checklist.completed" : "checklist.reopened",
        entityType: "Admission",
        entityId: item.admission.id,
        after: { item: item.name },
      });
    });
    revalidateAdmission(item.admission.studentId);
    return { ok: true };
  } catch (error) {
    console.error("setChecklistItem failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function addChecklistItem(admissionId: unknown, name: unknown): Promise<AdmissionResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsedName = z.string().trim().min(2).max(120).safeParse(name);
  if (!parsedName.success) return { ok: false, error: "Enter a document name." };

  try {
    const admission = await findOwnAdmission(user, admissionId);
    if (!admission) return { ok: false, error: NOT_FOUND };
    await db.checklistItem.create({ data: { admissionId: admission.id, name: parsedName.data } });
    revalidateAdmission(admission.studentId);
    return { ok: true };
  } catch (error) {
    console.error("addChecklistItem failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** The usual way to enrol, from the Admission tab. Moving the lead to Enrolled does the same. */
export async function enrolFromAdmission(id: unknown): Promise<AdmissionResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };

  try {
    const admission = await findOwnAdmission(user, id);
    if (!admission) return { ok: false, error: NOT_FOUND };
    const won = await db.pipelineStage.findFirst({ where: { type: "WON" }, orderBy: { position: "asc" } });
    if (!won) return { ok: false, error: GENERIC_ERROR };

    await db.$transaction(async (tx) => {
      await takeSeat(tx, admission.studentId);
      const student = await tx.student.findUniqueOrThrow({
        where: { id: admission.studentId },
        include: { stage: { select: { name: true, type: true } } },
      });
      if (student.stage.type === "WON") return;
      await tx.student.update({ where: { id: student.id }, data: { stageId: won.id, lostReason: null, nextFollowUpAt: null } });
      await tx.activity.create({
        data: {
          studentId: student.id,
          type: "STAGE_CHANGE",
          body: `Stage changed from ${student.stage.name} to ${won.name}`,
          metadata: { from: student.stage.name, to: won.name },
          actorId: user.id,
        },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "admission.enrolled",
        entityType: "Admission",
        entityId: admission.id,
        before: { stage: student.stage.name },
        after: { stage: won.name },
      });
    });
    revalidateAdmission(admission.studentId);
    return { ok: true };
  } catch (error) {
    if (error instanceof EnrolmentError) return { ok: false, error: error.message };
    console.error("enrolFromAdmission failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
