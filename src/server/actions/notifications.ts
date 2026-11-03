"use server";

import { z } from "zod";

import { db } from "@/lib/db";
import { summarisePlan } from "@/lib/fees";
import { formatDateTime, formatRupees } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

const MAX_SHOWN = 20;
const MAX_REMINDERS_PER_CHECK = 50;

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
};

export type NotificationFeed = { items: NotificationItem[]; unread: number };

/**
 * There's no background job, so reminders that have come due turn into
 * notifications when their assignee's browser checks in.
 */
async function deliverDueReminders(userId: string) {
  const due = await db.task.findMany({
    where: {
      assigneeId: userId,
      status: "OPEN",
      reminderAt: { lte: new Date() },
      reminderSentAt: null,
      OR: [{ studentId: null }, { student: { deletedAt: null } }],
    },
    orderBy: { reminderAt: "asc" },
    take: MAX_REMINDERS_PER_CHECK,
    select: { id: true, title: true, dueAt: true, studentId: true },
  });

  for (const task of due) {
    await db.$transaction(async (tx) => {
      // Claiming the reminder first means two open tabs can't both deliver it.
      const claimed = await tx.task.updateMany({
        where: { id: task.id, reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (claimed.count === 0) return;
      await tx.notification.create({
        data: {
          userId,
          title: "Reminder",
          message: `${task.title} is due ${formatDateTime(task.dueAt)}.`,
          link: task.studentId ? `/students/${task.studentId}` : "/tasks",
        },
      });
    });
  }
}

/** Overdue instalments alert everyone in accounts, the first time any of them checks in. */
async function deliverOverdueAlerts() {
  const now = new Date();
  const due = await db.instalment.findMany({
    where: {
      dueDate: { lt: now },
      cancelledAt: null,
      overdueNotifiedAt: null,
      feePlan: { cancelledAt: null, student: { deletedAt: null } },
    },
    orderBy: { dueDate: "asc" },
    take: MAX_REMINDERS_PER_CHECK,
    select: {
      id: true,
      sequence: true,
      feePlan: {
        select: {
          totalAmount: true,
          discountAmount: true,
          gstRateBps: true,
          student: { select: { id: true, name: true } },
          course: { select: { name: true } },
          instalments: {
            where: { cancelledAt: null },
            orderBy: { sequence: "asc" },
            select: { id: true, amount: true, dueDate: true },
          },
          payments: { where: { deletedAt: null }, select: { amount: true } },
        },
      },
    },
  });
  if (due.length === 0) return;

  const recipients = await db.user.findMany({ where: { role: "ACCOUNTS", isActive: true }, select: { id: true } });

  for (const instalment of due) {
    const { feePlan } = instalment;
    const position = summarisePlan(feePlan, now).instalments.find((item) => item.id === instalment.id);

    await db.$transaction(async (tx) => {
      const claimed = await tx.instalment.updateMany({
        where: { id: instalment.id, overdueNotifiedAt: null },
        data: { overdueNotifiedAt: now },
      });
      // Already paid instalments are marked too, so they aren't looked at again.
      if (claimed.count === 0 || !position || position.outstanding === 0) return;
      await tx.notification.createMany({
        data: recipients.map(({ id }) => ({
          userId: id,
          title: "Overdue payment",
          message: `${feePlan.student.name}'s instalment ${instalment.sequence} for ${feePlan.course.name} is overdue by ${formatRupees(position.outstanding)}.`,
          link: `/students/${feePlan.student.id}?tab=payments`,
        })),
      });
    });
  }
}

export async function getNotifications(): Promise<NotificationFeed> {
  const user = await getCurrentUser();
  if (!user) return { items: [], unread: 0 };

  await deliverDueReminders(user.id);
  if (user.role === "ACCOUNTS") await deliverOverdueAlerts();

  const [rows, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: MAX_SHOWN,
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return {
    unread,
    items: rows.map(({ id, title, message, link, readAt, createdAt }) => ({
      id,
      title,
      message,
      link,
      isRead: readAt !== null,
      createdAt,
    })),
  };
}

export async function markNotificationRead(id: unknown) {
  const user = await getCurrentUser();
  const parsed = z.string().min(1).max(64).safeParse(id);
  if (!user || !parsed.success) return;
  // The user check means nobody can mark someone else's notification as read.
  await db.notification.updateMany({
    where: { id: parsed.data, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  if (!user) return;
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
}
