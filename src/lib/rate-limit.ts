import { CredentialsSignin } from "next-auth";

import { db } from "@/lib/db";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL_AND_IP = 5;
// IP headers can be forged unless a trusted proxy sets them. This cap stops
// someone guessing one account's password by pretending to have many IPs.
const MAX_PER_EMAIL = 20;

export class LoginRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

async function isLimited(email: string, ip: string, limitOffset: number) {
  const since = new Date(Date.now() - WINDOW_MS);
  const [forPair, forEmail] = await Promise.all([
    db.loginAttempt.count({ where: { email, ip, createdAt: { gte: since } } }),
    db.loginAttempt.count({ where: { email, createdAt: { gte: since } } }),
  ]);
  return forPair >= MAX_PER_EMAIL_AND_IP + limitOffset || forEmail >= MAX_PER_EMAIL + limitOffset;
}

/**
 * Records an attempt before the password is checked, so a burst of parallel
 * requests can't all slip through before any failure has been saved.
 * Blocked attempts aren't recorded, so the wait doesn't keep extending.
 */
export async function reserveLoginAttempt(email: string, ip: string) {
  await db.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - WINDOW_MS) } },
  });

  if (await isLimited(email, ip, 0)) throw new LoginRateLimited();
  await db.loginAttempt.create({ data: { email, ip } });
  if (await isLimited(email, ip, 1)) throw new LoginRateLimited();
}

export async function clearLoginAttempts(email: string, ip: string) {
  await db.loginAttempt.deleteMany({ where: { email, ip } });
}
