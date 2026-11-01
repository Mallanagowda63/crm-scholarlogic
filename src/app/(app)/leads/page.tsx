import type { Metadata } from "next";
import { Suspense } from "react";

import { LeadsBoard } from "@/app/(app)/leads/leads-board";
import { LeadsEmpty } from "@/app/(app)/leads/leads-empty";
import { LeadsTable } from "@/app/(app)/leads/leads-table";
import { LeadsWorkspace } from "@/app/(app)/leads/leads-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { leadFiltersSchema, type LeadFilters } from "@/lib/leads";
import { requireModuleAccess, type CurrentUser } from "@/lib/session";
import { getBoard, getLeadOptions, listLeads } from "@/server/leads";

export const metadata: Metadata = { title: "Leads" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LeadsPage({ searchParams }: Props) {
  // Runs before anything is sent, so a blocked request gets a real redirect.
  const user = await requireModuleAccess("leads");
  const filters = leadFiltersSchema.parse(await searchParams);
  const options = await getLeadOptions();

  return (
    <LeadsWorkspace filters={filters} options={options} canManage={user.role === "ADMIN"}>
      <Suspense fallback={<LeadsSkeleton view={filters.view} />}>
        <LeadsData user={user} filters={filters} />
      </Suspense>
    </LeadsWorkspace>
  );
}

async function LeadsData({ user, filters }: { user: CurrentUser; filters: LeadFilters }) {
  const now = new Date();

  if (filters.view === "board") {
    const columns = await getBoard(user, filters, now);
    if (columns.every((column) => column.total === 0)) return <LeadsEmpty filters={filters} />;
    return <LeadsBoard columns={columns} now={now} />;
  }

  const { rows, total, page, pageCount } = await listLeads(user, filters, now);
  if (total === 0) return <LeadsEmpty filters={filters} />;
  return <LeadsTable rows={rows} total={total} page={page} pageCount={pageCount} filters={filters} now={now} />;
}

function LeadsSkeleton({ view }: { view: LeadFilters["view"] }) {
  return (
    <div role="status" aria-label="Loading leads">
      {view === "board" ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-96 w-72 shrink-0" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}
