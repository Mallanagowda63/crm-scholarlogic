"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

import { logout } from "@/server/actions/auth";

export function useLogout() {
  const router = useRouter();

  return useCallback(async () => {
    try {
      await logout();
      toast.success("You've been signed out");
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Couldn't sign you out. Please try again.");
    }
  }, [router]);
}
