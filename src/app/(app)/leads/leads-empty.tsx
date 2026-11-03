"use client";

import { SearchX, UserPlus } from "lucide-react";
import Link from "next/link";

import { useLeadWorkspace } from "@/app/(app)/leads/lead-dialogs";
import { EmptyState } from "@/components/shared/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { hasActiveFilters, type LeadFilters } from "@/lib/leads";
import { cn } from "@/lib/utils";

export function LeadsEmpty({ filters }: { filters: LeadFilters }) {
  const { openCreate } = useLeadWorkspace();

  return (
    <Card>
      {hasActiveFilters(filters) ? (
        <EmptyState
          icon={SearchX}
          title="No leads match these filters"
          description="Try a different search, or clear the filters to see everyone."
          action={
            <Link
              href={filters.view === "board" ? "/leads?view=board" : "/leads"}
              className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
            >
              Clear filters
            </Link>
          }
        />
      ) : (
        <EmptyState
          icon={UserPlus}
          title="No leads yet"
          description="Add your first enquiry, or import a list from a CSV file."
          action={
            <Button size="lg" onClick={openCreate}>
              Add a lead
            </Button>
          }
        />
      )}
    </Card>
  );
}
