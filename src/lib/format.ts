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
