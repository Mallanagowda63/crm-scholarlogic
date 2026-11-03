import { expect, test, type Browser, type Page } from "@playwright/test";

import { db, emailOf, expectToast, newSignedInContext, noHorizontalScroll, signIn, watchForErrors } from "./helpers";

const DAY = 86_400_000;
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;
const stageId = async (name: string) => (await db.pipelineStage.findUniqueOrThrow({ where: { name } })).id;

let lastStamp = 0;
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `+916${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};

async function makeStudent(name: string, owner = "counsellor", stage = "New") {
  return db.student.create({
    data: { name, phone: newPhone(), stageId: await stageId(stage), assignedToId: await userId(owner) },
  });
}

async function makeTask(title: string, owner = "counsellor", options: { daysAhead?: number; studentId?: string; reminderAt?: Date } = {}) {
  return db.task.create({
    data: {
      title,
      dueAt: new Date(Date.now() + (options.daysAhead ?? 3) * DAY),
      assigneeId: await userId(owner),
      studentId: options.studentId,
      reminderAt: options.reminderAt,
    },
  });
}

/** A value for a date input, on a given number of days from now. */
function local(daysAhead: number, time = "10:00") {
  const date = new Date(Date.now() + daysAhead * DAY);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
}

const india = (date: Date) => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);

async function fillNewTask(page: Page, title: string, due: string) {
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Due").fill(due);
  return dialog;
}

test.describe("the task list", () => {
  test("adds a task, with validation, audit log and reminder", async ({ page }) => {
    await signIn(page, "counsellor");
    await page.goto("/tasks", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog.getByText("Enter a title")).toBeVisible();
    await expect(dialog.getByText("Choose a date and time")).toBeVisible();

    await dialog.getByLabel("Title").fill("Past due date");
    await dialog.getByLabel("Due").fill(local(-2));
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog.getByText("Choose a date and time in the future")).toBeVisible();

    await dialog.getByLabel("Title").fill("Call the scholarship office");
    await dialog.getByLabel("Due").fill(local(4));
    await dialog.getByLabel("Priority").selectOption("HIGH");
    await dialog.getByLabel("Type").selectOption("CALL");
    await dialog.getByLabel("Reminder").selectOption("1440");
    await dialog.getByLabel(/Details/).fill("Ask about the deadline.");
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expectToast(page, "Task added");

    const task = await db.task.findFirstOrThrow({ where: { title: "Call the scholarship office" } });
    expect(task.assigneeId).toBe(await userId("counsellor"));
    expect(task.priority).toBe("HIGH");
    expect(task.type).toBe("CALL");
    expect(task.description).toBe("Ask about the deadline.");
    expect(task.dueAt.getTime()).toBe(new Date(local(4)).getTime());
    expect(task.dueAt.getTime() - task.reminderAt!.getTime()).toBe(DAY);
    expect(await db.auditLog.count({ where: { entityId: task.id, action: "task.created" } })).toBe(1);
    await expect(page.getByRole("button", { name: "Call the scholarship office", exact: true })).toBeVisible();
  });

  test("links a task to a person, updating their timeline and next follow-up", async ({ page }) => {
    const student = await makeStudent("Task Link Alpaca");
    await signIn(page, "counsellor");
    await page.goto("/tasks", { waitUntil: "networkidle" });

    const dialog = await fillNewTask(page, "Linked task", local(2));
    await dialog.getByLabel(/Link to a lead or student/).fill("Task Link Alpaca");
    await dialog.getByLabel("Matching people").getByRole("button", { name: /Task Link Alpaca/ }).click();
    await expect(dialog.getByText("Task Link Alpaca")).toBeVisible();
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expectToast(page, "Task added");

    const saved = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(saved.nextFollowUpAt?.getTime()).toBe(new Date(local(2)).getTime());
    expect(await db.activity.count({ where: { studentId: student.id, body: "Task scheduled: Linked task" } })).toBe(1);
    await expect(page.getByRole("link", { name: "Task Link Alpaca" })).toHaveAttribute("href", `/students/${student.id}`);
  });

  test("edits a task, loading its existing values", async ({ page }) => {
    const task = await makeTask("Edit Me Task", "counsellor", { reminderAt: new Date(Date.now() + 3 * DAY - 15 * 60_000) });
    await signIn(page, "counsellor");
    await page.goto("/tasks?q=Edit+Me+Task", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Edit Me Task", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Title")).toHaveValue("Edit Me Task");
    await expect(dialog.getByLabel("Reminder")).toHaveValue("15");
    await dialog.getByLabel("Title").fill("Edited Task Name");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Task updated");

    const saved = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.title).toBe("Edited Task Name");
    expect(saved.dueAt.getTime()).toBe(task.dueAt.getTime());
  });

  test("an overdue task can be edited without moving its date", async ({ page }) => {
    const task = await makeTask("Overdue Edit Task", "counsellor", { daysAhead: -2 });
    await signIn(page, "counsellor");
    await page.goto("/tasks?q=Overdue+Edit+Task", { waitUntil: "networkidle" });
    await expect(page.getByRole("row").filter({ hasText: "Overdue Edit Task" })).toContainText("Overdue");

    await page.getByRole("button", { name: "Overdue Edit Task", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Title")).toHaveValue("Overdue Edit Task");
    await dialog.getByLabel("Priority").selectOption("LOW");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Task updated");
    const saved = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.priority).toBe("LOW");
    // Date inputs drop the seconds, which must not move the task or count as a new date.
    expect(saved.dueAt.getTime()).toBe(task.dueAt.getTime());
  });

  test("completing and reopening keeps follow-up dates and history right", async ({ page }) => {
    const student = await makeStudent("Complete Task Bison");
    const task = await makeTask("Finish This Task", "counsellor", { studentId: student.id });
    await db.student.update({ where: { id: student.id }, data: { nextFollowUpAt: task.dueAt } });

    await signIn(page, "counsellor");
    await page.goto("/tasks?q=Finish+This+Task", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: 'Mark "Finish This Task" as done' }).click();
    await expectToast(page, "Task completed");
    await expect(page.getByText("No tasks match these filters")).toBeVisible();

    let saved = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.status).toBe("DONE");
    expect(saved.completedAt).not.toBeNull();
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).nextFollowUpAt).toBeNull();

    await page.goto("/tasks?q=Finish+This+Task&status=DONE", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: 'Reopen "Finish This Task"' }).click();
    await expectToast(page, "Task reopened");
    saved = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.status).toBe("OPEN");
    expect(saved.completedAt).toBeNull();
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).nextFollowUpAt?.getTime()).toBe(task.dueAt.getTime());

    const history = await db.activity.findMany({ where: { studentId: student.id, type: "FOLLOW_UP" }, orderBy: { occurredAt: "asc" } });
    expect(history.map((entry) => entry.body)).toEqual(["Task completed: Finish This Task", "Task reopened: Finish This Task"]);
  });

  test("cancelling keeps the record, and hides it from the open list", async ({ page }) => {
    const task = await makeTask("Cancel This Task");
    await signIn(page, "counsellor");
    await page.goto("/tasks?q=Cancel+This+Task", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Cancel This Task", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel task" }).click();
    await expectToast(page, "Task cancelled");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("CANCELLED");

    await page.goto("/tasks?q=Cancel+This+Task&status=CANCELLED", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Cancel This Task", exact: true })).toBeVisible();
  });

  test("filters by due date, priority and status, and matches the database", async ({ page }) => {
    const counsellor = await userId("counsellor");
    const now = new Date();
    const scope = {
      assigneeId: counsellor,
      status: "OPEN" as const,
      OR: [{ studentId: null }, { student: { deletedAt: null } }],
    };
    await makeTask("Overdue Filter Task", "counsellor", { daysAhead: -1 });
    await signIn(page, "counsellor");
    await page.goto("/tasks", { waitUntil: "networkidle" });

    const overdue = await db.task.count({ where: { ...scope, dueAt: { lt: now } } });
    await page.getByLabel("Filter by due date").selectOption("overdue");
    await expect(page).toHaveURL(/due=overdue/);
    await expect(page.getByLabel("Pagination")).toContainText(`of ${overdue}`);

    await page.getByLabel("Filter by due date").selectOption("");
    await page.getByLabel("Filter by priority").selectOption("HIGH");
    await expect(page).toHaveURL(/priority=HIGH/);
    const high = await db.task.count({ where: { ...scope, priority: "HIGH" } });
    await expect(page.getByLabel("Pagination")).toContainText(`of ${high}`);
  });

  test("searches task titles and linked names", async ({ page }) => {
    const student = await makeStudent("Search Target Caracal");
    await makeTask("Generic Title Xylophone", "counsellor", { studentId: student.id });
    await signIn(page, "counsellor");
    await page.goto("/tasks", { waitUntil: "networkidle" });

    await page.getByLabel("Search tasks").fill("Caracal");
    await page.waitForURL(/q=Caracal/);
    await expect(page.getByRole("button", { name: "Generic Title Xylophone", exact: true })).toBeVisible();

    await page.getByLabel("Search tasks").fill("no such task here");
    await expect(page.getByText("No tasks match these filters")).toBeVisible();
  });

  test("paginates long lists", async ({ page }) => {
    const admin = await userId("admin");
    await db.task.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        title: `Bulk Page Task ${index}`,
        dueAt: new Date(Date.now() + (index + 1) * 3_600_000),
        assigneeId: admin,
      })),
    });
    await signIn(page, "admin");
    await page.goto(`/tasks?q=Bulk+Page+Task&assignee=${admin}`, { waitUntil: "networkidle" });
    await expect(page.getByLabel("Pagination")).toContainText("1–25 of 30");
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page.getByLabel("Pagination")).toContainText("26–30 of 30");
  });

  test("hides tasks of soft-deleted people", async ({ page }) => {
    const student = await makeStudent("Deleted Person Dingo");
    await makeTask("Task Of Deleted Dingo", "counsellor", { studentId: student.id });
    await db.student.update({ where: { id: student.id }, data: { deletedAt: new Date() } });
    await signIn(page, "counsellor");
    await page.goto("/tasks?q=Deleted+Dingo", { waitUntil: "networkidle" });
    await expect(page.getByText("No tasks match these filters")).toBeVisible();
  });
});

test.describe("the calendar", () => {
  test("month view puts tasks and demos on the right India date, including near midnight", async ({ page }) => {
    const student = await makeStudent("Calendar Demo Egret");
    // 11:45 PM in India on the 15th is still the 15th, though UTC already agrees and 12:15 AM wouldn't.
    const monthKey = india(new Date(Date.now() + 40 * DAY)).slice(0, 7);
    const lateAt = new Date(`${monthKey}-15T18:15:00Z`);
    const earlyAt = new Date(`${monthKey}-15T18:45:00Z`);
    await db.task.create({ data: { title: "Late Night Task", dueAt: lateAt, assigneeId: await userId("counsellor") } });
    await db.task.create({ data: { title: "Just After Midnight", dueAt: earlyAt, assigneeId: await userId("counsellor") } });
    await db.demoClass.create({
      data: {
        studentId: student.id,
        courseId: (await db.course.findFirstOrThrow()).id,
        scheduledAt: new Date(`${monthKey}-20T05:00:00Z`),
        counsellorId: await userId("counsellor"),
      },
    });

    await signIn(page, "counsellor");
    await page.goto(`/tasks?view=calendar&date=${monthKey}-10`, { waitUntil: "networkidle" });

    await expect(page.locator(`[data-day="${monthKey}-15"]`)).toContainText("Late Night Task");
    await expect(page.locator(`[data-day="${monthKey}-15"]`)).not.toContainText("Just After Midnight");
    await expect(page.locator(`[data-day="${monthKey}-16"]`)).toContainText("Just After Midnight");
    const demo = page.locator(`[data-day="${monthKey}-20"]`).locator('[data-event-kind="demo"]');
    await expect(demo).toContainText("Demo: Calendar Demo Egret");
    await expect(demo).toHaveAttribute("href", `/students/${student.id}`);
  });

  test("moves between months, weeks and days, and returns to today", async ({ page }) => {
    await signIn(page, "counsellor");
    await page.goto("/tasks?view=calendar&date=2027-01-15", { waitUntil: "networkidle" });
    const title = page.locator('h2[aria-live="polite"]');
    await expect(title).toHaveText("January 2027");

    await page.getByRole("link", { name: "Next", exact: true }).click();
    await expect(title).toHaveText("February 2027");
    await page.getByRole("link", { name: "Previous", exact: true }).click();
    await page.getByRole("link", { name: "Previous", exact: true }).click();
    await expect(title).toHaveText("December 2026");

    await page.goto("/tasks?view=calendar&date=2027-01-15&mode=week", { waitUntil: "networkidle" });
    await expect(title).toHaveText("11 Jan – 17 Jan 2027");
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await expect(title).toHaveText("18 Jan – 24 Jan 2027");

    await page.goto("/tasks?view=calendar&date=2027-01-31&mode=day", { waitUntil: "networkidle" });
    await expect(title).toHaveText("Sunday, 31 January 2027");
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await expect(title).toHaveText("Monday, 1 February 2027");

    await page.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`date=${india(new Date())}`));
  });

  test("a month with 31 days doesn't skip the next month", async ({ page }) => {
    await signIn(page, "counsellor");
    await page.goto("/tasks?view=calendar&date=2027-01-31", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("February 2027");
  });

  test("busy days show a +more link that leads to the whole day", async ({ page }) => {
    const owner = await userId("sandeep");
    const key = "2027-03-10";
    await db.task.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        title: `Busy Day ${index}`,
        dueAt: new Date(`${key}T0${index + 3}:00:00Z`),
        assigneeId: owner,
      })),
    });
    await signIn(page, "sandeep");
    await page.goto(`/tasks?view=calendar&date=${key}`, { waitUntil: "networkidle" });
    const cell = page.locator(`[data-day="${key}"]`);
    await expect(cell.getByRole("button")).toHaveCount(3);
    await cell.getByRole("link", { name: "+2 more" }).click();
    await expect(page).toHaveURL(/mode=day/);
    await expect(page.getByRole("button", { name: /Busy Day/ })).toHaveCount(5);
  });

  test("clicking a task opens its form", async ({ page }) => {
    await db.task.create({
      data: { title: "Click Calendar Task", dueAt: new Date("2027-04-12T05:00:00Z"), assigneeId: await userId("counsellor") },
    });
    await signIn(page, "counsellor");
    await page.goto("/tasks?view=calendar&date=2027-04-12&mode=week", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Click Calendar Task/ }).click();
    await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue("Click Calendar Task");
  });

  test("a counsellor's calendar shows only their own work", async ({ page }) => {
    await db.task.create({
      data: { title: "Someone Elses Calendar Task", dueAt: new Date("2027-05-12T05:00:00Z"), assigneeId: await userId("kavya") },
    });
    await signIn(page, "counsellor");
    await page.goto(`/tasks?view=calendar&date=2027-05-12&assignee=${await userId("kavya")}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Someone Elses Calendar Task")).toHaveCount(0);
  });
});

test.describe("demo classes", () => {
  const openPanel = (page: Page, id: string) => page.goto(`/students/${id}`, { waitUntil: "networkidle" });

  test("scheduling moves the lead forward, and records history", async ({ page }) => {
    const student = await makeStudent("Demo Schedule Finch");
    const course = await db.course.findUniqueOrThrow({ where: { code: "JEE-2Y" } });
    await signIn(page, "counsellor");
    await openPanel(page, student.id);

    await page.getByRole("button", { name: "Schedule demo" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Schedule", exact: true })).toBeDisabled();
    await dialog.getByLabel("Batch or course").selectOption(`course:${course.id}`);
    await dialog.getByLabel("When").fill(local(3));
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expectToast(page, "Demo class scheduled");

    const saved = await db.student.findUniqueOrThrow({ where: { id: student.id }, include: { stage: true, demoClasses: true } });
    expect(saved.stage.name).toBe("Demo Scheduled");
    expect(saved.demoClasses).toHaveLength(1);
    expect(saved.demoClasses[0].courseId).toBe(course.id);
    expect(saved.demoClasses[0].batchId).toBeNull();
    expect(saved.demoClasses[0].attended).toBeNull();
    expect(saved.demoClasses[0].counsellorId).toBe(await userId("counsellor"));
    await expect(page.getByRole("button", { name: "Record attendance" })).toHaveCount(0);

    const types = await db.activity.findMany({ where: { studentId: student.id } });
    expect(types.map((entry) => entry.type).sort()).toEqual(["DEMO_CLASS", "STAGE_CHANGE"]);
  });

  test("can book into a specific batch, and rejects past dates", async ({ page }) => {
    const student = await makeStudent("Demo Batch Gibbon");
    const batch = await db.batch.findFirstOrThrow();
    await signIn(page, "counsellor");
    await openPanel(page, student.id);

    await page.getByRole("button", { name: "Schedule demo" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Batch or course").selectOption(`batch:${batch.id}`);
    await dialog.getByLabel("When").fill(local(-3));
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expectToast(page, "Choose a date and time in the future");
    expect(await db.demoClass.count({ where: { studentId: student.id } })).toBe(0);

    await dialog.getByLabel("When").fill(local(2));
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expectToast(page, "Demo class scheduled");
    expect((await db.demoClass.findFirstOrThrow({ where: { studentId: student.id } })).batchId).toBe(batch.id);
  });

  test("scheduling never moves someone backward", async ({ page }) => {
    const student = await makeStudent("Demo Later Heron", "counsellor", "Interested");
    const course = await db.course.findFirstOrThrow();
    await signIn(page, "counsellor");
    await openPanel(page, student.id);
    await page.getByRole("button", { name: "Schedule demo" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Batch or course").selectOption(`course:${course.id}`);
    await dialog.getByLabel("When").fill(local(2));
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expectToast(page, "Demo class scheduled");
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id }, include: { stage: true } })).stage.name).toBe("Interested");
  });

  async function pastDemo(name: string) {
    const student = await makeStudent(name, "counsellor", "Demo Scheduled");
    const course = await db.course.findFirstOrThrow();
    const demo = await db.demoClass.create({
      data: {
        studentId: student.id,
        courseId: course.id,
        scheduledAt: new Date(Date.now() - 3_600_000),
        counsellorId: await userId("counsellor"),
      },
    });
    return { student, demo };
  }

  test("recording attendance saves feedback and moves the lead forward", async ({ page }) => {
    const { student, demo } = await pastDemo("Attended Ibis");
    await signIn(page, "counsellor");
    await openPanel(page, student.id);
    await page.getByRole("button", { name: "Record attendance" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Feedback/).fill("Loved the physics session.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expectToast(page, "Attendance recorded");

    const saved = await db.demoClass.findUniqueOrThrow({ where: { id: demo.id } });
    expect(saved.attended).toBe(true);
    expect(saved.feedback).toBe("Loved the physics session.");
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id }, include: { stage: true } })).stage.name).toBe("Demo Attended");
    await expect(page.getByRole("main")).toContainText("Loved the physics session.");
    await expect(page.getByRole("button", { name: "Record attendance" })).toHaveCount(0);
  });

  test("a no-show stays at Demo Scheduled", async ({ page }) => {
    const { student, demo } = await pastDemo("No Show Jay");
    await signIn(page, "counsellor");
    await openPanel(page, student.id);
    await page.getByRole("button", { name: "Record attendance" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Did they attend?").selectOption("no");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expectToast(page, "Attendance recorded");
    expect((await db.demoClass.findUniqueOrThrow({ where: { id: demo.id } })).attended).toBe(false);
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id }, include: { stage: true } })).stage.name).toBe("Demo Scheduled");
    await expect(page.getByRole("main")).toContainText("Didn't attend");
  });

  test("a demo can be rescheduled or cancelled, keeping the record", async ({ page }) => {
    const student = await makeStudent("Reschedule Kiwi");
    const course = await db.course.findFirstOrThrow();
    const demo = await db.demoClass.create({
      data: {
        studentId: student.id,
        courseId: course.id,
        scheduledAt: new Date(Date.now() + DAY),
        counsellorId: await userId("counsellor"),
      },
    });
    await signIn(page, "counsellor");
    await openPanel(page, student.id);

    await page.getByRole("button", { name: "Reschedule", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New date and time").fill(local(6));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expectToast(page, "Demo class rescheduled");
    expect((await db.demoClass.findUniqueOrThrow({ where: { id: demo.id } })).scheduledAt.getTime()).toBe(new Date(local(6)).getTime());

    await page.getByRole("button", { name: "Cancel demo" }).click();
    await expectToast(page, "Demo class cancelled");
    await expect(page.getByText("No demo classes yet.")).toBeVisible();
    expect((await db.demoClass.findUniqueOrThrow({ where: { id: demo.id } })).cancelledAt).not.toBeNull();
  });
});

test.describe("reassigning a lead", () => {
  test("takes open tasks and upcoming demos along, and leaves finished ones", async ({ page }) => {
    const student = await makeStudent("Reassign Lynx", "kavya");
    const openTask = await makeTask("Open Reassign Task", "kavya", { studentId: student.id });
    const doneTask = await makeTask("Done Reassign Task", "kavya", { studentId: student.id });
    await db.task.update({ where: { id: doneTask.id }, data: { status: "DONE" } });
    const demo = await db.demoClass.create({
      data: {
        studentId: student.id,
        courseId: (await db.course.findFirstOrThrow()).id,
        scheduledAt: new Date(Date.now() + DAY),
        counsellorId: await userId("kavya"),
      },
    });

    await signIn(page, "admin");
    await page.goto("/leads?q=Reassign+Lynx", { waitUntil: "networkidle" });
    await page.getByLabel("Select Reassign Lynx").click();
    await page.getByLabel("Assign selected leads").selectOption({ label: "Arjun Nair" });
    await expectToast(page, /assigned to Arjun Nair/);

    const arjun = await userId("counsellor");
    expect((await db.task.findUniqueOrThrow({ where: { id: openTask.id } })).assigneeId).toBe(arjun);
    expect((await db.task.findUniqueOrThrow({ where: { id: doneTask.id } })).assigneeId).toBe(await userId("kavya"));
    expect((await db.demoClass.findUniqueOrThrow({ where: { id: demo.id } })).counsellorId).toBe(arjun);
  });
});

test.describe("notifications", () => {
  const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });

  test("a due reminder appears once, and can be opened and read", async ({ page, browser }) => {
    const student = await makeStudent("Reminder Marten", "sandeep");
    const task = await makeTask("Reminder Bell Task", "sandeep", { studentId: student.id, reminderAt: new Date(Date.now() - 60_000) });
    const future = await makeTask("Future Reminder Task", "sandeep", { reminderAt: new Date(Date.now() + DAY) });

    await signIn(page, "sandeep");
    await page.waitForLoadState("networkidle");
    await expect(bell(page)).toHaveAccessibleName(/unread/);
    await bell(page).click();
    const item = page.getByRole("menuitem").filter({ hasText: "Reminder Bell Task" });
    await expect(item).toHaveCount(1);
    await expect(page.getByRole("menuitem").filter({ hasText: "Future Reminder Task" })).toHaveCount(0);

    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt).not.toBeNull();
    expect((await db.task.findUniqueOrThrow({ where: { id: future.id } })).reminderSentAt).toBeNull();

    // Checking again, or from a second tab, doesn't repeat it.
    const second = await newSignedInContext(browser, "sandeep");
    await second.page.waitForLoadState("networkidle");
    await second.context.close();
    await page.reload({ waitUntil: "networkidle" });
    expect(await db.notification.count({ where: { message: { contains: "Reminder Bell Task" } } })).toBe(1);

    await bell(page).click();
    await page.getByRole("menuitem").filter({ hasText: "Reminder Bell Task" }).click();
    await page.waitForURL(`**/students/${student.id}`);
    await expect
      .poll(async () => (await db.notification.findFirstOrThrow({ where: { message: { contains: "Reminder Bell Task" } } })).readAt)
      .not.toBeNull();
  });

  test("reminders go only to the assignee, and never for finished tasks", async ({ page }) => {
    const past = new Date(Date.now() - 60_000);
    await makeTask("Other Person Reminder", "kavya", { reminderAt: past });
    const done = await makeTask("Finished Reminder", "counsellor", { reminderAt: past });
    await db.task.update({ where: { id: done.id }, data: { status: "DONE" } });

    await signIn(page, "counsellor");
    await page.waitForLoadState("networkidle");
    await bell(page).click();
    await expect(page.getByRole("menuitem").filter({ hasText: "Other Person Reminder" })).toHaveCount(0);
    await expect(page.getByRole("menuitem").filter({ hasText: "Finished Reminder" })).toHaveCount(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: done.id } })).reminderSentAt).toBeNull();
  });

  test("changing a task's time gives a fresh reminder", async ({ page }) => {
    const task = await makeTask("Moved Reminder Task", "counsellor", { reminderAt: new Date(Date.now() - 60_000) });
    await db.task.update({ where: { id: task.id }, data: { reminderSentAt: new Date() } });
    await signIn(page, "counsellor");
    await page.goto("/tasks?q=Moved+Reminder+Task", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Moved Reminder Task", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Due").fill(local(9));
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Task updated");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt).toBeNull();
  });

  test("accounts sees overdue payment alerts from the sample data, and can mark all as read", async ({ page }) => {
    const accounts = await userId("accounts");
    expect(await db.notification.count({ where: { userId: accounts, readAt: null } })).toBeGreaterThan(0);
    await signIn(page, "accounts");
    await page.waitForLoadState("networkidle");
    await expect(bell(page)).toHaveAccessibleName(/unread/);
    await bell(page).click();
    await expect(page.getByRole("menuitem").filter({ hasText: "Overdue payment" }).first()).toBeVisible();
    await page.getByRole("menuitem", { name: "Mark all as read" }).click();
    await expect(bell(page)).toHaveAccessibleName("Notifications");
    await expect.poll(() => db.notification.count({ where: { userId: accounts, readAt: null } })).toBe(0);
  });

  test("the dashboard no longer promises modules that are already built", async ({ page }) => {
    await signIn(page, "admin");
    const leads = page.getByRole("main").getByRole("link", { name: /^Leads/ });
    await expect(leads).not.toContainText("Arrives in Phase");
    await expect(page.getByRole("main").getByRole("link", { name: /^Fees/ })).toContainText("Arrives in Phase 6");
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

  for (const who of ["accounts", "viewer"]) {
    test(`${who} can't open tasks`, async ({ page }) => {
      await signIn(page, who);
      const response = await page.context().request.get("/tasks", { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toMatch(/\/forbidden$/);
    });
  }

  test("a counsellor sees only their own tasks, and can't assign to others", async ({ page }) => {
    await makeTask("Hidden Kavya Task", "kavya");
    await signIn(page, "counsellor");
    await page.goto(`/tasks?q=Hidden+Kavya+Task&assignee=${await userId("kavya")}`, { waitUntil: "networkidle" });
    await expect(page.getByText("No tasks match these filters")).toBeVisible();
    await page.getByRole("button", { name: "New task" }).click();
    await expect(page.getByRole("dialog").getByLabel("Assigned to")).toHaveCount(0);
    await expect(page.getByLabel("Filter by assignee")).toHaveCount(0);
  });

  test("an admin can assign tasks to someone else", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/tasks", { waitUntil: "networkidle" });
    const dialog = await fillNewTask(page, "Assigned By Admin", local(2));
    await dialog.getByLabel("Assigned to").selectOption({ label: "Kavya Reddy" });
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expectToast(page, "Task added");
    expect((await db.task.findFirstOrThrow({ where: { title: "Assigned By Admin" } })).assigneeId).toBe(await userId("kavya"));
  });

  test("a counsellor can't link a task to someone else's lead, even by search", async ({ page }) => {
    await makeStudent("Not Mine Newt", "kavya");
    await signIn(page, "counsellor");
    await page.goto("/tasks", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Link to a lead or student/).fill("Not Mine Newt");
    await page.waitForTimeout(800);
    await expect(dialog.getByLabel("Matching people")).toHaveCount(0);
  });

  test("task, demo and notification actions refuse direct requests without permission", async ({ browser }) => {
    const task = await makeTask("Replay Status Task");
    const taskRequest = await capture(
      browser,
      "counsellor",
      async (page) => {
        await page.goto("/tasks?q=Replay+Status+Task", { waitUntil: "networkidle" });
        await page.getByRole("button", { name: 'Mark "Replay Status Task" as done' }).click();
      },
      task.id,
    );
    await db.task.update({ where: { id: task.id }, data: { status: "OPEN" } });
    for (const who of ["accounts", "viewer"]) {
      expect(await replay(browser, who, taskRequest), who).toContain("You don't have permission");
    }
    expect(await replay(browser, "kavya", taskRequest)).toContain("isn't assigned to you");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("OPEN");

    const student = await makeStudent("Replay Demo Otter");
    const course = await db.course.findFirstOrThrow();
    const demo = await db.demoClass.create({
      data: { studentId: student.id, courseId: course.id, scheduledAt: new Date(Date.now() + DAY), counsellorId: await userId("counsellor") },
    });
    const demoRequest = await capture(
      browser,
      "counsellor",
      async (page) => {
        await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Cancel demo" }).click();
      },
      demo.id,
    );
    await db.demoClass.update({ where: { id: demo.id }, data: { cancelledAt: null } });
    expect(await replay(browser, "accounts", demoRequest)).toContain("You don't have permission");
    expect(await replay(browser, "kavya", demoRequest)).toContain("isn't assigned to you");
    expect((await db.demoClass.findUniqueOrThrow({ where: { id: demo.id } })).cancelledAt).toBeNull();
  });

  test("someone else's notification can't be marked as read", async ({ browser }) => {
    const notification = await db.notification.create({
      data: { userId: await userId("sandeep"), title: "Private", message: "Replay Read Notification" },
    });
    const request = await capture(
      browser,
      "sandeep",
      async (page) => {
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: /^Notifications/ }).click();
        await page.getByRole("menuitem").filter({ hasText: "Replay Read Notification" }).click();
      },
      notification.id,
    );
    await db.notification.update({ where: { id: notification.id }, data: { readAt: null } });
    await replay(browser, "viewer", request);
    expect((await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt).toBeNull();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the list and every calendar range fit, without browser errors", async ({ page }) => {
    const problems = watchForErrors(page);
    await signIn(page, "counsellor");
    for (const url of ["/tasks", "/tasks?view=calendar", "/tasks?view=calendar&mode=week", "/tasks?view=calendar&mode=day"]) {
      await page.goto(url, { waitUntil: "networkidle" });
      await noHorizontalScroll(page);
    }
    expect(problems).toEqual([]);
  });

  test("a month day with work shows a count that opens the day", async ({ page }) => {
    await db.task.create({
      data: { title: "Phone Month Task", dueAt: new Date("2027-06-15T05:00:00Z"), assigneeId: await userId("counsellor") },
    });
    await signIn(page, "counsellor");
    await page.goto("/tasks?view=calendar&date=2027-06-15", { waitUntil: "networkidle" });
    await page.locator('[data-day="2027-06-15"]').getByRole("link").first().tap();
    await expect(page).toHaveURL(/mode=day/);
    await expect(page.getByRole("button", { name: /Phone Month Task/ })).toBeVisible();
  });

  test("a task can be added in the field", async ({ page }) => {
    await signIn(page, "counsellor");
    await page.goto("/tasks", { waitUntil: "networkidle" });
    const dialog = await fillNewTask(page, "Added From Phone", local(1));
    await dialog.getByRole("button", { name: "Add task" }).tap();
    await expectToast(page, "Task added");
    await noHorizontalScroll(page);
  });
});
