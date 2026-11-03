import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";

import { readHidden } from "../scripts/read-hidden.mjs";
import { db, emailOf, fillLogin, path } from "./helpers";

const PASSWORD = "correct-horse-battery";

function run(lines: string[], { args = [] as string[], env = {} as Record<string, string> } = {}) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/create-admin.mjs", ...args], {
      env: { ...process.env, ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(lines.map((line) => `${line}\n`).join(""));
  });
}

let counter = 0;
const newEmail = () => `new.admin.${Date.now()}.${(counter += 1)}@theta.example`;

test.beforeEach(() => db.loginAttempt.deleteMany());

test("creates an admin who can sign in and reach admin pages", async ({ page }) => {
  const email = newEmail();
  const { code, output } = await run(["New Admin", email, PASSWORD, PASSWORD]);
  expect(output).toContain(`Admin account created for ${email}`);
  expect(code).toBe(0);

  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.role).toBe("ADMIN");
  expect(user.isActive).toBe(true);
  expect(user.passwordHash).not.toContain(PASSWORD);
  expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);
  expect(await db.auditLog.count({ where: { entityId: user.id, action: "user.created" } })).toBe(1);

  await page.goto("/login", { waitUntil: "networkidle" });
  await fillLogin(page, email, PASSWORD);
  await page.waitForURL("**/dashboard");
  await page.goto("/settings");
  expect(path(page)).toBe("/settings");
});

test("works with NODE_ENV=production", async () => {
  const email = newEmail();
  const { code } = await run(["Production Admin", email, PASSWORD, PASSWORD], { env: { NODE_ENV: "production" } });
  expect(code).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { email } })).role).toBe("ADMIN");
});

test("saves the email in lowercase, so sign-in can find it", async () => {
  const email = newEmail();
  const { code } = await run(["Case Admin", `  ${email.toUpperCase()}  `, PASSWORD, PASSWORD]);
  expect(code).toBe(0);
  expect(await db.user.count({ where: { email } })).toBe(1);
});

test("refuses to overwrite an existing user, whatever the email's case", async () => {
  const existing = emailOf("viewer");
  const before = await db.user.findUniqueOrThrow({ where: { email: existing } });

  for (const email of [existing, existing.toUpperCase()]) {
    const { code, output } = await run(["Hijacker", email, PASSWORD, PASSWORD]);
    expect(code).toBe(1);
    expect(output).toContain("already exists");
    expect(output).toContain("No account was created");
  }

  const after = await db.user.findUniqueOrThrow({ where: { email: existing } });
  expect(after.passwordHash).toBe(before.passwordHash);
  expect(after.role).toBe("VIEWER");
  expect(after.name).toBe(before.name);
});

test("refuses any command-line argument, so passwords stay out of shell history", async () => {
  const email = newEmail();
  for (const args of [[PASSWORD], ["--password", PASSWORD], [email, PASSWORD]]) {
    const { code, output } = await run([], { args });
    expect(code).toBe(1);
    expect(output).toContain("takes no arguments");
    expect(output).not.toContain(PASSWORD);
  }
  expect(await db.user.count({ where: { email } })).toBe(0);
});

test("rejects bad input without creating anything", async () => {
  const cases: [string, string[], string][] = [
    ["short name", ["A", newEmail(), PASSWORD, PASSWORD], "name of 2 to 120"],
    ["bad email", ["Good Name", "not-an-email", PASSWORD, PASSWORD], "valid email"],
    ["short password", ["Good Name", newEmail(), "short", "short"], "at least 12"],
    ["long password", ["Good Name", newEmail(), "x".repeat(73), "x".repeat(73)], "at most 72"],
    ["mismatch", ["Good Name", newEmail(), PASSWORD, `${PASSWORD}x`], "didn't match"],
    ["input ends early", ["Good Name", newEmail()], "Input ended"],
  ];
  const before = await db.user.count();
  for (const [label, lines, message] of cases) {
    const { code, output } = await run(lines);
    expect(code, label).toBe(1);
    expect(output, label).toContain(message);
  }
  expect(await db.user.count()).toBe(before);
});

test("never prints the password", async () => {
  const { output } = await run(["Quiet Admin", newEmail(), PASSWORD, PASSWORD]);
  expect(output).not.toContain(PASSWORD);
});

test("reports a database problem clearly, without creating anything", async () => {
  const { code, output } = await run(["Good Name", newEmail(), PASSWORD, PASSWORD], {
    env: { DATABASE_URL: "postgresql://nobody:wrong@localhost:1/none" },
  });
  expect(code).toBe(1);
  expect(output).toContain("No account was created");
  expect(output).not.toContain(PASSWORD);
});

test.describe("the hidden password prompt", () => {
  class FakeTerminal extends EventEmitter {
    isRaw = false;
    modes: boolean[] = [];
    paused = false;
    setRawMode(mode: boolean) {
      this.modes.push(mode);
      this.isRaw = mode;
      return this;
    }
    resume() {
      this.paused = false;
      return this;
    }
    pause() {
      this.paused = true;
      return this;
    }
    type(text: string) {
      this.emit("data", Buffer.from(text));
    }
  }

  function setup() {
    const input = new FakeTerminal();
    let shown = "";
    const output = { write: (text: string) => (shown += text) };
    return { input, output, shown: () => shown };
  }

  test("reads what's typed without ever showing it, and restores the terminal", async () => {
    const { input, output, shown } = setup();
    const result = readHidden(input, output, "Password: ");
    input.type("secret");
    input.type("-value\r");
    expect(await result).toBe("secret-value");
    expect(shown()).toBe("Password: \n");
    expect(input.modes).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(input.listenerCount("data")).toBe(0);
  });

  test("handles backspace, including non-English characters", async () => {
    const { input, output } = setup();
    const result = readHidden(input, output, "");
    input.type("abcd\u007f\u007fx");
    input.type("रि\u007f\b");
    input.type("y\n");
    expect(await result).toBe("abxy");
  });

  test("Ctrl+C cancels, and still restores the terminal", async () => {
    const { input, output } = setup();
    const result = readHidden(input, output, "");
    input.type("partial\u0003");
    await expect(result).rejects.toThrow("Cancelled");
    expect(input.modes).toEqual([true, false]);
  });
});

test("the go-live checklist names the command", async () => {
  const { readFileSync } = await import("node:fs");
  expect(readFileSync("GO_LIVE.md", "utf8")).toContain("npm run create-admin");
});

//  the toast import used by this file's sign-in check style consistent.






















