"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, getUserWithAccess } from "@/lib/session";
import {
  changePasswordSchema,
  editUserSchema,
  listItemSchema,
  newUserSchema,
  orgSchema,
  passwordSchema,
  stageSchema,
} from "@/lib/validations/settings";
import { recordAudit } from "@/server/audit";
import { detectFileType, saveUpload } from "@/server/storage";

export type SettingsResult = { ok: true } | { ok: false; error: string };

const NO_ACCESS = "You don't have permission to do that.";
const NOT_FOUND = "That record no longer exists.";
const GENERIC_ERROR = "Something went wrong. Please try again.";
const idSchema = z.string().min(1).max(64);
const MAX_LOGO_BYTES = 1024 * 1024;

const getAdmin = () => getUserWithAccess("settings");
const isUniqueError = (error: unknown) => (error as { code?: string })?.code === "P2002";

function fail(error: unknown, name: string): SettingsResult {
  console.error(`${name} failed`, error);
  return { ok: false, error: GENERIC_ERROR };
}

// ---------- Users ----------

export async function createUser(input: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = newUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { password, ...values } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { ...values, passwordHash } });
      await recordAudit(tx, {
        actorId: user.id,
        action: "user.created",
        entityType: "User",
        entityId: created.id,
        after: { name: values.name, email: values.email, role: values.role },
      });
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    if (isUniqueError(error)) return { ok: false, error: "Someone already uses that email." };
    return fail(error, "createUser");
  }
}

/** There must always be someone left who can sign in and manage the system. */
async function wouldRemoveLastAdmin(targetId: string) {
  const others = await db.user.count({ where: { role: "ADMIN", isActive: true, id: { not: targetId } } });
  return others === 0;
}

export async function updateUser(id: unknown, input: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const userId = idSchema.safeParse(id);
  const parsed = editUserSchema.safeParse(input);
  if (!userId.success) return { ok: false, error: NOT_FOUND };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  try {
    const target = await db.user.findUnique({ where: { id: userId.data } });
    if (!target) return { ok: false, error: NOT_FOUND };
    if (target.role === "ADMIN" && parsed.data.role !== "ADMIN" && (await wouldRemoveLastAdmin(target.id))) {
      return { ok: false, error: "This is the only admin, so their role can't change." };
    }
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: parsed.data });
      await recordAudit(tx, {
        actorId: user.id,
        action: "user.updated",
        entityType: "User",
        entityId: target.id,
        before: { name: target.name, role: target.role },
        after: parsed.data,
      });
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return fail(error, "updateUser");
  }
}

export async function setUserActive(id: unknown, isActive: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const userId = idSchema.safeParse(id);
  if (!userId.success || typeof isActive !== "boolean") return { ok: false, error: NOT_FOUND };
  if (userId.data === user.id && !isActive) return { ok: false, error: "You can't deactivate your own account." };

  try {
    const target = await db.user.findUnique({ where: { id: userId.data } });
    if (!target) return { ok: false, error: NOT_FOUND };
    if (!isActive && target.role === "ADMIN" && (await wouldRemoveLastAdmin(target.id))) {
      return { ok: false, error: "This is the only admin, so they can't be deactivated." };
    }
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { isActive } });
      await recordAudit(tx, {
        actorId: user.id,
        action: isActive ? "user.reactivated" : "user.deactivated",
        entityType: "User",
        entityId: target.id,
      });
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return fail(error, "setUserActive");
  }
}

/** Raising the session version signs that person out of every device. */
export async function resetUserPassword(id: unknown, password: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const userId = idSchema.safeParse(id);
  const parsed = passwordSchema.safeParse(password);
  if (!userId.success) return { ok: false, error: NOT_FOUND };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  try {
    const passwordHash = await bcrypt.hash(parsed.data, 12);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId.data }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      await recordAudit(tx, { actorId: user.id, action: "user.password_reset", entityType: "User", entityId: userId.data });
    });
    return { ok: true };
  } catch (error) {
    return fail(error, "resetUserPassword");
  }
}

export async function changeOwnPassword(input: unknown): Promise<SettingsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  try {
    const record = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(parsed.data.current, record.passwordHash))) {
      return { ok: false, error: "Your current password isn't right." };
    }
    const passwordHash = await bcrypt.hash(parsed.data.next, 12);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      await recordAudit(tx, { actorId: user.id, action: "user.password_changed", entityType: "User", entityId: user.id });
    });
    return { ok: true };
  } catch (error) {
    return fail(error, "changeOwnPassword");
  }
}

// ---------- Pipeline stages ----------

export async function saveStage(id: unknown, input: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const stageId = idSchema.parse(id);
        const before = await tx.pipelineStage.findUniqueOrThrow({ where: { id: stageId } });
        await tx.pipelineStage.update({ where: { id: stageId }, data: parsed.data });
        // Past moves are stored by stage name, so the funnel needs them kept in step.
        if (before.name !== parsed.data.name) {
          await tx.$executeRaw`UPDATE "Activity" SET metadata = jsonb_set(metadata::jsonb, '{to}', to_jsonb(${parsed.data.name}::text))
            WHERE type = 'STAGE_CHANGE' AND metadata->>'to' = ${before.name}`;
          await tx.$executeRaw`UPDATE "Activity" SET metadata = jsonb_set(metadata::jsonb, '{from}', to_jsonb(${parsed.data.name}::text))
            WHERE type = 'STAGE_CHANGE' AND metadata->>'from' = ${before.name}`;
        }
        await recordAudit(tx, {
          actorId: user.id,
          action: "stage.updated",
          entityType: "PipelineStage",
          entityId: stageId,
          before: { name: before.name, color: before.color },
          after: parsed.data,
        });
      } else {
        // New stages join the end of the open ones, ahead of Enrolled and Lost.
        const closed = await tx.pipelineStage.findMany({ where: { type: { not: "OPEN" } }, orderBy: { position: "asc" } });
        const position = closed[0]?.position ?? (await tx.pipelineStage.count());
        for (const [index, stage] of closed.entries()) {
          await tx.pipelineStage.update({ where: { id: stage.id }, data: { position: position + index + 1 } });
        }
        const created = await tx.pipelineStage.create({ data: { ...parsed.data, position, type: "OPEN" } });
        await recordAudit(tx, {
          actorId: user.id,
          action: "stage.created",
          entityType: "PipelineStage",
          entityId: created.id,
          after: parsed.data,
        });
      }
    });
    revalidatePath("/settings");
    revalidatePath("/leads");
    return { ok: true };
  } catch (error) {
    if (isUniqueError(error)) return { ok: false, error: "Another stage already has that name." };
    return fail(error, "saveStage");
  }
}

/** Only open stages move, so Enrolled and Lost always stay at the end. */
export async function moveStage(id: unknown, direction: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const stageId = idSchema.safeParse(id);
  if (!stageId.success || (direction !== -1 && direction !== 1)) return { ok: false, error: NOT_FOUND };

  try {
    const stages = await db.pipelineStage.findMany({ where: { type: "OPEN" }, orderBy: { position: "asc" } });
    const index = stages.findIndex((stage) => stage.id === stageId.data);
    const neighbour = stages[index + direction];
    if (index < 0 || !neighbour) return { ok: true };

    await db.$transaction(async (tx) => {
      await tx.pipelineStage.update({ where: { id: stages[index].id }, data: { position: neighbour.position } });
      await tx.pipelineStage.update({ where: { id: neighbour.id }, data: { position: stages[index].position } });
      await recordAudit(tx, { actorId: user.id, action: "stage.moved", entityType: "PipelineStage", entityId: stageId.data });
    });
    revalidatePath("/settings");
    revalidatePath("/leads");
    return { ok: true };
  } catch (error) {
    return fail(error, "moveStage");
  }
}

export async function deleteStage(id: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const stageId = idSchema.safeParse(id);
  if (!stageId.success) return { ok: false, error: NOT_FOUND };

  try {
    const stage = await db.pipelineStage.findUnique({
      where: { id: stageId.data },
      include: { _count: { select: { students: true } } },
    });
    if (!stage) return { ok: false, error: NOT_FOUND };
    if (stage.key || stage.type !== "OPEN") return { ok: false, error: `${stage.name} is built in, so it can't be deleted.` };
    if (stage._count.students > 0) {
      return { ok: false, error: `Move the ${stage._count.students} people at ${stage.name} to another stage first.` };
    }
    await db.$transaction(async (tx) => {
      await tx.pipelineStage.delete({ where: { id: stage.id } });
      await recordAudit(tx, {
        actorId: user.id,
        action: "stage.deleted",
        entityType: "PipelineStage",
        entityId: stage.id,
        before: { name: stage.name },
      });
    });
    revalidatePath("/settings");
    revalidatePath("/leads");
    return { ok: true };
  } catch (error) {
    return fail(error, "deleteStage");
  }
}

// ---------- Simple lists ----------

const LIST_KIND = z.enum(["source", "exam", "branch"]);
type ListKind = z.infer<typeof LIST_KIND>;

export async function saveListItem(kind: unknown, id: unknown, input: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const listKind = LIST_KIND.safeParse(kind);
  const parsed = listItemSchema.safeParse(input);
  if (!listKind.success) return { ok: false, error: GENERIC_ERROR };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { name } = parsed.data;

  try {
    const entityId = await db.$transaction(async (tx) => {
      const existingId = id ? idSchema.parse(id) : null;
      let savedId: string;
      if (listKind.data === "source") {
        savedId = existingId
          ? (await tx.leadSource.update({ where: { id: existingId }, data: { name } })).id
          : (await tx.leadSource.create({ data: { name } })).id;
      } else if (listKind.data === "exam") {
        savedId = existingId
          ? (await tx.targetExam.update({ where: { id: existingId }, data: { name } })).id
          : (await tx.targetExam.create({ data: { name, position: await tx.targetExam.count() } })).id;
      } else {
        savedId = existingId
          ? (await tx.branch.update({ where: { id: existingId }, data: { name } })).id
          : (await tx.branch.create({ data: { name } })).id;
      }
      await recordAudit(tx, {
        actorId: user.id,
        action: `${listKind.data}.${existingId ? "updated" : "created"}`,
        entityType: listKind.data,
        entityId: savedId,
        after: { name },
      });
      return savedId;
    });
    revalidateLists();
    return entityId ? { ok: true } : { ok: false, error: GENERIC_ERROR };
  } catch (error) {
    if (isUniqueError(error)) return { ok: false, error: "That name is already on the list." };
    return fail(error, "saveListItem");
  }
}

function revalidateLists() {
  revalidatePath("/settings");
  revalidatePath("/leads");
  revalidatePath("/courses");
}

/** Hidden rather than deleted, as past records still refer to them. */
export async function setListItemActive(kind: unknown, id: unknown, isActive: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const listKind = LIST_KIND.safeParse(kind);
  const itemId = idSchema.safeParse(id);
  if (!listKind.success || !itemId.success || typeof isActive !== "boolean") return { ok: false, error: GENERIC_ERROR };

  const updaters: Record<ListKind, () => Promise<unknown>> = {
    source: () => db.leadSource.update({ where: { id: itemId.data }, data: { isActive } }),
    exam: () => db.targetExam.update({ where: { id: itemId.data }, data: { isActive } }),
    branch: () => db.branch.update({ where: { id: itemId.data }, data: { isActive } }),
  };
  try {
    await updaters[listKind.data]();
    await recordAudit(db, {
      actorId: user.id,
      action: `${listKind.data}.${isActive ? "restored" : "hidden"}`,
      entityType: listKind.data,
      entityId: itemId.data,
    });
    revalidateLists();
    return { ok: true };
  } catch (error) {
    return fail(error, "setListItemActive");
  }
}

// ---------- Organisation and branding ----------

export async function saveOrganisation(input: unknown): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = orgSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  try {
    await db.$transaction(async (tx) => {
      const before = await tx.orgSettings.findUnique({ where: { id: "default" } });
      await tx.orgSettings.upsert({ where: { id: "default" }, update: parsed.data, create: parsed.data });
      await recordAudit(tx, {
        actorId: user.id,
        action: "organisation.updated",
        entityType: "OrgSettings",
        entityId: "default",
        before: before ? { name: before.name, gstin: before.gstin, receiptPrefix: before.receiptPrefix } : undefined,
        after: { name: parsed.data.name, gstin: parsed.data.gstin, receiptPrefix: parsed.data.receiptPrefix },
      });
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error, "saveOrganisation");
  }
}

export async function uploadLogo(formData: FormData): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image." };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, error: "Choose an image smaller than 1 MB." };

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const extension = detectFileType(bytes);
    // Not SVG, as those can contain scripts, and not PDF, as it can't be shown as an image.
    if (!extension || extension === "pdf") return { ok: false, error: "Use a PNG, JPG or WebP image." };
    const key = await saveUpload(bytes, extension);
    await db.$transaction(async (tx) => {
      await tx.orgSettings.update({ where: { id: "default" }, data: { logoUrl: key } });
      await recordAudit(tx, { actorId: user.id, action: "organisation.logo_changed", entityType: "OrgSettings", entityId: "default" });
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error, "uploadLogo");
  }
}

export async function removeLogo(): Promise<SettingsResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  try {
    await db.orgSettings.update({ where: { id: "default" }, data: { logoUrl: null } });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error, "removeLogo");
  }
}
