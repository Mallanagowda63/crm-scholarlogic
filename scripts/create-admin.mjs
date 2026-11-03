// Creates an admin account from the command line, including in production.
// Plain JavaScript, so it runs on a production install without development tools.

import { createInterface } from "node:readline/promises";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { readHidden } from "./read-hidden.mjs";

const MIN_PASSWORD_LENGTH = 12;
// bcrypt ignores anything past 72 bytes, so a longer password would be weaker than it looks.
const MAX_PASSWORD_BYTES = 72;

function fail(message) {
  console.error(`\nNo account was created. ${message}`);
  process.exit(1);
}

if (process.argv.length > 2) {
  fail("This command takes no arguments, because a password passed that way is saved in shell history. Run it alone and answer the prompts.");
}

// Real environment variables win over the file, as a production host would set them.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file, which is normal in production.
}
if (!process.env.DATABASE_URL) fail("DATABASE_URL isn't set.");

const isTerminal = Boolean(process.stdin.isTTY);
// When input is piped, as in automated tests, each answer is one line.
const pipedLines = isTerminal ? null : createInterface({ input: process.stdin })[Symbol.asyncIterator]();

async function ask(question) {
  if (pipedLines) {
    const { value, done } = await pipedLines.next();
    if (done) fail("Input ended before all the questions were answered.");
    return value;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(question);
  prompt.close();
  return answer;
}

function askPassword(question) {
  return pipedLines ? ask(question) : readHidden(process.stdin, process.stdout, question);
}

const db = new PrismaClient();

try {
  console.log("Create a ScholarLogic admin account.\n");

  const name = (await ask("Full name: ")).trim();
  if (name.length < 2 || name.length > 120) fail("Enter a name of 2 to 120 characters.");

  // Stored the same way the sign-in form looks it up.
  const email = (await ask("Email: ")).trim().toLowerCase();
  if (!z.email().safeParse(email).success) fail("That isn't a valid email address.");

  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    fail("An account with that email already exists, and this command never changes existing accounts.");
  }

  const password = await askPassword(`Password (at least ${MIN_PASSWORD_LENGTH} characters, hidden as you type): `);
  if ([...password].length < MIN_PASSWORD_LENGTH) fail(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) fail(`The password must be at most ${MAX_PASSWORD_BYTES} bytes.`);

  const confirmation = await askPassword("Confirm password: ");
  if (confirmation !== password) fail("The passwords didn't match.");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { name, email, passwordHash, role: "ADMIN" } });
    await tx.auditLog.create({
      data: {
        action: "user.created",
        entityType: "User",
        entityId: created.id,
        after: { name, role: "ADMIN", via: "create-admin" },
      },
    });
    return created;
  });

  console.log(`\nAdmin account created for ${user.email}.`);
} catch (error) {
  if (error?.message === "Cancelled") fail("Cancelled.");
  // Someone else created this email between the check and the save.
  if (error?.code === "P2002") fail("An account with that email already exists, and this command never changes existing accounts.");
  fail(`The database reported an error: ${error?.message ?? error}`);
} finally {
  await db.$disconnect();
}

process.exit(0);
