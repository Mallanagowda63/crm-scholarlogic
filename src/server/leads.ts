import type { Prisma } from "@prisma/client";
import { subDays } from "date-fns";

import { db } from "@/lib/db";
import { indiaDayRange } from "@/lib/format";
import { BOARD_COLUMN_LIMIT, PAGE_SIZE, type LeadFilters } from "@/lib/leads";
import type { CurrentUser } from "@/lib/session";

/** Counsellors only ever see and change leads assigned to them. */
export function ownedBy(user: CurrentUser): Prisma.StudentWhereInput {
  return user.role === "COUNSELLOR" ? { assignedToId: user.id } : {};
}

export function searchWhere(q: string): Prisma.StudentWhereInput {
  if (!q) return {};
  const digits = q.replace(/\D/g, "");
  const text = { contains: q, mode: "insensitive" as const };
  return {
    OR: [
      { name: text },
      { email: text },
      { parentName: text },
      { college: text },
      ...(digits.length >= 3
        ? [
            { phone: { contains: digits } },
            { alternatePhone: { contains: digits } },
            { parentPhone: { contains: digits } },
          ]
        : []),
    ],
  };
}

function followUpWhere(followUp: LeadFilters["followUp"], now: Date): Prisma.StudentWhereInput {
  const { end } = indiaDayRange(now);
  switch (followUp) {
    case "overdue":
      return { nextFollowUpAt: { lt: now } };
    case "today":
      return { nextFollowUpAt: { gte: now, lt: end } };
    case "upcoming":
      return { nextFollowUpAt: { gte: end } };
    case "none":
      return { nextFollowUpAt: null };
    default:
      return {};
  }
}

/** Filters shared by the table, board and export. */
function baseWhere(user: CurrentUser, filters: LeadFilters, now: Date): Prisma.StudentWhereInput {
  return {
    ...ownedBy(user),
    ...searchWhere(filters.q),
    ...followUpWhere(filters.followUp, now),
    ...(filters.source && { sourceId: filters.source }),
    ...(filters.course && { courseInterestId: filters.course }),
    // Counsellors are already limited to their own leads, so this filter is ignored for them.
    ...(filters.counsellor && user.role !== "COUNSELLOR" && { assignedToId: filters.counsellor }),
  };
}

/** Enrolled people are students, so the Leads table leaves them out. */
export function tableWhere(user: CurrentUser, filters: LeadFilters, now: Date): Prisma.StudentWhereInput {
  return {
    ...baseWhere(user, filters, now),
    stage: { type: { not: "WON" } },
    ...(filters.stage && { stageId: filters.stage }),
  };
}

const LEAD_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  city: true,
  degree: true,
  degreeStream: true,
  budget: true,
  lostReason: true,
  nextFollowUpAt: true,
  lastContactedAt: true,
  createdAt: true,
  stage: { select: { id: true, name: true, color: true, type: true } },
  source: { select: { name: true } },
  courseInterest: { select: { name: true } },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.StudentSelect;

export type LeadRow = Prisma.StudentGetPayload<{ select: typeof LEAD_SELECT }>;

function orderBy(filters: LeadFilters): Prisma.StudentOrderByWithRelationInput[] {
  const { sort, dir } = filters;
  const primary =
    sort === "nextFollowUpAt" || sort === "lastContactedAt"
      ? { [sort]: { sort: dir, nulls: "last" as const } }
      : { [sort]: dir };
  return [primary, { id: "asc" }];
}

export async function listLeads(user: CurrentUser, filters: LeadFilters, now: Date) {
  const where = tableWhere(user, filters, now);
  const total = await db.student.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const rows = await db.student.findMany({
    where,
    select: LEAD_SELECT,
    orderBy: orderBy(filters),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return { rows, total, page, pageCount };
}

export type BoardColumn = {
  stage: { id: string; name: string; color: string; type: LeadRow["stage"]["type"] };
  total: number;
  leads: LeadRow[];
};

export async function getBoard(user: CurrentUser, filters: LeadFilters, now: Date): Promise<BoardColumn[]> {
  const stages = await db.pipelineStage.findMany({ orderBy: { position: "asc" } });
  const where = baseWhere(user, filters, now);

  return Promise.all(
    stages.map(async ({ id, name, color, type }) => {
      // Closed columns would grow forever, so they only show the last 30 days.
      const columnWhere: Prisma.StudentWhereInput = {
        ...where,
        stageId: id,
        ...(type !== "OPEN" && { updatedAt: { gte: subDays(now, 30) } }),
      };
      const [total, leads] = await Promise.all([
        db.student.count({ where: columnWhere }),
        db.student.findMany({
          where: columnWhere,
          select: LEAD_SELECT,
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: BOARD_COLUMN_LIMIT,
        }),
      ]);
      return { stage: { id, name, color, type }, total, leads };
    }),
  );
}

export async function getLeadOptions() {
  const [stages, sources, courses, assignees] = await Promise.all([
    db.pipelineStage.findMany({
      orderBy: { position: "asc" },
      select: { id: true, name: true, color: true, type: true },
    }),
    db.leadSource.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.course.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { isActive: true, role: "COUNSELLOR" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { stages, sources, courses, assignees };
}

export type LeadOptions = Awaited<ReturnType<typeof getLeadOptions>>;

export type DuplicateMatch = {
  id: string;
  name: string;
  stage: string;
  counsellor: string | null;
  matchedOn: string;
};

/**
 * Finds people sharing a phone or email, in any stage and any counsellor's list.
 * It shows only enough to identify the match, not their contact details.
 */
export async function findDuplicates(
  values: { phone: string; alternatePhone?: string | null; parentPhone?: string | null; email?: string | null },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const phones = [values.phone, values.alternatePhone, values.parentPhone].filter((p): p is string => Boolean(p));
  const matches = await db.student.findMany({
    where: {
      ...(excludeId && { id: { not: excludeId } }),
      OR: [
        { phone: { in: phones } },
        { alternatePhone: { in: phones } },
        { parentPhone: { in: phones } },
        ...(values.email ? [{ email: values.email }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      alternatePhone: true,
      parentPhone: true,
      email: true,
      stage: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
    take: 5,
  });

  return matches.map((match) => {
    const sharesPhone = [match.phone, match.alternatePhone, match.parentPhone].some(
      (phone) => phone && phones.includes(phone),
    );
    return {
      id: match.id,
      name: match.name,
      stage: match.stage.name,
      counsellor: match.assignedTo?.name ?? null,
      matchedOn: sharesPhone ? "phone" : "email",
    };
  });
}

export async function firstStageId() {
  const stage = await db.pipelineStage.findFirstOrThrow({
    where: { type: "OPEN" },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  return stage.id;
}
