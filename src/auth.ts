import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/auth.config";
import { db } from "@/lib/db";
import { clearLoginAttempts, clientIp, reserveLoginAttempt } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validations/auth";

// Compared against when the account doesn't exist, so response time doesn't reveal which emails do.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      // Rate limiting lives here because the login form and the public
      // /api/auth/callback/credentials endpoint both pass through this function.
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const ip = clientIp(request);
        await reserveLoginAttempt(email, ip);

        const user = await db.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid || !user.isActive) return null;

        await clearLoginAttempts(email, ip);
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
});
