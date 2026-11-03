"use client";

import { GraduationCap } from "lucide-react";
import Link from "next/link";

import { useTaskWorkspace } from "@/app/(app)/tasks/tasks-workspace";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/server/tasks";

/** Tasks open their form. Demo classes open the student, where they're managed. */
export function CalendarEventChip({ event, showDetail = false }: { event: CalendarEvent; showDetail?: boolean }) {
  const { openTask } = useTaskWorkspace();
  const time = formatTime(new Date(event.at));
  const className = cn(
    "block w-full truncate rounded-md border-l-2 px-1.5 py-1 text-left text-xs outline-none transition-colors hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50",
    event.kind === "demo" ? "border-violet-500 bg-violet-500/10" : "border-primary bg-primary-soft",
    event.isHighPriority && "border-destructive",
    event.isDone && "line-through opacity-60",
  );
  const content = (
    <>
      <span className="text-muted-foreground">{time}</span>{" "}
      {event.kind === "demo" && <GraduationCap className="inline size-3" aria-hidden />} {event.title}
      {showDetail && event.personName && <span className="block truncate text-muted-foreground">{event.personName}</span>}
    </>
  );

  if (event.kind === "demo") {
    return (
      <Link href={`/students/${event.studentId}`} className={className} data-event-kind="demo">
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => openTask(event.id)} className={className} data-event-kind="task">
      {content}
    </button>
  );
}
