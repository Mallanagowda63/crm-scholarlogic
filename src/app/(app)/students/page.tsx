import { GraduationCap, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { Pager } from "@/app/(app)/students/pager";
import { StudentFilters } from "@/app/(app)/students/student-filters";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { formatShortDate } from "@/lib/format";
import { degreeLine } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { requireModuleAccess, type CurrentUser } from "@/lib/session";
import { STUDENTS_PAGE_SIZE } from "@/lib/students";
import { cn } from "@/lib/utils";
import { listStudents } from "@/server/students";

export const metadata: Metadata = { title: "Students" };

const filtersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  course: z.string().max(64).catch(""),
  page: z.coerce.number().int().min(1).catch(1),
});

type Filters = z.infer<typeof filtersSchema>;

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireModuleAccess("students");
  const filters = filtersSchema.parse(await searchParams);
  const courses = await db.course.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <PageHeader title="Students" description="Everyone currently enrolled at Theta." />
      <StudentFilters q={filters.q} course={filters.course} courses={courses} />
      <Suspense
        fallback={
          <div role="status" aria-label="Loading students" className="space-y-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        }
      >
        <StudentsTable user={user} filters={filters} />
      </Suspense>
    </>
  );
}

async function StudentsTable({ user, filters }: { user: CurrentUser; filters: Filters }) {
  const { rows, total, page, pageCount } = await listStudents(user, filters);

  if (total === 0) {
    return (
      <Card>
        {filters.q || filters.course ? (
          <EmptyState
            icon={SearchX}
            title="No students match these filters"
            description="Try a different search, or clear the filters to see everyone."
            action={
              <Link href="/students" className={cn(buttonVariants({ size: "lg", variant: "outline" }))}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={GraduationCap}
            title="No enrolled students yet"
            description="People appear here when they reach the Enrolled stage in Leads."
          />
        )}
      </Card>
    );
  }

  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.course) params.set("course", filters.course);
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `/students?${query}` : "/students";
  };

  return (
    <>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Degree</TableHead>
              <TableHead className="hidden md:table-cell">Course</TableHead>
              <TableHead className="hidden lg:table-cell">Batch</TableHead>
              <TableHead className="hidden md:table-cell">Counsellor</TableHead>
              <TableHead className="hidden xl:table-cell">Enrolled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((student) => {
              const enrollment = student.enrollments[0];
              return (
                <TableRow key={student.id}>
                  <TableCell>
                    <Link
                      href={`/students/${student.id}`}
                      className="rounded font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {student.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{formatPhone(student.phone)}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{degreeLine(student) ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="block max-w-52 truncate">{student.courseInterest?.name ?? "—"}</span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{enrollment?.batch.name ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {student.assignedTo ? (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <UserAvatar name={student.assignedTo.name} size="sm" />
                        {student.assignedTo.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">
                    {enrollment ? formatShortDate(enrollment.enrolledAt) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <Pager
        summary={`${(page - 1) * STUDENTS_PAGE_SIZE + 1}–${Math.min(page * STUDENTS_PAGE_SIZE, total)} of ${total.toLocaleString("en-IN")}`}
        page={page}
        pageCount={pageCount}
        hrefFor={pageHref}
      />
    </>
  );
}
