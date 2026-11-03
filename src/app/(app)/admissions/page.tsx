import { FileText, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { AdmissionFilters } from "@/app/(app)/admissions/admission-filters";
import { Pager } from "@/app/(app)/students/pager";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatShortDate } from "@/lib/format";
import { requireModuleAccess, type CurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getAdmissionsList } from "@/server/fees";

export const metadata: Metadata = { title: "Admissions" };

const PAGE_SIZE = 25;
const STATUS = {
  PENDING: { label: "Pending", className: "text-amber-700 dark:text-amber-400" },
  CONFIRMED: { label: "Confirmed", className: "text-emerald-700 dark:text-emerald-400" },
  CANCELLED: { label: "Cancelled", className: "text-muted-foreground" },
} as const;

const filtersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  status: z.enum(["", "PENDING", "CONFIRMED", "CANCELLED"]).catch(""),
  page: z.coerce.number().int().min(1).catch(1),
});

type Filters = z.infer<typeof filtersSchema>;

export default async function AdmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireModuleAccess("admissions");
  const filters = filtersSchema.parse(await searchParams);

  return (
    <>
      <PageHeader title="Admissions" description="Everyone who has joined, with their documents and fee plan status." />
      <AdmissionFilters q={filters.q} status={filters.status} />
      <Suspense
        fallback={
          <div role="status" aria-label="Loading admissions" className="space-y-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        }
      >
        <AdmissionsTable user={user} filters={filters} />
      </Suspense>
    </>
  );
}

async function AdmissionsTable({ user, filters }: { user: CurrentUser; filters: Filters }) {
  const { rows, total, page, pageCount } = await getAdmissionsList(user, filters, PAGE_SIZE);

  if (total === 0) {
    return (
      <Card>
        {filters.q || filters.status ? (
          <EmptyState icon={SearchX} title="No admissions match these filters" description="Try different filters to see more." />
        ) : (
          <EmptyState
            icon={FileText}
            title="No admissions yet"
            description="Create one from the Admission tab of a lead's profile."
            action={
              <Link href="/leads" className="text-sm text-primary-soft-foreground hover:underline">
                Go to Leads
              </Link>
            }
          />
        )}
      </Card>
    );
  }

  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `/admissions?${query}` : "/admissions";
  };

  return (
    <>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Batch</TableHead>
              <TableHead className="hidden sm:table-cell">Documents</TableHead>
              <TableHead className="hidden lg:table-cell">Fee plan</TableHead>
              <TableHead className="hidden xl:table-cell">Admitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((admission) => {
              const required = admission.checklistItems.filter((item) => item.isRequired);
              const done = required.filter((item) => item.completedAt).length;
              return (
                <TableRow key={admission.id}>
                  <TableCell className="max-w-48 whitespace-normal sm:max-w-none">
                    <Link
                      href={`/students/${admission.student.id}?tab=admission`}
                      className="rounded font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {admission.student.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{admission.course.name}</span>
                  </TableCell>
                  <TableCell className={cn("font-medium", STATUS[admission.status].className)}>
                    {STATUS[admission.status].label}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {admission.batch?.name ?? <span className="text-muted-foreground">Not chosen</span>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {done} of {required.length}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {admission.feePlanId ? "Set up" : <span className="text-muted-foreground">Not set up</span>}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">
                    {formatShortDate(admission.admissionDate)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <Pager
        summary={`${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString("en-IN")}`}
        page={page}
        pageCount={pageCount}
        hrefFor={hrefFor}
      />
    </>
  );
}
