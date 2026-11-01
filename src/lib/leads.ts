import { z } from "zod";

export const CLASS_OPTIONS = ["8th", "9th", "10th", "11th", "12th", "Dropper"] as const;

export const BOARD_LABELS = { CBSE: "CBSE", ICSE: "ICSE", STATE: "State board" } as const;

export const LOST_REASONS = [
  "Fees over budget",
  "Joined another coaching centre",
  "Centre too far from home",
  "Not responding",
  "Didn't attend the demo class",
] as const;

export const PAGE_SIZE = 25;
export const BOARD_COLUMN_LIMIT = 50;
export const MAX_BULK = 200;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 900 * 1024;

export const leadFiltersSchema = z.object({
  view: z.enum(["table", "board"]).catch("table"),
  q: z.string().trim().max(100).catch(""),
  stage: z.string().max(64).catch(""),
  source: z.string().max(64).catch(""),
  course: z.string().max(64).catch(""),
  counsellor: z.string().max(64).catch(""),
  followUp: z.enum(["", "overdue", "today", "upcoming", "none"]).catch(""),
  sort: z.enum(["name", "createdAt", "nextFollowUpAt", "lastContactedAt"]).catch("createdAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).catch(1),
});

export type LeadFilters = z.infer<typeof leadFiltersSchema>;

const DEFAULTS: LeadFilters = leadFiltersSchema.parse({});

/** Builds a query string that leaves out default values, to keep URLs short. */
export function leadsQuery(filters: LeadFilters, changes: Partial<LeadFilters> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...changes })) {
    if (value !== DEFAULTS[key as keyof LeadFilters]) params.set(key, String(value));
  }
  return params.toString();
}

export function hasActiveFilters({ q, stage, source, course, counsellor, followUp }: LeadFilters) {
  return Boolean(q || stage || source || course || counsellor || followUp);
}
