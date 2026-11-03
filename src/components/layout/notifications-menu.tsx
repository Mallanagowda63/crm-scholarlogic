"use client";

import { Bell, BellOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationFeed,
} from "@/server/actions/notifications";

const CHECK_EVERY_MS = 60_000;

export function NotificationsMenu() {
  const router = useRouter();
  const [feed, setFeed] = useState<NotificationFeed>({ items: [], unread: 0 });

  const refresh = useCallback(() => {
    // A missed check isn't worth interrupting anyone for, as the next one is a minute away.
    getNotifications()
      .then(setFeed)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  function open(id: string, link: string | null) {
    setFeed((current) => ({
      unread: Math.max(0, current.unread - (current.items.find((item) => item.id === id)?.isRead ? 0 : 1)),
      items: current.items.map((item) => (item.id === id ? { ...item, isRead: true } : item)),
    }));
    void markNotificationRead(id).catch(() => undefined);
    if (link) router.push(link);
  }

  function markAll() {
    setFeed((current) => ({ unread: 0, items: current.items.map((item) => ({ ...item, isRead: true })) }));
    void markAllNotificationsRead().catch(() => undefined);
  }

  return (
    <DropdownMenu onOpenChange={(isOpen) => isOpen && refresh()}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="relative"
            aria-label={feed.unread > 0 ? `Notifications, ${feed.unread} unread` : "Notifications"}
          />
        }
      >
        <Bell />
        {feed.unread > 0 && (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white"
          >
            {feed.unread > 99 ? "99+" : feed.unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {feed.items.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="You're all caught up"
            description="Follow-up reminders and overdue payment alerts will appear here."
            className="py-8"
          />
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {feed.items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={() => open(item.id, item.link)}
                className="flex-col items-start gap-0.5 py-2"
              >
                <span className="flex w-full items-center gap-1.5">
                  {!item.isRead && <span aria-label="Unread" className="size-1.5 shrink-0 rounded-full bg-primary" />}
                  <span className={cn("text-sm", !item.isRead && "font-medium")}>{item.title}</span>
                </span>
                <span className="text-xs whitespace-normal text-muted-foreground">{item.message}</span>
                <span className="text-[11px] text-muted-foreground">{formatDateTime(new Date(item.createdAt))}</span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
        {feed.unread > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={markAll} className="justify-center text-primary-soft-foreground">
              Mark all as read
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
