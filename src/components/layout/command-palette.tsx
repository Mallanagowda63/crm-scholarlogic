"use client";

import { LogOut, Moon, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { searchLeads, type LeadSearchResult } from "@/server/actions/leads";

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
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<LeadSearchResult[]>([]);
  const canSearchLeads = modules.some((definition) => definition.id === "leads");

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

  useEffect(() => {
    if (!canSearchLeads || query.trim().length < 2) {
      setLeads([]);
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      searchLeads(query)
        .then((results) => isCurrent && setLeads(results))
        .catch(() => isCurrent && setLeads([]));
    }, 200);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [query, canSearchLeads]);

  function run(action: () => void) {
    onOpenChange(false);
    setQuery("");
    action();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search leads, jump to a page or run a command."
    >
      <Command>
        <CommandInput
          placeholder={canSearchLeads ? "Search leads, pages or commands..." : "Jump to a page or run a command..."}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {leads.length > 0 && (
            <>
              <CommandGroup heading="Leads">
                {leads.map(({ id, name, phone, stage }) => (
                  // The query is a keyword because the server already matched this lead on fields not shown here.
                  <CommandItem
                    key={id}
                    value={`lead ${id} ${name}`}
                    keywords={[query]}
                    onSelect={() => run(() => router.push(`/leads?q=${encodeURIComponent(phone)}`))}
                  >
                    <User aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span className="text-xs text-muted-foreground">{stage}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
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
