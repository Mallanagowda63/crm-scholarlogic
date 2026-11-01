import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { DEMO_PASSWORD } from "../src/lib/demo-users";

export { DEMO_PASSWORD };

/** A plain client, so tests can see soft-deleted rows and aren't affected by app rules. */
export const db = new PrismaClient();

export const path = (page: Page) => new URL(page.url()).pathname;

export type DemoUser = "admin" | "counsellor" | "accounts" | "viewer";

export const emailOf = (who: string) => `${who}@theta.example`;

export async function fillLogin(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function signIn(page: Page, who: string, query = "") {
  await page.goto(`/login${query}`, { waitUntil: "networkidle" });
  await fillLogin(page, emailOf(who), DEMO_PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function newSignedInContext(browser: Browser, who: string, options = {}) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3200",
    viewport: { width: 1360, height: 860 },
    ...options,
  });
  const page = await context.newPage();
  await signIn(page, who);
  return { context, page };
}

/** Collects browser errors, so a test can fail on anything unexpected. */
export function watchForErrors(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => problems.push(error.message.slice(0, 300)));
  return problems;
}

export async function expectToast(page: Page, text: string | RegExp) {
  // Scoped to toasts because the board's screen-reader announcements can use the same words.
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 });
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

/** Dragging with real mouse moves, so the drag-and-drop library sees what a person would do. */
export async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

export type SignedIn = { context: BrowserContext; page: Page };
