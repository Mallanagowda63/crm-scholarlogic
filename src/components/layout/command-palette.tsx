"use client";

import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useLogout } from "@/hooks/use-logout";
import type { ModuleDef } from "@/lib/modules";

export function CommandPalette({
  modules,
  open,
  onOpenChange,
}: {
  modules: readonly ModuleDef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const signOut = useLogout();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to a page or run a command."
    >
      <Command>
        <CommandInput placeholder="Jump to a page or run a command..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Go to">
            {modules.map(({ id, href, label, icon: Icon }) => (
              <CommandItem key={id} value={label} onSelect={() => run(() => router.push(href))}>
                <Icon aria-hidden />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Commands">
            <CommandItem value="Switch to light mode" onSelect={() => run(() => setTheme("light"))}>
              <Sun aria-hidden />
              Switch to light mode
            </CommandItem>
            <CommandItem value="Switch to dark mode" onSelect={() => run(() => setTheme("dark"))}>
              <Moon aria-hidden />
              Switch to dark mode
            </CommandItem>
            <CommandItem value="Sign out" onSelect={() => run(() => void signOut())}>
              <LogOut aria-hidden />
              Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
