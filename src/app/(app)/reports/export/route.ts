import Papa from "papaparse";

import { csvSafe, UTF8_BOM } from "@/lib/csv";
import { db } from "@/lib/db";
import { parseReportRange } from "@/lib/reports";
import { requireModuleAccess } from "@/lib/session";
import { getCounsellorPerformance, getLeadsBySource, getRevenueByCourse } from "@/server/analytics";
import { recordAudit } from "@/server/audit";

export async function GET(request: Request) {
  const user = await requireModuleAccess("reports");
  const url = new URL(request.url);
  const now = new Date();
  const range = parseReportRange(Object.fromEntries(url.searchParams), now);
  const report = url.searchParams.get("report");
  const rupees = (paise: number) => (paise / 100).toFixed(2);
  const percent = (value: number) => value.toFixed(1);

  let fields: string[];
  let rows: (string | number)[][];
  if (report === "sources") {
    fields = ["Source", "Leads", "Enrolled", "Conversion %"];
    rows = (await getLeadsBySource(user, range)).map((row) => [row.source, row.leads, row.enrolled, percent(row.conversion)]);
  } else if (report === "counsellors") {
    fields = ["Counsellor", "Leads", "Enrolled", "Conversion %", "Demos attended", "Overdue follow-ups", "Collected (Rs)"];
    rows = (await getCounsellorPerformance(range, now)).map((row) => [
      row.name,
      row.leads,
      row.enrolled,
      percent(row.conversion),
      row.demosAttended,
      row.overdueFollowUps,
      rupees(row.collected),
    ]);
  } else if (report === "revenue") {
    fields = ["Course", "Payments", "Collected (Rs)"];
    rows = (await getRevenueByCourse(range)).map((row) => [row.course, row.payments, rupees(row.collected)]);
  } else {
    return new Response("Unknown report", { status: 404 });
  }

  await recordAudit(db, {
    actorId: user.id,
    action: "report.exported",
    entityType: "Report",
    entityId: report,
    after: { from: range.from, to: range.to, rows: rows.length },
  });

  const csv = Papa.unparse({
    fields,
    data: rows.map((row) => row.map((cell) => (typeof cell === "string" ? csvSafe(cell) : cell))),
  });
  return new Response(UTF8_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="scholarlogic-${report}-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
