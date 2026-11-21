import type { ActivityType } from "@prisma/client";

import { db } from "@/lib/db";
import { addDaysToKey, dateKeyStart, indiaDateKey } from "@/lib/format";

/** The report counts as ready from 7 pm in India, when the working day is over. */
export const END_OF_DAY_HOUR = 19;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: string) {
  if (!DAY_KEY.test(value)) return false;
  const start = dateKeyStart(value);
  // 2026-02-31 turns into a different day, so the round trip catches it.
  return !Number.isNaN(start.getTime()) && indiaDateKey(start) === value;
}

/** Today after 7 pm in India, otherwise yesterday: the latest day that's finished. */
export function latestFinishedDay(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now));
  const today = indiaDateKey(now);
  return hour >= END_OF_DAY_HOUR ? today : addDaysToKey(today, -1);
}

/** The kinds of timeline entries the report counts. */
const COUNTED_TYPES = ["CALL", "WHATSAPP", "EMAIL", "NOTE", "STAGE_CHANGE", "FOLLOW_UP", "DEMO_CLASS"] as const satisfies readonly ActivityType[];

export type CounsellorDay = {
  id: string;
  name: string;
  isActive: boolean;
  followUpsDone: number;
  followUpsMissed: number;
  calls: number;
  whatsapp: number;
  emails: number;
  notes: number;
  stageChanges: number;
  leadsAdded: number;
  entries: { id: string; at: Date; type: ActivityType; body: string; student: { id: string; name: string } }[];
};

/** Everything each counsellor did on one India day, from the timeline and their tasks. */
export async function getDailyReport(day: string): Promise<CounsellorDay[]> {
  const period = { gte: dateKeyStart(day), lt: dateKeyStart(addDaysToKey(day, 1)) };

  const [counsellors, activities, done, missed, created] = await Promise.all([
    db.user.findMany({ where: { role: "COUNSELLOR" }, orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
    db.activity.findMany({
      where: {
        occurredAt: period,
        type: { in: [...COUNTED_TYPES] },
        actor: { role: "COUNSELLOR" },
        student: { deletedAt: null },
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        body: true,
        occurredAt: true,
        actorId: true,
        student: { select: { id: true, name: true } },
      },
    }),
    db.task.groupBy({
      by: ["assigneeId"],
      where: { status: "DONE", completedAt: period, OR: [{ studentId: null }, { student: { deletedAt: null } }] },
      _count: { _all: true },
    }),
    // Due that day and still not done, or done only on a later day.
    db.task.groupBy({
      by: ["assigneeId"],
      where: {
        dueAt: period,
        OR: [{ status: "OPEN" }, { status: "DONE", completedAt: { gte: period.lt } }],
        AND: [{ OR: [{ studentId: null }, { student: { deletedAt: null } }] }],
      },
      _count: { _all: true },
    }),
    db.auditLog.groupBy({
      by: ["actorId"],
      where: { action: "lead.created", createdAt: period },
      _count: { _all: true },
    }),
  ]);

  const byPerson = (rows: { id: string | null; count: number }[]) => new Map(rows.map(({ id, count }) => [id, count]));
  const doneBy = byPerson(done.map((row) => ({ id: row.assigneeId, count: row._count._all })));
  const missedBy = byPerson(missed.map((row) => ({ id: row.assigneeId, count: row._count._all })));
  const createdBy = byPerson(created.map((row) => ({ id: row.actorId, count: row._count._all })));

  return (
    counsellors
      .map((counsellor) => {
        const mine = activities.filter((activity) => activity.actorId === counsellor.id);
        const ofType = (type: ActivityType) => mine.filter((activity) => activity.type === type).length;
        return {
          ...counsellor,
          followUpsDone: doneBy.get(counsellor.id) ?? 0,
          followUpsMissed: missedBy.get(counsellor.id) ?? 0,
          calls: ofType("CALL"),
          whatsapp: ofType("WHATSAPP"),
          emails: ofType("EMAIL"),
          notes: ofType("NOTE"),
          stageChanges: ofType("STAGE_CHANGE"),
          leadsAdded: createdBy.get(counsellor.id) ?? 0,
          entries: mine.map(({ id, type, body, occurredAt, student }) => ({ id, at: occurredAt, type, body, student })),
        };
      })
      // Former counsellors only appear on days they did something.
      .filter((row) => row.isActive || row.entries.length > 0 || row.followUpsDone > 0 || row.followUpsMissed > 0)
  );
}

export function reportTotals(rows: CounsellorDay[]) {
  const sum = (pick: (row: CounsellorDay) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    followUpsDone: sum((row) => row.followUpsDone),
    followUpsMissed: sum((row) => row.followUpsMissed),
    contacts: sum((row) => row.calls + row.whatsapp + row.emails),
    leadsAdded: sum((row) => row.leadsAdded),
  };
}
