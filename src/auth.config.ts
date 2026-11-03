import type { NextAuthConfig } from "next-auth";

/** Edge-safe settings shared with middleware. Must not import Prisma or bcrypt. */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      // The logo is public because the sign-in page shows it.
      if (nextUrl.pathname === "/login" || nextUrl.pathname === "/branding/logo" || auth?.user) return true;

      const loginUrl = new URL("/login", nextUrl);
      loginUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
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
