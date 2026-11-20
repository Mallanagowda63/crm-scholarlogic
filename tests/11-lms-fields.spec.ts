import { expect, test } from "@playwright/test";

import { db, emailOf, expectToast, signIn } from "./helpers";

let lastStamp = 0;
/** A fresh valid number, far from the ones in the sample data. */
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `8${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};
const stored = (phone: string) => `+91${phone}`;
const stageId = async (name: string) => (await db.pipelineStage.findUniqueOrThrow({ where: { name } })).id;
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

async function makeGraduate(name: string, stage = "New") {
  const phone = newPhone();
  const student = await db.student.create({
    data: {
      name,
      phone: stored(phone),
      stageId: await stageId(stage),
      assignedToId: await userId("admin"),
      address: "7, Church Street, Bengaluru",
      dateOfBirth: day("2002-09-30"),
      college: `Graduate College ${Date.now()}`,
      degree: "B.Tech",
      degreeStream: "AI & DS",
      degreeScore: "8.4",
      passOutYear: 2024,
      tenthScore: "93",
      twelfthScore: "88",
      preferredMode: "HYBRID",
      joiningDate: day("2026-12-15"),
    },
  });
  return { phone, student };
}

test.describe("LMS registration fields", () => {
  test("the lead form explains bad education details", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New lead" }).click();
    await page.getByLabel(/Full name/).fill("Bad Scores Owl");
    await page.getByLabel(/^Phone/).fill(newPhone());
    await page.getByLabel("10th %").fill("105");
    await page.getByLabel("Degree % or CGPA").fill("eight");
    await page.getByLabel("Pass-out year").fill("1975");
    await page.getByLabel("Date of birth").fill(`${new Date().getFullYear() - 2}-01-01`);
    await page.getByRole("button", { name: "Add lead" }).click();

    await expect(page.getByText("Enter a number from 0 to 100")).toHaveCount(2);
    await expect(page.getByText(/Enter a year from 1980 to \d{4}/)).toBeVisible();
    await expect(page.getByText("Enter a valid date of birth")).toBeVisible();
    expect(await db.student.count({ where: { name: "Bad Scores Owl" } })).toBe(0);
  });

  test("editing loads the saved values and only logs real changes", async ({ page }) => {
    const { phone, student } = await makeGraduate("Edit Graduate Heron");
    await signIn(page, "admin");
    await page.goto(`/leads?q=${phone}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Actions for Edit Graduate Heron" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    await expect(page.getByLabel("Date of birth")).toHaveValue("2002-09-30");
    await expect(page.getByLabel("Degree", { exact: true })).toHaveValue("B.Tech");
    await expect(page.getByLabel("Stream")).toHaveValue("AI & DS");
    await expect(page.getByLabel("Pass-out year")).toHaveValue("2024");
    await expect(page.getByLabel("Mode", { exact: true })).toHaveValue("HYBRID");
    await expect(page.getByLabel("Joining date")).toHaveValue("2026-12-15");

    await page.getByLabel("Degree % or CGPA").fill("8.6");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Lead updated");

    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: student.id, action: "lead.updated" } });
    // The unchanged dates are not reported as changes.
    expect(log.after).toEqual({ degreeScore: "8.6" });
    expect(log.before).toEqual({ degreeScore: "8.4" });
  });

  test("the profile and student list show education details", async ({ page }) => {
    const { student } = await makeGraduate("Profile Graduate Kite", "Enrolled");
    await signIn(page, "admin");

    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
    const main = page.getByRole("main");
    await expect(main).toContainText("7, Church Street, Bengaluru");
    await expect(main).toContainText(/30 Sept? 2002/);
    await expect(main).toContainText("Hybrid");
    await expect(main).toContainText("15 Dec 2026");

    await page.goto(`/students/${student.id}?tab=academics`, { waitUntil: "networkidle" });
    await expect(main).toContainText(student.college!);
    await expect(main).toContainText("B.Tech · AI & DS");
    await expect(main).toContainText("8.4");
    await expect(main).toContainText("2024");

    await page.goto(`/students?q=${encodeURIComponent("Profile Graduate Kite")}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("row", { name: /Profile Graduate Kite/ })).toContainText("B.Tech AI & DS");
  });

  test("leads can be found by college and exported with education details", async ({ page }) => {
    const { student } = await makeGraduate("Search Graduate Wren");
    await signIn(page, "admin");
    await page.goto(`/leads?q=${encodeURIComponent(student.college!)}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("row", { name: /Search Graduate Wren/ })).toContainText("B.Tech AI & DS");

    const response = await page.context().request.get(`/leads/export?q=${encodeURIComponent(student.college!)}`);
    const [header, row] = (await response.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(header).toContain("College,Degree,Stream,Degree Score,Pass-out Year,10th Score,12th Score,Course,Mode,Joining Date");
    expect(header).not.toContain("Target Exam");
    expect(row).toContain(`${student.college},B.Tech,AI & DS,8.4,2024,93,88,,Hybrid,2026-12-15`);
  });

  test("target exams are no longer offered in settings or the lead form", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/settings?section=exams", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: "Target exams" })).toHaveCount(0);
    await expect(page.getByLabel("Add a target exam")).toHaveCount(0);

    await page.goto("/leads", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New lead" }).click();
    await expect(page.getByLabel("College & university")).toBeVisible();
    await expect(page.getByLabel("Target exam")).toHaveCount(0);
    await expect(page.getByLabel("Current class")).toHaveCount(0);
  });
});
