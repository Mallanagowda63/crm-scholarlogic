import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Pager({
  summary,
  page,
  pageCount,
  hrefFor,
}: {
  summary: string;
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <p>{summary}</p>
      <div className="flex items-center gap-2">
        <PageLink href={page > 1 ? hrefFor(page - 1) : null} label="Previous page" icon={ChevronLeft} />
        <span>
          Page {page} of {pageCount}
        </span>
        <PageLink href={page < pageCount ? hrefFor(page + 1) : null} label="Next page" icon={ChevronRight} />
      </div>
    </nav>
  );
}

function PageLink({ href, label, icon: Icon }: { href: string | null; label: string; icon: typeof ChevronLeft }) {
  if (!href) {
    return (
      <Button variant="outline" size="icon-lg" disabled aria-label={label}>
        <Icon />
      </Button>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }))}
    >
      <Icon />
    </Link>
  );
}
