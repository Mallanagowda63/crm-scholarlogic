import type { NextAuthConfig } from "next-auth";

import { BASE_PATH } from "@/lib/base-path";

/** Edge-safe settings shared with middleware. Must not import Prisma or bcrypt. */
export const authConfig = {
  pages: { signIn: `${BASE_PATH}/login` },
  // Auth routes live under the base path too (e.g. /crm/api/auth).
  ...(BASE_PATH ? { basePath: `${BASE_PATH}/api/auth` } : {}),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      // The logo is public because the sign-in page shows it.
      if (nextUrl.pathname === "/login" || nextUrl.pathname === "/branding/logo" || auth?.user) return true;

      const loginUrl = new URL(`${BASE_PATH}/login`, nextUrl);
      loginUrl.searchParams.set("callbackUrl", BASE_PATH + nextUrl.pathname + nextUrl.search);
      return Response.redirect(loginUrl);
    },
    jwt({ token, user }) {
      if (user) token.sessionVersion = user.sessionVersion ?? 0;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.sessionVersion = (token.sessionVersion as number | undefined) ?? 0;
      return session;
    },
  },
} satisfies NextAuthConfig;
