import type { NextAuthConfig } from "next-auth";

import { BASE_PATH } from "@/lib/base-path";

/** Edge-safe settings shared with middleware. Must not import Prisma or bcrypt. */
export const authConfig = {
  // Under a base path the sign-in routes are found from AUTH_URL (e.g. https://scholarlogiclms.in/crm/api/auth).
  pages: { signIn: `${BASE_PATH}/login` },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      // The logo is public because the sign-in page shows it.
      // Here the path can include the base path (e.g. /crm/login); compare without it.
      const full = nextUrl.pathname;
      const path = BASE_PATH && full.startsWith(BASE_PATH) ? full.slice(BASE_PATH.length) || "/" : full;
      if (path === "/login" || path === "/branding/logo" || auth?.user) return true;

      const loginUrl = new URL(`${BASE_PATH}/login`, nextUrl);
      loginUrl.searchParams.set("callbackUrl", BASE_PATH + path + nextUrl.search);
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
