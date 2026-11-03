import { z } from "zod";

export const noteSchema = z.object({
  body: z.string().trim().min(1, "Write a note first").max(5000, "Must be 5,000 characters or fewer"),
});

export const contactSchema = z.object({
  type: z.enum(["CALL", "EMAIL", "WHATSAPP"]),
  body: z.string().trim().min(1, "Add a short summary").max(5000, "Must be 5,000 characters or fewer"),
});

export const followUpSchema = z.object({
  title: z.string().trim().max(120, "Must be 120 characters or fewer"),
  dueAt: z.string().refine(
    (value) => {
      const time = new Date(value).getTime();
      // A minute of grace, for the time between filling in the form and it arriving.
      return !Number.isNaN(time) && time > Date.now() - 60_000;
    },
    { message: "Choose a date and time in the future" },
  ),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reminderMinutes: z.enum(["0", "15", "60", "1440"]),
});

const THIS_YEAR = new Date().getFullYear();

export const academicSchema = z.object({
  qualification: z.string().trim().min(1, "Enter the qualification").max(80, "Must be 80 characters or fewer"),
  institution: z.string().trim().min(1, "Enter the school or institution").max(160, "Must be 160 characters or fewer"),
  year: z.string().transform((value, context) => {
    const year = Number(value.trim());
    if (!Number.isInteger(year) || year < 1990 || year > THIS_YEAR + 1) {
      context.addIssue({ code: "custom", message: `Enter a year from 1990 to ${THIS_YEAR + 1}` });
      return z.NEVER;
    }
    return year;
  }),
  score: z
    .string()
    .trim()
    .max(40, "Must be 40 characters or fewer")
    .transform((value) => value || null),
});

export type AcademicFormValues = z.input<typeof academicSchema>;
