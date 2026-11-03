import { CalendarOff, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { CalendarEventChip } from "@/app/(app)/tasks/calendar-event";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { addDaysToKey, formatKey, indiaDateKey, weekdayOfKey } from "@/lib/format";
import type { CurrentUser } from "@/lib/session";
import { tasksHref, type TaskFilters } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { getCalendarEvents, type CalendarEvent } from "@/server/tasks";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN_PER_MONTH_CELL = 3;

function range(mode: TaskFilters["mode"], date: string) {
  if (mode === "day") return { from: date, to: addDaysToKey(date, 1) };
  if (mode === "week") {
    const from = addDaysToKey(date, -weekdayOfKey(date));
    return { from, to: addDaysToKey(from, 7) };
  }
  // A month grid always shows 6 full weeks, so its height doesn't jump between months.
  const first = `${date.slice(0, 7)}-01`;
  const from = addDaysToKey(first, -weekdayOfKey(first));
  return { from, to: addDaysToKey(from, 42) };
}

function shift(mode: TaskFilters["mode"], date: string, direction: 1 | -1) {
  if (mode === "day") return addDaysToKey(date, direction);
  if (mode === "week") return addDaysToKey(date, 7 * direction);
  const [year, month] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + direction, 1));
  return target.toISOString().slice(0, 10);
}

function heading(mode: TaskFilters["mode"], date: string, from: string, to: string) {
  if (mode === "day") return formatKey(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (mode === "month") return formatKey(date, { month: "long", year: "numeric" });
  const last = addDaysToKey(to, -1);
  return `${formatKey(from, { day: "numeric", month: "short" })} – ${formatKey(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

export async function TaskCalendar({
  user,
  filters,
  today,
}: {
  user: CurrentUser;
  filters: TaskFilters;
  today: string;
}) {
  const date = filters.date ?? today;
  const { from, to } = range(filters.mode, date);
  const events = await getCalendarEvents(user, filters, from, to);

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = indiaDateKey(event.at);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }

  const navLink = cn(buttonVariants({ variant: "outline", size: "icon-lg" }));
  const dayHref = (key: string) => tasksHref(filters, { mode: "day", date: key });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={tasksHref(filters, { date: shift(filters.mode, date, -1) })} scroll={false} prefetch={false} aria-label="Previous" className={navLink}>
            <ChevronLeft />
          </Link>
          <Link href={tasksHref(filters, { date: shift(filters.mode, date, 1) })} scroll={false} prefetch={false} aria-label="Next" className={navLink}>
            <ChevronRight />
          </Link>
          <Link
            href={tasksHref(filters, { date: today })}
            scroll={false} prefetch={false}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            Today
          </Link>
          <h2 className="ml-1 text-base font-semibold tracking-tight" aria-live="polite">
            {heading(filters.mode, date, from, to)}
          </h2>
        </div>
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Calendar range">
          {(["month", "week", "day"] as const).map((mode) => (
            <Link
              key={mode}
              href={tasksHref(filters, { mode })}
              scroll={false} prefetch={false}
              aria-current={filters.mode === mode ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm font-medium capitalize transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                filters.mode === mode
                  ? "bg-primary-soft text-primary-soft-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode}
            </Link>
          ))}
        </div>
      </div>

      {filters.mode === "month" && (
        <MonthGrid from={from} month={date.slice(0, 7)} today={today} byDay={byDay} dayHref={dayHref} />
      )}
      {filters.mode === "week" && <WeekColumns from={from} today={today} byDay={byDay} dayHref={dayHref} />}
      {filters.mode === "day" && <DayAgenda events={byDay.get(date) ?? []} />}
    </>
  );
}

function MonthGrid({
  from,
  month,
  today,
  byDay,
  dayHref,
}: {
  from: string;
  month: string;
  today: string;
  byDay: Map<string, CalendarEvent[]>;
  dayHref: (key: string) => string;
}) {
  const days = Array.from({ length: 42 }, (_, index) => addDaysToKey(from, index));

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-2">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((key) => {
          const events = byDay.get(key) ?? [];
          const isOutside = !key.startsWith(month);
          const label = `${formatKey(key, { day: "numeric", month: "long" })}, ${events.length} ${events.length === 1 ? "item" : "items"}`;
          return (
            <div
              key={key}
              data-day={key}
              className={cn("min-h-16 min-w-0 border-r border-b p-1 sm:min-h-28", isOutside && "bg-muted/40")}
            >
              <Link
                href={dayHref(key)}
                scroll={false} prefetch={false}
                aria-label={label}
                className={cn(
                  "mb-1 flex size-6 items-center justify-center rounded-full text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                  isOutside && "text-muted-foreground",
                  key === today && "bg-primary font-medium text-primary-foreground hover:bg-primary",
                )}
              >
                {Number(key.slice(8))}
              </Link>
              {/* Phones have no room for titles, so they show a count that leads to the day. */}
              {events.length > 0 && (
                <Link
                  href={dayHref(key)}
                  scroll={false} prefetch={false}
                  tabIndex={-1}
                  aria-hidden
                  className="block rounded bg-primary-soft text-center text-[11px] font-medium text-primary-soft-foreground sm:hidden"
                >
                  {events.length}
                </Link>
              )}
              <ul className="hidden space-y-0.5 sm:block">
                {events.slice(0, SHOWN_PER_MONTH_CELL).map((event) => (
                  <li key={`${event.kind}-${event.id}`}>
                    <CalendarEventChip event={event} />
                  </li>
                ))}
                {events.length > SHOWN_PER_MONTH_CELL && (
                  <li>
                    <Link href={dayHref(key)} scroll={false} prefetch={false} className="px-1.5 text-xs text-muted-foreground hover:underline">
                      +{events.length - SHOWN_PER_MONTH_CELL} more
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekColumns({
  from,
  today,
  byDay,
  dayHref,
}: {
  from: string;
  today: string;
  byDay: Map<string, CalendarEvent[]>;
  dayHref: (key: string) => string;
}) {
  return (
    <div className="grid gap-2 lg:grid-cols-7">
      {Array.from({ length: 7 }, (_, index) => addDaysToKey(from, index)).map((key, index) => {
        const events = byDay.get(key) ?? [];
        return (
          <section key={key} data-day={key} className="min-w-0 rounded-xl border bg-card p-2 lg:min-h-64">
            <h3 className="mb-2 text-xs font-medium">
              <Link
                href={dayHref(key)}
                scroll={false} prefetch={false}
                className={cn("rounded hover:underline", key === today && "font-semibold text-primary-soft-foreground")}
              >
                {WEEKDAYS[index]} {Number(key.slice(8))}
              </Link>
            </h3>
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground lg:sr-only">Nothing scheduled</p>
            ) : (
              <ul className="space-y-1">
                {events.map((event) => (
                  <li key={`${event.kind}-${event.id}`}>
                    <CalendarEventChip event={event} showDetail />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DayAgenda({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) {
    return (
      <Card>
        <EmptyState icon={CalendarOff} title="Nothing scheduled" description="Tasks and demo classes for this day appear here." />
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={`${event.kind}-${event.id}`} className="text-sm">
            <CalendarEventChip event={event} showDetail />
          </li>
        ))}
      </ul>
    </Card>
  );
}
