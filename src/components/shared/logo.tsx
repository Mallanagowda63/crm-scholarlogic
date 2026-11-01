import { GraduationCap } from "lucide-react";

import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-indigo-600 to-violet-500 text-white shadow-sm",
        className,
      )}
    >
      <GraduationCap className="size-[18px]" />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight text-foreground">ScholarLogic</span>
        <span className="mt-1 text-[11px] text-muted-foreground">by Theta</span>
      </span>
    </span>
  );
}
