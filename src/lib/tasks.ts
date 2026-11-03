import { z } from "zod";

export const TASK_PAGE_SIZE = 25;

export const TASK_TYPE_LABELS = { FOLLOW_UP: "Follow-up", CALL: "Call", MEETING: "Meeting", OTHER: "Other" } as const;
export const TASK_PRIORITY_LABELS = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;
export const TASK_STATUS_LABELS = { OPEN: "Open", DONE: "Done", CANCELLED: "Cancelled" } as const;

export const REMINDER_OPTIONS = [
  { value: "0", label: "No reminder" },
  { value: "15", label: "15 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
] as const;

export function reminderTime(dueAt: Date, minutes: number) {
  return minutes > 0 ? new Date(dueAt.getTime() - minutes * 60_000) : null;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const taskFiltersSchema = z.object({
  view: z.enum(["list", "calendar"]).catch("list"),
  mode: z.enum(["month", "week", "day"]).catch("month"),
  date: z
    .string()
    .refine((value) => DATE_KEY.test(value) && !Number.isNaN(Date.parse(value)))
    .optional()
    .catch(undefined),
  q: z.string().trim().max(100).catch(""),
  status: z.enum(["OPEN", "DONE", "CANCELLED", "ALL"]).catch("OPEN"),
  priority: z.enum(["", "LOW", "MEDIUM", "HIGH"]).catch(""),
  due: z.enum(["", "overdue", "today", "upcoming"]).catch(""),
  assignee: z.string().max(64).catch(""),
  page: z.coerce.number().int().min(1).catch(1),
});

export type TaskFilters = z.infer<typeof taskFiltersSchema>;

const DEFAULTS = taskFiltersSchema.parse({});

export function tasksHref(filters: TaskFilters, changes: Partial<TaskFilters> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...changes })) {
    if (value !== undefined && value !== DEFAULTS[key as keyof TaskFilters]) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

export function hasActiveTaskFilters({ q, status, priority, due, assignee }: TaskFilters) {
  return Boolean(q || priority || due || assignee || status !== "OPEN");
}
