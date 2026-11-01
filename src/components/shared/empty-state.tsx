import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-14 text-center", className)}>
      <div className="relative mb-5" aria-hidden>
        <div className="absolute -inset-3 rounded-full bg-primary-soft/60" />
        <div className="relative flex size-14 items-center justify-center rounded-2xl border bg-card text-primary-soft-foreground shadow-sm">
          <Icon className="size-6" />
        </div>
      </div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
