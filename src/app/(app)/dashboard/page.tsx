import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { formatLongDate, greeting } from "@/lib/format";
import { modulesForRole } from "@/lib/modules";
import { ROLE_LABELS } from "@/lib/roles";
import { requireModuleAccess } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireModuleAccess("dashboard");
  const now = new Date();
  const modules = modulesForRole(user.role).filter((definition) => definition.id !== "dashboard");

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${user.name.split(" ")[0]}`}
        description={formatLongDate(now)}
        actions={<Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>}
      />

      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Your workspace</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map(({ id, href, label, description, icon: Icon, phase }) => (
          <Link
            key={id}
            href={href}
            className="group rounded-xl border bg-card p-5 shadow-xs transition-all outline-none hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <div className="flex items-start justify-between">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <ArrowUpRight
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden
              />
            </div>
            <h3 className="mt-4 text-sm font-semibold">{label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <p className="mt-3 text-xs text-muted-foreground">Arrives in Phase {phase}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
