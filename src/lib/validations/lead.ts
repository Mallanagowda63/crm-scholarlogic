import { z } from "zod";

import { CLASS_OPTIONS } from "@/lib/leads";
import { normalizePhone } from "@/lib/phone";

const MAX_BUDGET_RUPEES = 10_000_000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => value || null);

const optionalId = z
  .string()
  .max(64)
  .transform((value) => value || null);

const requiredPhone = z.string().transform((value, context) => {
  const phone = normalizePhone(value);
  if (!phone) {
    context.addIssue({ code: "custom", message: "Enter a valid phone number" });
    return z.NEVER;
  }
  return phone;
});

const optionalPhone = z.string().transform((value, context) => {
  if (!value.trim()) return null;
  const phone = normalizePhone(value);
  if (!phone) {
    context.addIssue({ code: "custom", message: "Enter a valid phone number" });
    return z.NEVER;
  }
  return phone;
});

// Every field is a string on the way in, so the form and CSV import can share this schema.
export const leadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter the student's name")
    .max(120, "Must be 120 characters or fewer"),
  phone: requiredPhone,
  alternatePhone: optionalPhone,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value, context) => {
      if (!value) return null;
      if (!z.email().safeParse(value).success) {
        context.addIssue({ code: "custom", message: "Enter a valid email address" });
        return z.NEVER;
      }
      return value;
    }),
  parentName: optionalText(120),
  parentPhone: optionalPhone,
  city: optionalText(80),
  currentClass: z.enum(["", ...CLASS_OPTIONS]).transform((value) => value || null),
  board: z.enum(["", "CBSE", "ICSE", "STATE"]).transform((value) => value || null),
  schoolName: optionalText(160),
  targetExamId: optionalId,
  courseInterestId: optionalId,
  sourceId: optionalId,
  /** Entered in rupees and stored in paise. */
  budget: z.string().transform((value, context) => {
    const cleaned = value.replace(/[₹,\s]/g, "");
    if (!cleaned) return null;
    const rupees = Number(cleaned);
    if (!Number.isInteger(rupees) || rupees < 0 || rupees > MAX_BUDGET_RUPEES) {
      context.addIssue({ code: "custom", message: "Enter a whole rupee amount up to ₹1 crore" });
      return z.NEVER;
    }
    return rupees * 100;
  }),
  preferredIntake: optionalText(40),
  notes: optionalText(2000),
  assignedToId: optionalId,
});

export type LeadFormValues = z.input<typeof leadSchema>;
export type LeadValues = z.output<typeof leadSchema>;

export const EMPTY_LEAD: LeadFormValues = {
  name: "",
  phone: "",
  alternatePhone: "",
  email: "",
  parentName: "",
  parentPhone: "",
  city: "",
  currentClass: "",
  board: "",
  schoolName: "",
  targetExamId: "",
  courseInterestId: "",
  sourceId: "",
  budget: "",
  preferredIntake: "",
  notes: "",
  assignedToId: "",
};
