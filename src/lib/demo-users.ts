import type { Role } from "./roles";

/** Local development accounts. The seed script refuses to run in production. */
export const DEMO_PASSWORD = "Theta@12345";

export const DEMO_USERS: { name: string; email: string; role: Role }[] = [
  { name: "Priya Sharma", email: "admin@theta.example", role: "ADMIN" },
  { name: "Arjun Nair", email: "counsellor@theta.example", role: "COUNSELLOR" },
  { name: "Meera Iyer", email: "accounts@theta.example", role: "ACCOUNTS" },
  { name: "Rohan Gupta", email: "viewer@theta.example", role: "VIEWER" },
];
