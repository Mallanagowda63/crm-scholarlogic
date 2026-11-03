import { z } from "zod";

import { addDaysToKey, indiaDateKey } from "@/lib/format";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dateKey = z
  .string()
  .refine((value) => DATE_KEY.test(value) && !Number.isNaN(Date.parse(value)))
  .optional()
  .catch(undefined);

const querySchema = z.object({ from: dateKey, to: dateKey });

export const RANGE_PRESETS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "12 months", days: 365 },
];

/** Turns query values into a usable range. Bad or reversed dates fall back to sensible ones. */
export function parseReportRange(query: unknown, now: Date) {
  const { from, to } = querySchema.parse(query);
  const today = indiaDateKey(now);
  const end = to ?? today;
  const start = from ?? addDaysToKey(end, -90);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}
