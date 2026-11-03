import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { BrandStyle } from "@/components/shared/brand-style";
import { SIDEBAR_COOKIE } from "@/lib/constants";
import { requireUser } from "@/lib/session";
import { getBranding } from "@/server/branding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const cookieStore = await cookies();
  const branding = await getBranding();

  return (
    <>
      <BrandStyle primary={branding.primaryColor} accent={branding.accentColor} />
      <AppShell
        user={{ name: user.name, email: user.email, role: user.role }}
        orgName={branding.name}
        logoUrl={branding.logoUrl}
        defaultCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "1"}
      >
        {children}
      </AppShell>
    </>
  );
}
