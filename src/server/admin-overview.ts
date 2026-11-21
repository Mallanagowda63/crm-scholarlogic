import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { dateKeyStart, indiaDateKey } from "@/lib/format";
import { INVALID_REASON, SOURCE_KEYS } from "@/lib/leads";
import { getPlanSummaries } from "@/server/fees";

/** How far back the yearly report goes. */
export const MAX_YEARS = 10;

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The monthly numbers, in the order the report shows them. */
export const FIGURE_FIELDS = [
  { key: "admissions", label: "Admissions", short: "Admissions" },
  { key: "walkIns", label: "Walk-ins", short: "Walk-ins" },
  { key: "plannedCandidates", label: "Planned candidates", short: "Planned" },
  { key: "instagramPosts", label: "Instagram posts", short: "Insta posts" },
  { key: "instagramLeads", label: "Instagram leads", short: "Insta leads" },
  { key: "metaLeads", label: "Meta ads leads", short: "Meta ads" },
  { key: "googleLeads", label: "Google ads leads", short: "Google ads" },
] as const;

export type FigureKey = (typeof FIGURE_FIELDS)[number]["key"];
export type MonthFigures = Record<FigureKey, number | null> & {
  month: number;
  /** True when any number this month is a sample. */
  isSample: boolean;
  /** True when admissions or walk-ins are samples rather than CRM counts. */
  hasSampleCounts: boolean;
};
export type YearFigures = { year: number; months: MonthFigures[]; totals: Record<FigureKey, number | null>; isSample: boolean };

/** Such as 2026-03, in India's time zone. */
export type MonthKey = string;

export function monthKeyOf(date: Date): MonthKey {
  return indiaDateKey(date).slice(0, 7);
}

export function shiftMonth(key: MonthKey, by: number): MonthKey {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

export function monthRange(key: MonthKey) {
  return { gte: dateKeyStart(`${key}-01`), lt: dateKeyStart(`${shiftMonth(key, 1)}-01`) };
}

export function formatMonth(key: MonthKey, style: "long" | "short" = "long") {
  const [year, month] = key.split("-").map(Number);
  return `${style === "long" ? new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-IN", { month: "long", timeZone: "UTC" }) : MONTH_NAMES[month - 1]} ${year}`;
}

type CountRow = { year: number; month: number; key: string | null; people: bigint };

/**
 * Counts from the CRM, per India month. Raw SQL so Postgres does the grouping,
 * which means it spells out the soft-delete rule itself.
 */
async function crmCounts(fromYear: number) {
  const since = dateKeyStart(`${fromYear}-01-01`);
  const keys = Object.values(SOURCE_KEYS);
  const [leads, admissions] = await Promise.all([
    db.$queryRaw<CountRow[]>`
      SELECT
        EXTRACT(YEAR FROM (s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::int AS year,
        EXTRACT(MONTH FROM (s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::int AS month,
        src.key AS key,
        COUNT(*) AS people
      FROM "Student" s
      JOIN "LeadSource" src ON src.id = s."sourceId"
      WHERE s."deletedAt" IS NULL AND s."createdAt" >= ${since} AND src.key IN (${Prisma.join(keys)})
      GROUP BY 1, 2, 3`,
    db.$queryRaw<CountRow[]>`
      SELECT
        EXTRACT(YEAR FROM (a."admissionDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::int AS year,
        EXTRACT(MONTH FROM (a."admissionDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::int AS month,
        NULL AS key,
        COUNT(*) AS people
      FROM "Admission" a
      JOIN "Student" s ON s.id = a."studentId"
      WHERE a."deletedAt" IS NULL AND a.status <> 'CANCELLED' AND s."deletedAt" IS NULL AND a."admissionDate" >= ${since}
      GROUP BY 1, 2`,
  ]);
  return { leads, admissions };
}

const LEAD_FIELDS: Partial<Record<string, FigureKey>> = {
  [SOURCE_KEYS["Walk-in"]]: "walkIns",
  [SOURCE_KEYS.Instagram]: "instagramLeads",
  [SOURCE_KEYS["Meta Ads"]]: "metaLeads",
  [SOURCE_KEYS["Google Ads"]]: "googleLeads",
};

/**
 * Every month from the earliest year with data, up to ten years back. A number
 * entered by hand wins over the CRM's count, so older years can be filled in.
 */
export async function getYearlyFigures(now: Date): Promise<YearFigures[]> {
  const thisYear = Number(monthKeyOf(now).slice(0, 4));
  const earliestAllowed = thisYear - MAX_YEARS + 1;
  const [entered, counts, firstLead] = await Promise.all([
    db.monthlyFigure.findMany({ where: { year: { gte: earliestAllowed, lte: thisYear } } }),
    crmCounts(earliestAllowed),
    db.student.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const years = [
    thisYear,
    ...entered.map((row) => row.year),
    ...(firstLead ? [Number(monthKeyOf(firstLead.createdAt).slice(0, 4))] : []),
  ];
  const fromYear = Math.max(earliestAllowed, Math.min(...years));

  const crm = new Map<string, number>();
  const add = (year: number, month: number, field: FigureKey, people: bigint) =>
    crm.set(`${year}-${month}-${field}`, (crm.get(`${year}-${month}-${field}`) ?? 0) + Number(people));
  for (const row of counts.leads) {
    const field = row.key ? LEAD_FIELDS[row.key] : undefined;
    if (field) add(row.year, row.month, field, row.people);
  }
  for (const row of counts.admissions) add(row.year, row.month, "admissions", row.people);
  const enteredByMonth = new Map(entered.map((row) => [`${row.year}-${row.month}`, row]));

  const result: YearFigures[] = [];
  for (let year = thisYear; year >= fromYear; year--) {
    const months: MonthFigures[] = MONTH_NAMES.map((_, index) => {
      const month = index + 1;
      const row = enteredByMonth.get(`${year}-${month}`);
      const figures = Object.fromEntries(
        FIGURE_FIELDS.map(({ key }) => {
          const typed = row?.[key] ?? null;
          // Planned candidates and Instagram posts only ever come from what's entered.
          const counted = key === "plannedCandidates" || key === "instagramPosts" ? null : (crm.get(`${year}-${month}-${key}`) ?? 0);
          return [key, typed ?? counted];
        }),
      ) as Record<FigureKey, number | null>;
      const isSample = row?.isSample ?? false;
      return {
        month,
        ...figures,
        isSample,
        hasSampleCounts: isSample && (row?.admissions != null || row?.walkIns != null),
      };
    });
    const totals = Object.fromEntries(
      FIGURE_FIELDS.map(({ key }) => {
        const values = months.map((month) => month[key]).filter((value): value is number => value !== null);
        return [key, values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0)];
      }),
    ) as Record<FigureKey, number | null>;
    result.push({ year, months, totals, isSample: months.some((month) => month.isSample) });
  }
  return result;
}

/** The left side of the admin dashboard, for one month. */
export async function getMonthOverview(key: MonthKey, now: Date, yearly: YearFigures[]) {
  const period = monthRange(key);
  const [year, month] = key.split("-").map(Number);
  const yearFigures = yearly.find((entry) => entry.year === year);
  const monthFigures = yearFigures?.months[month - 1];

  const [invalid, pendingReply, admissions, courses, plans] = await Promise.all([
    db.student.count({ where: { createdAt: period, stage: { type: "LOST" }, lostReason: INVALID_REASON } }),
    db.student.count({ where: { createdAt: period, stage: { type: "OPEN" }, lastContactedAt: null } }),
    db.admission.groupBy({
      by: ["courseId"],
      where: { status: { not: "CANCELLED" }, admissionDate: period, student: { deletedAt: null } },
      _count: { _all: true },
    }),
    db.course.findMany({ select: { id: true, name: true } }),
    getPlanSummaries(now),
  ]);

  // Instalments falling due this month that still have money owing.
  const owing = plans.flatMap((plan) =>
    plan.summary.instalments
      .filter((instalment) => instalment.outstanding > 0 && instalment.dueDate >= period.gte && instalment.dueDate < period.lt)
      .map((instalment) => ({ studentId: plan.student.id, outstanding: instalment.outstanding })),
  );

  const courseNames = new Map(courses.map((course) => [course.id, course.name]));
  const byCourse = admissions
    .map((row) => ({ label: courseNames.get(row.courseId) ?? "Unknown course", value: row._count._all }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  return {
    walkIns: monthFigures?.walkIns ?? 0,
    walkInsThisYear: yearFigures?.months.slice(0, month).reduce((sum, entry) => sum + (entry.walkIns ?? 0), 0) ?? 0,
    admissions: monthFigures?.admissions ?? 0,
    invalid,
    pendingReply,
    paymentPending: {
      amount: owing.reduce((sum, entry) => sum + entry.outstanding, 0),
      students: new Set(owing.map((entry) => entry.studentId)).size,
    },
    byCourse,
    hasSampleCounts: monthFigures?.hasSampleCounts ?? false,
  };
}
