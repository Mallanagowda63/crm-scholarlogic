import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { SIDEBAR_COOKIE } from "@/lib/constants";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const cookieStore = await cookies();

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      defaultCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "1"}
    >
      {children}
    </AppShell>
  );
}
