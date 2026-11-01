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
