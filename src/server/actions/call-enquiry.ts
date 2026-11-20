"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { PHONE_CALL_SOURCE_KEY } from "@/lib/leads";
import { normalizePhone } from "@/lib/phone";
import { getUserWithAccess, type CurrentUser } from "@/lib/session";
import { callEnquirySchema, type CallEnquiryFormValues } from "@/lib/validations/lead";
import { recordAudit, type Tx } from "@/server/audit";
import { findDuplicates, firstStageId, ownedBy, pickNextCounsellor } from "@/server/leads";
import { LOCKED_TRANSACTION } from "@/server/stages";

/** Someone already in the CRM with the caller's number. */
export type CallerMatch = {
  id: string;
  name: string;
  stage: string;
  counsellor: string | null;
  /** False when the lead belongs to another counsellor, so this person can't open it. */
  canOpen: boolean;
};

export type CallEnquiryResult =
  | { ok: true; id: string; name: string; isExisting: boolean }
  | { ok: false; error: string; fieldErrors?: Partial<Record<keyof CallEnquiryFormValues, string>> };

const NO_ACCESS = "You don't have permission to do that.";
const GENERIC_ERROR = "Something went wrong. Please try again.";
const DEFAULT_SUMMARY = "Called to ask about a course.";

/** Prefers a match this person can open, as siblings can share a parent's number. */
async function findCaller(user: CurrentUser, phone: string): Promise<CallerMatch | null> {
  const matches = await findDuplicates({ phone });
  if (matches.length === 0) return null;
  const openable = await db.student.findMany({
    where: { id: { in: matches.map((match) => match.id) }, ...ownedBy(user) },
    select: { id: true },
  });
  const canOpen = new Set(openable.map(({ id }) => id));
  const best = matches.find((match) => canOpen.has(match.id)) ?? matches[0];
  return {
    id: best.id,
    name: best.name,
    stage: best.stage,
    counsellor: best.counsellor,
    canOpen: canOpen.has(best.id),
  };
}

/** The renamed "Phone Call" source, or a new one if it has gone missing. */
async function phoneCallSourceId(tx: Tx) {
  const source = await tx.leadSource.findUnique({ where: { key: PHONE_CALL_SOURCE_KEY }, select: { id: true } });
  if (source) return source.id;
  const created = await tx.leadSource.upsert({
    where: { name: "Phone Call" },
    update: { key: PHONE_CALL_SOURCE_KEY },
    create: { name: "Phone Call", key: PHONE_CALL_SOURCE_KEY },
    select: { id: true },
  });
  return created.id;
}

/** Tells the lead's counsellor, unless they're the one who took the call. */
async function notifyOwner(
  tx: Tx,
  user: CurrentUser,
  ownerId: string | null,
  studentId: string,
  title: string,
  message: string,
) {
  if (!ownerId || ownerId === user.id) return;
  await tx.notification.create({ data: { userId: ownerId, title, message, link: `/students/${studentId}` } });
}

/** Called as the counsellor types, so they know straight away if the caller is already in the CRM. */
export async function checkCaller(phone: unknown): Promise<CallerMatch | null> {
  const user = await getUserWithAccess("leads");
  if (!user || typeof phone !== "string" || phone.length > 30) return null;
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  try {
    return await findCaller(user, normalized);
  } catch (error) {
    console.error("checkCaller failed", error);
    return null;
  }
}

/**
 * Saves a phone enquiry. A known number gets the call logged on its profile
 * instead of a duplicate lead. A new number becomes a lead from "Phone Call".
 */
export async function saveCallEnquiry(input: unknown): Promise<CallEnquiryResult> {
  const user = await getUserWithAccess("leads");
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = callEnquirySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof CallEnquiryFormValues, string>> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as keyof CallEnquiryFormValues] ??= issue.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const { phone, name, courseInterestId, summary } = parsed.data;

  try {
    const match = await findCaller(user, phone);
    const now = new Date();

    if (match) {
      if (!match.canOpen) {
        return {
          ok: false,
          error: `This number is already saved for ${match.name}${
            match.counsellor ? `, who is with ${match.counsellor}` : ""
          }. Ask an admin to log this call.`,
        };
      }
      await db.$transaction(async (tx) => {
        const student = await tx.student.update({
          where: { id: match.id },
          data: { lastContactedAt: now },
          select: { assignedToId: true },
        });
        await tx.activity.create({
          data: { studentId: match.id, type: "CALL", body: summary ?? DEFAULT_SUMMARY, actorId: user.id, occurredAt: now },
        });
        await notifyOwner(tx, user, student.assignedToId, match.id, "Call logged", `${match.name} called again. ${user.name} logged it.`);
      });
      revalidatePath(`/students/${match.id}`);
      revalidatePath("/leads");
      return { ok: true, id: match.id, name: match.name, isExisting: true };
    }

    if (name.length < 2) {
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { name: "Enter the caller's name" } };
    }
    if (courseInterestId && !(await db.course.findFirst({ where: { id: courseInterestId }, select: { id: true } }))) {
      return { ok: false, error: "That course no longer exists.", fieldErrors: { courseInterestId: "Choose a course" } };
    }

    const stageId = await firstStageId();
    const lead = await db.$transaction(async (tx) => {
      // Like the full lead form: a counsellor keeps their own calls, and an admin's go round robin.
      const owner = user.role === "COUNSELLOR" ? user.id : await pickNextCounsellor(tx);
      const created = await tx.student.create({
        data: {
          name,
          phone,
          courseInterestId,
          stageId,
          sourceId: await phoneCallSourceId(tx),
          assignedToId: owner,
          lastContactedAt: now,
        },
        select: { id: true, name: true, courseInterest: { select: { name: true } } },
      });
      await tx.activity.create({
        data: { studentId: created.id, type: "CALL", body: summary ?? DEFAULT_SUMMARY, actorId: user.id, occurredAt: now },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "lead.created",
        entityType: "Student",
        entityId: created.id,
        after: { name: created.name, assignedToId: owner, via: "call" },
      });
      await notifyOwner(
        tx,
        user,
        owner,
        created.id,
        "New call enquiry",
        `${created.name} called about ${created.courseInterest?.name ?? "a course"}. ${user.name} added them.`,
      );
      return created;
    }, LOCKED_TRANSACTION);

    revalidatePath("/leads");
    revalidatePath("/students", "layout");
    return { ok: true, id: lead.id, name: lead.name, isExisting: false };
  } catch (error) {
    console.error("saveCallEnquiry failed", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
