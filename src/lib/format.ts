export const TIME_ZONE = "Asia/Kolkata";

export function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Formats paise as rupees with Indian digit grouping, such as ₹1,65,000. */
export function formatRupees(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

/** The start and end of the given date's day in India, as UTC instants. */
export function indiaDayRange(date: Date) {
  const offsetMs = 330 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const start = Math.floor((date.getTime() + offsetMs) / dayMs) * dayMs - offsetMs;
  return { start: new Date(start), end: new Date(start + dayMs) };
}

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The India calendar date of an instant, as YYYY-MM-DD. */
export function indiaDateKey(date: Date) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a YYYY-MM-DD date begins in India. */
export function dateKeyStart(key: string) {
  return new Date(Date.parse(`${key}T00:00:00Z`) - IST_OFFSET_MS);
}

export function addDaysToKey(key: string, days: number) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 is Monday and 6 is Sunday. */
export function weekdayOfKey(key: string) {
  return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function formatKey(key: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(new Date(`${key}T00:00:00Z`));
}

export function greeting(date: Date) {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: TIME_ZONE,
      hour: "numeric",
      hourCycle: "h23",
    }).format(date),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
