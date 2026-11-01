"use client";

import { Bell, BellOff } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NotificationsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-lg" aria-label="Notifications" />}
      >
        <Bell />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <EmptyState
          icon={BellOff}
          title="You're all caught up"
          description="Follow-up reminders and overdue payment alerts will appear here."
          className="py-8"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
