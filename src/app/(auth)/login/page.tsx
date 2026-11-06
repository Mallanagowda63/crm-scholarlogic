import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/(auth)/login/login-form";
import { Logo } from "@/components/shared/logo";
import { DEMO_PASSWORD, DEMO_USERS } from "@/lib/demo-users";
import { ROLE_LABELS } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";
import { BrandStyle } from "@/components/shared/brand-style";
import { getBranding } from "@/server/branding";

export const metadata: Metadata = { title: "Sign in" };

const JOURNEY = ["Enquiry", "Contacted", "Demo class", "Admission", "Fees", "Enrolled"];

/** Only same-site paths are allowed, so a crafted link can't send people to another website. */
function safeCallbackUrl(value: string | string[] | undefined) {
  const isSafe =
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.startsWith("/login");
  return isSafe ? value : "/dashboard";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  if (await getCurrentUser()) redirect(callbackUrl);

  const branding = await getBranding();
  // Production hides them, as they show a password, unless a local copy turns them on.
  const showDemoAccounts = process.env.NODE_ENV !== "production" || process.env.SHOW_DEMO_ACCOUNTS === "true";
  const demoAccounts = !showDemoAccounts
    ? undefined
    : {
        password: DEMO_PASSWORD,
        users: DEMO_USERS.map(({ email, role }) => ({ email, role: ROLE_LABELS[role] })),
      };

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <BrandStyle primary={branding.primaryColor} accent={branding.accentColor} />
      <section className="relative hidden flex-col justify-between overflow-hidden bg-linear-to-br from-primary to-(--brand-accent) p-12 text-white lg:flex">
        <div
          aria-hidden
          className="absolute -top-32 -right-32 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-violet-400/20 blur-3xl"
        />
        <p className="relative text-lg font-semibold tracking-tight">ScholarLogic</p>
        <div className="relative">
          <h1 className="max-w-md text-4xl font-semibold tracking-tight text-balance">
            Every student journey, from first enquiry to enrolment.
          </h1>
          <ol className="mt-8 flex flex-wrap items-center gap-2 text-sm">
            {JOURNEY.map((step) => (
              <li key={step} className="rounded-full bg-white/15 px-3 py-1 backdrop-blur">
                {step}
              </li>
            ))}
          </ol>
        </div>
        <p className="relative text-sm text-white/80">Built for {branding.name}</p>
      </section>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-8" orgName={branding.name} logoUrl={branding.logoUrl} />
          <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            Sign in to your ScholarLogic account.
          </p>
          <LoginForm callbackUrl={callbackUrl} demoAccounts={demoAccounts} />
        </div>
      </main>
    </div>
  );
}
