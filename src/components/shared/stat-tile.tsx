import type { LucideIcon } from "lucide-react";
import Link from "next/link";

export function StatTile({
  label,
  value,
  note,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  note?: string;
  icon: LucideIcon;
  href?: string;
}) {
  const body = (
    <>
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>}
    </>
  );
  const className = "block h-full rounded-xl border bg-card p-4 shadow-xs";
  if (!href) return <div className={className}>{body}</div>;
  return (
    <div className="h-full">
      <Link
        href={href}
        className={`${className} transition-colors outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50`}
      >
        {body}
      </Link>
    </div>
  );
}

export function ChartCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border bg-card p-5 shadow-xs">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
