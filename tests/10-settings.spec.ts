import { expect, test, type Browser, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";

import { db, DEMO_PASSWORD, emailOf, expectToast, fillLogin, newSignedInContext, noHorizontalScroll, path, signIn, watchForErrors } from "./helpers";

const NEW_PASSWORD = "brand-new-password-1";
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;
const stageId = async (name: string) => (await db.pipelineStage.findUniqueOrThrow({ where: { name } })).id;
const section = (name: string) => `/settings?section=${name}`;

let serial = 0;
const unique = (label: string) => `${label} ${Date.now()}${(serial += 1)}`;
const newEmail = () => `user.${Date.now()}.${(serial += 1)}@theta.example`;
let lastStamp = 0;
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `+916${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};

async function makeUser(role: "ADMIN" | "COUNSELLOR" | "ACCOUNTS" | "VIEWER" = "VIEWER") {
  const email = newEmail();
  return db.user.create({
    data: { name: unique("Temp User"), email, role, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 4) },
  });
}

test.beforeEach(() => db.loginAttempt.deleteMany());

test.describe("users", () => {
  test("an admin adds a user, with validation, and they can sign in", async ({ page, browser }) => {
    await signIn(page, "admin");
    await page.goto(section("users"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(dialog.getByText("Enter a name")).toBeVisible();
    await expect(dialog.getByText("Use at least 12 characters")).toBeVisible();

    const email = newEmail();
    await dialog.getByLabel("Full name").fill("New Accounts Person");
    await dialog.getByLabel("Email").fill(email.toUpperCase());
    await dialog.getByLabel("Role").selectOption("ACCOUNTS");
    await dialog.getByLabel(/^Password/).fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expectToast(page, "User added");

    const saved = await db.user.findUniqueOrThrow({ where: { email } });
    expect(saved.role).toBe("ACCOUNTS");
    expect(saved.passwordHash).not.toContain(NEW_PASSWORD);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: saved.id, action: "user.created" } });
    expect(JSON.stringify(audit.after)).not.toContain(NEW_PASSWORD);

    const context = await browser.newContext({ baseURL: "http://localhost:3200" });
    const fresh = await context.newPage();
    await fresh.goto("/login", { waitUntil: "networkidle" });
    await fillLogin(fresh, email, NEW_PASSWORD);
    await fresh.waitForURL("**/dashboard");
    await context.close();
  });

  test("duplicate emails are refused", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto(section("users"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Full name").fill("Copy Person");
    await dialog.getByLabel("Email").fill(emailOf("viewer"));
    await dialog.getByLabel(/^Password/).fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expectToast(page, "Someone already uses that email.");
  });

  test("changing a role applies to their live session", async ({ page, browser }) => {
    const target = await makeUser("VIEWER");
    const theirs = await browser.newContext({ baseURL: "http://localhost:3200" });
    const theirPage = await theirs.newPage();
    await theirPage.goto("/login", { waitUntil: "networkidle" });
    await fillLogin(theirPage, target.email, DEMO_PASSWORD);
    await theirPage.waitForURL("**/dashboard");

    await signIn(page, "admin");
    await page.goto(section("users"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Edit ${target.name}` }).click();
    await page.getByRole("dialog").getByLabel("Role").selectOption("ACCOUNTS");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expectToast(page, "User updated");

    await theirPage.goto("/fees");
    expect(path(theirPage)).toBe("/fees");
    await theirs.close();
  });

  test("deactivating signs someone out, and takes them out of round robin", async ({ page, browser }) => {
    const target = await makeUser("COUNSELLOR");
    const theirs = await browser.newContext({ baseURL: "http://localhost:3200" });
    const theirPage = await theirs.newPage();
    await theirPage.goto("/login", { waitUntil: "networkidle" });
    await fillLogin(theirPage, target.email, DEMO_PASSWORD);
    await theirPage.waitForURL("**/dashboard");

    await signIn(page, "admin");
    await page.goto(section("users"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Deactivate ${target.name}` }).click();
    await expectToast(page, `${target.name} deactivated`);

    await theirPage.goto("/dashboard");
    expect(path(theirPage)).toBe("/login");
    await theirs.close();

    // A brand new counsellor is first in line, unless they've been deactivated.
    const created = newPhone();
    await page.goto("/leads", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New lead" }).click();
    await page.getByLabel(/Full name/).fill("After Deactivation Newt");
    await page.getByLabel(/^Phone/).fill(created);
    await page.getByRole("button", { name: "Add lead" }).click();
    await expectToast(page, "Lead added");
    const lead = await db.student.findFirstOrThrow({ where: { phone: created } });
    expect(lead.assignedToId).not.toBe(target.id);
    await expect(page.getByLabel("Filter by counsellor").locator("option", { hasText: target.name })).toHaveCount(0);
  });

  test("you can't deactivate yourself, or remove the last admin", async ({ page }) => {
    const admins = await db.user.findMany({ where: { role: "ADMIN", isActive: true, email: { not: emailOf("admin") } } });
    await db.user.updateMany({ where: { id: { in: admins.map(({ id }) => id) } }, data: { isActive: false } });
    try {
      await signIn(page, "admin");
      await page.goto(section("users"), { waitUntil: "networkidle" });
      const me = await db.user.findUniqueOrThrow({ where: { email: emailOf("admin") } });
      await expect(page.getByRole("button", { name: `Deactivate ${me.name}` })).toHaveCount(0);

      await page.getByRole("button", { name: `Edit ${me.name}` }).click();
      await page.getByRole("dialog").getByLabel("Role").selectOption("VIEWER");
      await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
      await expectToast(page, "This is the only admin, so their role can't change.");
      expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).role).toBe("ADMIN");
    } finally {
      await db.user.updateMany({ where: { id: { in: admins.map(({ id }) => id) } }, data: { isActive: true } });
    }
  });

  test("an admin's password reset ends the person's sessions and works", async ({ page, browser }) => {
    const target = await makeUser("VIEWER");
    const theirs = await browser.newContext({ baseURL: "http://localhost:3200" });
    const theirPage = await theirs.newPage();
    await theirPage.goto("/login", { waitUntil: "networkidle" });
    await fillLogin(theirPage, target.email, DEMO_PASSWORD);
    await theirPage.waitForURL("**/dashboard");

    await signIn(page, "admin");
    await page.goto(section("users"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Reset password for ${target.name}` }).click();
    await page.getByRole("dialog").getByLabel(/New password/).fill("short");
    await page.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
    await expectToast(page, "Use at least 12 characters");
    await page.getByRole("dialog").getByLabel(/New password/).fill(NEW_PASSWORD);
    await page.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
    await expectToast(page, "Password reset");

    await theirPage.goto("/dashboard");
    expect(path(theirPage)).toBe("/login");
    await fillLogin(theirPage, target.email, DEMO_PASSWORD);
    await expectToast(theirPage, "Incorrect email or password.");
    await fillLogin(theirPage, target.email, NEW_PASSWORD);
    await theirPage.waitForURL("**/dashboard");
    await theirs.close();
  });
});

test.describe("your own password", () => {
  async function openChange(page: Page) {
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Change password" }).click();
    return page.getByRole("dialog");
  }

  test("needs the current password, and signs you out everywhere when changed", async ({ page, browser }) => {
    const target = await makeUser("COUNSELLOR");
    await page.goto("/login", { waitUntil: "networkidle" });
    await fillLogin(page, target.email, DEMO_PASSWORD);
    await page.waitForURL("**/dashboard");

    const other = await browser.newContext({ baseURL: "http://localhost:3200" });
    const otherPage = await other.newPage();
    await otherPage.goto("/login", { waitUntil: "networkidle" });
    await fillLogin(otherPage, target.email, DEMO_PASSWORD);
    await otherPage.waitForURL("**/dashboard");

    const dialog = await openChange(page);
    await dialog.getByLabel("Current password").fill("not-the-password");
    await dialog.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await dialog.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(dialog.getByText("Your current password isn't right.")).toBeVisible();

    await dialog.getByLabel("Confirm new password").fill("something-else-entirely");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(dialog.getByText("The passwords don't match")).toBeVisible();

    await dialog.getByLabel("Current password").fill(DEMO_PASSWORD);
    await dialog.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expectToast(page, "Password changed. Please sign in again.");
    await page.waitForURL("**/login");

    await otherPage.goto("/dashboard");
    expect(path(otherPage)).toBe("/login");
    await other.close();

    await fillLogin(page, target.email, NEW_PASSWORD);
    await page.waitForURL("**/dashboard");
  });
});

test.describe("pipeline stages", () => {
  test("adding a stage places it before Enrolled, and it appears on the board", async ({ page }) => {
    const name = unique("Parent Call").slice(0, 30);
    await signIn(page, "admin");
    await page.goto(section("pipeline"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New stage" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", { name: "Save stage" }).click();
    await expectToast(page, "Stage added");

    const stages = await db.pipelineStage.findMany({ orderBy: { position: "asc" } });
    const types = stages.map((stage) => stage.type);
    expect(types.slice(-2)).toEqual(["WON", "LOST"]);
    expect(stages[stages.length - 3].name).toBe(name);
    expect(new Set(stages.map((stage) => stage.position)).size).toBe(stages.length);

    await page.goto("/leads?view=board", { waitUntil: "networkidle" });
    await expect(page.locator(`section[data-stage="${name}"]`)).toBeVisible();

    await page.goto(section("pipeline"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await expectToast(page, `${name} deleted`);
    expect(await db.pipelineStage.count({ where: { name } })).toBe(0);
  });

  test("built-in stages can't be deleted, and stages with people are protected", async ({ page }) => {
    const custom = await db.pipelineStage.create({
      data: { name: unique("Held Stage").slice(0, 30), color: "#123456", position: 99 },
    });
    await db.student.create({ data: { name: "Held Person Quail", phone: newPhone(), stageId: custom.id } });
    await signIn(page, "admin");
    await page.goto(section("pipeline"), { waitUntil: "networkidle" });

    for (const name of ["Demo Scheduled", "Enrolled", "Lost"]) {
      await expect(page.getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);
    }
    await page.getByRole("button", { name: `Delete ${custom.name}` }).click();
    await expectToast(page, new RegExp(`Move the .* people at ${custom.name} to another stage first`));
    await db.student.updateMany({ where: { stageId: custom.id }, data: { stageId: await stageId("New") } });
    await db.pipelineStage.delete({ where: { id: custom.id } });
  });

  test("stages reorder, but Enrolled and Lost stay last", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto(section("pipeline"), { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Move Enrolled up" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Lost down" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move New up" })).toBeDisabled();

    const order = async () => (await db.pipelineStage.findMany({ orderBy: { position: "asc" } })).map((stage) => stage.name);
    const before = await order();
    await page.getByRole("button", { name: "Move Contacted up" }).click();
    await expectToast(page, "Contacted moved");
    const after = await order();
    expect(after.indexOf("Contacted")).toBe(before.indexOf("Contacted") - 1);

    await page.getByRole("button", { name: "Move Contacted down" }).click();
    await expect.poll(order).toEqual(before);
  });

  test("renaming keeps the funnel history, and demo classes still move people forward", async ({ page }) => {
    const before = await db.activity.count({ where: { type: "STAGE_CHANGE", metadata: { path: ["to"], equals: "Demo Attended" } } });
    expect(before).toBeGreaterThan(0);
    const stage = await db.pipelineStage.findUniqueOrThrow({ where: { name: "Demo Scheduled" } });
    await signIn(page, "admin");
    await page.goto(section("pipeline"), { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Edit Demo Attended" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Trial Attended");
    await dialog.getByRole("button", { name: "Save stage" }).click();
    await expectToast(page, "Stage updated");
    try {
      expect(await db.activity.count({ where: { type: "STAGE_CHANGE", metadata: { path: ["to"], equals: "Trial Attended" } } })).toBe(before);

      const student = await db.student.create({
        data: { name: "Rename Stage Robin", phone: newPhone(), stageId: stage.id, assignedToId: await userId("admin") },
      });
      await db.demoClass.create({
        data: {
          studentId: student.id,
          courseId: (await db.course.findFirstOrThrow()).id,
          scheduledAt: new Date(Date.now() - 3_600_000),
          counsellorId: await userId("admin"),
        },
      });
      await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Record attendance" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
      await expectToast(page, "Attendance recorded");
      const saved = await db.student.findUniqueOrThrow({ where: { id: student.id }, include: { stage: true } });
      expect(saved.stage.name).toBe("Trial Attended");
    } finally {
      const renamed = await db.pipelineStage.findUniqueOrThrow({ where: { name: "Trial Attended" } });
      await db.pipelineStage.update({ where: { id: renamed.id }, data: { name: "Demo Attended" } });
      await db.$executeRaw`UPDATE "Activity" SET metadata = jsonb_set(metadata::jsonb, '{to}', '"Demo Attended"') WHERE metadata->>'to' = 'Trial Attended'`;
      await db.$executeRaw`UPDATE "Activity" SET metadata = jsonb_set(metadata::jsonb, '{from}', '"Demo Attended"') WHERE metadata->>'from' = 'Trial Attended'`;
    }
  });
});

test.describe("lists", () => {
  for (const { sectionName, label, field } of [
    { sectionName: "sources", label: "Add a source", field: "Filter by source" },
  ]) {
    test(`${sectionName} can be added, renamed and hidden, and forms follow`, async ({ page }) => {
      const name = unique(sectionName).slice(0, 40);
      const renamed = `${name} X`;
      await signIn(page, "admin");
      await page.goto(section(sectionName), { waitUntil: "networkidle" });
      await page.getByLabel(label).fill(name);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expectToast(page, `${name} added`);

      await page.getByLabel(label).fill(name);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expectToast(page, "That name is already on the list.");
      await page.getByLabel(label).fill("");

      await page.getByRole("button", { name: `Rename ${name}` }).click();
      await page.getByLabel(`New name for ${name}`).fill(renamed);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expectToast(page, "Saved");

      const openForm = async () => {
        await page.goto("/leads", { waitUntil: "networkidle" });
        return page.getByLabel(field, { exact: true }).locator("option", { hasText: renamed });
      };
      await expect(await openForm()).toHaveCount(1);

      await page.goto(section(sectionName), { waitUntil: "networkidle" });
      await page.getByRole("button", { name: `Hide ${renamed}` }).click();
      await expectToast(page, `${renamed} hidden`);
      await expect(await openForm()).toHaveCount(0);
    });
  }

  test("branches can be added and offered on batches", async ({ page }) => {
    const name = unique("Whitefield").slice(0, 40);
    await signIn(page, "admin");
    await page.goto(section("branches"), { waitUntil: "networkidle" });
    await page.getByLabel("Add a branch").fill(name);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expectToast(page, `${name} added`);

    await page.goto("/courses", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Add a batch to/ }).first().click();
    await expect(page.getByRole("dialog").getByLabel("Branch").locator("option", { hasText: name })).toHaveCount(1);
  });
});

test.describe("organisation and branding", () => {
  const save = (page: Page) => page.getByRole("button", { name: "Save changes" }).click();

  test("details are validated and new receipts use them, leaving old ones alone", async ({ page }) => {
    const org = await db.orgSettings.findUniqueOrThrow({ where: { id: "default" } });
    await signIn(page, "admin");
    await page.goto(section("organisation"), { waitUntil: "networkidle" });

    await page.getByLabel("GSTIN").fill("NOT-A-GSTIN");
    await save(page);
    await expect(page.getByText("That isn't a valid GSTIN")).toBeVisible();

    await page.getByLabel("GSTIN").fill("29aaaaa1234a1z5");
    await page.getByLabel("Receipt prefix").fill("tc");
    await save(page);
    await expectToast(page, "Organisation saved");
    try {
      const saved = await db.orgSettings.findUniqueOrThrow({ where: { id: "default" } });
      expect(saved.gstin).toBe("29AAAAA1234A1Z5");
      expect(saved.receiptPrefix).toBe("TC");
    } finally {
      await db.orgSettings.update({ where: { id: "default" }, data: { gstin: org.gstin, receiptPrefix: org.receiptPrefix } });
    }
  });

  test("saving other details leaves the brand colours alone", async ({ page }) => {
    const before = await db.orgSettings.findUniqueOrThrow({ where: { id: "default" } });
    await signIn(page, "admin");
    await page.goto(section("organisation"), { waitUntil: "networkidle" });
    await expect(page.getByLabel("Primary colour")).toHaveValue(before.primaryColor.toLowerCase());
    await expect(page.getByLabel("Accent colour")).toHaveValue(before.accentColor.toLowerCase());

    await page.getByLabel("Phone").fill("+919000300000");
    await save(page);
    await expectToast(page, "Organisation saved");
    const after = await db.orgSettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(after.phone).toBe("+919000300000");
    expect(after.primaryColor).toBe(before.primaryColor);
    expect(after.accentColor).toBe(before.accentColor);
    expect(after.logoUrl).toBe(before.logoUrl);
    expect(after.receiptPrefix).toBe(before.receiptPrefix);
  });

  test("editing a stage keeps its colour unless it's changed", async ({ page }) => {
    const before = await db.pipelineStage.findUniqueOrThrow({ where: { name: "Contacted" } });
    await signIn(page, "admin");
    await page.goto(section("pipeline"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Edit Contacted" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Colour")).toHaveValue(before.color.toLowerCase());
    await dialog.getByRole("button", { name: "Save stage" }).click();
    await expectToast(page, "Stage updated");
    const after = await db.pipelineStage.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.color.toLowerCase()).toBe(before.color.toLowerCase());
  });

  test("brand colours apply across the app, and unreadable ones are refused", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto(section("organisation"), { waitUntil: "networkidle" });

    await page.getByLabel("Primary colour").fill("#fff176");
    await save(page);
    await expect(page.getByText(/Too light for white text/)).toBeVisible();

    await page.getByLabel("Primary colour").fill("#0f766e");
    await save(page);
    await expectToast(page, "Organisation saved");
    try {
      await page.goto("/dashboard", { waitUntil: "networkidle" });
      const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
      expect(primary).toBe("#0f766e");
      const context = await page.context().browser()!.newContext({ baseURL: "http://localhost:3200" });
      const signedOut = await context.newPage();
      await signedOut.goto("/login", { waitUntil: "networkidle" });
      expect(await signedOut.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim())).toBe("#0f766e");
      await context.close();
    } finally {
      await db.orgSettings.update({ where: { id: "default" }, data: { primaryColor: "#4F46E5" } });
    }
  });

  test("a colour can't be used to inject anything into the page", async ({ page, browser }) => {
    const request = await (async () => {
      const { context, page: adminPage } = await newSignedInContext(browser, "admin");
      await adminPage.goto(section("organisation"), { waitUntil: "networkidle" });
      const pending = adminPage.waitForRequest(
        (item) => item.method() === "POST" && Boolean(item.headers()["next-action"]) && (item.postData() ?? "").includes("receiptPrefix"),
      );
      await adminPage.getByRole("button", { name: "Save changes" }).click();
      const captured = await pending;
      const result = { url: captured.url(), headers: captured.headers(), body: captured.postData() ?? "", context };
      return result;
    })();
    const attack = request.body.replace(/"primaryColor":"[^"]*"/, '"primaryColor":"red;}</style><script>window.__x=1</script>"');
    const response = await request.context.request.post(request.url, {
      headers: {
        "next-action": request.headers["next-action"],
        "content-type": request.headers["content-type"] ?? "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: "http://localhost:3200",
      },
      data: attack,
    });
    expect(await response.text()).toContain("Use a colour like #4F46E5");
    await request.context.close();
    expect((await db.orgSettings.findUniqueOrThrow({ where: { id: "default" } })).primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    void page;
  });

  test("a logo can be uploaded and shown, including before sign-in, and SVGs are refused", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto(section("organisation"), { waitUntil: "networkidle" });

    await page.getByLabel("Logo image").setInputFiles({
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    await expectToast(page, "Use a PNG, JPG or WebP image.");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.getByLabel("Logo image").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await expectToast(page, "Logo updated");
    await expect(page.getByAltText("Current logo")).toBeVisible();
    try {
      const response = await page.context().request.get("/branding/logo");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");

      const anonymous = await page.context().browser()!.newContext({ baseURL: "http://localhost:3200" });
      const signedOut = await anonymous.newPage();
      expect((await signedOut.request.get("/branding/logo", { maxRedirects: 0 })).status()).toBe(200);
      await signedOut.goto("/login", { waitUntil: "networkidle" });
      await expect(signedOut.locator('img[src="/branding/logo"]').first()).toBeVisible();
      await anonymous.close();

      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await expectToast(page, "Logo removed");
      expect((await page.context().request.get("/branding/logo")).status()).toBe(404);
    } finally {
      await db.orgSettings.update({ where: { id: "default" }, data: { logoUrl: null } });
    }
  });
});

test.describe("templates and messages", () => {
  test("an admin adds and edits a template, and unknown variables are refused", async ({ page }) => {
    const name = unique("Exam Reminder").slice(0, 40);
    await signIn(page, "admin");
    await page.goto("/communication", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New template" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Message").fill("Hi {{name}}, your {{fee_amount}} is due.");
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog.getByText(/can be used/)).toBeVisible();

    await dialog.getByLabel("Channel").selectOption("EMAIL");
    await dialog.getByLabel("Subject").fill("Reminder for {{course}}");
    await dialog.getByLabel("Message").fill("Hi {{name}}, {{course}} is due on {{due_date}}.");
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expectToast(page, "Template added");

    const saved = await db.messageTemplate.findUniqueOrThrow({ where: { name } });
    expect(saved.channel).toBe("EMAIL");
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await expect(dialog.getByLabel("Subject")).toHaveValue("Reminder for {{course}}");
  });

  test("a counsellor can use templates but not change them", async ({ page }) => {
    await signIn(page, "counsellor");
    await page.goto("/communication", { waitUntil: "networkidle" });
    await expect(page.getByRole("region", { name: "First contact" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New template" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  });

  test("a template fills in for the person, opens WhatsApp and logs it", async ({ page }) => {
    const course = await db.course.findUniqueOrThrow({ where: { code: "DA" } });
    const student = await db.student.create({
      data: {
        name: "Template Fill Sparrow",
        phone: newPhone(),
        parentName: "Rekha Sparrow",
        parentPhone: newPhone(),
        stageId: await stageId("Admitted"),
        assignedToId: await userId("counsellor"),
        courseInterestId: course.id,
      },
    });
    const dueDate = new Date("2027-04-20T10:00:00Z");
    await db.feePlan.create({
      data: {
        studentId: student.id,
        courseId: course.id,
        totalAmount: course.fee,
        gstRateBps: course.gstRateBps,
        instalments: { create: [{ sequence: 1, amount: Math.round((course.fee * 11800) / 10000), dueDate }] },
      },
    });

    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Message", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Template").selectOption({ label: "Fee reminder (WhatsApp)" });

    const body = dialog.locator("#message-body");
    await expect(body).toHaveValue(/Hi Template Fill Sparrow, your Data Analytics & Power BI Mastery fee instalment is due on 20 Apr 2027/);

    const link = dialog.getByRole("link", { name: "Open WhatsApp" });
    expect(await link.getAttribute("href")).toContain(`https://wa.me/${student.phone.slice(1)}?text=Hi%20Template`);

    await dialog.getByLabel("Send to").selectOption("parent");
    expect(await link.getAttribute("href")).toContain(`https://wa.me/${student.parentPhone!.slice(1)}?text=`);
    await body.fill("Edited message for the parent.");
    expect(await link.getAttribute("href")).toContain(encodeURIComponent("Edited message for the parent."));

    // The link opens in a new tab, which is answered here so the test never reaches the real site.
    await page.context().route("https://wa.me/**", (route) => route.fulfill({ status: 200, body: "stub" }));
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await popup.close();
    await expect
      .poll(() => db.activity.count({ where: { studentId: student.id, type: "WHATSAPP", body: { contains: "Edited message for the parent." } } }))
      .toBe(1);
    const saved = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(saved.lastContactedAt).not.toBeNull();
  });

  test("email templates need an email address", async ({ page }) => {
    const student = await db.student.create({
      data: { name: "No Email Thrush", phone: newPhone(), stageId: await stageId("New"), assignedToId: await userId("counsellor") },
    });
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Message", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Template").selectOption({ label: "Welcome email (Email)" });
    await expect(dialog.getByText("This person has no email address.")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open email" })).toHaveCount(0);
  });

  test("the contact log only shows a counsellor their own people", async ({ page }) => {
    const other = await db.student.create({
      data: { name: "Other Log Wren", phone: newPhone(), stageId: await stageId("New"), assignedToId: await userId("kavya") },
    });
    await db.activity.create({ data: { studentId: other.id, type: "CALL", body: "Private log entry" } });
    await signIn(page, "counsellor");
    await page.goto("/communication?view=log", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Pagination")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Other Log Wren");
  });
});

test.describe("access", () => {
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

  for (const who of ["counsellor", "accounts", "viewer"]) {
    test(`${who} can't open settings`, async ({ page }) => {
      await signIn(page, who);
      const response = await page.context().request.get("/settings", { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toMatch(/\/forbidden$/);
    });
  }

  for (const who of ["accounts", "viewer"]) {
    test(`${who} can't open communication`, async ({ page }) => {
      await signIn(page, who);
      const response = await page.context().request.get("/communication", { maxRedirects: 0 });
      expect(response.status()).toBe(307);
    });
  }

  test("a counsellor can't make themselves an admin with a direct request", async ({ browser }) => {
    const me = await db.user.findUniqueOrThrow({ where: { email: emailOf("counsellor") } });
    const { context, page } = await newSignedInContext(browser, "admin");
    await page.goto(section("users"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Edit ${me.name}` }).click();
    const dialog = page.getByRole("dialog");
    const pending = page.waitForRequest(
      (item) => item.method() === "POST" && Boolean(item.headers()["next-action"]) && (item.postData() ?? "").includes(me.id),
    );
    await dialog.getByLabel("Role").selectOption("ADMIN");
    await dialog.getByRole("button", { name: "Save" }).click();
    const captured = await pending;
    const request = { url: captured.url(), headers: captured.headers(), body: captured.postData() ?? "" };
    await expectToast(page, "User updated");
    await context.close();
    await db.user.update({ where: { id: me.id }, data: { role: "COUNSELLOR" } });

    expect(await replay(browser, "counsellor", request)).toContain("You don't have permission");
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).role).toBe("COUNSELLOR");
  });
});

test.describe("every page", () => {
  const PAGES: [string, string[]][] = [
    ["admin", ["/dashboard", "/reports", "/leads", "/leads?view=board", "/students", "/admissions", "/courses", "/tasks", "/tasks?view=calendar", "/communication", "/communication?view=log", "/fees", "/settings", "/settings?section=pipeline", "/settings?section=organisation"]],
    ["counsellor", ["/dashboard", "/leads", "/students", "/admissions", "/courses", "/tasks", "/communication"]],
    ["accounts", ["/dashboard", "/students", "/fees"]],
    ["viewer", ["/dashboard", "/reports"]],
  ];

  for (const [who, urls] of PAGES) {
    test(`${who}: pages load without browser errors, in light and dark`, async ({ page }) => {
      const problems = watchForErrors(page);
      await signIn(page, who);
      for (const url of urls) await page.goto(url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Toggle light and dark mode" }).click();
      await expect(page.locator("html")).toHaveClass(/dark/);
      for (const url of urls.slice(0, 3)) await page.goto(url, { waitUntil: "networkidle" });
      expect(problems).toEqual([]);
    });
  }

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("settings and communication fit the screen", async ({ page }) => {
      await signIn(page, "admin");
      for (const url of ["/settings", "/settings?section=pipeline", "/settings?section=sources", "/settings?section=organisation", "/communication", "/communication?view=log"]) {
        await page.goto(url, { waitUntil: "networkidle" });
        await noHorizontalScroll(page);
      }
    });
  });
});
