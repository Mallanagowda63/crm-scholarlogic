import { expect, test } from "@playwright/test";

import { db, DEMO_PASSWORD, emailOf, expectToast, fillLogin, noHorizontalScroll, path, signIn, watchForErrors } from "./helpers";

const ALL = ["dashboard", "reports", "leads", "students", "admissions", "courses", "tasks", "communication", "fees", "settings"];
const ACCESS: Record<string, string[]> = {
  admin: ALL,
  counsellor: ["dashboard", "leads", "students", "admissions", "courses", "tasks", "communication"],
  accounts: ["dashboard", "students", "fees"],
  viewer: ["dashboard", "reports"],
};

test.beforeEach(() => db.loginAttempt.deleteMany());

test.describe("signing in", () => {
  test("signed-out visitors go to login, keeping the page they wanted", async ({ page }) => {
    await page.goto("/leads?stage=new");
    expect(path(page)).toBe("/login");
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/leads?stage=new");

    await signIn(page, "admin", "?callbackUrl=%2Fleads%3Fstage%3Dnew");
    expect(page.url()).toMatch(/\/leads\?stage=new$/);
  });

  test("demo accounts are hidden in production builds", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Development only")).toHaveCount(0);
    expect(await page.content()).not.toContain(DEMO_PASSWORD);
  });

  test("the form validates and rejects bad credentials", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Enter your password")).toBeVisible();

    await fillLogin(page, emailOf("admin"), "wrong-password");
    await expectToast(page, "Incorrect email or password.");
    expect(path(page)).toBe("/login");
  });

  for (const evil of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
    test(`sign-in can't redirect to ${evil}`, async ({ page, baseURL }) => {
      await signIn(page, "admin", `?callbackUrl=${encodeURIComponent(evil)}`);
      expect(new URL(page.url()).origin).toBe(baseURL);
      expect(path(page)).toBe("/dashboard");
    });
  }

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, "admin");
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await expectToast(page, "You've been signed out");
    await page.goto("/dashboard");
    expect(path(page)).toBe("/login");
  });
});

test.describe("roles", () => {
  for (const [who, allowed] of Object.entries(ACCESS)) {
    test(`${who} sees and can open only their modules`, async ({ page }) => {
      await signIn(page, who);

      const nav = await page.locator('nav[aria-label="Main"] a').allTextContents();
      expect(nav.map((label) => label.toLowerCase()).sort()).toEqual([...allowed].sort());

      for (const id of ALL) {
        const response = await page.context().request.get(`/${id}`, { maxRedirects: 0 });
        if (allowed.includes(id)) {
          expect(response.status(), `/${id}`).toBe(200);
        } else {
          expect(response.status(), `/${id}`).toBe(307);
          expect(response.headers().location, `/${id}`).toMatch(/\/forbidden$/);
        }
      }
    });
  }

  test("unknown pages return a real 404", async ({ page }) => {
    await signIn(page, "admin");
    expect((await page.goto("/not-a-module"))?.status()).toBe(404);
  });

  test("role changes and deactivation apply to live sessions", async ({ page }) => {
    const email = emailOf("viewer");
    await signIn(page, "viewer");
    try {
      await db.user.update({ where: { email }, data: { role: "ADMIN" } });
      await page.goto("/settings");
      expect(path(page)).toBe("/settings");

      await db.user.update({ where: { email }, data: { role: "VIEWER" } });
      await page.goto("/settings");
      expect(path(page)).toBe("/forbidden");

      await db.user.update({ where: { email }, data: { isActive: false } });
      await page.goto("/dashboard");
      expect(path(page)).toBe("/login");

      await fillLogin(page, email, DEMO_PASSWORD);
      await expectToast(page, "Incorrect email or password.");
    } finally {
      await db.user.update({ where: { email }, data: { role: "VIEWER", isActive: true } });
    }
  });
});

test.describe("app shell", () => {
  test("the command palette works from the keyboard", async ({ page }) => {
    await signIn(page, "admin");
    await page.waitForLoadState("networkidle");
    const input = page.getByPlaceholder("Search leads, pages or commands...");

    await page.keyboard.press("Control+k");
    await expect(input).toBeFocused();
    await input.fill("fees");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/fees");

    await page.getByRole("button", { name: "Open command palette" }).click();
    await expect(input).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });

  test("the theme toggle persists", async ({ page }) => {
    await signIn(page, "admin");
    await page.getByRole("button", { name: "Toggle light and dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("the sidebar collapses, shows tooltips and remembers its state", async ({ page }) => {
    await signIn(page, "admin");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect.poll(() => page.locator("aside").evaluate((el) => el.getBoundingClientRect().width)).toBe(68);

    await page.locator('nav[aria-label="Main"] a[aria-label="Leads"]').hover();
    await expect(page.locator("[data-slot=tooltip-content]", { hasText: "Leads" })).toBeVisible();

    await page.reload();
    expect(await page.locator("aside").evaluate((el) => el.getBoundingClientRect().width)).toBe(68);
  });

  test("the notifications and user menus open", async ({ page }) => {
    await signIn(page, "admin");
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByText("You're all caught up")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL("**/settings");
  });

  test("the first Tab reaches the skip link", async ({ page }) => {
    await signIn(page, "admin");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Skip to content");
  });

  test("there are no browser errors on main pages", async ({ page }) => {
    const problems = watchForErrors(page);
    await signIn(page, "admin");
    for (const route of ["/dashboard", "/leads", "/leads?view=board", "/reports", "/forbidden"]) {
      await page.goto(route, { waitUntil: "networkidle" });
    }
    expect(problems).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("navigation slides in, and the layout fits", async ({ page }) => {
    await signIn(page, "counsellor");
    await noHorizontalScroll(page);
    await expect(page.locator("aside")).toBeHidden();

    await page.getByRole("button", { name: "Open navigation" }).tap();
    const leads = page.getByRole("dialog").getByRole("link", { name: "Leads" });
    await expect(leads).toBeVisible();
    await leads.tap();
    await page.waitForURL("**/leads");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
