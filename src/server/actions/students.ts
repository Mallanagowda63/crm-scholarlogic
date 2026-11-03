"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { getUserWithAccess, type CurrentUser } from "@/lib/session";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/students";
import { academicSchema, contactSchema, followUpSchema, noteSchema } from "@/lib/validations/student";
import { recordAudit } from "@/server/audit";
import { ownedBy } from "@/server/leads";
import { detectFileType, saveUpload } from "@/server/storage";
import { syncNextFollowUp } from "@/server/students";

export type ProfileResult = { ok: true } | { ok: false; error: string };

const NO_ACCESS = "You don't have permission to do that.";
const NOT_FOUND = "That record no longer exists or isn't assigned to you.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

const idSchema = z.string().min(1).max(64);

/** Accounts can look at profiles but not change them, so everything here needs more than module access. */
async function getEditor(): Promise<CurrentUser | null> {
  const user = await getUserWithAccess("students");
  return user && user.role !== "ACCOUNTS" ? user : null;
}

async function findEditableStudent(user: CurrentUser, id: unknown) {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return null;
  return db.student.findFirst({
    where: { id: parsed.data, ...ownedBy(user) },
    select: { id: true, name: true, assignedToId: true, lastContactedAt: true },
  });
}

function revalidateStudent(id: string) {
  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  revalidatePath("/leads");
}

function firstMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Please check what you entered.";
}

/** Runs the body and turns unexpected failures into a friendly message. */
async function attempt(name: string, body: () => Promise<ProfileResult>): Promise<ProfileResult> {
  try {
    return await body();
  } catch (error) {
    console.error(`${name} failed`, error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function addNote(studentId: unknown, input: unknown): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstMessage(parsed.error) };

  return attempt("addNote", async () => {
    const student = await findEditableStudent(user, studentId);
    if (!student) return { ok: false, error: NOT_FOUND };
    await db.activity.create({
      data: { studentId: student.id, type: "NOTE", body: parsed.data.body, actorId: user.id },
    });
    revalidateStudent(student.id);
    return { ok: true };
  });
}

export async function logContact(studentId: unknown, input: unknown): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstMessage(parsed.error) };

  return attempt("logContact", async () => {
    const student = await findEditableStudent(user, studentId);
    if (!student) return { ok: false, error: NOT_FOUND };
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.activity.create({
        data: { studentId: student.id, type: parsed.data.type, body: parsed.data.body, actorId: user.id, occurredAt: now },
      });
      await tx.student.update({ where: { id: student.id }, data: { lastContactedAt: now } });
    });
    revalidateStudent(student.id);
    return { ok: true };
  });
}

export async function scheduleFollowUp(studentId: unknown, input: unknown): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = followUpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstMessage(parsed.error) };

  return attempt("scheduleFollowUp", async () => {
    const student = await findEditableStudent(user, studentId);
    if (!student) return { ok: false, error: NOT_FOUND };
    const title = parsed.data.title || `Follow up with ${student.name}`;
    await db.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title,
          type: "FOLLOW_UP",
          priority: parsed.data.priority,
          dueAt: new Date(parsed.data.dueAt),
          assigneeId: student.assignedToId ?? user.id,
          createdById: user.id,
          studentId: student.id,
        },
      });
      await tx.activity.create({
        data: {
          studentId: student.id,
          type: "FOLLOW_UP",
          body: `Follow-up scheduled: ${title}`,
          metadata: { taskId: task.id },
          actorId: user.id,
        },
      });
      await syncNextFollowUp(tx, student.id);
    });
    revalidateStudent(student.id);
    return { ok: true };
  });
}

export async function completeFollowUp(taskId: unknown): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(taskId);
  if (!id.success) return { ok: false, error: NOT_FOUND };

  return attempt("completeFollowUp", async () => {
    const task = await db.task.findFirst({
      where: { id: id.data, status: "OPEN", studentId: { not: null }, student: { deletedAt: null, ...ownedBy(user) } },
      select: { id: true, title: true, studentId: true },
    });
    if (!task?.studentId) return { ok: false, error: NOT_FOUND };
    const studentId = task.studentId;

    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { status: "DONE", completedAt: new Date() } });
      await tx.activity.create({
        data: {
          studentId,
          type: "FOLLOW_UP",
          body: `Follow-up completed: ${task.title}`,
          metadata: { taskId: task.id },
          actorId: user.id,
        },
      });
      await syncNextFollowUp(tx, studentId);
    });
    revalidateStudent(studentId);
    return { ok: true };
  });
}

export async function saveAcademicRecord(studentId: unknown, recordId: unknown, input: unknown): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = academicSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstMessage(parsed.error) };

  return attempt("saveAcademicRecord", async () => {
    const student = await findEditableStudent(user, studentId);
    if (!student) return { ok: false, error: NOT_FOUND };

    if (recordId) {
      const id = idSchema.safeParse(recordId);
      const record = id.success
        ? await db.academicRecord.findFirst({ where: { id: id.data, studentId: student.id } })
        : null;
      if (!record) return { ok: false, error: NOT_FOUND };
      await db.$transaction(async (tx) => {
        await tx.academicRecord.update({ where: { id: record.id }, data: parsed.data });
        await recordAudit(tx, {
          actorId: user.id,
          action: "academic_record.updated",
          entityType: "AcademicRecord",
          entityId: record.id,
          before: { qualification: record.qualification, institution: record.institution, year: record.year, score: record.score },
          after: parsed.data,
        });
      });
    } else {
      await db.$transaction(async (tx) => {
        const record = await tx.academicRecord.create({ data: { ...parsed.data, studentId: student.id } });
        await recordAudit(tx, {
          actorId: user.id,
          action: "academic_record.created",
          entityType: "AcademicRecord",
          entityId: record.id,
          after: parsed.data,
        });
      });
    }
    revalidateStudent(student.id);
    return { ok: true };
  });
}

export async function removeAcademicRecord(recordId: unknown): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(recordId);
  if (!id.success) return { ok: false, error: NOT_FOUND };

  return attempt("removeAcademicRecord", async () => {
    const record = await db.academicRecord.findFirst({
      where: { id: id.data, student: { deletedAt: null, ...ownedBy(user) } },
      select: { id: true, studentId: true, qualification: true },
    });
    if (!record) return { ok: false, error: NOT_FOUND };
    await db.$transaction(async (tx) => {
      await tx.academicRecord.update({ where: { id: record.id }, data: { deletedAt: new Date() } });
      await recordAudit(tx, {
        actorId: user.id,
        action: "academic_record.removed",
        entityType: "AcademicRecord",
        entityId: record.id,
        after: { qualification: record.qualification },
      });
    });
    revalidateStudent(record.studentId);
    return { ok: true };
  });
}

const uploadSchema = z.object({
  studentId: idSchema,
  type: z.enum(DOCUMENT_TYPES, { error: "Choose a document type" }),
  file: z.instanceof(File, { error: "Choose a file" }),
});

export async function uploadDocument(formData: FormData): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = uploadSchema.safeParse({
    studentId: formData.get("studentId"),
    type: formData.get("type"),
    file: formData.get("file"),
  });
  if (!parsed.success) return { ok: false, error: firstMessage(parsed.error) };
  const { file, type } = parsed.data;
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, error: "Choose a file smaller than 5 MB." };

  return attempt("uploadDocument", async () => {
    const student = await findEditableStudent(user, parsed.data.studentId);
    if (!student) return { ok: false, error: NOT_FOUND };

    const bytes = Buffer.from(await file.arrayBuffer());
    const extension = detectFileType(bytes);
    if (!extension) return { ok: false, error: "Only PDF, JPG, PNG and WebP files can be uploaded." };

    const key = await saveUpload(bytes, extension);
    await db.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          studentId: student.id,
          type,
          // Only ever displayed as text, and shortened because browsers allow very long names.
          fileName: file.name.slice(-200) || `document.${extension}`,
          fileUrl: key,
          uploadedById: user.id,
        },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "document.uploaded",
        entityType: "Document",
        entityId: document.id,
        after: { studentId: student.id, type, fileName: document.fileName },
      });
    });
    revalidateStudent(student.id);
    return { ok: true };
  });
}

const documentWhere = (id: string, user: CurrentUser) => ({ id, student: { deletedAt: null, ...ownedBy(user) } });

export async function setDocumentStatus(documentId: unknown, status: unknown): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(documentId);
  const newStatus = z.enum(["PENDING", "VERIFIED", "REJECTED"]).safeParse(status);
  if (!id.success || !newStatus.success) return { ok: false, error: NOT_FOUND };

  return attempt("setDocumentStatus", async () => {
    const document = await db.document.findFirst({ where: documentWhere(id.data, user) });
    if (!document) return { ok: false, error: NOT_FOUND };
    await db.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: document.id },
        data: { status: newStatus.data, verifiedById: newStatus.data === "PENDING" ? null : user.id },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "document.status_changed",
        entityType: "Document",
        entityId: document.id,
        before: { status: document.status },
        after: { status: newStatus.data },
      });
    });
    revalidateStudent(document.studentId);
    return { ok: true };
  });
}

async function setDocumentDeleted(documentId: unknown, deleted: boolean): Promise<ProfileResult> {
  const user = await getEditor();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(documentId);
  if (!id.success) return { ok: false, error: NOT_FOUND };

  return attempt("setDocumentDeleted", async () => {
    const where = { ...documentWhere(id.data, user), deletedAt: deleted ? null : { not: null } };
    const document = await db.document.findFirst({ where });
    if (!document) return { ok: false, error: NOT_FOUND };
    await db.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: document.id, deletedAt: deleted ? null : { not: null } },
        data: { deletedAt: deleted ? new Date() : null },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: deleted ? "document.removed" : "document.restored",
        entityType: "Document",
        entityId: document.id,
        after: { fileName: document.fileName },
      });
    });
    revalidateStudent(document.studentId);
    return { ok: true };
  });
}

export async function removeDocument(documentId: unknown) {
  return setDocumentDeleted(documentId, true);
}

export async function restoreDocument(documentId: unknown) {
  return setDocumentDeleted(documentId, false);
}
