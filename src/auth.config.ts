import type { NextAuthConfig } from "next-auth";

/** Edge-safe settings shared with middleware. Must not import Prisma or bcrypt. */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      if (nextUrl.pathname === "/login" || auth?.user) return true;

      const loginUrl = new URL("/login", nextUrl);
      loginUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
      return Response.redirect(loginUrl);
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
