import { cn } from "@/lib/utils";

/** Colours come from settings, so the text stays neutral to keep good contrast with any choice. */
export function StageBadge({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
        borderColor: `color-mix(in oklch, ${color} 30%, transparent)`,
      }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}
