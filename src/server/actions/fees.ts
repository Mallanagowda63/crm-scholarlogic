"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { endOfIndiaDay, financialYearOf, payableAmount, splitGst, splitIntoInstalments } from "@/lib/fees";
import { addDaysToKey, dateKeyStart, formatRupees, indiaDateKey } from "@/lib/format";
import { getUserWithAccess } from "@/lib/session";
import { feePlanSchema, paymentSchema } from "@/lib/validations/fees";
import { recordAudit } from "@/server/audit";
import { LOCKED_TRANSACTION } from "@/server/stages";

export type FeeResult = { ok: true; paymentId?: string } | { ok: false; error: string };

const NO_ACCESS = "You don't have permission to do that.";
const NOT_FOUND = "That record no longer exists.";
const GENERIC_ERROR = "Something went wrong. Please try again.";
const idSchema = z.string().min(1).max(64);

// One lock number for receipt numbering, so two payments can't take the same number.
const RECEIPT_LOCK = 727003;

async function getFeeManager() {
  return getUserWithAccess("fees");
}

function revalidateFees(studentId: string) {
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/fees");
  revalidatePath("/admissions");
}

export async function createFeePlan(admissionId: unknown, input: unknown): Promise<FeeResult> {
  const user = await getFeeManager();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(admissionId);
  const parsed = feePlanSchema.safeParse(input);
  if (!id.success) return { ok: false, error: NOT_FOUND };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { discount, instalmentCount, firstDueDate, intervalDays } = parsed.data;

  try {
    const admission = await db.admission.findFirst({
      where: { id: id.data, status: { not: "CANCELLED" }, student: { deletedAt: null } },
      include: { course: true },
    });
    if (!admission) return { ok: false, error: NOT_FOUND };
    if (admission.feePlanId) return { ok: false, error: "This admission already has a fee plan." };
    if (discount > admission.course.fee) return { ok: false, error: "The discount can't be more than the course fee." };

    const plan = { totalAmount: admission.course.fee, discountAmount: discount, gstRateBps: admission.course.gstRateBps };
    const amounts = splitIntoInstalments(payableAmount(plan), instalmentCount);

    await db.$transaction(async (tx) => {
      const created = await tx.feePlan.create({
        data: {
          ...plan,
          studentId: admission.studentId,
          courseId: admission.courseId,
          createdById: user.id,
          instalments: {
            create: amounts.map((amount, index) => ({
              sequence: index + 1,
              amount,
              dueDate: endOfIndiaDay(addDaysToKey(firstDueDate, index * intervalDays)),
            })),
          },
        },
      });
      await tx.admission.update({ where: { id: admission.id }, data: { feePlanId: created.id } });
      await recordAudit(tx, {
        actorId: user.id,
        action: "fee_plan.created",
        entityType: "FeePlan",
        entityId: created.id,
        after: { studentId: admission.studentId, discount, instalmentCount, payable: payableAmount(plan) },
      });
    });
    revalidateFees(admission.studentId);
    return { ok: true };
  } catch (error) {
    console.error("createFeePlan failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function cancelFeePlan(id: unknown): Promise<FeeResult> {
  const user = await getFeeManager();
  if (!user) return { ok: false, error: NO_ACCESS };
  const planId = idSchema.safeParse(id);
  if (!planId.success) return { ok: false, error: NOT_FOUND };

  try {
    const plan = await db.feePlan.findFirst({
      where: { id: planId.data, cancelledAt: null },
      include: { payments: { where: { deletedAt: null }, select: { id: true } }, admission: { select: { id: true, status: true } } },
    });
    if (!plan) return { ok: false, error: NOT_FOUND };
    if (plan.payments.length > 0) return { ok: false, error: "Cancel this plan's payments first." };
    if (plan.admission?.status === "CONFIRMED") {
      return { ok: false, error: "Move this student out of Enrolled before cancelling their fee plan." };
    }

    await db.$transaction(async (tx) => {
      const now = new Date();
      await tx.feePlan.update({ where: { id: plan.id }, data: { cancelledAt: now } });
      await tx.instalment.updateMany({ where: { feePlanId: plan.id }, data: { cancelledAt: now } });
      if (plan.admission) await tx.admission.update({ where: { id: plan.admission.id }, data: { feePlanId: null } });
      await recordAudit(tx, { actorId: user.id, action: "fee_plan.cancelled", entityType: "FeePlan", entityId: plan.id });
    });
    revalidateFees(plan.studentId);
    return { ok: true };
  } catch (error) {
    console.error("cancelFeePlan failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

class PaymentRefused extends Error {}

export async function recordPayment(feePlanId: unknown, input: unknown): Promise<FeeResult> {
  const user = await getFeeManager();
  if (!user) return { ok: false, error: NO_ACCESS };
  const id = idSchema.safeParse(feePlanId);
  const parsed = paymentSchema.safeParse(input);
  if (!id.success) return { ok: false, error: NOT_FOUND };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const { amount, method, reference, paidOn, notes } = parsed.data;

  const now = new Date();
  if (paidOn > indiaDateKey(now)) return { ok: false, error: "The payment date can't be in the future." };
  if (method !== "CASH" && !reference) return { ok: false, error: "Enter the transaction reference." };

  try {
    const org = await db.orgSettings.findUnique({ where: { id: "default" } });
    if (!org) return { ok: false, error: "Add your organisation's details in Settings before recording payments." };

    const paymentId = await db.$transaction(async (tx) => {
      // Held to the end, so payments can't overspend a plan or share a receipt number.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECEIPT_LOCK})`;

      const plan = await tx.feePlan.findFirst({
        where: { id: id.data, cancelledAt: null, student: { deletedAt: null } },
        include: {
          student: { select: { name: true } },
          course: { select: { name: true } },
          instalments: { where: { cancelledAt: null }, orderBy: { sequence: "asc" } },
          payments: { where: { deletedAt: null }, select: { amount: true } },
        },
      });
      if (!plan) throw new PaymentRefused(NOT_FOUND);

      const paid = plan.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const balance = payableAmount(plan) - paid;
      if (amount > balance) {
        throw new PaymentRefused(`That's more than the ${formatRupees(balance)} still owed on this plan.`);
      }

      // Recorded against the earliest instalment this money starts paying off.
      let running = paid;
      const instalment = plan.instalments.find((item) => {
        running -= item.amount;
        return running < 0;
      });

      const payment = await tx.payment.create({
        data: {
          feePlanId: plan.id,
          instalmentId: instalment?.id,
          amount,
          method,
          reference,
          notes,
          // Noon, so the date reads the same in any time zone.
          paidAt: new Date(dateKeyStart(paidOn).getTime() + 12 * 60 * 60 * 1000),
          recordedById: user.id,
        },
      });

      const financialYear = financialYearOf(now);
      const latest = await tx.receipt.aggregate({ where: { financialYear }, _max: { sequence: true } });
      const sequence = (latest._max.sequence ?? 0) + 1;
      await tx.receipt.create({
        data: {
          paymentId: payment.id,
          number: `${org.receiptPrefix}/${financialYear}/${String(sequence).padStart(4, "0")}`,
          financialYear,
          sequence,
          issuedAt: now,
          orgName: org.legalName ?? org.name,
          orgAddress: org.address,
          orgGstin: org.gstin,
          studentName: plan.student.name,
          courseName: plan.course.name,
          gstRateBps: plan.gstRateBps,
          totalAmount: amount,
          ...splitGst(amount, plan.gstRateBps),
        },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "payment.recorded",
        entityType: "Payment",
        entityId: payment.id,
        after: { amount, method, feePlanId: plan.id },
      });
      revalidateFees(plan.studentId);
      return payment.id;
    }, LOCKED_TRANSACTION);
    return { ok: true, paymentId };
  } catch (error) {
    if (error instanceof PaymentRefused) return { ok: false, error: error.message };
    console.error("recordPayment failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** The payment and its receipt stay on record. An issued receipt number is never reused. */
export async function cancelPayment(id: unknown, reason: unknown): Promise<FeeResult> {
  const user = await getFeeManager();
  if (!user) return { ok: false, error: NO_ACCESS };
  const paymentId = idSchema.safeParse(id);
  const parsedReason = z.string().trim().min(3).max(300).safeParse(reason);
  if (!paymentId.success) return { ok: false, error: NOT_FOUND };
  if (!parsedReason.success) return { ok: false, error: "Enter a reason for cancelling this payment." };

  try {
    const payment = await db.payment.findFirst({
      where: { id: paymentId.data },
      include: { feePlan: { select: { studentId: true } } },
    });
    if (!payment) return { ok: false, error: NOT_FOUND };

    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } });
      await recordAudit(tx, {
        actorId: user.id,
        action: "payment.cancelled",
        entityType: "Payment",
        entityId: payment.id,
        before: { amount: payment.amount },
        after: { reason: parsedReason.data },
      });
    });
    revalidateFees(payment.feePlan.studentId);
    return { ok: true };
  } catch (error) {
    console.error("cancelPayment failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
