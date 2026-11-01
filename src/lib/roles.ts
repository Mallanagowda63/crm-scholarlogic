import type { Role } from "@prisma/client";

export type { Role };

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  COUNSELLOR: "Counsellor",
  ACCOUNTS: "Accounts",
  VIEWER: "Viewer",
};
