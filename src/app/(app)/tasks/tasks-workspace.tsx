"use client";

import { CalendarDays, List, Loader2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { TaskDialog } from "@/app/(app)/tasks/task-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useTypedBeforeHydration } from "@/hooks/use-typed-before-hydration";
import { TASK_PRIORITY_LABELS, tasksHref, type TaskFilters } from "@/lib/tasks";
import { cn } from "@/lib/utils";

const TaskWorkspaceContext = createContext<{ openTask: (id: string) => void; openNew: () => void } | null>(null);

export function useTaskWorkspace() {
  const workspace = useContext(TaskWorkspaceContext);
  if (!workspace) throw new Error("useTaskWorkspace must be used inside TasksWorkspace");
  return workspace;
}

export function TasksWorkspace({
  filters,
  assignees,
  canAssign,
  children,
}: {
  filters: TaskFilters;
  assignees: { id: string; name: string }[];
  canAssign: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; taskId: string | null }>({ open: false, taskId: null });

  const openTask = useCallback((taskId: string) => setDialog({ open: true, taskId }), []);
  const openNew = useCallback(() => setDialog({ open: true, taskId: null }), []);
  const closeDialog = useCallback(() => setDialog((current) => ({ ...current, open: false })), []);
  const workspace = useMemo(() => ({ openTask, openNew }), [openTask, openNew]);

  // Tracks the newest choice, so a second quick change builds on the first instead of undoing it.
  const latestFilters = useRef(filters);
  useEffect(() => {
    latestFilters.current = filters;
  }, [filters]);

  const navigate = useCallback(
    (changes: Partial<TaskFilters>) => {
      const next = { ...latestFilters.current, page: 1, ...changes };
      latestFilters.current = next;
      startTransition(() => router.push(tasksHref(next), { scroll: false }));
    },
    [router],
  );

  const [search, setSearch] = useState(filters.q);
  const searchInput = useRef<HTMLInputElement>(null);
  useTypedBeforeHydration(searchInput, search, setSearch);
  useEffect(() => {
    if (search.trim() === filters.q) return;
    const timer = setTimeout(() => navigate({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [search, filters.q, navigate]);

  const isList = filters.view === "list";

  return (
    <TaskWorkspaceContext.Provider value={workspace}>
      <PageHeader
        title="Tasks"
        description="Follow-ups, calls and meetings, with demo classes on the calendar."
        actions={
          <Button size="lg" onClick={openNew}>
            <Plus aria-hidden />
            New task
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="View">
          {(
            [
              { view: "list", label: "List", icon: List },
              { view: "calendar", label: "Calendar", icon: CalendarDays },
            ] as const
          ).map(({ view, label, icon: Icon }) => (
            <Link
              key={view}
              href={tasksHref(filters, { view, page: 1 })}
              aria-current={filters.view === view ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                filters.view === view
                  ? "bg-primary-soft text-primary-soft-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ))}
        </div>

        {isList && (
          <>
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                ref={searchInput}
                type="search"
                aria-label="Search tasks"
                placeholder="Search task or person"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 pl-8"
              />
            </div>
            <FilterSelect
              label="Filter by status"
              value={filters.status}
              onChange={(status) => navigate({ status: status as TaskFilters["status"] })}
            >
              <NativeSelectOption value="OPEN">Open</NativeSelectOption>
              <NativeSelectOption value="DONE">Done</NativeSelectOption>
              <NativeSelectOption value="CANCELLED">Cancelled</NativeSelectOption>
              <NativeSelectOption value="ALL">All statuses</NativeSelectOption>
            </FilterSelect>
            <FilterSelect
              label="Filter by due date"
              value={filters.due}
              onChange={(due) => navigate({ due: due as TaskFilters["due"] })}
            >
              <NativeSelectOption value="">Due: Any</NativeSelectOption>
              <NativeSelectOption value="overdue">Overdue</NativeSelectOption>
              <NativeSelectOption value="today">Today</NativeSelectOption>
              <NativeSelectOption value="upcoming">Upcoming</NativeSelectOption>
            </FilterSelect>
            <FilterSelect
              label="Filter by priority"
              value={filters.priority}
              onChange={(priority) => navigate({ priority: priority as TaskFilters["priority"] })}
            >
              <NativeSelectOption value="">Priority: Any</NativeSelectOption>
              {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </FilterSelect>
          </>
        )}
        {canAssign && (
          <FilterSelect
            label="Filter by assignee"
            value={filters.assignee}
            onChange={(assignee) => navigate({ assignee })}
          >
            <NativeSelectOption value="">Assignee: Anyone</NativeSelectOption>
            {assignees.map(({ id, name }) => (
              <NativeSelectOption key={id} value={id}>
                {name}
              </NativeSelectOption>
            ))}
          </FilterSelect>
        )}
        {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
      </div>

      {children}

      <TaskDialog
        key={`${dialog.taskId ?? "new"}-${dialog.open}`}
        open={dialog.open}
        taskId={dialog.taskId}
        assignees={assignees}
        canAssign={canAssign}
        onClose={closeDialog}
      />
    </TaskWorkspaceContext.Provider>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="[&>select]:h-9"
    >
      {children}
    </NativeSelect>
  );
}
