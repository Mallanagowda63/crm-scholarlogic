"use server";

import { AuthError } from "next-auth";

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
    if (error instanceof AuthError) return { ok: false, error: "Incorrect email or password." };
    throw error;
  }
}

export async function logout() {
  await signOut({ redirect: false });
}
