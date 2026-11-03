"use client";

import { KeyRound, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ChangePasswordDialog } from "@/components/layout/change-password-dialog";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout } from "@/hooks/use-logout";
import { ROLE_LABELS, type Role } from "@/lib/roles";

export type ShellUser = { name: string; email: string; role: Role };

export function UserMenu({ user }: { user: ShellUser }) {
  const signOut = useLogout();
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${user.name}`}
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <UserAvatar name={user.name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2.5 p-2 font-normal">
            <UserAvatar name={user.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {user.name}
              </span>
              <span className="block truncate text-xs">{user.email}</span>
            </span>
            <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {user.role === "ADMIN" && (
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings aria-hidden />
            Settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setIsChangingPassword(true)}>
          <KeyRound aria-hidden />
          Change password
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ChangePasswordDialog open={isChangingPassword} onClose={() => setIsChangingPassword(false)} />
    </>
  );
}
