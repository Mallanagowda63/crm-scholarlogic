export const ROLES = ["ADMIN", "COUNSELLOR", "ACCOUNTS", "VIEWER"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  COUNSELLOR: "Counsellor",
  ACCOUNTS: "Accounts",
  VIEWER: "Viewer",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
