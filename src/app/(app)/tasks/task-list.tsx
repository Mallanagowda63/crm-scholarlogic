"use client";

import { Check, CheckSquare, RotateCcw, SearchX } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { useTaskWorkspace } from "@/app/(app)/tasks/tasks-workspace";
import { Pager } from "@/app/(app)/students/pager";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import {
  hasActiveTaskFilters,
  TASK_PAGE_SIZE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  tasksHref,
  type TaskFilters,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { setTaskStatus } from "@/server/actions/tasks";
import type { TaskRow } from "@/server/tasks";

const PRIORITY_CLASS = {
  LOW: "text-muted-foreground",
  MEDIUM: "text-foreground",
  HIGH: "font-medium text-destructive",
} as const;

export function TaskList({
  rows,
  total,
  page,
  pageCount,
  filters,
  now,
}: {
  rows: TaskRow[];
  total: number;
  page: number;
  pageCount: number;
  filters: TaskFilters;
  now: Date;
}) {
  const { openTask, openNew } = useTaskWorkspace();

  if (total === 0) {
    return (
      <Card>
        {hasActiveTaskFilters(filters) ? (
          <EmptyState
            icon={SearchX}
            title="No tasks match these filters"
            description="Try different filters to see more."
            action={
              <Link href="/tasks" className={cn(buttonVariants({ size: "lg", variant: "outline" }))}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={CheckSquare}
            title="No open tasks"
            description="You're up to date. Add a task to keep track of what's next."
            action={
              <Button size="lg" onClick={openNew}>
                Add a task
              </Button>
            }
          />
        )}
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="hidden lg:table-cell">Priority</TableHead>
              <TableHead className="hidden md:table-cell">Linked to</TableHead>
              <TableHead className="hidden xl:table-cell">Assigned to</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((task) => {
              const isOverdue = task.status === "OPEN" && new Date(task.dueAt) < now;
              return (
                <TableRow key={task.id}>
                  <TableCell className="max-w-48 whitespace-normal sm:max-w-none">
                    <button
                      type="button"
                      onClick={() => openTask(task.id)}
                      className={cn(
                        "rounded text-left font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
                        task.status !== "OPEN" && "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </button>
                    <span className="block text-xs text-muted-foreground">
                      {TASK_TYPE_LABELS[task.type]}
                      {task.status !== "OPEN" && ` · ${TASK_STATUS_LABELS[task.status]}`}
                    </span>
                  </TableCell>
                  <TableCell className={cn("whitespace-normal sm:whitespace-nowrap", isOverdue && "font-medium text-destructive")}>
                    {formatDateTime(new Date(task.dueAt))}
                    {isOverdue && <span className="block text-xs font-normal">Overdue</span>}
                  </TableCell>
                  <TableCell className={cn("hidden lg:table-cell", PRIORITY_CLASS[task.priority])}>
                    {TASK_PRIORITY_LABELS[task.priority]}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {task.student ? (
                      <Link href={`/students/${task.student.id}`} className="rounded hover:underline">
                        {task.student.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <UserAvatar name={task.assignee.name} size="sm" />
                      {task.assignee.name}
                    </span>
                  </TableCell>
                  <TableCell className="w-10">
                    <StatusButton taskId={task.id} title={task.title} status={task.status} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <Pager
        summary={`${(page - 1) * TASK_PAGE_SIZE + 1}–${Math.min(page * TASK_PAGE_SIZE, total)} of ${total.toLocaleString("en-IN")}`}
        page={page}
        pageCount={pageCount}
        hrefFor={(target) => tasksHref(filters, { page: target })}
      />
    </>
  );
}

function StatusButton({ taskId, title, status }: { taskId: string; title: string; status: TaskRow["status"] }) {
  const [isPending, startTransition] = useTransition();
  const isOpen = status === "OPEN";

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={isPending}
      aria-label={isOpen ? `Mark "${title}" as done` : `Reopen "${title}"`}
      onClick={() =>
        startTransition(async () => {
          const result = await setTaskStatus(taskId, isOpen ? "DONE" : "OPEN");
          if (result.ok) toast.success(isOpen ? "Task completed" : "Task reopened");
          else toast.error(result.error);
        })
      }
    >
      {isOpen ? <Check /> : <RotateCcw />}
    </Button>
  );
}
