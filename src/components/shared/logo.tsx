import { GraduationCap } from "lucide-react";

import { cn } from "@/lib/utils";

export function LogoMark({ logoUrl, className }: { logoUrl?: string | null; className?: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- an uploaded file served by our own route
      <img src={logoUrl} alt="" className={cn("size-8 shrink-0 rounded-lg object-contain", className)} />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary to-(--brand-accent) text-white shadow-sm",
        className,
      )}
    >
      <GraduationCap className="size-[18px]" />
    </span>
  );
}

export function Logo({
  orgName = "Theta",
  logoUrl,
  className,
}: {
  orgName?: string;
  logoUrl?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark logoUrl={logoUrl} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight text-foreground">ScholarLogic</span>
        <span className="mt-1 truncate text-[11px] text-muted-foreground">by {orgName}</span>
      </span>
    </span>
  );
}
