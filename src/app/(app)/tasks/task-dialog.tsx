"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { REMINDER_OPTIONS, TASK_PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/tasks";
import { taskSchema, type TaskFormValues } from "@/lib/validations/task";
import { searchPeople, type PersonSearchResult } from "@/server/actions/leads";
import { createTask, getTaskForEdit, setTaskStatus, updateTask } from "@/server/actions/tasks";

const EMPTY: TaskFormValues = {
  title: "",
  description: "",
  type: "FOLLOW_UP",
  priority: "MEDIUM",
  dueAt: "",
  reminderMinutes: "60",
  assigneeId: "",
  studentId: "",
};

/** The value a date input needs, in the time zone of whoever is using it. */
function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TaskDialog({
  open,
  taskId,
  assignees,
  canAssign,
  onClose,
}: {
  open: boolean;
  taskId: string | null;
  assignees: { id: string; name: string }[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const isEditing = taskId !== null;
  const [isLoading, setIsLoading] = useState(isEditing && open);
  const [status, setStatus] = useState<"OPEN" | "DONE" | "CANCELLED">("OPEN");
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const [isChangingStatus, startStatusChange] = useTransition();
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues, unknown, z.output<typeof taskSchema>>({
    resolver: zodResolver(taskSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open || !taskId) return;
    let isCurrent = true;
    getTaskForEdit(taskId)
      .then((result) => {
        if (!isCurrent) return;
        if (!result.ok) {
          toast.error(result.error);
          onClose();
          return;
        }
        reset({ ...result.values, dueAt: toLocalInput(result.values.dueAt) });
        setStatus(result.status);
        setPerson(result.values.studentId ? { id: result.values.studentId, name: result.studentName ?? "" } : null);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isCurrent) return;
        toast.error("Couldn't load this task. Please try again.");
        onClose();
      });
    return () => {
      isCurrent = false;
    };
  }, [open, taskId, reset, onClose]);

  async function save() {
    try {
      const raw = getValues();
      // Converted here, because only the browser knows which time zone the person typed in.
      const input = { ...raw, dueAt: new Date(raw.dueAt).toISOString() };
      const result = taskId ? await updateTask(taskId, input) : await createTask(input);
      if (result.ok) {
        toast.success(taskId ? "Task updated" : "Task added");
        onClose();
        return;
      }
      if (result.field) setError(result.field, { message: result.error });
      else toast.error(result.error);
    } catch {
      toast.error("Couldn't save this task. Please try again.");
    }
  }

  function changeStatus(next: "OPEN" | "DONE" | "CANCELLED", message: string) {
    if (!taskId) return;
    startStatusChange(async () => {
      const result = await setTaskStatus(taskId, next);
      if (result.ok) {
        toast.success(message);
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div role="status" aria-label="Loading task" className="space-y-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <form noValidate onSubmit={handleSubmit(save)} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                className="h-10"
                aria-invalid={Boolean(errors.title)}
                aria-describedby="task-title-error"
                {...register("title")}
              />
              {errors.title && (
                <p id="task-title-error" className="text-xs text-destructive">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Due</Label>
                <Input
                  id="task-due"
                  type="datetime-local"
                  className="h-10"
                  aria-invalid={Boolean(errors.dueAt)}
                  aria-describedby="task-due-error"
                  {...register("dueAt")}
                />
                {errors.dueAt && (
                  <p id="task-due-error" className="text-xs text-destructive">
                    {errors.dueAt.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-reminder">Reminder</Label>
                <NativeSelect id="task-reminder" className="w-full [&>select]:h-10" {...register("reminderMinutes")}>
                  {REMINDER_OPTIONS.map(({ value, label }) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-type">Type</Label>
                <NativeSelect id="task-type" className="w-full [&>select]:h-10" {...register("type")}>
                  {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-priority">Priority</Label>
                <NativeSelect id="task-priority" className="w-full [&>select]:h-10" {...register("priority")}>
                  {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {canAssign && (
              <div className="space-y-1.5">
                <Label htmlFor="task-assignee">Assigned to</Label>
                <NativeSelect id="task-assignee" className="w-full [&>select]:h-10" {...register("assigneeId")}>
                  <NativeSelectOption value="">Me</NativeSelectOption>
                  {assignees.map(({ id, name }) => (
                    <NativeSelectOption key={id} value={id}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {errors.assigneeId && <p className="text-xs text-destructive">{errors.assigneeId.message}</p>}
              </div>
            )}

            <PersonPicker
              person={person}
              onChange={(next) => {
                setPerson(next);
                setValue("studentId", next?.id ?? "");
              }}
            />

            <div className="space-y-1.5">
              <Label htmlFor="task-description">Details (optional)</Label>
              <Textarea id="task-description" rows={2} {...register("description")} />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>

            <DialogFooter className="sm:justify-between">
              {isEditing ? (
                <div className="flex flex-wrap gap-2">
                  {status === "OPEN" ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        disabled={isChangingStatus}
                        onClick={() => changeStatus("DONE", "Task completed")}
                      >
                        Mark as done
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="lg"
                        disabled={isChangingStatus}
                        onClick={() => changeStatus("CANCELLED", "Task cancelled")}
                      >
                        Cancel task
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={isChangingStatus}
                      onClick={() => changeStatus("OPEN", "Task reopened")}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              ) : (
                <span />
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="lg" onClick={onClose}>
                  Close
                </Button>
                <Button type="submit" size="lg" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                  {isEditing ? "Save changes" : "Add task"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PersonPicker({
  person,
  onChange,
}: {
  person: { id: string; name: string } | null;
  onChange: (person: { id: string; name: string } | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSearchResult[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      searchPeople(query)
        .then((found) => isCurrent && setResults(found))
        .catch(() => isCurrent && setResults([]));
    }, 200);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [query]);

  if (person) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Linked to</p>
        <p className="flex h-10 items-center justify-between rounded-lg border px-2.5 text-sm">
          <span className="truncate">{person.name}</span>
          <button
            type="button"
            aria-label={`Remove link to ${person.name}`}
            onClick={() => onChange(null)}
            className="rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-4" aria-hidden />
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="task-person">Link to a lead or student (optional)</Label>
      <Input
        id="task-person"
        className="h-10"
        placeholder="Search by name or phone"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-lg border" aria-label="Matching people">
          {results.map(({ id, name, phone, stage }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id, name });
                  setQuery("");
                  setResults([]);
                }}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <span className="min-w-0 truncate font-medium">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {stage} · {phone}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
