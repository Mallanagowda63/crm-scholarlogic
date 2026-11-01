"use client";

import { Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { CommandPalette } from "@/components/layout/command-palette";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu, type ShellUser } from "@/components/layout/user-menu";
import { Logo, LogoMark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SIDEBAR_COOKIE } from "@/lib/constants";
import { modulesForRole } from "@/lib/modules";
import { cn } from "@/lib/utils";

export function AppShell({
  user,
  defaultCollapsed,
  children,
}: {
  user: ShellUser;
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const modules = modulesForRole(user.role);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    // A cookie, so the server renders the right width on the next load without a flash.
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        <div className={cn("flex h-14 items-center border-b", collapsed ? "justify-center" : "px-5")}>
          <Link
            href="/dashboard"
            aria-label="ScholarLogic home"
            className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {collapsed ? <LogoMark /> : <Logo />}
          </Link>
        </div>
        <SidebarNav modules={modules} collapsed={collapsed} />
        <div className="border-t p-3">
          <Button
            variant="ghost"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={cn(
              "h-9 w-full text-muted-foreground",
              collapsed ? "justify-center" : "justify-start gap-2.5 px-2.5",
            )}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!collapsed && "Collapse"}
          </Button>
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
          <SheetTitle className="flex h-14 items-center border-b px-5 font-normal">
            <Logo />
          </SheetTitle>
          <SidebarNav modules={modules} onNavigate={closeMobile} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card/80 px-3 backdrop-blur sm:px-4">
          <Button
            variant="ghost"
            size="icon-lg"
            className="md:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </Button>

          <Button
            variant="outline"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className="h-9 flex-1 justify-start gap-2 font-normal text-muted-foreground sm:max-w-xs"
          >
            <Search />
            <span className="truncate">Search or jump to...</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:block">
              ⌘/Ctrl K
            </kbd>
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <NotificationsMenu />
            <ThemeToggle />
            <div className="ml-1">
              <UserMenu user={user} />
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>

      <CommandPalette modules={modules} open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
