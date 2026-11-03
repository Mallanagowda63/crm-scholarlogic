import { expect, test } from "@playwright/test";

import { db as appDb } from "../src/lib/db";
import { db } from "./helpers";

// Runs first, while the data is exactly what the seed script produced.
test.describe("sample data", () => {
  const load = () =>
    db.student.findMany({
      where: { deletedAt: null },
      include: {
        stage: true,
        targetExam: true,
        courseInterest: true,
        demoClasses: true,
        activities: true,
        tasks: true,
        enrollments: { include: { batch: true } },
        admissions: { include: { checklistItems: true, batch: true } },
        feePlans: { include: { instalments: { include: { payments: { include: { receipt: true } } } }, admission: true } },
      },
    });

  test("uses the coaching pipeline, in order", async () => {
    const stages = await db.pipelineStage.findMany({ orderBy: { position: "asc" } });
    expect(stages.map((stage) => stage.name)).toEqual([
      "New",
      "Contacted",
      "Demo Scheduled",
      "Demo Attended",
      "Interested",
      "Admitted",
      "Enrolled",
      "Lost",
    ]);
    expect(stages.filter((stage) => stage.type !== "OPEN").map((stage) => `${stage.name}:${stage.type}`)).toEqual([
      "Enrolled:WON",
      "Lost:LOST",
    ]);
  });

  test("has 120 live students and 2 soft-deleted", async () => {
    expect(await db.student.count({ where: { deletedAt: null } })).toBe(120);
    expect(await db.student.count()).toBe(122);
    expect(await appDb.student.count()).toBe(120);
  });

  test("students have sensible coaching details", async () => {
    const students = await load();
    for (const student of students) {
      expect(student.currentClass).toBeTruthy();
      expect(student.targetExam).toBeTruthy();
      expect(student.phone).toMatch(/^\+91[6-9]\d{9}$/);
      if (student.email) expect(student.email).toMatch(/@example\.com$/);
      if (student.currentClass === "Dropper") {
        expect(student.board).toBeNull();
        expect(student.schoolName).toBeNull();
      } else {
        expect(student.board).toBeTruthy();
        expect(student.schoolName).toBeTruthy();
      }
      const code = student.courseInterest!.code;
      if (code.endsWith("-2Y")) expect(student.currentClass).toBe("11th");
      else if (code === "FND-10") expect(["9th", "10th"]).toContain(student.currentClass);
      else expect(["12th", "Dropper"]).toContain(student.currentClass);
    }
    const parents = students.map((student) => student.parentPhone);
    expect(new Set(parents).size).toBeLessThan(parents.length);
  });

  test("demo classes match each student's stage", async () => {
    const students = await load();
    const position = (student: (typeof students)[number]) => student.stage.position;
    const open = students.filter((student) => student.stage.type !== "LOST");

    for (const student of open.filter((s) => position(s) < 2)) expect(student.demoClasses).toHaveLength(0);
    for (const student of open.filter((s) => s.stage.name === "Demo Scheduled")) {
      expect(student.demoClasses).toHaveLength(1);
      expect(student.demoClasses[0].attended).toBeNull();
      expect(student.demoClasses[0].scheduledAt.getTime()).toBeGreaterThan(Date.now());
    }
    for (const student of open.filter((s) => position(s) >= 3)) {
      expect(student.demoClasses[0].attended).toBe(true);
      expect(student.demoClasses[0].feedback).toBeTruthy();
    }
    for (const student of students) {
      expect(student.activities.filter((a) => a.type === "DEMO_CLASS")).toHaveLength(student.demoClasses.length);
    }
  });

  test("batches have timing, mode and branch", async () => {
    const batches = await db.batch.findMany({ include: { enrollments: true } });
    for (const batch of batches) {
      expect(batch.timing).toBeTruthy();
      expect(batch.branchId === null).toBe(batch.mode === "ONLINE");
      expect(batch.enrollments.length).toBeLessThanOrEqual(batch.capacity);
    }
    expect(new Set(batches.map((batch) => batch.mode)).size).toBe(3);
  });

  test("only Admitted and Enrolled have an admission, each with a fee plan and checklist", async () => {
    const students = await load();
    for (const student of students) {
      const shouldHave = ["Admitted", "Enrolled"].includes(student.stage.name);
      expect(student.admissions).toHaveLength(shouldHave ? 1 : 0);
      expect(student.feePlans).toHaveLength(shouldHave ? 1 : 0);
      if (shouldHave) {
        const [admission] = student.admissions;
        expect(admission.feePlanId).toBe(student.feePlans[0].id);
        expect(admission.courseId).toBe(student.courseInterestId);
        expect(admission.checklistItems.length).toBeGreaterThan(0);
        expect(admission.status).toBe(student.stage.name === "Enrolled" ? "CONFIRMED" : "PENDING");
      }
    }
    expect(students.filter((s) => s.stage.name === "Admitted").some((s) => s.admissions[0].batchId === null)).toBe(true);
  });

  test("enrolled students hold a seat in the batch on their admission", async () => {
    const students = await load();
    for (const student of students) {
      if (student.stage.type === "WON") {
        expect(student.enrollments).toHaveLength(1);
        expect(student.enrollments[0].batchId).toBe(student.admissions[0].batchId);
        expect(student.enrollments[0].batch.courseId).toBe(student.courseInterestId);
      } else {
        expect(student.enrollments).toHaveLength(0);
      }
    }
  });

  test("follow-up and contact dates are consistent", async () => {
    const students = await load();
    for (const student of students) {
      expect(student.stage.type === "LOST").toBe(Boolean(student.lostReason));
      if (student.stage.type === "OPEN") {
        const task = student.tasks.find((t) => t.status === "OPEN");
        expect(student.nextFollowUpAt?.getTime()).toBe(task?.dueAt.getTime());
      } else {
        expect(student.nextFollowUpAt).toBeNull();
      }
      if (student.stage.position > 0) {
        const contact = student.activities.filter((a) => ["CALL", "EMAIL", "WHATSAPP"].includes(a.type));
        expect(student.lastContactedAt?.getTime()).toBe(Math.max(...contact.map((a) => a.occurredAt.getTime())));
      }
    }
  });

  test("fees, payments and receipts add up", async () => {
    const students = await load();
    const plans = students.flatMap((student) => student.feePlans);
    expect(plans.length).toBeGreaterThan(0);

    for (const plan of plans) {
      const expected = Math.round(((plan.totalAmount - plan.discountAmount) * (10000 + plan.gstRateBps)) / 10000);
      expect(plan.instalments.reduce((sum, instalment) => sum + instalment.amount, 0)).toBe(expected);
      for (const instalment of plan.instalments) {
        for (const payment of instalment.payments) {
          const receipt = payment.receipt!;
          expect(payment.amount).toBe(instalment.amount);
          expect(receipt.taxableAmount + receipt.cgstAmount + receipt.sgstAmount + receipt.igstAmount).toBe(receipt.totalAmount);
          expect(receipt.totalAmount).toBe(payment.amount);
          expect(Math.abs(receipt.cgstAmount - receipt.sgstAmount)).toBeLessThanOrEqual(1);
        }
      }
    }

    const overdue = plans
      .flatMap((plan) => plan.instalments)
      .filter((instalment) => instalment.dueDate.getTime() < Date.now() && instalment.payments.length === 0);
    expect(overdue.length).toBeGreaterThan(0);

    const receipts = await db.receipt.findMany({
      orderBy: [{ financialYear: "asc" }, { sequence: "asc" }],
      include: { payment: true },
    });
    for (const year of new Set(receipts.map((receipt) => receipt.financialYear))) {
      const inYear = receipts.filter((receipt) => receipt.financialYear === year);
      inYear.forEach((receipt, index) => {
        expect(receipt.sequence).toBe(index + 1);
        if (index > 0) expect(receipt.payment.paidAt.getTime()).toBeGreaterThanOrEqual(inYear[index - 1].payment.paidAt.getTime());
      });
    }
  });
});

test.describe("database rules", () => {
  test("a demo class needs a batch or a course", async () => {
    const student = await db.student.findFirstOrThrow({ where: { assignedToId: { not: null } } });
    await expect(
      db.demoClass.create({
        data: { studentId: student.id, scheduledAt: new Date(), counsellorId: student.assignedToId! },
      }),
    ).rejects.toThrow(/DemoClass_batch_or_course/);
  });

  test("soft-deleted students are hidden everywhere until restored", async () => {
    const target = await appDb.student.findFirstOrThrow({ where: { stage: { name: "New" } } });
    const before = await appDb.student.count();

    await appDb.student.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
    expect(await appDb.student.count()).toBe(before - 1);
    expect(await appDb.student.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await appDb.student.findFirst({ where: { id: target.id } })).toBeNull();
    expect(await appDb.student.findMany({ where: { id: target.id } })).toHaveLength(0);
    const groups = await appDb.student.groupBy({ by: ["stageId"], _count: true });
    expect(groups.reduce((sum, group) => sum + group._count, 0)).toBe(before - 1);
    await expect(appDb.student.update({ where: { id: target.id }, data: { city: "X" } })).rejects.toThrow();
    expect((await appDb.student.findFirst({ where: { id: target.id, deletedAt: { not: null } } }))?.id).toBe(target.id);

    await appDb.student.update({ where: { id: target.id, deletedAt: { not: null } }, data: { deletedAt: null } });
    expect(await appDb.student.count()).toBe(before);
  });

  test("admissions and payments soft-delete too", async () => {
    const admission = await appDb.admission.findFirstOrThrow();
    await appDb.admission.update({ where: { id: admission.id }, data: { deletedAt: new Date() } });
    expect(await appDb.admission.findUnique({ where: { id: admission.id } })).toBeNull();
    await appDb.admission.update({ where: { id: admission.id, deletedAt: { not: null } }, data: { deletedAt: null } });

    const payment = await appDb.payment.findFirstOrThrow();
    await appDb.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } });
    expect(await appDb.payment.findUnique({ where: { id: payment.id } })).toBeNull();
    await appDb.payment.update({ where: { id: payment.id, deletedAt: { not: null } }, data: { deletedAt: null } });
  });

  test("the app refuses hard deletes", async () => {
    const student = await appDb.student.findFirstOrThrow();
    await expect(appDb.student.delete({ where: { id: student.id } })).rejects.toThrow(/can't be hard-deleted/);
    await expect(appDb.student.deleteMany()).rejects.toThrow(/can't be hard-deleted/);
    await expect(appDb.admission.deleteMany()).rejects.toThrow(/can't be hard-deleted/);
    await expect(appDb.payment.deleteMany()).rejects.toThrow(/can't be hard-deleted/);
  });

  for (const table of ["Student", "AcademicRecord", "Admission", "Payment", "FeePlan", "Instalment", "Receipt"]) {
    test(`the database blocks raw DELETE on ${table}`, async () => {
      const before = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM "${table}"`);
      await expect(db.$executeRawUnsafe(`DELETE FROM "${table}"`)).rejects.toThrow(/cannot be deleted/);
      const after = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM "${table}"`);
      expect(after[0].n).toBe(before[0].n);
    });
  }

  test("the database blocks raw DELETE on Document", async () => {
    // The seed has no documents, because it has no files to attach.
    const student = await db.student.findFirstOrThrow();
    const document = await db.document.create({
      data: { studentId: student.id, type: "Other", fileName: "test.pdf", fileUrl: "test.pdf", deletedAt: new Date() },
    });
    await expect(db.$executeRawUnsafe(`DELETE FROM "Document" WHERE id = '${document.id}'`)).rejects.toThrow(/cannot be deleted/);
  });

  test("totals above ₹2.1 crore sum correctly", async () => {
    const plan = await db.feePlan.findFirstOrThrow();
    const recorder = await db.user.findFirstOrThrow({ where: { role: "ACCOUNTS" } });
    let total: number | null = null;
    await expect(
      db.$transaction(async (tx) => {
        for (let i = 0; i < 3; i += 1) {
          await tx.payment.create({
            data: { feePlanId: plan.id, amount: 2_000_000_000, method: "CASH", paidAt: new Date(), recordedById: recorder.id },
          });
        }
        total = (await tx.payment.aggregate({ _sum: { amount: true } }))._sum.amount;
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(total).toBeGreaterThan(6_000_000_000);
  });
});
