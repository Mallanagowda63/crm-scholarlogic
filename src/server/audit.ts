import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export function recordAudit(
  tx: Pick<Tx, "auditLog">,
  entry: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  },
) {
  return tx.auditLog.create({ data: entry });
}

/** Lists only the fields that changed, so the log stays readable. */
export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const previous: Record<string, Prisma.InputJsonValue | null> = {};
  const next: Record<string, Prisma.InputJsonValue | null> = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      previous[key] = (before[key] ?? null) as Prisma.InputJsonValue | null;
      next[key] = (after[key] ?? null) as Prisma.InputJsonValue | null;
    }
  }
  return { before: previous, after: next, hasChanges: Object.keys(next).length > 0 };
}
