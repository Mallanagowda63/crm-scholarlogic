import Papa from "papaparse";

import { csvSafe, UTF8_BOM } from "@/lib/csv";
import { db } from "@/lib/db";
import { formatShortDate } from "@/lib/format";
import { BOARD_LABELS, leadFiltersSchema } from "@/lib/leads";
import { requireModuleAccess } from "@/lib/session";
import { recordAudit } from "@/server/audit";
import { tableWhere } from "@/server/leads";

const MAX_EXPORT_ROWS = 10_000;

export async function GET(request: Request) {
  const user = await requireModuleAccess("leads");
  const url = new URL(request.url);
  const filters = leadFiltersSchema.parse(Object.fromEntries(url.searchParams));

  const leads = await db.student.findMany({
    where: tableWhere(user, filters, new Date()),
    orderBy: { createdAt: "desc" },
    take: MAX_EXPORT_ROWS,
    include: {
      stage: { select: { name: true } },
      source: { select: { name: true } },
      courseInterest: { select: { name: true } },
      targetExam: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });

  const rows = leads.map((lead) =>
    [
      lead.name,
      lead.phone,
      lead.alternatePhone,
      lead.email,
      lead.parentName,
      lead.parentPhone,
      lead.city,
      lead.currentClass,
      lead.board && BOARD_LABELS[lead.board],
      lead.schoolName,
      lead.targetExam?.name,
      lead.courseInterest?.name,
      lead.source?.name,
      lead.budget === null ? "" : String(lead.budget / 100),
      lead.preferredIntake,
      lead.stage.name,
      lead.lostReason,
      lead.assignedTo?.name,
      lead.nextFollowUpAt && formatShortDate(lead.nextFollowUpAt),
      formatShortDate(lead.createdAt),
    ].map((value) => csvSafe(value ?? "")),
  );

  await recordAudit(db, {
    actorId: user.id,
    action: "lead.exported",
    entityType: "Student",
    entityId: "bulk",
    after: { count: rows.length, filters: url.searchParams.toString() },
  });

  const csv = Papa.unparse({
    fields: [
      "Name", "Phone", "Alternate Phone", "Email", "Parent Name", "Parent Phone", "City", "Class", "Board", "School",
      "Target Exam", "Course", "Source", "Budget", "Preferred Intake", "Stage", "Lost Reason", "Counsellor",
      "Next Follow-up", "Created",
    ],
    data: rows,
  });

  return new Response(UTF8_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="scholarlogic-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
