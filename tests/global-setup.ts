import { execSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

/** Builds a fresh test database from the migrations and seed data before each run. */
export default async function globalSetup() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/scholarlogic_test") {
    throw new Error(`Refusing to reset ${url.pathname}. Tests only run against scholarlogic_test.`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  const existing = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = 'scholarlogic_test'`;
  if (existing.length === 0) await admin.$executeRawUnsafe("CREATE DATABASE scholarlogic_test");
  await admin.$disconnect();

  const env = { ...process.env, NODE_ENV: "test" as const };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
