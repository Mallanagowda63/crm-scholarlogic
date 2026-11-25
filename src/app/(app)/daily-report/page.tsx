import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, MessageSquare, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ChartCard, StatTile } from "@/components/shared/stat-tile";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDaysToKey, formatKey, formatTime, indiaDateKey } from "@/lib/format";
import { requireModuleAccess } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getDailyReport, isDayKey, reportTotals } from "@/server/daily-report";
import { withBase } from "@/lib/base-path";

export const metadata: Metadata = { title: "Daily report" };

const TYPE_LABELS: Record<string, string> = {
  CALL: "Call",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  NOTE: "Note",
  STAGE_CHANGE: "Stage",
  FOLLOW_UP: "Follow-up",
  DEMO_CLASS: "Demo class",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DailyReportPage({ searchParams }: Props) {
  await requireModuleAccess("dailyReport");
  const today = indiaDateKey(new Date());
  const raw = (await searchParams).date;
  const day = typeof raw === "string" && isDayKey(raw) && raw <= today ? raw : today;
  const rows = await getDailyReport(day);
  const totals = reportTotals(rows);
  const label = formatKey(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const next = addDaysToKey(day, 1);

  return (
    <>
      <PageHeader
        title="Daily report"
        description={`${label}. Only admins can see this page.`}
        actions={
          <div className="flex items-center gap-1">
            <Link
              href={`/daily-report?date=${addDaysToKey(day, -1)}`}
              aria-label="Previous day"
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
            >
              <ChevronLeft aria-hidden />
            </Link>
            <form action={withBase("/daily-report")} className="flex items-center gap-1">
              <Input type="date" name="date" aria-label="Choose a day" defaultValue={day} max={today} className="h-9 w-40" />
              <Button type="submit" variant="outline" className="h-9">
                Show
              </Button>
            </form>
            {next <= today && (
              <Link
                href={`/daily-report?date=${next}`}
                aria-label="Next day"
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
              >
                <ChevronRight aria-hidden />
              </Link>
            )}
          </div>
        }
      />

      <dl aria-label="Totals for the day" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Follow-ups done" value={totals.followUpsDone.toLocaleString("en-IN")} icon={CheckCircle2} />
        <StatTile
          label="Follow-ups missed"
          value={totals.followUpsMissed.toLocaleString("en-IN")}
          note="Due that day and not done on time"
          icon={AlertTriangle}
        />
        <StatTile
          label="Calls, WhatsApp and emails"
          value={totals.contacts.toLocaleString("en-IN")}
          icon={MessageSquare}
        />
        <StatTile label="Leads added" value={totals.leadsAdded.toLocaleString("en-IN")} icon={UserPlus} />
      </dl>

      {rows.length === 0 ? (
        <EmptyState icon={UserPlus} title="No counsellors yet" description="Add counsellors in Settings to see their daily work here." />
      ) : (
        <>
          <ChartCard title="By counsellor">
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Counsellor</TableHead>
                    <TableHead className="text-right">Follow-ups done</TableHead>
                    <TableHead className="text-right">Missed</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">WhatsApp</TableHead>
                    <TableHead className="text-right">Emails</TableHead>
                    <TableHead className="text-right">Notes</TableHead>
                    <TableHead className="text-right">Stage moves</TableHead>
                    <TableHead className="text-right">Leads added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        <a href={`#counsellor-${row.id}`} className="rounded hover:underline">
                          {row.name}
                        </a>
                        {!row.isActive && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.followUpsDone}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", row.followUpsMissed > 0 && "font-medium text-destructive")}>
                        {row.followUpsMissed}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.whatsapp}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.emails}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.notes}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.stageChanges}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.leadsAdded}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ChartCard>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {rows.map((row) => (
              <div key={row.id} id={`counsellor-${row.id}`} className="scroll-mt-4">
                <ChartCard title={row.name} description={`${row.entries.length} ${row.entries.length === 1 ? "entry" : "entries"} on the timeline`}>
                  {row.entries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing logged this day.</p>
                  ) : (
                    <ol className="divide-y">
                      {row.entries.map((entry) => (
                        <li key={entry.id} className="flex gap-3 py-2 text-sm">
                          <time dateTime={entry.at.toISOString()} className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                            {formatTime(entry.at)}
                          </time>
                          <div className="min-w-0">
                            <p>
                              <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{TYPE_LABELS[entry.type] ?? entry.type}</span>
                              <Link href={`/students/${entry.student.id}`} className="rounded font-medium hover:underline">
                                {entry.student.name}
                              </Link>
                            </p>
                            <p className="mt-0.5 break-words text-muted-foreground">{entry.body}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </ChartCard>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
