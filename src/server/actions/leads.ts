"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { MAX_BULK, MAX_IMPORT_BYTES } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { getUserWithAccess, type CurrentUser } from "@/lib/session";
import { leadSchema, type LeadFormValues } from "@/lib/validations/lead";
import { changedFields, recordAudit, type Tx } from "@/server/audit";
import { parseLeadCsv, type ImportError } from "@/server/lead-import";
import { findDuplicates, firstStageId, ownedBy, type DuplicateMatch } from "@/server/leads";
import { syncNextFollowUp, viewableWhere } from "@/server/students";
import { moveOpenWork } from "@/server/tasks";

export type LeadActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Partial<Record<keyof LeadFormValues, string>>;
      duplicates?: DuplicateMatch[];
    };

export type SimpleResult = { ok: true; count: number } | { ok: false; error: string };

const NO_ACCESS = "You don't have permission to do that.";
const NOT_FOUND = "That lead no longer exists or isn't assigned to you.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

// One lock number for every round-robin pick, so two new leads can't go to the same counsellor at once.
const ROUND_ROBIN_LOCK = 727001;

const idSchema = z.string().min(1).max(64);
const idsSchema = z.array(idSchema).min(1).max(MAX_BULK);
const lostReasonSchema = z.string().trim().max(200).optional();

function revalidateLeadPages() {
  revalidatePath("/leads");
  revalidatePath("/students", "layout");
}

async function pickNextCounsellor(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROUND_ROBIN_LOCK})`;
  const next = await tx.user.findFirst({
    where: { role: "COUNSELLOR", isActive: true },
    orderBy: [{ lastAssignedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    select: { id: true },
  });
  if (next) await tx.user.update({ where: { id: next.id }, data: { lastAssignedAt: new Date() } });
  return next?.id ?? null;
}

async function isAssignable(id: string) {
  const user = await db.user.findFirst({ where: { id, isActive: true, role: "COUNSELLOR" }, select: { id: true } });
  return Boolean(user);
}

function fieldErrorsFrom(error: z.ZodError) {
  const fieldErrors: Partial<Record<keyof LeadFormValues, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as keyof LeadFormValues;
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

export async function createLead(input: unknown, allowDuplicates: unknown): Promise<LeadActionResult> {
  const user = await getUserWithAccess("leads");
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const { notes, assignedToId, ...values } = parsed.data;

  try {
    if (allowDuplicates !== true) {
      const duplicates = await findDuplicates(values);
      if (duplicates.length > 0) return { ok: false, error: "Possible duplicate.", duplicates };
    }
    if (user.role === "ADMIN" && assignedToId && !(await isAssignable(assignedToId))) {
      return { ok: false, error: "Choose an active counsellor." };
    }

    const stageId = await firstStageId();
    const lead = await db.$transaction(async (tx) => {
      // A counsellor's own leads stay with them. Otherwise an admin's choice or round robin decides.
      const owner =
        user.role === "COUNSELLOR" ? user.id : (assignedToId ?? (await pickNextCounsellor(tx)));
      const created = await tx.student.create({
        data: { ...values, stageId, assignedToId: owner },
      });
      if (notes) {
        await tx.activity.create({
          data: { studentId: created.id, type: "NOTE", body: notes, actorId: user.id },
        });
      }
      await recordAudit(tx, {
        actorId: user.id,
        action: "lead.created",
        entityType: "Student",
        entityId: created.id,
        after: { name: created.name, assignedToId: owner },
      });
      return created;
    });

    revalidateLeadPages();
    return { ok: true, id: lead.id };
  } catch (error) {
    console.error("createLead failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function updateLead(id: unknown, input: unknown, allowDuplicates: unknown): Promise<LeadActionResult> {
  const user = await getUserWithAccess("leads");
  if (!user) return { ok: false, error: NO_ACCESS };

  const leadId = idSchema.safeParse(id);
  const parsed = leadSchema.safeParse(input);
  if (!leadId.success) return { ok: false, error: NOT_FOUND };
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  // Notes are added on the timeline after creation, so they aren't edited here.
  const { notes: _notes, assignedToId, ...values } = parsed.data;

  try {
    const lead = await db.student.findFirst({ where: { id: leadId.data, ...ownedBy(user) } });
    if (!lead) return { ok: false, error: NOT_FOUND };

    if (allowDuplicates !== true) {
      const duplicates = await findDuplicates(values, lead.id);
      if (duplicates.length > 0) return { ok: false, error: "Possible duplicate.", duplicates };
    }

    // Only admins can reassign, and only to an active counsellor.
    const canAssign = user.role === "ADMIN" && assignedToId !== lead.assignedToId;
    if (canAssign && assignedToId && !(await isAssignable(assignedToId))) {
      return { ok: false, error: "Choose an active counsellor." };
    }
    const data = { ...values, ...(canAssign && { assignedToId }) };

    const { before, after, hasChanges } = changedFields(lead, data);
    if (hasChanges) {
      await db.$transaction(async (tx) => {
        await tx.student.update({ where: { id: lead.id }, data });
        if (canAssign && lead.assignedToId && assignedToId) await moveOpenWork(tx, lead.id, lead.assignedToId, assignedToId);
        await recordAudit(tx, {
          actorId: user.id,
          action: "lead.updated",
          entityType: "Student",
          entityId: lead.id,
          before,
          after,
        });
      });
      revalidateLeadPages();
    }
    return { ok: true, id: lead.id };
  } catch (error) {
    console.error("updateLead failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function getLeadForEdit(id: unknown): Promise<{ ok: true; values: LeadFormValues } | { ok: false; error: string }> {
  const user = await getUserWithAccess("leads");
  if (!user) return { ok: false, error: NO_ACCESS };
  const leadId = idSchema.safeParse(id);
  if (!leadId.success) return { ok: false, error: NOT_FOUND };

  const lead = await db.student.findFirst({ where: { id: leadId.data, ...ownedBy(user) } });
  if (!lead) return { ok: false, error: NOT_FOUND };

  return {
    ok: true,
    values: {
      name: lead.name,
      phone: lead.phone,
      alternatePhone: lead.alternatePhone ?? "",
      email: lead.email ?? "",
      parentName: lead.parentName ?? "",
      parentPhone: lead.parentPhone ?? "",
      city: lead.city ?? "",
      currentClass: (lead.currentClass ?? "") as LeadFormValues["currentClass"],
      board: lead.board ?? "",
      schoolName: lead.schoolName ?? "",
      targetExamId: lead.targetExamId ?? "",
      courseInterestId: lead.courseInterestId ?? "",
      sourceId: lead.sourceId ?? "",
      budget: lead.budget === null ? "" : String(lead.budget / 100),
      preferredIntake: lead.preferredIntake ?? "",
      notes: "",
      assignedToId: lead.assignedToId ?? "",
    },
  };
}

async function applyStageChange(
  tx: Tx,
  user: CurrentUser,
  lead: { id: string; stageId: string; lostReason: string | null; stage: { name: string } },
  stage: { id: string; name: string; type: string },
  lostReason: string | undefined,
) {
  const newReason = stage.type === "LOST" ? (lostReason ?? null) : null;
  await tx.student.update({
    where: { id: lead.id },
    // Closed leads don't need chasing, so their next follow-up is cleared.
    data: {
      stageId: stage.id,
      lostReason: newReason,
      ...(stage.type !== "OPEN" && { nextFollowUpAt: null }),
    },
  });
  // Reopened leads pick up any follow-ups still waiting.
  if (stage.type === "OPEN") await syncNextFollowUp(tx, lead.id);
  await tx.activity.create({
    data: {
      studentId: lead.id,
      type: "STAGE_CHANGE",
      body: `Stage changed from ${lead.stage.name} to ${stage.name}${newReason ? `: ${newReason}` : ""}`,
      metadata: { from: lead.stage.name, to: stage.name },
      actorId: user.id,
    },
  });
  await recordAudit(tx, {
    actorId: user.id,
    action: "lead.stage_changed",
    entityType: "Student",
    entityId: lead.id,
    before: { stage: lead.stage.name, lostReason: lead.lostReason },
    after: { stage: stage.name, lostReason: newReason },
  });
}

export async function changeLeadStages(ids: unknown, stageId: unknown, lostReason: unknown): Promise<SimpleResult> {
  const user = await getUserWithAccess("leads");
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsedIds = idsSchema.safeParse(ids);
  const parsedStage = idSchema.safeParse(stageId);
  const parsedReason = lostReasonSchema.safeParse(lostReason);
  if (!parsedIds.success || !parsedStage.success || !parsedReason.success) {
    return { ok: false, error: "That change isn't valid." };
  }

  try {
    const stage = await db.pipelineStage.findUnique({ where: { id: parsedStage.data } });
    if (!stage) return { ok: false, error: "That stage no longer exists." };
    if (stage.type === "LOST" && !parsedReason.data) {
      return { ok: false, error: "Choose a reason for marking this lead as lost." };
    }

    const leads = await db.student.findMany({
      where: { id: { in: parsedIds.data }, ...ownedBy(user), stageId: { not: stage.id } },
      select: { id: true, stageId: true, lostReason: true, stage: { select: { name: true } } },
    });
    if (leads.length === 0) {
      const alreadyThere = await db.student.count({
        where: { id: { in: parsedIds.data }, ...ownedBy(user), stageId: stage.id },
      });
      return alreadyThere > 0 ? { ok: true, count: 0 } : { ok: false, error: NOT_FOUND };
    }

    await db.$transaction(
      async (tx) => {
        for (const lead of leads) await applyStageChange(tx, user, lead, stage, parsedReason.data);
      },
      { timeout: 30_000 },
    );

    revalidateLeadPages();
    return { ok: true, count: leads.length };
  } catch (error) {
    console.error("changeLeadStages failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function assignLeads(ids: unknown, counsellorId: unknown): Promise<SimpleResult> {
  const user = await getUserWithAccess("leads");
  if (user?.role !== "ADMIN") return { ok: false, error: NO_ACCESS };

  const parsedIds = idsSchema.safeParse(ids);
  const parsedCounsellor = idSchema.safeParse(counsellorId);
  if (!parsedIds.success || !parsedCounsellor.success) return { ok: false, error: "That change isn't valid." };

  try {
    if (!(await isAssignable(parsedCounsellor.data))) return { ok: false, error: "Choose an active counsellor." };

    const leads = await db.student.findMany({
      // Unassigned leads need listing separately, because SQL's "not equal" never matches an empty value.
      where: {
        id: { in: parsedIds.data },
        OR: [{ assignedToId: null }, { assignedToId: { not: parsedCounsellor.data } }],
      },
      select: { id: true, assignedToId: true },
    });
    await db.$transaction(
      async (tx) => {
        for (const lead of leads) {
          await tx.student.update({ where: { id: lead.id }, data: { assignedToId: parsedCounsellor.data } });
          if (lead.assignedToId) await moveOpenWork(tx, lead.id, lead.assignedToId, parsedCounsellor.data);
          await recordAudit(tx, {
            actorId: user.id,
            action: "lead.assigned",
            entityType: "Student",
            entityId: lead.id,
            before: { assignedToId: lead.assignedToId },
            after: { assignedToId: parsedCounsellor.data },
          });
        }
      },
      { timeout: 30_000 },
    );

    revalidateLeadPages();
    return { ok: true, count: leads.length };
  } catch (error) {
    console.error("assignLeads failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

async function setDeleted(id: unknown, deleted: boolean): Promise<SimpleResult> {
  const user = await getUserWithAccess("leads");
  if (user?.role !== "ADMIN") return { ok: false, error: NO_ACCESS };
  const leadId = idSchema.safeParse(id);
  if (!leadId.success) return { ok: false, error: NOT_FOUND };

  try {
    const where = { id: leadId.data, deletedAt: deleted ? null : { not: null } };
    const lead = await db.student.findFirst({ where, select: { id: true, name: true } });
    if (!lead) return { ok: false, error: NOT_FOUND };

    await db.$transaction(async (tx) => {
      await tx.student.update({ where, data: { deletedAt: deleted ? new Date() : null } });
      await recordAudit(tx, {
        actorId: user.id,
        action: deleted ? "lead.deleted" : "lead.restored",
        entityType: "Student",
        entityId: lead.id,
        after: { name: lead.name },
      });
    });

    revalidateLeadPages();
    return { ok: true, count: 1 };
  } catch (error) {
    console.error("setDeleted failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function deleteLead(id: unknown) {
  return setDeleted(id, true);
}

export async function restoreLead(id: unknown) {
  return setDeleted(id, false);
}

export type ImportPreview =
  | { ok: true; total: number; valid: number; duplicates: number; errors: ImportError[]; errorCount: number }
  | { ok: false; error: string };

function validImportText(text: unknown): text is string {
  return typeof text === "string" && text.length > 0 && text.length <= MAX_IMPORT_BYTES;
}

export async function previewLeadImport(text: unknown): Promise<ImportPreview> {
  const user = await getUserWithAccess("leads");
  if (!user) return { ok: false, error: NO_ACCESS };
  if (!validImportText(text)) return { ok: false, error: "Choose a CSV file smaller than 900 KB." };

  try {
    const { rows, errors, total, fatal } = await parseLeadCsv(text);
    if (fatal) return { ok: false, error: fatal };
    const duplicates = rows.filter((row) => row.isDuplicate).length;
    return {
      ok: true,
      total,
      valid: rows.length - duplicates,
      duplicates,
      errors: errors.slice(0, 50),
      errorCount: errors.length,
    };
  } catch (error) {
    console.error("previewLeadImport failed", error);
    return { ok: false, error: "That file couldn't be read. Is it a CSV?" };
  }
}

export async function commitLeadImport(text: unknown, includeDuplicates: unknown): Promise<SimpleResult> {
  const user = await getUserWithAccess("leads");
  if (!user) return { ok: false, error: NO_ACCESS };
  if (!validImportText(text)) return { ok: false, error: "Choose a CSV file smaller than 900 KB." };

  try {
    // Parsed again because the browser's copy of the preview can't be trusted.
    const { rows, fatal } = await parseLeadCsv(text);
    if (fatal) return { ok: false, error: fatal };
    const chosen = rows.filter((row) => includeDuplicates === true || !row.isDuplicate);
    if (chosen.length === 0) return { ok: false, error: "There are no new leads to import." };

    const stageId = await firstStageId();
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROUND_ROBIN_LOCK})`;
        const counsellors =
          user.role === "COUNSELLOR"
            ? [{ id: user.id }]
            : await tx.user.findMany({
                where: { role: "COUNSELLOR", isActive: true },
                orderBy: [{ lastAssignedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
                select: { id: true },
              });

        const leads = chosen.map(({ values: { notes, assignedToId: _unused, ...values } }, index) => ({
          id: randomUUID(),
          notes,
          data: { ...values, stageId, assignedToId: counsellors[index % (counsellors.length || 1)]?.id ?? null },
        }));
        await tx.student.createMany({ data: leads.map(({ id, data }) => ({ id, ...data })) });
        await tx.activity.createMany({
          data: leads.flatMap(({ id, notes }) =>
            notes ? [{ studentId: id, type: "NOTE" as const, body: notes, actorId: user.id }] : [],
          ),
        });

        // Keep round robin fair by marking whoever received leads, in the order they received them.
        if (user.role !== "COUNSELLOR") {
          const now = Date.now();
          const used = Math.min(chosen.length, counsellors.length);
          const last = (chosen.length - 1) % (counsellors.length || 1);
          for (let offset = 0; offset < used; offset += 1) {
            const position = (last - offset + counsellors.length) % counsellors.length;
            await tx.user.update({
              where: { id: counsellors[position].id },
              data: { lastAssignedAt: new Date(now - offset) },
            });
          }
        }

        await recordAudit(tx, {
          actorId: user.id,
          action: "lead.imported",
          entityType: "Student",
          entityId: "bulk",
          after: { count: leads.length, includedDuplicates: includeDuplicates === true },
        });
      },
      { timeout: 60_000 },
    );

    revalidateLeadPages();
    return { ok: true, count: chosen.length };
  } catch (error) {
    console.error("commitLeadImport failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export type PersonSearchResult = { id: string; name: string; phone: string; stage: string };

/** Powers the command palette, and follows the same visibility rules as the profile page. */
export async function searchPeople(query: unknown): Promise<PersonSearchResult[]> {
  const user = await getUserWithAccess("students");
  const q = z.string().trim().min(2).max(100).safeParse(query);
  if (!user || !q.success) return [];

  const digits = q.data.replace(/\D/g, "");
  const people = await db.student.findMany({
    where: {
      AND: [
        viewableWhere(user),
        {
          OR: [
            { name: { contains: q.data, mode: "insensitive" } },
            { email: { contains: q.data, mode: "insensitive" } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          ],
        },
      ],
    },
    select: { id: true, name: true, phone: true, stage: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 6,
  });
  return people.map(({ id, name, phone, stage }) => ({ id, name, phone: formatPhone(phone), stage: stage.name }));
}
