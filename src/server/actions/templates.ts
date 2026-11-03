"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { summarisePlan } from "@/lib/fees";
import { formatShortDate } from "@/lib/format";
import { getUserWithAccess } from "@/lib/session";
import { fillTemplate, templateSchema } from "@/lib/validations/settings";
import { recordAudit } from "@/server/audit";
import { ownedBy } from "@/server/leads";

export type TemplateResult = { ok: true } | { ok: false; error: string };

const NO_ACCESS = "You don't have permission to do that.";
const GENERIC_ERROR = "Something went wrong. Please try again.";
const idSchema = z.string().min(1).max(64);

/** Counsellors use templates. Only admins change them, so the wording stays consistent. */
async function getAdmin() {
  const user = await getUserWithAccess("communication");
  return user?.role === "ADMIN" ? user : null;
}

export async function saveTemplate(id: unknown, input: unknown): Promise<TemplateResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  // Subjects only make sense for email.
  const data = { ...parsed.data, subject: parsed.data.channel === "EMAIL" ? parsed.data.subject : null };

  try {
    await db.$transaction(async (tx) => {
      const existingId = id ? idSchema.parse(id) : null;
      const saved = existingId
        ? await tx.messageTemplate.update({ where: { id: existingId }, data })
        : await tx.messageTemplate.create({ data });
      await recordAudit(tx, {
        actorId: user.id,
        action: existingId ? "template.updated" : "template.created",
        entityType: "MessageTemplate",
        entityId: saved.id,
        after: { name: data.name, channel: data.channel },
      });
    });
    revalidatePath("/communication");
    return { ok: true };
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return { ok: false, error: "Another template already has that name." };
    console.error("saveTemplate failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function setTemplateActive(id: unknown, isActive: unknown): Promise<TemplateResult> {
  const user = await getAdmin();
  if (!user) return { ok: false, error: NO_ACCESS };
  const templateId = idSchema.safeParse(id);
  if (!templateId.success || typeof isActive !== "boolean") return { ok: false, error: GENERIC_ERROR };
  try {
    await db.messageTemplate.update({ where: { id: templateId.data }, data: { isActive } });
    await recordAudit(db, {
      actorId: user.id,
      action: isActive ? "template.restored" : "template.hidden",
      entityType: "MessageTemplate",
      entityId: templateId.data,
    });
    revalidatePath("/communication");
    return { ok: true };
  } catch (error) {
    console.error("setTemplateActive failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export type PreparedMessage =
  | { ok: true; channel: "WHATSAPP" | "EMAIL"; subject: string | null; body: string }
  | { ok: false; error: string };

/** Fills in a template for one person, using their own course and next due date. */
export async function prepareMessage(studentId: unknown, templateId: unknown): Promise<PreparedMessage> {
  const user = await getUserWithAccess("communication");
  if (!user) return { ok: false, error: NO_ACCESS };
  const student = idSchema.safeParse(studentId);
  const template = idSchema.safeParse(templateId);
  if (!student.success || !template.success) return { ok: false, error: GENERIC_ERROR };

  try {
    const [person, chosen] = await Promise.all([
      db.student.findFirst({
        where: { id: student.data, ...ownedBy(user) },
        select: {
          name: true,
          courseInterest: { select: { name: true } },
          feePlans: {
            where: { cancelledAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              totalAmount: true,
              discountAmount: true,
              gstRateBps: true,
              course: { select: { name: true } },
              instalments: {
                where: { cancelledAt: null },
                orderBy: { sequence: "asc" },
                select: { amount: true, dueDate: true },
              },
              payments: { where: { deletedAt: null }, select: { amount: true } },
            },
          },
        },
      }),
      db.messageTemplate.findFirst({ where: { id: template.data, isActive: true } }),
    ]);
    if (!person) return { ok: false, error: "That person no longer exists or isn't assigned to you." };
    if (!chosen) return { ok: false, error: "That template is no longer available." };

    const plan = person.feePlans[0];
    const next = plan && summarisePlan(plan, new Date()).instalments.find((item) => item.outstanding > 0);
    const values = {
      name: person.name,
      course: plan?.course.name ?? person.courseInterest?.name ?? "your course",
      due_date: next ? formatShortDate(next.dueDate) : "your next due date",
    };
    return {
      ok: true,
      channel: chosen.channel,
      subject: chosen.subject ? fillTemplate(chosen.subject, values) : null,
      body: fillTemplate(chosen.body, values),
    };
  } catch (error) {
    console.error("prepareMessage failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
