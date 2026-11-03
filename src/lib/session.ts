import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getModule, type ModuleId } from "@/lib/modules";

/**
 * Reads the user from the database on every request, so a role change, password
 * change or deactivation applies immediately instead of when the cookie expires.
 */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, isActive: true, sessionVersion: true },
  });
  if (!user?.isActive) return null;
  // The password has changed since this session began.
  if (user.sessionVersion !== (session.sessionVersion ?? 0)) return null;

  return { id: user.id, name: user.name, email: user.email, role: user.role };
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For Server Actions, which report a failure to the caller instead of redirecting. */
export async function getUserWithAccess(id: ModuleId) {
  const user = await getCurrentUser();
  return user && getModule(id)?.roles.includes(user.role) ? user : null;
}

export async function requireModuleAccess(id: ModuleId) {
  const user = await requireUser();
  if (!getModule(id)?.roles.includes(user.role)) redirect("/forbidden");
  return user;
}
