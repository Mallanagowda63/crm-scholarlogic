import { Download, GraduationCap, IndianRupee, Percent, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ReportRangeForm } from "@/app/(app)/reports/range-form";
import { BarChart, ChartTable } from "@/components/shared/bar-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ChartCard, StatTile } from "@/components/shared/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDaysToKey, formatKey, formatRupees, indiaDateKey } from "@/lib/format";
import { parseReportRange, RANGE_PRESETS } from "@/lib/reports";
import { requireModuleAccess, type CurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  getCounsellorPerformance,
  getFunnel,
  getLeadsBySource,
  getRevenueByCourse,
  type DateRange,
} from "@/server/analytics";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireModuleAccess("reports");
  const now = new Date();
  const range = parseReportRange(await searchParams, now);
  const today = indiaDateKey(now);
  const label = `${formatKey(range.from, { day: "numeric", month: "short", year: "numeric" })} to ${formatKey(range.to, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <>
      <PageHeader title="Reports" description={label} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <ReportRangeForm from={range.from} to={range.to} today={today} />
        <div className="flex gap-1" role="group" aria-label="Quick ranges">
          {RANGE_PRESETS.map(({ label: presetLabel, days }) => {
            const from = addDaysToKey(today, -days);
            const isCurrent = range.from === from && range.to === today;
            return (
              <Link
                key={days}
                href={`/reports?from=${from}&to=${today}`}
                scroll={false}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "rounded-lg border px-2.5 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  isCurrent ? "bg-primary-soft text-primary-soft-foreground" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {presetLabel}
              </Link>
            );
          })}
        </div>
      </div>
      <Suspense
        key={`${range.from}-${range.to}`}
        fallback={
          <div role="status" aria-label="Loading reports" className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        }
      >
        <ReportsData user={user} range={range} now={now} />
      </Suspense>
    </>
  );
}

function ExportLink({ report, range, name }: { report: string; range: DateRange; name: string }) {
  return (
    <a
      href={`/reports/export?report=${report}&from=${range.from}&to=${range.to}`}
      aria-label={`Export ${name} as CSV`}
      className="inline-flex items-center gap-1 rounded text-sm text-primary-soft-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Download className="size-3.5" aria-hidden />
      CSV
    </a>
  );
}

async function ReportsData({ user, range, now }: { user: CurrentUser; range: DateRange; now: Date }) {
  const [funnel, sources, counsellors, courses] = await Promise.all([
    getFunnel(user, range),
    getLeadsBySource(user, range),
    getCounsellorPerformance(range, now),
    getRevenueByCourse(range),
  ]);

  const totalLeads = sources.reduce((sum, row) => sum + row.leads, 0);
  const totalEnrolled = sources.reduce((sum, row) => sum + row.enrolled, 0);
  const totalCollected = courses.reduce((sum, row) => sum + row.collected, 0);
  const conversionChart = sources.map(({ source, conversion }) => ({ label: source, value: conversion }));
  const revenueChart = courses.map(({ course, collected }) => ({ label: course, value: collected }));

  return (
    <>
      <dl aria-label="Totals for this period" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Enquiries" value={totalLeads.toLocaleString("en-IN")} icon={UserPlus} />
        <StatTile label="Enrolled" value={totalEnrolled.toLocaleString("en-IN")} note="Of these enquiries" icon={GraduationCap} />
        <StatTile
          label="Conversion rate"
          value={`${(totalLeads === 0 ? 0 : (totalEnrolled / totalLeads) * 100).toFixed(1)}%`}
          icon={Percent}
        />
        <StatTile label="Fees collected" value={formatRupees(totalCollected)} note="Including GST" icon={IndianRupee} />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Funnel" description="Of the enquiries in this period, how far each has reached">
          <BarChart data={funnel} label="Funnel" horizontal />
          <ChartTable data={funnel} labelHeading="Stage" valueHeading="People" />
        </ChartCard>

        <ChartCard
          title="Revenue by course"
          description="Payments received in this period, including GST"
          action={<ExportLink report="revenue" range={range} name="revenue by course" />}
        >
          {courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments in this period.</p>
          ) : (
            <>
              <BarChart data={revenueChart} label="Revenue by course" format="rupees" horizontal />
              <ChartTable data={revenueChart} labelHeading="Course" valueHeading="Collected" format="rupees" />
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Conversion by source"
          description="Enrolled, of enquiries from each source in this period"
          action={<ExportLink report="sources" range={range} name="conversion by source" />}
        >
          {sources.length === 0 ? (
            <EmptyState icon={UserPlus} title="No enquiries" description="Try a longer date range." className="py-6" />
          ) : (
            <>
              <BarChart data={conversionChart} label="Conversion by source" format="percent" horizontal />
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Enrolled</TableHead>
                      <TableHead className="text-right">Conversion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map((row) => (
                      <TableRow key={row.source} data-source={row.source}>
                        <TableCell>{row.source}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.leads}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.enrolled}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.conversion.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </ChartCard>

        <div className="min-w-0 lg:col-span-2">
        <ChartCard
          title="Counsellor performance"
          description="Enquiries assigned in this period. Overdue is as of today."
          action={<ExportLink report="counsellors" range={range} name="counsellor performance" />}
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Counsellor</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Enrolled</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Demos</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counsellors.map((row) => (
                  <TableRow key={row.id} data-counsellor={row.name}>
                    <TableCell className="whitespace-nowrap">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.leads}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.enrolled}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.conversion.toFixed(1)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{row.demosAttended}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.overdueFollowUps}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{formatRupees(row.collected)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ChartCard>
        </div>
      </div>
    </>
  );
}
