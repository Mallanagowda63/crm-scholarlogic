import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/auth.config";
import { db } from "@/lib/db";
import { loginSchema } from "@/lib/validations/auth";

// Compared against when the account doesn't exist, so response time doesn't reveal which emails do.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await db.user.findUnique({ where: { email: parsed.data.email } });
        const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid || !user.isActive) return null;

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
});
