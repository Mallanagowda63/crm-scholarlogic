import { expect, test, type Browser, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { amountInWords, splitGst, splitIntoInstalments, summarisePlan } from "../src/lib/fees";
import { db, emailOf, expectToast, newSignedInContext, noHorizontalScroll, signIn, watchForErrors } from "./helpers";

const DAY = 86_400_000;
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;
const stageId = async (name: string) => (await db.pipelineStage.findUniqueOrThrow({ where: { name } })).id;
const india = (date: Date) => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

let lastStamp = 0;
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `+918${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};

async function makeLead(name: string, owner = "counsellor", stage = "Interested") {
  return db.student.create({
    data: { name, phone: newPhone(), stageId: await stageId(stage), assignedToId: await userId(owner) },
  });
}

const course = (code = "FND-10") => db.course.findUniqueOrThrow({ where: { code }, include: { batches: true } });

/** A lead with an admission and fee plan of 3 instalments, ready for payments. */
async function makeAdmitted(name: string, options: { owner?: string; daysUntilFirstDue?: number; withBatch?: boolean; withPlan?: boolean } = {}) {
  const student = await makeLead(name, options.owner ?? "counsellor", "Admitted");
  const theCourse = await course();
  const withPlan = options.withPlan ?? true;
  const plan = withPlan
    ? await db.feePlan.create({
        data: {
          studentId: student.id,
          courseId: theCourse.id,
          totalAmount: theCourse.fee,
          gstRateBps: theCourse.gstRateBps,
          instalments: {
            create: splitIntoInstalments(Math.round((theCourse.fee * 11800) / 10000), 3).map((amount, index) => ({
              sequence: index + 1,
              amount,
              dueDate: new Date(Date.now() + ((options.daysUntilFirstDue ?? 10) + index * 30) * DAY),
            })),
          },
        },
      })
    : null;
  const admission = await db.admission.create({
    data: {
      studentId: student.id,
      courseId: theCourse.id,
      batchId: options.withBatch === false ? null : theCourse.batches[0].id,
      admissionDate: new Date(),
      feePlanId: plan?.id,
      checklistItems: { create: [{ name: "Student ID proof" }, { name: "Scholarship result", isRequired: false }] },
    },
  });
  return { student, plan, admission, course: theCourse };
}

const tab = (id: string, name: string) => `/students/${id}?tab=${name}`;

test.describe("fee calculations", () => {
  test("GST splits add up exactly, whatever the amount", () => {
    for (const amount of [1, 2, 99, 100, 101, 1999, 2124000, 7654321]) {
      const { taxableAmount, cgstAmount, sgstAmount } = splitGst(amount, 1800);
      expect(taxableAmount + cgstAmount + sgstAmount).toBe(amount);
      expect(Math.abs(cgstAmount - sgstAmount)).toBeLessThanOrEqual(1);
    }
  });

  test("instalments add up exactly, with leftovers on the last", () => {
    expect(splitIntoInstalments(100, 3)).toEqual([33, 33, 34]);
    for (const [payable, count] of [[5664000, 3], [1, 2], [999999, 7], [100, 1]]) {
      expect(splitIntoInstalments(payable, count).reduce((sum, value) => sum + value, 0)).toBe(payable);
    }
  });

  test("payments count toward the earliest instalments first", () => {
    const now = new Date("2027-01-15T00:00:00Z");
    const plan = {
      totalAmount: 30000,
      discountAmount: 0,
      gstRateBps: 0,
      instalments: [
        { amount: 10000, dueDate: new Date("2027-01-01T00:00:00Z") },
        { amount: 10000, dueDate: new Date("2027-01-10T00:00:00Z") },
        { amount: 10000, dueDate: new Date("2027-02-01T00:00:00Z") },
      ],
      payments: [{ amount: 12500 }],
    };
    const summary = summarisePlan(plan, now);
    expect(summary.instalments.map((item) => item.status)).toEqual(["PAID", "OVERDUE", "UPCOMING"]);
    expect(summary.overdueAmount).toBe(7500);
    expect(summary.balance).toBe(17500);
    const later = summarisePlan({ ...plan, payments: [{ amount: 25000 }] }, now);
    expect(later.instalments.map((item) => item.status)).toEqual(["PAID", "PAID", "PART_PAID"]);
    expect(later.overdueAmount).toBe(0);
  });

  test("amounts in words use the Indian system", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(100)).toBe("Rupees One Only");
    expect(amountInWords(1888000)).toBe("Rupees Eighteen Thousand Eight Hundred Eighty Only");
    expect(amountInWords(21830000)).toBe("Rupees Two Lakh Eighteen Thousand Three Hundred Only");
    expect(amountInWords(12345678950)).toBe(
      "Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and Fifty Paise Only",
    );
  });
});

test.describe("courses and batches", () => {
  test("an admin adds and edits a course, with validation and audit", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/courses", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New course" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save course" }).click();
    await expect(dialog.getByText("Enter the course name")).toBeVisible();

    await dialog.getByLabel("Name").fill("Olympiad Prep");
    await dialog.getByLabel("Code").fill("oly-1");
    await dialog.getByLabel("Duration (months)").fill("6");
    await dialog.getByLabel("Fee before GST (₹)").fill("42,000");
    await dialog.getByRole("button", { name: "Save course" }).click();
    await expectToast(page, "Course added");

    const saved = await db.course.findUniqueOrThrow({ where: { code: "OLY-1" } });
    expect(saved.fee).toBe(4200000);
    expect(saved.gstRateBps).toBe(1800);
    expect(await db.auditLog.count({ where: { entityId: saved.id, action: "course.created" } })).toBe(1);

    await page.getByRole("button", { name: "Edit Olympiad Prep" }).click();
    await expect(dialog.getByLabel("Fee before GST (₹)")).toHaveValue("42000");
    await dialog.getByLabel("Fee before GST (₹)").fill("45000");
    await dialog.getByRole("button", { name: "Save course" }).click();
    await expectToast(page, "Course updated");
    expect((await db.course.findUniqueOrThrow({ where: { code: "OLY-1" } })).fee).toBe(4500000);
  });

  test("course codes must be unique", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/courses", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New course" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Copy Of JEE");
    await dialog.getByLabel("Code").fill("JEE-2Y");
    await dialog.getByLabel("Duration (months)").fill("6");
    await dialog.getByLabel("Fee before GST (₹)").fill("1000");
    await dialog.getByRole("button", { name: "Save course" }).click();
    await expectToast(page, "Another course already uses that code.");
  });

  test("batches show live seats, and capacity can't go below who's enrolled", async ({ page }) => {
    const theCourse = await db.course.create({
      data: { code: `SEAT-${Date.now() % 100000}`, name: `Seat Course ${Date.now()}`, fee: 100000, durationMonths: 3 },
    });
    await signIn(page, "admin");
    await page.goto("/courses", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Add a batch to ${theCourse.name}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Evening Test");
    await dialog.getByLabel(/^Timing/).fill("Mon–Fri 4–6 PM");
    await dialog.getByLabel("Mode").selectOption("HYBRID");
    await dialog.getByLabel("Branch").selectOption({ label: "Indiranagar" });
    await dialog.getByLabel("Start date").fill("2027-06-01");
    await dialog.getByLabel(/^End date/).fill("2027-01-01");
    await dialog.getByLabel("Capacity").fill("2");
    await dialog.getByRole("button", { name: "Save batch" }).click();
    await expect(dialog.getByText("The end date can't be before the start date")).toBeVisible();
    await dialog.getByLabel(/^End date/).fill("");
    await dialog.getByRole("button", { name: "Save batch" }).click();
    await expectToast(page, "Batch added");

    const batch = await db.batch.findFirstOrThrow({ where: { courseId: theCourse.id } });
    expect(batch.mode).toBe("HYBRID");
    expect(india(batch.startDate)).toBe("2027-06-01");

    const students = await Promise.all([makeLead("Seat One Abalone"), makeLead("Seat Two Abalone")]);
    await db.enrollment.createMany({ data: students.map(({ id }) => ({ studentId: id, batchId: batch.id })) });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-batch="Evening Test"]')).toContainText("2 of 2 seats");

    await page.getByRole("button", { name: `Edit Evening Test of ${theCourse.name}` }).click();
    await dialog.getByLabel("Capacity").fill("1");
    await dialog.getByRole("button", { name: "Save batch" }).click();
    await expectToast(page, "This batch already has 2 students, so its capacity can't go below that.");
  });

  test("archived courses stop being offered, and can be restored", async ({ page }) => {
    const theCourse = await db.course.create({
      data: { code: `ARCH-${Date.now() % 100000}`, name: `Archive Course ${Date.now()}`, fee: 100000, durationMonths: 3 },
    });
    await signIn(page, "admin");
    await page.goto("/courses", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Archive ${theCourse.name}` }).click();
    await expectToast(page, `${theCourse.name} archived`);
    expect((await db.course.findUniqueOrThrow({ where: { id: theCourse.id } })).isActive).toBe(false);

    await page.goto("/leads", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Filter by course").locator("option", { hasText: theCourse.name })).toHaveCount(0);

    await page.goto("/courses", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Restore ${theCourse.name}` }).click();
    await expectToast(page, `${theCourse.name} restored`);
  });

  test("a counsellor can look at courses but not change them", async ({ page }) => {
    await signIn(page, "counsellor");
    await page.goto("/courses", { waitUntil: "networkidle" });
    await expect(page.getByRole("region", { name: /JEE Main \+ Advanced \(2-Year\)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "New course" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  });
});

test.describe("admissions", () => {
  test("creating one moves the lead to Admitted and adds the checklist", async ({ page }) => {
    const student = await makeLead("Admission Create Bream");
    const theCourse = await course();
    await signIn(page, "counsellor");
    await page.goto(tab(student.id, "admission"), { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Create admission" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Course").selectOption(theCourse.id);
    await dialog.getByLabel(/^Batch/).selectOption(theCourse.batches[0].id);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expectToast(page, "Admission created");

    const saved = await db.student.findUniqueOrThrow({
      where: { id: student.id },
      include: { stage: true, admissions: { include: { checklistItems: true } } },
    });
    expect(saved.stage.name).toBe("Admitted");
    expect(saved.admissions).toHaveLength(1);
    expect(saved.admissions[0].status).toBe("PENDING");
    expect(saved.admissions[0].checklistItems.length).toBeGreaterThan(3);
    await expect(page.getByRole("button", { name: "Create admission" })).toHaveCount(0);
  });

  test("the batch list follows the chosen course", async ({ page }) => {
    const student = await makeLead("Admission Batch Carp");
    const [first, second] = await Promise.all([course("FND-10"), course("BRD-12")]);
    await signIn(page, "counsellor");
    await page.goto(tab(student.id, "admission"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create admission" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Course").selectOption(first.id);
    await expect(dialog.getByLabel(/^Batch/).locator(`option[value="${first.batches[0].id}"]`)).toHaveCount(1);
    await dialog.getByLabel("Course").selectOption(second.id);
    await expect(dialog.getByLabel(/^Batch/).locator(`option[value="${first.batches[0].id}"]`)).toHaveCount(0);
  });

  test("the checklist can be ticked, and new items added", async ({ page }) => {
    const { student, admission } = await makeAdmitted("Checklist Dace");
    await signIn(page, "counsellor");
    await page.goto(tab(student.id, "admission"), { waitUntil: "networkidle" });
    await expect(page.getByRole("main")).toContainText("0 of 1 required");

    await page.getByRole("checkbox", { name: "Student ID proof" }).click();
    await expectToast(page, "Student ID proof received");
    await expect(page.getByRole("main")).toContainText("1 of 1 required");
    const item = await db.checklistItem.findFirstOrThrow({ where: { admissionId: admission.id, name: "Student ID proof" } });
    expect(item.completedAt).not.toBeNull();

    await page.getByLabel("New document name").fill("Transfer certificate");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Transfer certificate" })).toBeVisible();
  });

  test("enrolling needs a fee plan and a batch, and takes a seat", async ({ page }) => {
    const noPlan = await makeAdmitted("Enrol No Plan Eel", { withPlan: false });
    await signIn(page, "counsellor");
    await page.goto(tab(noPlan.student.id, "admission"), { waitUntil: "networkidle" });
    await expect(page.getByRole("main")).toContainText("Enrolling needs a fee plan from accounts");
    await page.getByRole("button", { name: "Enrol student" }).click();
    await expectToast(page, "Enrol No Plan Eel needs a fee plan before enrolling.");

    const noBatch = await makeAdmitted("Enrol No Batch Eel", { withBatch: false });
    await page.goto(tab(noBatch.student.id, "admission"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enrol student" }).click();
    await expectToast(page, "Choose a batch for Enrol No Batch Eel before enrolling.");
    expect(await db.enrollment.count({ where: { studentId: noBatch.student.id } })).toBe(0);

    const ready = await makeAdmitted("Enrol Ready Eel");
    await page.goto(tab(ready.student.id, "admission"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enrol student" }).click();
    await expectToast(page, "Enrolled");
    const saved = await db.student.findUniqueOrThrow({
      where: { id: ready.student.id },
      include: { stage: true, enrollments: true, admissions: true },
    });
    expect(saved.stage.type).toBe("WON");
    expect(saved.enrollments[0].status).toBe("ACTIVE");
    expect(saved.admissions[0].status).toBe("CONFIRMED");
    await expect(page.getByLabel("Breadcrumb").getByRole("link", { name: "Students" })).toBeVisible();
  });

  test("a full batch refuses the next student, and leaving Enrolled frees the seat", async ({ page }) => {
    const theCourse = await course();
    const batch = await db.batch.create({ data: { courseId: theCourse.id, name: `Tiny ${Date.now()}`, startDate: new Date(), capacity: 1 } });
    const first = await makeAdmitted("Seat First Fugu");
    const second = await makeAdmitted("Seat Second Fugu");
    await db.admission.updateMany({ where: { id: { in: [first.admission.id, second.admission.id] } }, data: { batchId: batch.id } });

    await signIn(page, "counsellor");
    await page.goto(tab(first.student.id, "admission"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enrol student" }).click();
    await expectToast(page, "Enrolled");

    await page.goto(tab(second.student.id, "admission"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enrol student" }).click();
    await expectToast(page, `${batch.name} is full.`);

    await page.goto(`/students/${first.student.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Actions for Seat First Fugu" }).click();
    await page.getByRole("menuitem", { name: "Admitted" }).click();
    await expectToast(page, "Seat First Fugu moved to Admitted");
    const enrollment = await db.enrollment.findFirstOrThrow({ where: { studentId: first.student.id } });
    expect(enrollment.status).toBe("WITHDRAWN");
    expect((await db.admission.findUniqueOrThrow({ where: { id: first.admission.id } })).status).toBe("PENDING");

    await page.goto(tab(second.student.id, "admission"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enrol student" }).click();
    await expectToast(page, "Enrolled");
  });

  test("two people can't take the last seat at once", async ({ browser }) => {
    const theCourse = await course();
    const batch = await db.batch.create({ data: { courseId: theCourse.id, name: `Race ${Date.now()}`, startDate: new Date(), capacity: 1 } });
    const people = await Promise.all(["Race A Gar", "Race B Gar", "Race C Gar"].map((name) => makeAdmitted(name)));
    await db.admission.updateMany({ where: { id: { in: people.map((person) => person.admission.id) } }, data: { batchId: batch.id } });

    const sessions = await Promise.all(people.map(async (person) => {
      const session = await newSignedInContext(browser, "counsellor");
      await session.page.goto(tab(person.student.id, "admission"), { waitUntil: "networkidle" });
      return session;
    }));
    await Promise.all(sessions.map(({ page }) => page.getByRole("button", { name: "Enrol student" }).click()));
    await Promise.all(sessions.map(({ page }) => expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 })));
    expect(await db.enrollment.count({ where: { batchId: batch.id, status: "ACTIVE" } })).toBe(1);
    await Promise.all(sessions.map(({ context }) => context.close()));
  });

  test("cancelling is refused while a fee plan exists, and works once it's gone", async ({ page }) => {
    const { student, admission } = await makeAdmitted("Cancel Admission Hake");
    await signIn(page, "admin");
    await page.goto(tab(student.id, "admission"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Cancel admission", exact: true }).click();
    await expectToast(page, /Cancel the fee plan first/);

    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Cancel fee plan", exact: true }).click();
    await expectToast(page, "Fee plan cancelled");

    await page.goto(tab(student.id, "admission"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Cancel admission", exact: true }).click();
    await expectToast(page, "Admission cancelled");
    expect((await db.admission.findUniqueOrThrow({ where: { id: admission.id } })).status).toBe("CANCELLED");
    await expect(page.getByRole("button", { name: "Create admission" })).toBeVisible();
  });

  test("the list filters by status, and counsellors see only their own", async ({ page }) => {
    const { student } = await makeAdmitted("List Own Ide", { owner: "counsellor" });
    await makeAdmitted("List Other Ide", { owner: "kavya" });
    await signIn(page, "counsellor");
    await page.goto("/admissions?q=Ide", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: "List Own Ide" })).toHaveAttribute("href", `/students/${student.id}?tab=admission`);
    await expect(page.getByRole("link", { name: "List Other Ide" })).toHaveCount(0);

    await page.getByLabel("Filter by status").selectOption("CANCELLED");
    await expect(page.getByText("No admissions match these filters")).toBeVisible();
  });
});

test.describe("fee plans", () => {
  test("accounts sets up a plan with a live preview and correct totals", async ({ page }) => {
    const { student, admission, course: theCourse } = await makeAdmitted("Plan Create Jack", { withPlan: false });
    await signIn(page, "accounts");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Set up fee plan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Discount (₹)").fill("3,000");
    await dialog.getByLabel("Instalments").fill("4");
    await dialog.getByLabel("First due date").fill("2027-01-31");
    await dialog.getByLabel("Days between").fill("30");
    const payable = Math.round(((theCourse.fee - 300000) * 11800) / 10000);
    await expect(dialog.getByLabel("Instalment preview")).toContainText(rupees(payable));
    await dialog.getByRole("button", { name: "Create plan" }).click();
    await expectToast(page, "Fee plan created");

    const saved = await db.admission.findUniqueOrThrow({
      where: { id: admission.id },
      include: { feePlan: { include: { instalments: { orderBy: { sequence: "asc" } } } } },
    });
    const plan = saved.feePlan!;
    expect(plan.discountAmount).toBe(300000);
    expect(plan.instalments).toHaveLength(4);
    expect(plan.instalments.reduce((sum, item) => sum + item.amount, 0)).toBe(payable);
    expect(india(plan.instalments[0].dueDate)).toBe("2027-01-31");
    expect(india(plan.instalments[1].dueDate)).toBe("2027-03-02");
    await expect(page.getByLabel(/Fee summary for/)).toContainText(rupees(payable));
  });

  test("a due date lasts all of that day in India", async ({ page }) => {
    const { student, plan } = await makeAdmitted("Due Today Koi");
    const today = india(new Date());
    const endOfToday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 330 * 60_000 + DAY - 1);
    await db.instalment.updateMany({ where: { feePlanId: plan!.id, sequence: 1 }, data: { dueDate: endOfToday } });
    await signIn(page, "accounts");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });
    await expect(page.locator('[data-instalment="1"]')).toContainText("Upcoming");
  });

  test("a discount can't exceed the fee, and a counsellor can't set up plans", async ({ page }) => {
    const { student, course: theCourse } = await makeAdmitted("Plan Limit Ling", { withPlan: false });
    await signIn(page, "admin");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Set up fee plan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Discount (₹)").fill(String(theCourse.fee / 100 + 1));
    await dialog.getByRole("button", { name: "Create plan" }).click();
    await expectToast(page, "The discount can't be more than the course fee.");
  });

  test("counsellors see payments but can't record them", async ({ page }) => {
    const { student } = await makeAdmitted("Read Only Mullet");
    await signIn(page, "counsellor");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });
    await expect(page.getByLabel(/Fee summary for/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel fee plan" })).toHaveCount(0);
  });
});

test.describe("payments and receipts", () => {
  async function pay(page: Page, amount: string, options: { method?: string; reference?: string } = {}) {
    await page.getByRole("button", { name: "Record payment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount (₹)").fill(amount);
    await dialog.getByLabel("Method").selectOption(options.method ?? "UPI");
    await dialog.getByLabel("Reference").fill(options.reference ?? "UPI12345");
    await dialog.getByRole("button", { name: "Save payment" }).click();
  }

  test("a part payment updates the balance, instalments and creates a correct receipt", async ({ page }) => {
    const { student, plan, course: theCourse } = await makeAdmitted("Part Pay Marlin");
    const payable = Math.round((theCourse.fee * 11800) / 10000);
    await signIn(page, "accounts");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });

    await pay(page, "5,000");
    await expectToast(page, "Payment recorded");
    await expect(page.getByLabel(/Fee summary for/)).toContainText(rupees(payable - 500000));
    await expect(page.locator('[data-instalment="1"]')).toContainText("Part paid");

    const payment = await db.payment.findFirstOrThrow({ where: { feePlanId: plan!.id }, include: { receipt: true } });
    expect(payment.amount).toBe(500000);
    expect(payment.recordedById).toBe(await userId("accounts"));
    const receipt = payment.receipt!;
    expect(receipt.number).toMatch(/^THETA\/\d{4}-\d{2}\/\d{4}$/);
    expect(receipt.studentName).toBe("Part Pay Marlin");
    expect(receipt.courseName).toBe(theCourse.name);
    expect(receipt.totalAmount).toBe(500000);
    expect(receipt.taxableAmount + receipt.cgstAmount + receipt.sgstAmount).toBe(500000);
    expect(receipt.gstRateBps).toBe(1800);
    expect(receipt.orgGstin).toBeTruthy();
    expect(await db.auditLog.count({ where: { entityId: payment.id, action: "payment.recorded" } })).toBe(1);
  });

  test("can't pay more than what's owed, in the future, or without a reference", async ({ page }) => {
    const { student, plan, course: theCourse } = await makeAdmitted("Pay Limit Nase");
    const payable = Math.round((theCourse.fee * 11800) / 10000);
    await signIn(page, "accounts");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });

    await pay(page, String(payable / 100 + 1));
    await expectToast(page, /more than the .* still owed/);

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount (₹)").fill("100");
    await dialog.getByLabel("Reference").fill("");
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expectToast(page, "Enter the transaction reference.");

    await dialog.getByLabel("Reference").fill("REF1");
    await dialog.getByLabel("Paid on").fill(india(new Date(Date.now() + 3 * DAY)));
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expectToast(page, "The payment date can't be in the future.");
    expect(await db.payment.count({ where: { feePlanId: plan!.id } })).toBe(0);
  });

  test("cash doesn't need a reference, and full payment removes the button", async ({ page }) => {
    const { student, plan, course: theCourse } = await makeAdmitted("Cash Pay Orfe");
    const payable = Math.round((theCourse.fee * 11800) / 10000);
    await signIn(page, "admin");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });
    await pay(page, String(payable / 100), { method: "CASH", reference: "" });
    await expectToast(page, "Payment recorded");
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    for (const sequence of [1, 2, 3]) await expect(page.locator(`[data-instalment="${sequence}"]`)).toContainText("Paid");
    expect((await db.payment.findFirstOrThrow({ where: { feePlanId: plan!.id } })).reference).toBeNull();
  });

  test("receipt numbers are sequential, never reused, and don't clash in a burst", async ({ browser }) => {
    const people = await Promise.all(["Number A Perch", "Number B Perch", "Number C Perch"].map((name) => makeAdmitted(name)));
    const sessions = await Promise.all(people.map(async (person) => {
      const session = await newSignedInContext(browser, "accounts");
      await session.page.goto(tab(person.student.id, "payments"), { waitUntil: "networkidle" });
      return session;
    }));
    await Promise.all(sessions.map(({ page }) => pay(page, "1000")));
    await Promise.all(sessions.map(({ page }) => expectToast(page, "Payment recorded")));
    await Promise.all(sessions.map(({ context }) => context.close()));

    const receipts = await db.receipt.findMany({ orderBy: [{ financialYear: "asc" }, { sequence: "asc" }] });
    for (const year of new Set(receipts.map((receipt) => receipt.financialYear))) {
      const inYear = receipts.filter((receipt) => receipt.financialYear === year);
      inYear.forEach((receipt, index) => expect(receipt.sequence).toBe(index + 1));
    }
    expect(new Set(receipts.map((receipt) => receipt.number)).size).toBe(receipts.length);
  });

  test("cancelling a payment needs a reason, restores the balance and keeps the receipt", async ({ page }) => {
    const { student, plan, course: theCourse } = await makeAdmitted("Cancel Pay Quillback");
    const payable = Math.round((theCourse.fee * 11800) / 10000);
    await signIn(page, "accounts");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });
    await pay(page, "2000");
    await expectToast(page, "Payment recorded");

    const payment = await db.payment.findFirstOrThrow({ where: { feePlanId: plan!.id }, include: { receipt: true } });
    await page.getByRole("button", { name: `Cancel payment ${payment.receipt!.number}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Cancel payment" })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Cheque bounced");
    await dialog.getByRole("button", { name: "Cancel payment" }).click();
    await expectToast(page, "Payment cancelled");

    await expect(page.getByLabel(/Fee summary for/)).toContainText(rupees(payable));
    await expect(page.getByRole("main")).toContainText("Cancelled");
    const saved = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { receipt: true } });
    expect(saved.deletedAt).not.toBeNull();
    expect(saved.receipt?.number).toBe(payment.receipt!.number);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: payment.id, action: "payment.cancelled" } });
    expect(audit.after).toEqual({ reason: "Cheque bounced" });

    // The cancelled receipt still opens, and says so.
    const pdf = await page.context().request.get(`/fees/receipts/${payment.id}`);
    expect(pdf.status()).toBe(200);
    expect((await PDFDocument.load(await pdf.body())).getSubject()).toBe("Cancelled receipt");
  });

  test("the PDF receipt downloads as a real, one-page PDF", async ({ page }) => {
    const payment = await db.payment.findFirstOrThrow({
      where: { deletedAt: null, receipt: { isNot: null } },
      include: { receipt: true },
    });
    await signIn(page, "accounts");
    const response = await page.context().request.get(`/fees/receipts/${payment.id}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    const pdf = await PDFDocument.load(await response.body());
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe(`Receipt ${payment.receipt!.number}`);
    expect(pdf.getSubject()).toBe("Fee receipt");
    expect(await db.auditLog.count({ where: { entityId: payment.receipt!.id, action: "receipt.downloaded" } })).toBeGreaterThan(0);
  });

  test("changing the organisation's details doesn't alter issued receipts", async ({ page }) => {
    const { student, plan } = await makeAdmitted("Snapshot Roach");
    await signIn(page, "accounts");
    await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });
    await pay(page, "1500");
    await expectToast(page, "Payment recorded");
    const before = await db.receipt.findFirstOrThrow({ where: { payment: { feePlanId: plan!.id } } });

    const org = await db.orgSettings.findUniqueOrThrow({ where: { id: "default" } });
    await db.orgSettings.update({ where: { id: "default" }, data: { gstin: "CHANGED", address: "Elsewhere" } });
    try {
      const after = await db.receipt.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.orgGstin).toBe(before.orgGstin);
      expect(after.orgAddress).toBe(before.orgAddress);
    } finally {
      await db.orgSettings.update({ where: { id: "default" }, data: { gstin: org.gstin, address: org.address } });
    }
  });
});

test.describe("the Fees page", () => {
  test("totals and overdue list match the data", async ({ page }) => {
    const now = new Date();
    const plans = await db.feePlan.findMany({
      where: { cancelledAt: null, student: { deletedAt: null } },
      include: {
        instalments: { where: { cancelledAt: null }, orderBy: { sequence: "asc" } },
        payments: { where: { deletedAt: null } },
      },
    });
    const summaries = plans.map((plan) => summarisePlan(plan, now));
    const pending = summaries.reduce((sum, item) => sum + item.balance, 0);
    const overdue = summaries.reduce((sum, item) => sum + item.overdueAmount, 0);
    const overdueCount = summaries.flatMap((item) => item.instalments).filter((item) => item.status === "OVERDUE").length;

    await signIn(page, "accounts");
    await page.goto("/fees", { waitUntil: "networkidle" });
    const totals = page.getByLabel("Fee totals");
    await expect(totals).toContainText(rupees(pending));
    await expect(totals).toContainText(rupees(overdue));
    if (overdueCount > 0) await expect(page.getByLabel("Pagination")).toContainText(`${overdueCount} overdue`);
  });

  test("every section opens, and payments link to their receipts", async ({ page }) => {
    const problems = watchForErrors(page);
    await signIn(page, "accounts");
    for (const section of ["Fee plans", "Awaiting plan", "Payments", "Overdue"]) {
      await page.goto("/fees", { waitUntil: "networkidle" });
      await page.getByLabel("Fee sections").getByRole("link", { name: section }).click();
      await expect(page.getByLabel("Fee sections").getByRole("link", { name: section })).toHaveAttribute("aria-current", "page");
    }
    await page.goto("/fees?view=payments", { waitUntil: "networkidle" });
    const link = page.getByRole("link", { name: /^Download receipt/ }).first();
    const response = await page.context().request.get((await link.getAttribute("href"))!);
    expect(response.status()).toBe(200);
    expect(problems).toEqual([]);
  });

  test("people without a plan appear under Awaiting plan", async ({ page }) => {
    const { student } = await makeAdmitted("Awaiting Sole", { withPlan: false });
    await signIn(page, "accounts");
    await page.goto("/fees?view=awaiting", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: "Awaiting Sole" })).toHaveAttribute("href", `/students/${student.id}?tab=payments`);
  });

  test("a new overdue instalment alerts accounts once, and paid ones don't", async ({ page, browser }) => {
    const late = await makeAdmitted("Overdue Alert Tench", { daysUntilFirstDue: -3 });
    const paid = await makeAdmitted("Paid Alert Tench", { daysUntilFirstDue: -3 });
    const firstPaid = await db.instalment.findFirstOrThrow({ where: { feePlanId: paid.plan!.id, sequence: 1 } });
    await db.payment.create({
      data: {
        feePlanId: paid.plan!.id,
        amount: firstPaid.amount,
        method: "CASH",
        paidAt: new Date(),
        recordedById: await userId("accounts"),
      },
    });

    await signIn(page, "accounts");
    await page.waitForLoadState("networkidle");
    await expect
      .poll(() => db.notification.count({ where: { message: { contains: "Overdue Alert Tench" } } }))
      .toBe(1);
    expect(await db.notification.count({ where: { message: { contains: "Paid Alert Tench" } } })).toBe(0);

    const second = await newSignedInContext(browser, "accounts");
    await second.page.waitForLoadState("networkidle");
    await second.context.close();
    expect(await db.notification.count({ where: { message: { contains: "Overdue Alert Tench" } } })).toBe(1);
    expect((await db.instalment.findFirstOrThrow({ where: { feePlanId: late.plan!.id, sequence: 1 } })).overdueNotifiedAt).not.toBeNull();
  });
});

test.describe("access", () => {
  async function capture(browser: Browser, who: string, act: (page: Page) => Promise<void>, marker: string) {
    const { context, page } = await newSignedInContext(browser, who);
    const pending = page.waitForRequest(
      (request) => request.method() === "POST" && Boolean(request.headers()["next-action"]) && (request.postData() ?? "").includes(marker),
    );
    await act(page);
    const request = await pending;
    const captured = { url: request.url(), headers: request.headers(), body: request.postData() ?? "" };
    await context.close();
    return captured;
  }

  async function replay(browser: Browser, who: string, request: { url: string; headers: Record<string, string>; body: string }) {
    const { context } = await newSignedInContext(browser, who);
    const response = await context.request.post(request.url, {
      headers: {
        "next-action": request.headers["next-action"],
        "content-type": request.headers["content-type"] ?? "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: "http://localhost:3200",
      },
      data: request.body,
    });
    const text = await response.text();
    await context.close();
    return text;
  }

  test("only admins and accounts can open the Fees page", async ({ page }) => {
    await signIn(page, "counsellor");
    const response = await page.context().request.get("/fees", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/\/forbidden$/);
  });

  test("receipts follow who can see the person", async ({ page }) => {
    const payment = await db.payment.findFirstOrThrow({
      where: { receipt: { isNot: null }, deletedAt: null, feePlan: { student: { assignedTo: { email: emailOf("kavya") } } } },
    });
    await signIn(page, "counsellor");
    expect((await page.context().request.get(`/fees/receipts/${payment.id}`)).status()).toBe(404);
  });

  test("the viewer can't download receipts", async ({ page }) => {
    const payment = await db.payment.findFirstOrThrow({ where: { receipt: { isNot: null } } });
    await signIn(page, "viewer");
    const response = await page.context().request.get(`/fees/receipts/${payment.id}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
  });

  test("fee actions refuse direct requests from counsellors and viewers", async ({ browser }) => {
    const { student, plan } = await makeAdmitted("Replay Pay Umbra");
    const request = await capture(
      browser,
      "accounts",
      async (page) => {
        await page.goto(tab(student.id, "payments"), { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Record payment" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Amount (₹)").fill("750");
        await dialog.getByLabel("Reference").fill("REPLAY");
        await dialog.getByRole("button", { name: "Save payment" }).click();
      },
      plan!.id,
    );
    expect(await db.payment.count({ where: { feePlanId: plan!.id } })).toBe(1);
    for (const who of ["counsellor", "viewer"]) {
      expect(await replay(browser, who, request), who).toContain("You don't have permission");
    }
    expect(await db.payment.count({ where: { feePlanId: plan!.id } })).toBe(1);
  });

  test("admission actions refuse other counsellors, accounts and viewers", async ({ browser }) => {
    const { student, admission } = await makeAdmitted("Replay Admission Vimba");
    const request = await capture(
      browser,
      "counsellor",
      async (page) => {
        await page.goto(tab(student.id, "admission"), { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Enrol student" }).click();
      },
      admission.id,
    );
    await db.enrollment.deleteMany({ where: { studentId: student.id } });
    await db.admission.update({ where: { id: admission.id }, data: { status: "PENDING" } });
    await db.student.update({ where: { id: student.id }, data: { stageId: await stageId("Admitted") } });

    for (const who of ["accounts", "viewer"]) {
      expect(await replay(browser, who, request), who).toContain("You don't have permission");
    }
    expect(await replay(browser, "kavya", request)).toContain("isn't assigned to you");
    expect(await db.enrollment.count({ where: { studentId: student.id } })).toBe(0);
  });

  test("course actions refuse counsellors", async ({ browser }) => {
    const theCourse = await db.course.create({
      data: { code: `RP-${Date.now() % 100000}`, name: `Replay Course ${Date.now()}`, fee: 100000, durationMonths: 3 },
    });
    const request = await capture(
      browser,
      "admin",
      async (page) => {
        await page.goto("/courses", { waitUntil: "networkidle" });
        await page.getByRole("button", { name: `Archive ${theCourse.name}` }).click();
      },
      theCourse.id,
    );
    await db.course.update({ where: { id: theCourse.id }, data: { isActive: true } });
    expect(await replay(browser, "counsellor", request)).toContain("You don't have permission");
    expect((await db.course.findUniqueOrThrow({ where: { id: theCourse.id } })).isActive).toBe(true);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("courses, admissions and fees fit the screen", async ({ page }) => {
    const problems = watchForErrors(page);
    await signIn(page, "admin");
    for (const url of ["/courses", "/admissions", "/fees", "/fees?view=plans", "/fees?view=payments"]) {
      await page.goto(url, { waitUntil: "networkidle" });
      await noHorizontalScroll(page);
    }
    expect(problems).toEqual([]);
  });
});
