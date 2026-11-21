import { expect, test, type Locator, type Page } from "@playwright/test";

import { db, emailOf, signIn, watchForErrors } from "./helpers";

let lastStamp = 0;
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `+916${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};
const monthKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(date);

const overview = (page: Page) => page.getByRole("region", { name: "Month at a glance" });
const years = (page: Page) => page.getByRole("region", { name: "Admissions by year" });

function tile(area: Locator, label: string) {
  return area.locator("div").filter({ has: area.page().locator("dt", { hasText: new RegExp(`^${label}$`) }) }).last();
}

async function tileNumber(area: Locator, label: string) {
  const text = await tile(area, label).locator("dd").first().innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function makeLead(name: string, values: { source?: string; stage?: string; lostReason?: string; contacted?: boolean }) {
  const stage = await db.pipelineStage.findUniqueOrThrow({ where: { name: values.stage ?? "New" } });
  const source = values.source ? await db.leadSource.findUniqueOrThrow({ where: { key: values.source } }) : null;
  return db.student.create({
    data: {
      name,
      phone: newPhone(),
      stageId: stage.id,
      sourceId: source?.id ?? null,
      lostReason: values.lostReason ?? null,
      lastContactedAt: values.contacted ? new Date() : null,
      assignedToId: (await db.user.findUniqueOrThrow({ where: { email: emailOf("counsellor") } })).id,
    },
  });
}

test.describe("Admin overview", () => {
  test("shows this month's numbers, and counts new walk-ins, invalid and unanswered enquiries", async ({ page }) => {
    const errors = watchForErrors(page);
    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const area = overview(page);
    const month = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" }).format(new Date());
    await expect(area).toContainText(month);
    // This year's walk-ins and admissions come from the CRM, not the sample figures.
    await expect(area.getByText("are sample figures")).toHaveCount(0);

    const before = {
      walkIns: await tileNumber(area, "Walk-ins"),
      invalid: await tileNumber(area, "Invalid enquiries"),
      pending: await tileNumber(area, "Pending reply"),
    };
    await makeLead("Overview Walk-in Ibis", { source: "walk_in", contacted: true });
    await makeLead("Overview Junk Gull", { stage: "Lost", lostReason: "Invalid enquiry", contacted: true });
    await makeLead("Overview Waiting Crane", {});

    await page.reload({ waitUntil: "networkidle" });
    expect(await tileNumber(area, "Walk-ins")).toBe(before.walkIns + 1);
    expect(await tileNumber(area, "Invalid enquiries")).toBe(before.invalid + 1);
    expect(await tileNumber(area, "Pending reply")).toBe(before.pending + 1);
    expect(errors).toEqual([]);
  });

  test("a year opens month by month, and a month fills the left side", async ({ page }) => {
    const lastYear = new Date().getFullYear() - 1;
    const july = await db.monthlyFigure.findUniqueOrThrow({ where: { year_month: { year: lastYear, month: 7 } } });
    await signIn(page, "admin");
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    await years(page).getByRole("link", { name: new RegExp(`^${lastYear}`) }).click();
    await expect(page).toHaveURL(new RegExp(`year=${lastYear}`), { timeout: 15_000 });
    // The rest of the dashboard streams in after the address changes, so wait for it before clicking again.
    await page.waitForLoadState("networkidle");
    const table = years(page).getByRole("table", { name: `Month by month figures for ${lastYear}` });
    await expect(table).toBeVisible();
    await expect(years(page)).toContainText("Includes sample figures");

    const julyLink = table.getByRole("link", { name: `Show July ${lastYear}` });
    const julyRow = table.getByRole("row").filter({ has: page.getByRole("link", { name: `Show July ${lastYear}` }) });
    await expect(julyRow).toContainText(String(july.admissions));
    await expect(julyRow).toContainText(String(july.plannedCandidates));

    // Opened by its address, as clicking straight after the year change can race the page's streaming.
    const href = await julyLink.getAttribute("href");
    expect(href).toContain(`month=${lastYear}-07`);
    await page.goto(href!, { waitUntil: "networkidle" });
    const area = overview(page);
    await expect(area).toContainText(`July ${lastYear}`);
    await expect(area).toContainText("are sample figures");
    expect(await tileNumber(area, "Walk-ins")).toBe(july.walkIns);
    expect(await tileNumber(area, "Admissions")).toBe(july.admissions);
  });

  test("a number entered by hand replaces the CRM's count for that month", async ({ page }) => {
    const now = new Date();
    const [year, month] = monthKey(now).split("-").map(Number);
    const saved = await db.monthlyFigure.findUnique({ where: { year_month: { year, month } } });
    await db.monthlyFigure.upsert({
      where: { year_month: { year, month } },
      update: { walkIns: 4321 },
      create: { year, month, walkIns: 4321 },
    });
    try {
      await signIn(page, "admin");
      await page.goto("/dashboard", { waitUntil: "networkidle" });
      expect(await tileNumber(overview(page), "Walk-ins")).toBe(4321);
    } finally {
      if (saved) await db.monthlyFigure.update({ where: { id: saved.id }, data: { walkIns: saved.walkIns } });
      else await db.monthlyFigure.delete({ where: { year_month: { year, month } } });
    }
  });

  test("bad or future months fall back to this month", async ({ page }) => {
    await signIn(page, "admin");
    const month = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" }).format(new Date());
    for (const query of ["month=2099-01", "month=not-a-month", "month=1990-05&year=abc"]) {
      await page.goto(`/dashboard?${query}`, { waitUntil: "networkidle" });
      await expect(overview(page)).toContainText(month);
    }
    // There's nothing after this month to step to.
    await expect(page.getByRole("link", { name: "Next month" })).toHaveAttribute("aria-disabled", "true");
  });

  for (const who of ["counsellor", "viewer", "accounts"]) {
    test(`${who} doesn't see the admin overview`, async ({ page }) => {
      await signIn(page, who);
      await page.goto("/dashboard?month=2025-07", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(overview(page)).toHaveCount(0);
      await expect(years(page)).toHaveCount(0);
    });
  }
});
