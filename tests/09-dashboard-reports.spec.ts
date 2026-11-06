import { expect, test, type Page } from "@playwright/test";

import { summarisePlan } from "../src/lib/fees";
import { db, emailOf, noHorizontalScroll, signIn, watchForErrors } from "./helpers";

const DAY = 86_400_000;
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;
const stageId = async (name: string) => (await db.pipelineStage.findUniqueOrThrow({ where: { name } })).id;
const india = (date: Date) => new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const startOfKey = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - 330 * 60_000);
const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

let lastStamp = 0;
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `+917${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};

const tile = (page: Page, label: string) =>
  page.getByLabel(/Key numbers|Totals for this period/).locator("div", { hasText: label }).last();

async function expectChart(page: Page, label: string) {
  const chart = page.locator(`[data-chart="${label}"]`);
  await expect(chart.locator("svg.recharts-surface").first()).toBeVisible();
  await expect(chart.locator(".recharts-bar-rectangle").first()).toBeVisible();
}

test.describe("the dashboard", () => {
  test("an admin sees numbers that match the data, charts and lists", async ({ page }) => {
    const problems = watchForErrors(page);
    const now = new Date();
    const monthStart = startOfKey(`${india(now).slice(0, 7)}-01`);
    const live = { deletedAt: null };
    const [newThisMonth, admissions, overdueTasks, plans, collected] = await Promise.all([
      db.student.count({ where: { ...live, createdAt: { gte: monthStart } } }),
      db.admission.count({
        where: { deletedAt: null, status: { not: "CANCELLED" }, admissionDate: { gte: monthStart }, student: live },
      }),
      db.task.count({
        where: { status: "OPEN", dueAt: { lt: now }, OR: [{ studentId: null }, { student: live }] },
      }),
      db.feePlan.findMany({
        where: { cancelledAt: null, student: live },
        include: { instalments: { where: { cancelledAt: null }, orderBy: { sequence: "asc" } }, payments: { where: live } },
      }),
      db.payment.aggregate({ where: { ...live, paidAt: { gte: monthStart }, feePlan: { cancelledAt: null, student: live } }, _sum: { amount: true } }),
    ]);
    const pending = plans.reduce((sum, plan) => sum + summarisePlan(plan, now).balance, 0);

    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    await expect(tile(page, "New leads this month")).toContainText(String(newThisMonth));
    await expect(tile(page, "Admissions this month")).toContainText(String(admissions));
    await expect(tile(page, "Overdue follow-ups")).toContainText(String(overdueTasks));
    await expect(tile(page, "Fees pending")).toContainText(rupees(pending));
    await expect(tile(page, "Fees collected this month")).toContainText(rupees(collected._sum.amount ?? 0));

    for (const chart of ["Lead funnel", "Monthly admissions", "Leads by source", "Counsellor leaderboard"]) {
      await expectChart(page, chart);
    }
    await expect(page.getByRole("region", { name: "Today's follow-ups" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent activity" })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("the conversion rate is enrolled out of the last 12 months' enquiries", async ({ page }) => {
    const yearAgo = new Date(Date.now() - 365 * DAY);
    const start = startOfKey(india(yearAgo));
    const [total, enrolled] = await Promise.all([
      db.student.count({ where: { deletedAt: null, createdAt: { gte: start } } }),
      db.student.count({ where: { deletedAt: null, createdAt: { gte: start }, stage: { type: "WON" } } }),
    ]);
    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(tile(page, "Conversion rate")).toContainText(`${((enrolled / total) * 100).toFixed(1)}%`);
  });

  test("the funnel counts everyone who reached a stage, and never rises", async ({ page }) => {
    const stages = await db.pipelineStage.findMany({ where: { type: { not: "LOST" } }, orderBy: { position: "asc" } });
    const total = await db.student.count({ where: { deletedAt: null } });

    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const card = page.getByRole("region", { name: "Lead funnel" });
    await card.getByText("View as table").click();
    const rows = card.locator("tbody tr");
    await expect(rows).toHaveCount(stages.length);

    const values = (await rows.locator("td:last-child").allTextContents()).map(Number);
    expect(values[0]).toBe(total);
    values.slice(1).forEach((value, index) => expect(value).toBeLessThanOrEqual(values[index]));

    // People lost after a stage still count as having reached it.
    const lostAfterInterested = await db.student.count({
      where: {
        deletedAt: null,
        stage: { name: "Lost" },
        activities: { some: { type: "STAGE_CHANGE", metadata: { path: ["to"], equals: "Interested" } } },
      },
    });
    const atOrPastInterested = await db.student.count({
      where: { deletedAt: null, stage: { name: { in: ["Interested", "Admitted", "Enrolled"] } } },
    });
    const interestedRow = rows.filter({ hasText: "Interested" }).locator("td:last-child");
    await expect(interestedRow).toHaveText(String(lostAfterInterested + atOrPastInterested));
  });

  test("hovering a bar shows its value", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const chart = page.locator('[data-chart="Monthly admissions"]');
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width - 60, box.y + box.height / 2);
    await expect(chart.locator(".recharts-tooltip-wrapper").getByText(/\d/).first()).toBeVisible();
  });

  test("a counsellor sees only their own numbers, without fees or the leaderboard", async ({ page }) => {
    const counsellor = await userId("counsellor");
    const overdue = await db.task.count({
      where: { assigneeId: counsellor, status: "OPEN", dueAt: { lt: new Date() }, OR: [{ studentId: null }, { student: { deletedAt: null } }] },
    });
    await signIn(page, "counsellor");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(tile(page, "Overdue follow-ups")).toContainText(String(overdue));
    await expect(page.getByText("Fees pending")).toHaveCount(0);
    await expect(page.getByText("Counsellor leaderboard")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Today's follow-ups" })).toBeVisible();

    const others = await db.student.findFirstOrThrow({ where: { deletedAt: null, assignedToId: await userId("kavya") } });
    await expect(page.getByRole("region", { name: "Recent activity" }).getByText(others.name, { exact: true })).toHaveCount(0);
  });

  test("the viewer gets totals and charts, but no lists naming students", async ({ page }) => {
    await signIn(page, "viewer");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(tile(page, "Fees pending")).toBeVisible();
    await expectChart(page, "Lead funnel");
    await expect(page.getByText("Today's follow-ups")).toHaveCount(0);
    await expect(page.getByText("Recent activity")).toHaveCount(0);
    // Links to pages this role can't open would only lead to a dead end.
    await expect(page.getByLabel("Key numbers").getByRole("link")).toHaveCount(0);
  });

  test("accounts gets a fees view", async ({ page }) => {
    await signIn(page, "accounts");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(tile(page, "Fees pending")).toBeVisible();
    await expectChart(page, "Monthly collections");
    await expect(page.getByRole("region", { name: "Most overdue" })).toBeVisible();
    await expect(page.getByText("Lead funnel")).toHaveCount(0);
    await expect(page.getByText("New leads this month")).toHaveCount(0);
  });

  test("a soft-deleted person isn't counted", async ({ page }) => {
    const student = await db.student.create({
      data: { name: "Deleted Count Akita", phone: newPhone(), stageId: await stageId("New"), deletedAt: new Date() },
    });
    const live = await db.student.count({ where: { deletedAt: null } });
    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const card = page.getByRole("region", { name: "Lead funnel" });
    await card.getByText("View as table").click();
    await expect(card.locator("tbody tr").first().locator("td:last-child")).toHaveText(String(live));
    expect(student.deletedAt).not.toBeNull();
  });

  test("tiles link to where the numbers come from", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Overdue follow-ups/ }).click();
    await page.waitForURL(/\/tasks\?due=overdue/);
  });
});

test.describe("reports", () => {
  const range = (from: string, to: string) => `/reports?from=${from}&to=${to}`;

  test("source conversion matches the data for the chosen dates", async ({ page }) => {
    const to = india(new Date());
    const from = india(new Date(Date.now() - 400 * DAY));
    const source = await db.leadSource.findUniqueOrThrow({ where: { name: "Referral" } });
    const period = { gte: startOfKey(from), lt: new Date(startOfKey(to).getTime() + DAY) };
    const [leads, enrolled] = await Promise.all([
      db.student.count({ where: { deletedAt: null, sourceId: source.id, createdAt: period } }),
      db.student.count({ where: { deletedAt: null, sourceId: source.id, createdAt: period, stage: { type: "WON" } } }),
    ]);
    expect(leads).toBeGreaterThan(0);

    await signIn(page, "admin");
    await page.goto(range(from, to), { waitUntil: "networkidle" });
    const row = page.locator('[data-source="Referral"]');
    await expect(row.locator("td").nth(1)).toHaveText(String(leads));
    await expect(row.locator("td").nth(2)).toHaveText(String(enrolled));
    await expect(row.locator("td").nth(3)).toHaveText(`${((enrolled / leads) * 100).toFixed(1)}%`);
    await expectChart(page, "Conversion by source");
    await expectChart(page, "Revenue by course");
  });

  test("dates filter the numbers, and include the whole last day in India", async ({ page }) => {
    const source = await db.leadSource.findFirstOrThrow({ where: { name: "Walk-in" } });
    // 11:30 PM in India on 10 March 2020, which is still 10 March there but UTC agrees only by chance.
    await db.student.create({
      data: {
        name: "Edge Date Beagle",
        phone: newPhone(),
        stageId: await stageId("New"),
        sourceId: source.id,
        createdAt: new Date("2020-03-10T18:00:00Z"),
      },
    });
    await signIn(page, "admin");
    await page.goto(range("2020-03-10", "2020-03-10"), { waitUntil: "networkidle" });
    await expect(page.locator('[data-source="Walk-in"]').locator("td").nth(1)).toHaveText("1");

    await page.goto(range("2020-03-11", "2020-03-11"), { waitUntil: "networkidle" });
    await expect(page.getByText("No enquiries", { exact: true })).toBeVisible();
    await expect(page.getByText("No payments in this period.")).toBeVisible();
  });

  test("the date form and quick ranges change the period", async ({ page }) => {
    await signIn(page, "viewer");
    await page.goto("/reports", { waitUntil: "networkidle" });
    await page.getByLabel("From", { exact: true }).fill("2026-01-05");
    await page.getByLabel("To", { exact: true }).fill("2026-02-10");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/from=2026-01-05&to=2026-02-10/);
    await expect(page.getByRole("main")).toContainText("5 Jan 2026 to 10 Feb 2026");

    await page.getByRole("link", { name: "12 months" }).click();
    await page.waitForURL(new RegExp(`to=${india(new Date())}`));
    await expect(page.getByRole("link", { name: "12 months" })).toHaveAttribute("aria-current", "page");
  });

  test("bad or reversed dates don't break the page", async ({ page }) => {
    await signIn(page, "admin");
    expect((await page.goto("/reports?from=banana&to=2026-13-45"))?.status()).toBe(200);
    await page.goto("/reports?from=2026-06-01&to=2026-01-01", { waitUntil: "networkidle" });
    await expect(page.getByRole("main")).toContainText("1 Jan 2026 to 1 Jun 2026");
  });

  test("revenue by course matches payments, and leaves out cancelled ones", async ({ page }) => {
    const to = india(new Date());
    const from = india(new Date(Date.now() - 400 * DAY));
    const period = { gte: startOfKey(from), lt: new Date(startOfKey(to).getTime() + DAY) };
    const course = await db.course.findUniqueOrThrow({ where: { code: "PFS" } });
    const where = { deletedAt: null, paidAt: period, feePlan: { courseId: course.id, student: { deletedAt: null } } };
    const sum = await db.payment.aggregate({ where, _sum: { amount: true } });
    expect(sum._sum.amount).toBeGreaterThan(0);

    await signIn(page, "admin");
    await page.goto(range(from, to), { waitUntil: "networkidle" });
    const card = page.getByRole("region", { name: "Revenue by course" });
    await card.getByText("View as table").click();
    await expect(card.locator("tbody tr").filter({ hasText: course.name })).toContainText(rupees(sum._sum.amount!));

    const payment = await db.payment.findFirstOrThrow({ where });
    await db.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } });
    try {
      await page.reload({ waitUntil: "networkidle" });
      await card.getByText("View as table").click();
      await expect(card.locator("tbody tr").filter({ hasText: course.name })).toContainText(rupees(sum._sum.amount! - payment.amount));
    } finally {
      await db.payment.update({ where: { id: payment.id }, data: { deletedAt: null } });
    }
  });

  test("counsellor performance lists each active counsellor with correct numbers", async ({ page }) => {
    const to = india(new Date());
    const from = india(new Date(Date.now() - 400 * DAY));
    const period = { gte: startOfKey(from), lt: new Date(startOfKey(to).getTime() + DAY) };
    const kavya = await userId("kavya");
    const [leads, enrolled] = await Promise.all([
      db.student.count({ where: { deletedAt: null, assignedToId: kavya, createdAt: period } }),
      db.student.count({ where: { deletedAt: null, assignedToId: kavya, createdAt: period, stage: { type: "WON" } } }),
    ]);
    await signIn(page, "admin");
    await page.goto(range(from, to), { waitUntil: "networkidle" });
    const row = page.locator('[data-counsellor="Kavya Reddy"]');
    await expect(row.locator("td").nth(1)).toHaveText(String(leads));
    await expect(row.locator("td").nth(2)).toHaveText(String(enrolled));
    await expect(page.locator("[data-counsellor]")).toHaveCount(await db.user.count({ where: { role: "COUNSELLOR", isActive: true } }));
  });

  for (const [report, header] of [
    ["sources", "Source,Leads,Enrolled,Conversion %"],
    ["counsellors", "Counsellor,Leads,Enrolled"],
    ["revenue", "Course,Payments,Collected (Rs)"],
  ] as const) {
    test(`the ${report} report exports as CSV`, async ({ page }) => {
      await signIn(page, "viewer");
      const response = await page.context().request.get(`/reports/export?report=${report}&from=2020-01-01&to=${india(new Date())}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/csv");
      expect(response.headers()["content-disposition"]).toContain(`scholarlogic-${report}-2020-01-01`);
      const lines = (await response.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
      expect(lines[0]).toContain(header);
      expect(lines.length).toBeGreaterThan(1);
    });
  }

  test("exports neutralise formulas, and refuse unknown reports", async ({ page }) => {
    const source = await db.leadSource.create({ data: { name: `=cmd${Date.now()}` } });
    await db.student.create({ data: { name: "Formula Source Collie", phone: newPhone(), stageId: await stageId("New"), sourceId: source.id } });
    await signIn(page, "admin");
    const today = india(new Date());
    const text = await (await page.context().request.get(`/reports/export?report=sources&from=${today}&to=${today}`)).text();
    expect(text).toContain(`'${source.name}`);
    expect((await page.context().request.get("/reports/export?report=nope")).status()).toBe(404);
    expect(await db.auditLog.count({ where: { action: "report.exported" } })).toBeGreaterThan(0);
  });

  for (const who of ["counsellor", "accounts"]) {
    test(`${who} can't open reports or exports`, async ({ page }) => {
      await signIn(page, who);
      for (const url of ["/reports", "/reports/export?report=revenue"]) {
        const response = await page.context().request.get(url, { maxRedirects: 0 });
        expect(response.status(), url).toBe(307);
        expect(response.headers().location, url).toMatch(/\/forbidden$/);
      }
    });
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const who of ["admin", "counsellor", "accounts", "viewer"]) {
    test(`the ${who} dashboard fits the screen`, async ({ page }) => {
      await signIn(page, who);
      await page.goto("/dashboard", { waitUntil: "networkidle" });
      await noHorizontalScroll(page);
    });
  }

  test("reports fit the screen", async ({ page }) => {
    const problems = watchForErrors(page);
    await signIn(page, "admin");
    await page.goto("/reports", { waitUntil: "networkidle" });
    await noHorizontalScroll(page);
    expect(problems).toEqual([]);
  });
});

test.describe("dark mode", () => {
  test("charts use the theme's colours", async ({ page }) => {
    await signIn(page, "admin");
    await page.getByRole("button", { name: "Toggle light and dark mode" }).click();
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    const bar = page.locator('[data-chart="Lead funnel"] .recharts-bar-rectangle path').first();
    await expect(bar).toHaveAttribute("fill", "var(--chart-1)");
  });
});
