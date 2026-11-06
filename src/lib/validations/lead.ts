import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

const MAX_BUDGET_RUPEES = 10_000_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

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

/** A calendar date such as 2004-08-15, stored as a date with no time of day. */
const optionalDate = (label: string, earliestYear: number, latestYear: () => number) =>
  z.string().transform((value, context) => {
    if (!value.trim()) return null;
    const date = new Date(`${value.trim()}T00:00:00.000Z`);
    // 2026-02-31 parses as a different day, so the round trip catches it.
    const isRealDate =
      DATE_KEY.test(value.trim()) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value.trim());
    if (!isRealDate || date.getUTCFullYear() < earliestYear || date.getUTCFullYear() > latestYear()) {
      context.addIssue({ code: "custom", message: `Enter a valid ${label}` });
      return z.NEVER;
    }
    return date;
  });

/** Percentages and CGPA, kept as typed (such as 78.5) once checked. */
const optionalScore = z.string().transform((value, context) => {
  const cleaned = value.replace(/[%\s]/g, "");
  if (!cleaned) return null;
  const score = Number(cleaned);
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned) || score > 100) {
    context.addIssue({ code: "custom", message: "Enter a number from 0 to 100" });
    return z.NEVER;
  }
  return String(score);
});

const thisYear = () => new Date().getFullYear();

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
  address: optionalText(300),
  dateOfBirth: optionalDate("date of birth", 1950, () => thisYear() - 10),
  college: optionalText(200),
  degree: optionalText(60),
  degreeStream: optionalText(80),
  degreeScore: optionalScore,
  passOutYear: z.string().transform((value, context) => {
    if (!value.trim()) return null;
    const year = Number(value.trim());
    if (!Number.isInteger(year) || year < 1980 || year > thisYear() + 6) {
      context.addIssue({ code: "custom", message: `Enter a year from 1980 to ${thisYear() + 6}` });
      return z.NEVER;
    }
    return year;
  }),
  tenthScore: optionalScore,
  twelfthScore: optionalScore,
  preferredMode: z.enum(["", "OFFLINE", "ONLINE", "HYBRID"]).transform((value) => value || null),
  joiningDate: optionalDate("joining date", 2000, () => thisYear() + 2),
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
  address: "",
  dateOfBirth: "",
  college: "",
  degree: "",
  degreeStream: "",
  degreeScore: "",
  passOutYear: "",
  tenthScore: "",
  twelfthScore: "",
  preferredMode: "",
  joiningDate: "",
  courseInterestId: "",
  sourceId: "",
  budget: "",
  preferredIntake: "",
  notes: "",
  assignedToId: "",
};
