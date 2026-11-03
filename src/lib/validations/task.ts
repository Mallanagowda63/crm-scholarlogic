import { z } from "zod";

const validDate = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "Choose a date and time",
});

export const taskSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(120, "Must be 120 characters or fewer"),
  description: z
    .string()
    .trim()
    .max(2000, "Must be 2,000 characters or fewer")
    .transform((value) => value || null),
  type: z.enum(["FOLLOW_UP", "CALL", "MEETING", "OTHER"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  dueAt: validDate,
  reminderMinutes: z.enum(["0", "15", "60", "1440"]),
  assigneeId: z.string().max(64),
  studentId: z.string().max(64),
});

export type TaskFormValues = z.input<typeof taskSchema>;

export const demoSchema = z.object({
  /** "batch:<id>" or "course:<id>". */
  target: z.string().regex(/^(batch|course):.+/, "Choose a batch or course").max(80),
  scheduledAt: validDate,
});

export const attendanceSchema = z
  .object({
    attended: z.enum(["yes", "no"]),
    feedback: z.string().trim().max(2000, "Must be 2,000 characters or fewer"),
  })
  .transform(({ attended, feedback }) => ({ attended: attended === "yes", feedback: feedback || null }));
