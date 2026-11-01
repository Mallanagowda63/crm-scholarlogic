"use server";

import { AuthError, CredentialsSignin } from "next-auth";

import { signIn, signOut } from "@/auth";
import { loginSchema } from "@/lib/validations/auth";

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(input: unknown): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email and password." };

  try {
    await signIn("credentials", { ...parsed.data, redirect: false });
    return { ok: true };
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      return {
        ok: false,
        error:
          error.code === "rate_limited"
            ? "Too many failed attempts. Please wait 15 minutes and try again."
            : "Incorrect email or password.",
      };
    }
    if (error instanceof AuthError) {
      return { ok: false, error: "Couldn't sign you in. Please try again." };
    }
    throw error;
  }
}

export async function logout() {
  await signOut({ redirect: false });
}
