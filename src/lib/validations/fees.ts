import { z } from "zod";

const MAX_RUPEES = 10_000_000;

/** Whole rupees typed by a person, such as "1,50,000", converted to paise. */
export const rupeesToPaise = (options: { min?: number } = {}) =>
  z.string().transform((value, context) => {
    const rupees = Number(value.replace(/[₹,\s]/g, ""));
    const min = options.min ?? 1;
    if (value.trim() === "" || !Number.isFinite(rupees) || rupees < min || rupees > MAX_RUPEES) {
      context.addIssue({ code: "custom", message: `Enter an amount from ₹${min} to ₹1 crore` });
      return z.NEVER;
    }
    // Up to 2 decimal places are allowed, as a part payment can include paise.
    if (Math.round(rupees * 100) !== Number((rupees * 100).toFixed(6))) {
      context.addIssue({ code: "custom", message: "Use at most 2 decimal places" });
      return z.NEVER;
    }
    return Math.round(rupees * 100);
  });

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

const wholeNumber = (label: string, min: number, max: number) =>
  z.string().transform((value, context) => {
    const number = Number(value.trim());
    if (value.trim() === "" || !Number.isInteger(number) || number < min || number > max) {
      context.addIssue({ code: "custom", message: `${label} must be from ${min} to ${max}` });
      return z.NEVER;
    }
    return number;
  });

export const courseSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Use 2 to 20 letters, numbers or hyphens"),
  name: z.string().trim().min(2, "Enter the course name").max(120, "Must be 120 characters or fewer"),
  description: z
    .string()
    .trim()
    .max(1000, "Must be 1,000 characters or fewer")
    .transform((value) => value || null),
  fee: rupeesToPaise(),
  durationMonths: wholeNumber("Duration", 1, 60),
  gstPercent: z.string().transform((value, context) => {
    const percent = Number(value.trim());
    if (value.trim() === "" || !Number.isFinite(percent) || percent < 0 || percent > 28) {
      context.addIssue({ code: "custom", message: "GST must be from 0 to 28%" });
      return z.NEVER;
    }
    return Math.round(percent * 100);
  }),
});

export type CourseFormValues = z.input<typeof courseSchema>;

export const batchSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the batch name").max(80, "Must be 80 characters or fewer"),
    timing: z
      .string()
      .trim()
      .max(80, "Must be 80 characters or fewer")
      .transform((value) => value || null),
    mode: z.enum(["OFFLINE", "ONLINE", "HYBRID"]),
    branchId: z
      .string()
      .max(64)
      .transform((value) => value || null),
    startDate: dateKey,
    endDate: z.union([dateKey, z.literal("")]).transform((value) => value || null),
    capacity: wholeNumber("Capacity", 1, 1000),
  })
  .refine(({ startDate, endDate }) => !endDate || endDate >= startDate, {
    message: "The end date can't be before the start date",
    path: ["endDate"],
  });

export type BatchFormValues = z.input<typeof batchSchema>;

export const admissionSchema = z.object({
  courseId: z.string().min(1, "Choose a course").max(64),
  batchId: z
    .string()
    .max(64)
    .transform((value) => value || null),
  admissionDate: dateKey,
});

export type AdmissionFormValues = z.input<typeof admissionSchema>;

export const feePlanSchema = z.object({
  discount: rupeesToPaise({ min: 0 }),
  instalmentCount: wholeNumber("Instalments", 1, 24),
  firstDueDate: dateKey,
  intervalDays: wholeNumber("Days between instalments", 1, 365),
});

export type FeePlanFormValues = z.input<typeof feePlanSchema>;

export const paymentSchema = z.object({
  amount: rupeesToPaise(),
  method: z.enum(["UPI", "CASH", "CARD", "BANK_TRANSFER"]),
  reference: z
    .string()
    .trim()
    .max(80, "Must be 80 characters or fewer")
    .transform((value) => value || null),
  paidOn: dateKey,
  notes: z
    .string()
    .trim()
    .max(500, "Must be 500 characters or fewer")
    .transform((value) => value || null),
});

export type PaymentFormValues = z.input<typeof paymentSchema>;
