import { expect, test } from "@playwright/test";

import { db, emailOf, signIn, watchForErrors } from "./helpers";

let lastStamp = 0;
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `+919${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};
const indiaDay = (date: Date) => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;

/** Today after 7 pm in India, otherwise yesterday, matching the app. */
function latestFinishedDay(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now));
  const today = indiaDay(now);
  if (hour >= 19) return today;
  return new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

async function counsellorRow(page: import("@playwright/test").Page, name: string) {
  return page.getByRole("region", { name: "By counsellor" }).getByRole("row").filter({ hasText: name });
}

test.describe("Daily report", () => {
  test("shows what each counsellor did today, with their timeline", async ({ page }) => {
    const errors = watchForErrors(page);
    const counsellor = await userId("counsellor");
    const stage = await db.pipelineStage.findUniqueOrThrow({ where: { name: "Contacted" } });
    const student = await db.student.create({
      data: { name: "Report Person Avocet", phone: newPhone(), stageId: stage.id, assignedToId: counsellor },
    });
    await db.activity.create({
      data: { studentId: student.id, type: "CALL", body: "Discussed the weekend batch for the report.", actorId: counsellor },
    });
    await db.task.create({
      data: { title: "Report Done Task", dueAt: new Date(), assigneeId: counsellor, studentId: student.id, status: "DONE", completedAt: new Date() },
    });

    await signIn(page, "admin");
    await page.goto("/daily-report", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Daily report" })).toBeVisible();

    const counsellorName = (await db.user.findUniqueOrThrow({ where: { id: counsellor } })).name;
    const row = await counsellorRow(page, counsellorName);
    await expect(row).toBeVisible();
    const cells = row.getByRole("cell");
    expect(Number(await cells.nth(1).innerText())).toBeGreaterThanOrEqual(1);
    expect(Number(await cells.nth(3).innerText())).toBeGreaterThanOrEqual(1);

    const timeline = page.getByRole("region", { name: counsellorName, exact: true });
    await expect(timeline).toContainText("Report Person Avocet");
    await expect(timeline).toContainText("Discussed the weekend batch for the report.");
    expect(errors).toEqual([]);
  });

  test("a follow-up due that day and not done counts as missed", async ({ page }) => {
    const counsellor = await userId("kavya");
    const name = (await db.user.findUniqueOrThrow({ where: { id: counsellor } })).name;
    await signIn(page, "admin");
    await page.goto("/daily-report", { waitUntil: "networkidle" });
    const missedBefore = Number(await (await counsellorRow(page, name)).getByRole("cell").nth(2).innerText());

    await db.task.create({ data: { title: "Report Missed Task", dueAt: new Date(Date.now() - 60_000), assigneeId: counsellor } });
    await page.reload({ waitUntil: "networkidle" });
    expect(Number(await (await counsellorRow(page, name)).getByRole("cell").nth(2).innerText())).toBe(missedBefore + 1);
  });

  test("earlier days can be chosen, and bad or future dates show today", async ({ page }) => {
    await signIn(page, "admin");
    const today = indiaDay(new Date());
    const label = (key: string) =>
      new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
        new Date(`${key}T00:00:00Z`),
      );

    await page.goto("/daily-report?date=2026-01-15", { waitUntil: "networkidle" });
    await expect(page.getByText(label("2026-01-15"), { exact: false }).first()).toBeVisible();
    for (const date of ["2099-01-01", "2026-02-31", "yesterday"]) {
      await page.goto(`/daily-report?date=${date}`, { waitUntil: "networkidle" });
      await expect(page.getByText(label(today), { exact: false }).first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Next day" })).toHaveCount(0);
  });

  test("admins get the report as one notification a day", async ({ page }) => {
    const admin = await userId("admin");
    const day = latestFinishedDay(new Date());
    const link = `/daily-report?date=${day}`;
    await db.dailyReportDelivery.deleteMany({ where: { userId: admin } });
    await db.notification.deleteMany({ where: { userId: admin, link } });

    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect.poll(() => db.notification.count({ where: { userId: admin, link } }), { timeout: 15_000 }).toBe(1);
    const notice = await db.notification.findFirstOrThrow({ where: { userId: admin, link } });
    expect(notice.title).toBe("Daily report");
    expect(notice.message).toMatch(/follow-ups done, \d+ missed, \d+ calls and messages, \d+ leads added\.$/);

    await page.reload({ waitUntil: "networkidle" });
    await page.goto("/leads", { waitUntil: "networkidle" });
    expect(await db.notification.count({ where: { userId: admin, link } })).toBe(1);
  });

  for (const who of ["counsellor", "viewer", "accounts"]) {
    test(`${who} can't see the daily report or be told about it`, async ({ page }) => {
      const id = await userId(who);
      await signIn(page, who);
      await page.goto("/dashboard", { waitUntil: "networkidle" });
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Daily report" })).toHaveCount(0);

      await page.goto("/daily-report");
      await expect(page).toHaveURL(/\/forbidden/);
      expect(await db.notification.count({ where: { userId: id, title: "Daily report" } })).toBe(0);
      expect(await db.dailyReportDelivery.count({ where: { userId: id } })).toBe(0);
    });
  }
});
