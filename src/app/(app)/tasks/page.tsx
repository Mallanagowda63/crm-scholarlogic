import type { Metadata } from "next";
import { Suspense } from "react";

import { TaskCalendar } from "@/app/(app)/tasks/task-calendar";
import { TaskList } from "@/app/(app)/tasks/task-list";
import { TasksWorkspace } from "@/app/(app)/tasks/tasks-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { indiaDateKey } from "@/lib/format";
import { requireModuleAccess, type CurrentUser } from "@/lib/session";
import { taskFiltersSchema, type TaskFilters } from "@/lib/tasks";
import { getTaskAssignees, listTasks } from "@/server/tasks";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireModuleAccess("tasks");
  const filters = taskFiltersSchema.parse(await searchParams);
  const assignees = user.role === "ADMIN" ? await getTaskAssignees() : [];

  return (
    <TasksWorkspace filters={filters} assignees={assignees} canAssign={user.role === "ADMIN"}>
      <Suspense
        key={`${filters.view}-${filters.mode}-${filters.date ?? ""}`}
        fallback={
          <div role="status" aria-label="Loading tasks" className="space-y-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        }
      >
        <TasksData user={user} filters={filters} />
      </Suspense>
    </TasksWorkspace>
  );
}

async function TasksData({ user, filters }: { user: CurrentUser; filters: TaskFilters }) {
  const now = new Date();
  if (filters.view === "calendar") {
    return <TaskCalendar user={user} filters={filters} today={indiaDateKey(now)} />;
  }
  const { rows, total, page, pageCount } = await listTasks(user, filters, now);
  return <TaskList rows={rows} total={total} page={page} pageCount={pageCount} filters={filters} now={now} />;
}
