import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Middleware only checks that a session exists. Role checks read the database in src/lib/session.ts.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
