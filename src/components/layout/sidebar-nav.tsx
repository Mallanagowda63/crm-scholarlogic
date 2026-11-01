"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModuleDef } from "@/lib/modules";
import { cn } from "@/lib/utils";

export function SidebarNav({
  modules,
  collapsed = false,
  onNavigate,
}: {
  modules: readonly ModuleDef[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = [...new Set(modules.map((definition) => definition.section))];

  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section}>
          {!collapsed && (
            <p className="mb-1.5 px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {section}
            </p>
          )}
          <ul className="space-y-0.5">
            {modules
              .filter((definition) => definition.section === section)
              .map(({ id, href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const link = (
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? label : undefined}
                    className={cn(
                      "flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-primary-soft text-primary-soft-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                );

                return (
                  <li key={id}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger render={link} />
                        <TooltipContent side="right">{label}</TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
