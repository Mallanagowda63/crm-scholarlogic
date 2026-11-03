import type { CurrentUser } from "@/lib/session";
import { recordAudit, type Tx } from "@/server/audit";

export type StageKey = "DEMO_SCHEDULED" | "DEMO_ATTENDED" | "ADMITTED";

/** Moves someone forward to a built-in stage, but never backward from a later one. */
export async function advanceToStage(tx: Tx, user: CurrentUser, studentId: string, stageKey: StageKey) {
  const [student, target] = await Promise.all([
    tx.student.findUniqueOrThrow({ where: { id: studentId }, include: { stage: true } }),
    tx.pipelineStage.findUnique({ where: { key: stageKey } }),
  ]);
  if (!target || student.stage.type !== "OPEN" || student.stage.position >= target.position) return;

  await tx.student.update({ where: { id: studentId }, data: { stageId: target.id } });
  await tx.activity.create({
    data: {
      studentId,
      type: "STAGE_CHANGE",
      body: `Stage changed from ${student.stage.name} to ${target.name}`,
      metadata: { from: student.stage.name, to: target.name },
      actorId: user.id,
    },
  });
  await recordAudit(tx, {
    actorId: user.id,
    action: "lead.stage_changed",
    entityType: "Student",
    entityId: studentId,
    before: { stage: student.stage.name },
    after: { stage: target.name },
  });
}

// One lock number for seat counting, so two enrolments can't both take the last seat.
const SEAT_LOCK = 727002;

/** Work that waits its turn for a lock needs longer than the default 5 seconds, or a busy moment makes it fail. */
export const LOCKED_TRANSACTION = { maxWait: 10_000, timeout: 30_000 };

export class EnrolmentError extends Error {}

/**
 * Takes a seat for someone moving to Enrolled. They need an admission with a
 * batch and fee plan, and the batch needs room.
 */
export async function takeSeat(tx: Tx, studentId: string) {
  const admission = await tx.admission.findFirst({
    where: { studentId, status: { not: "CANCELLED" } },
    orderBy: { admissionDate: "desc" },
    include: { student: { select: { name: true } }, batch: { select: { id: true, name: true, capacity: true } } },
  });
  const name = admission?.student.name;
  if (!admission) {
    const student = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { name: true } });
    throw new EnrolmentError(`${student.name} needs an admission and a fee plan before enrolling.`);
  }
  if (!admission.feePlanId) throw new EnrolmentError(`${name} needs a fee plan before enrolling.`);
  if (!admission.batch) throw new EnrolmentError(`Choose a batch for ${name} before enrolling.`);

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEAT_LOCK})`;
  const existing = await tx.enrollment.findUnique({
    where: { studentId_batchId: { studentId, batchId: admission.batch.id } },
  });
  if (existing?.status !== "ACTIVE") {
    const filled = await tx.enrollment.count({ where: { batchId: admission.batch.id, status: "ACTIVE" } });
    if (filled >= admission.batch.capacity) throw new EnrolmentError(`${admission.batch.name} is full.`);
  }

  await tx.enrollment.upsert({
    where: { studentId_batchId: { studentId, batchId: admission.batch.id } },
    update: { status: "ACTIVE" },
    create: { studentId, batchId: admission.batch.id },
  });
  await tx.admission.update({ where: { id: admission.id }, data: { status: "CONFIRMED" } });
}

/** Frees the seat when someone leaves Enrolled. */
export async function releaseSeat(tx: Tx, studentId: string) {
  await tx.enrollment.updateMany({ where: { studentId, status: "ACTIVE" }, data: { status: "WITHDRAWN" } });
  await tx.admission.updateMany({ where: { studentId, status: "CONFIRMED" }, data: { status: "PENDING" } });
}
