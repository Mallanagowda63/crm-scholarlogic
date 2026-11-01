import { expect, test, type Browser } from "@playwright/test";

import { db, DEMO_PASSWORD, emailOf, fillLogin } from "./helpers";

const EMAIL = emailOf("counsellor");
const WRONG = "wrong-password";
const BASE = "http://localhost:3200";

const rows = (email = EMAIL) => db.loginAttempt.count({ where: { email } });

/** Signs in through the real form from a given IP, and reports the outcome. */
async function viaForm(browser: Browser, ip: string, email: string, password: string) {
  const context = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": ip } });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await fillLogin(page, email, password);
  const outcome = await Promise.race([
    page.waitForURL("**/dashboard", { timeout: 30_000 }).then(() => "ok"),
    page.getByText("Too many failed attempts").waitFor({ timeout: 30_000 }).then(() => "limited"),
    page.getByText("Incorrect email or password").waitFor({ timeout: 30_000 }).then(() => "wrong"),
  ]);
  await context.close();
  return outcome;
}

/** Skips the form and posts straight to the public Auth.js endpoint. */
async function direct(browser: Browser, ip: string, email: string, password: string) {
  const context = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": ip } });
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", {
    form: { csrfToken, email, password },
    maxRedirects: 0,
  });
  const signedIn = (await context.cookies()).some((cookie) => cookie.name.includes("session-token"));
  await context.close();
  return signedIn;
}

test.beforeEach(() => db.loginAttempt.deleteMany());
test.afterAll(() => db.loginAttempt.deleteMany());

test("blocks the 6th attempt, even with the right password, per email and IP", async ({ browser }) => {
  for (let i = 0; i < 5; i += 1) expect(await viaForm(browser, "10.0.0.1", EMAIL, WRONG)).toBe("wrong");
  expect(await viaForm(browser, "10.0.0.1", EMAIL, DEMO_PASSWORD)).toBe("limited");
  expect(await rows()).toBe(5);

  expect(await viaForm(browser, "10.0.0.2", EMAIL, DEMO_PASSWORD)).toBe("ok");
  expect(await viaForm(browser, "10.0.0.1", emailOf("admin"), DEMO_PASSWORD)).toBe("ok");
  expect(await viaForm(browser, "10.0.0.1", EMAIL, DEMO_PASSWORD)).toBe("limited");
});

test("the block lifts after 15 minutes, not before", async ({ browser }) => {
  for (let i = 0; i < 5; i += 1) await direct(browser, "10.0.0.1", EMAIL, WRONG);

  await db.loginAttempt.updateMany({ data: { createdAt: new Date(Date.now() - 14 * 60 * 1000) } });
  expect(await viaForm(browser, "10.0.0.1", EMAIL, DEMO_PASSWORD)).toBe("limited");

  await db.loginAttempt.updateMany({ data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) } });
  expect(await viaForm(browser, "10.0.0.1", EMAIL, DEMO_PASSWORD)).toBe("ok");
});

test("a successful sign-in clears the count", async ({ browser }) => {
  for (let i = 0; i < 4; i += 1) await direct(browser, "10.0.0.3", EMAIL, WRONG);
  expect(await viaForm(browser, "10.0.0.3", EMAIL, DEMO_PASSWORD)).toBe("ok");
  expect(await rows()).toBe(0);
});

test("the public endpoint can't be used to get around the limit", async ({ browser }) => {
  for (let i = 0; i < 5; i += 1) await direct(browser, "10.0.0.4", EMAIL, WRONG);
  expect(await rows()).toBe(5);
  expect(await direct(browser, "10.0.0.4", EMAIL, DEMO_PASSWORD)).toBe(false);
  expect(await viaForm(browser, "10.0.0.4", EMAIL, DEMO_PASSWORD)).toBe("limited");

  await db.loginAttempt.deleteMany();
  expect(await direct(browser, "10.0.0.4", EMAIL, DEMO_PASSWORD)).toBe(true);
});

test("forging IP addresses hits the 20-per-email cap", async ({ browser }) => {
  for (let i = 0; i < 20; i += 1) await direct(browser, `172.16.0.${i + 1}`, EMAIL, WRONG);
  expect(await rows()).toBe(20);
  expect(await viaForm(browser, "172.16.9.9", EMAIL, DEMO_PASSWORD)).toBe("limited");
});

test("changing the email's case or spacing counts as the same account", async ({ browser }) => {
  for (const variant of ["COUNSELLOR@theta.example", " counsellor@theta.example ", "Counsellor@Theta.Example", EMAIL, EMAIL]) {
    await direct(browser, "10.0.0.5", variant, WRONG);
  }
  expect(await rows()).toBe(5);
  expect(await viaForm(browser, "10.0.0.5", EMAIL, DEMO_PASSWORD)).toBe("limited");
});

test("a parallel burst can't get through", async ({ browser }) => {
  const burst = await Promise.all(Array.from({ length: 12 }, () => direct(browser, "10.0.0.6", EMAIL, WRONG)));
  expect(burst.every((signedIn) => !signedIn)).toBe(true);
  expect(await viaForm(browser, "10.0.0.6", EMAIL, DEMO_PASSWORD)).toBe("limited");
});

test("unknown emails behave the same, so accounts can't be discovered", async ({ browser }) => {
  const email = "nobody@theta.example";
  for (let i = 0; i < 5; i += 1) expect(await viaForm(browser, "10.0.0.8", email, WRONG)).toBe("wrong");
  expect(await viaForm(browser, "10.0.0.8", email, WRONG)).toBe("limited");
});

test("expired rows get cleaned up", async ({ browser }) => {
  await db.loginAttempt.create({
    data: { email: "old@theta.example", ip: "1.1.1.1", createdAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  await direct(browser, "10.0.0.9", EMAIL, WRONG);
  expect(await rows("old@theta.example")).toBe(0);
});
