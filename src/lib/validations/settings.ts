import { z } from "zod";

const MIN_PASSWORD = 12;
const MAX_PASSWORD_BYTES = 72;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`)
  .refine((value) => Buffer.byteLength(value) <= MAX_PASSWORD_BYTES, `Use at most ${MAX_PASSWORD_BYTES} bytes`);

const emailField = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));

export const newUserSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(120, "Must be 120 characters or fewer"),
  email: emailField,
  role: z.enum(["ADMIN", "COUNSELLOR", "ACCOUNTS", "VIEWER"]),
  password: passwordSchema,
});

export type NewUserValues = z.input<typeof newUserSchema>;

export const editUserSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(120, "Must be 120 characters or fewer"),
  role: z.enum(["ADMIN", "COUNSELLOR", "ACCOUNTS", "VIEWER"]),
});

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password").max(200),
    next: passwordSchema,
    confirm: z.string(),
  })
  .refine(({ next, confirm }) => next === confirm, { message: "The passwords don't match", path: ["confirm"] })
  .refine(({ current, next }) => current !== next, { message: "Choose a different password", path: ["next"] });

export type ChangePasswordValues = z.input<typeof changePasswordSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #4F46E5");

export const stageSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(40, "Must be 40 characters or fewer"),
  color: hexColor,
});

export type StageValues = z.input<typeof stageSchema>;

export const listItemSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(60, "Must be 60 characters or fewer"),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => value || null);

/** Relative brightness, used to check that white text stays readable on a brand colour. */
function contrastWithWhite(hex: string) {
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}

export const orgSchema = z.object({
  name: z.string().trim().min(2, "Enter the organisation's name").max(80, "Must be 80 characters or fewer"),
  legalName: optionalText(120),
  address: optionalText(240),
  phone: optionalText(30),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => !value || z.email().safeParse(value).success, "Enter a valid email address")
    .transform((value) => value || null),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => !value || /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(value), "That isn't a valid GSTIN")
    .transform((value) => value || null),
  receiptPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, "Use 2 to 12 letters, numbers or hyphens"),
  primaryColor: hexColor.refine((value) => contrastWithWhite(value) >= 4.5, {
    message: "Too light for white text on buttons. Choose a darker colour.",
  }),
  accentColor: hexColor,
});

export type OrgValues = z.input<typeof orgSchema>;

/** The only placeholders a template can use. */
export const TEMPLATE_VARIABLES = ["name", "course", "due_date"] as const;

export const templateSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(80, "Must be 80 characters or fewer"),
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  subject: z
    .string()
    .trim()
    .max(160, "Must be 160 characters or fewer")
    .transform((value) => value || null),
  body: z
    .string()
    .trim()
    .min(2, "Write the message")
    .max(2000, "Must be 2,000 characters or fewer")
    .refine(
      (value) =>
        [...value.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].every(([, name]) =>
          (TEMPLATE_VARIABLES as readonly string[]).includes(name),
        ),
      `Only ${TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(", ")} can be used`,
    ),
});

export type TemplateValues = z.input<typeof templateSchema>;

export function fillTemplate(text: string, values: Record<(typeof TEMPLATE_VARIABLES)[number], string>) {
  return text.replace(/\{\{\s*(name|course|due_date)\s*\}\}/g, (_, name: keyof typeof values) => values[name]);
}
