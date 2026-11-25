import { ChevronLeft, ChevronRight, CircleAlert, Footprints, GraduationCap, IndianRupee, MailQuestion, UserX } from "lucide-react";
import Link from "next/link";

import { ChartCard, StatTile } from "@/components/shared/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRupees } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  FIGURE_FIELDS,
  MAX_YEARS,
  MONTH_NAMES,
  formatMonth,
  getMonthOverview,
  getYearlyFigures,
  monthKeyOf,
  shiftMonth,
  type MonthKey,
  type YearFigures,
} from "@/server/admin-overview";
import { withBase } from "@/lib/base-path";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Reads ?month= and ?year=, keeping both within the last ten years and not in the future. */
export function parseOverviewParams(params: Record<string, string | string[] | undefined>, now: Date) {
  const current = monthKeyOf(now);
  const earliest = `${Number(current.slice(0, 4)) - MAX_YEARS + 1}-01`;
  const rawMonth = typeof params.month === "string" ? params.month : "";
  const month = MONTH_PATTERN.test(rawMonth) && rawMonth <= current && rawMonth >= earliest ? rawMonth : current;
  const rawYear = typeof params.year === "string" ? Number(params.year) : NaN;
  const year = Number.isInteger(rawYear) ? rawYear : Number(month.slice(0, 4));
  return { month, year };
}

function overviewHref(month: MonthKey, year: number) {
  return `/dashboard?month=${month}&year=${year}`;
}

const count = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-IN"));

export async function AdminOverview({ month, year, now }: { month: MonthKey; year: number; now: Date }) {
  const yearly = await getYearlyFigures(now);
  const overview = await getMonthOverview(month, now, yearly);
  const current = monthKeyOf(now);
  const earliestYear = yearly.at(-1)?.year ?? Number(current.slice(0, 4));
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const hasPrevious = Number(previous.slice(0, 4)) >= earliestYear;
  const hasNext = next <= current;
  const selectedYear = yearly.find((entry) => entry.year === year) ?? yearly[0];

  return (
    <div id="overview" className="mb-4 grid scroll-mt-4 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <ChartCard
        title="Month at a glance"
        description={formatMonth(month)}
        action={
          <div className="flex items-center gap-1">
            <MonthStep href={hasPrevious ? overviewHref(previous, Number(previous.slice(0, 4))) : null} label="Previous month">
              <ChevronLeft aria-hidden />
            </MonthStep>
            <form action={withBase("/dashboard")} className="flex items-center gap-1">
              <Input
                type="month"
                name="month"
                aria-label="Choose a month"
                defaultValue={month}
                min={`${earliestYear}-01`}
                max={current}
                className="h-8 w-36"
              />
              <Button type="submit" variant="outline" size="sm" className="h-8">
                Show
              </Button>
            </form>
            <MonthStep href={hasNext ? overviewHref(next, Number(next.slice(0, 4))) : null} label="Next month">
              <ChevronRight aria-hidden />
            </MonthStep>
          </div>
        }
      >
        {overview.hasSampleCounts && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleAlert className="size-3.5" aria-hidden />
            Walk-ins and admissions for this month are sample figures.
          </p>
        )}
        <dl aria-label={`Numbers for ${formatMonth(month)}`} className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Walk-ins"
            value={count(overview.walkIns)}
            note={`${count(overview.walkInsThisYear)} in ${month.slice(0, 4)} up to ${MONTH_NAMES[Number(month.slice(5)) - 1]}`}
            icon={Footprints}
          />
          <StatTile label="Admissions" value={count(overview.admissions)} icon={GraduationCap} />
          <StatTile
            label="Invalid enquiries"
            value={count(overview.invalid)}
            note="Wrong numbers, spam, not looking for a course"
            icon={UserX}
          />
        </dl>

        <h3 className="mt-5 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Add-on: waiting on us</h3>
        <dl aria-label="Waiting on us" className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Pending reply"
            value={count(overview.pendingReply)}
            note="Enquiries this month not contacted yet"
            icon={MailQuestion}
          />
          <StatTile
            label="Payment pending"
            value={formatRupees(overview.paymentPending.amount)}
            note={`Due this month from ${overview.paymentPending.students} ${overview.paymentPending.students === 1 ? "student" : "students"}`}
            icon={IndianRupee}
            href="/fees?view=plans"
          />
        </dl>

        <h3 className="mt-5 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Admissions by course</h3>
        {overview.byCourse.length === 0 ? (
          <p className="text-sm text-muted-foreground">No admissions recorded in the CRM for {formatMonth(month)}.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Admissions by course in {formatMonth(month)}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Course</th>
                <th scope="col">Admissions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {overview.byCourse.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {row.label}
                  </th>
                  <td className="py-1.5 text-right font-medium tabular-nums">{count(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartCard>

      <ChartCard
        title="Admissions by year"
        description={`Choose a year to see it month by month. Up to ${MAX_YEARS} years.`}
        action={selectedYear?.isSample && <Badge variant="secondary">Includes sample figures</Badge>}
      >
        <ul className="flex flex-wrap gap-2" aria-label="Years">
          {yearly.map((entry) => (
            <li key={entry.year}>
              <Link
                href={overviewHref(month, entry.year)}
                scroll={false}
                aria-current={entry.year === selectedYear?.year ? "true" : undefined}
                className={cn(
                  "flex flex-col rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50",
                  entry.year === selectedYear?.year && "border-primary bg-primary-soft text-primary-soft-foreground",
                )}
              >
                <span className="text-sm font-semibold">{entry.year}</span>
                <span className="text-xs text-muted-foreground">{count(entry.totals.admissions)} admissions</span>
              </Link>
            </li>
          ))}
        </ul>

        {selectedYear && <YearTable entry={selectedYear} month={month} current={current} />}
      </ChartCard>
    </div>
  );
}

function MonthStep({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const className = cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8");
  if (!href) {
    return (
      <span aria-disabled className={cn(className, "pointer-events-none opacity-40")} aria-label={label} role="link">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={className} scroll={false}>
      {children}
    </Link>
  );
}

function YearTable({ entry, month, current }: { entry: YearFigures; month: MonthKey; current: MonthKey }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <caption className="sr-only">Month by month figures for {entry.year}</caption>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 text-left font-medium">
              {entry.year}
            </th>
            {FIGURE_FIELDS.map(({ key, label, short }) => (
              <th key={key} scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap">
                <abbr title={label} className="no-underline">
                  {short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {entry.months.map((row) => {
            const key = `${entry.year}-${String(row.month).padStart(2, "0")}`;
            const isFuture = key > current;
            return (
              <tr key={row.month} className={cn(key === month && "bg-primary-soft/60", isFuture && "text-muted-foreground")}>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                  {isFuture ? (
                    MONTH_NAMES[row.month - 1]
                  ) : (
                    <Link
                      href={overviewHref(key, entry.year)}
                      scroll={false}
                      aria-label={`Show ${formatMonth(key)}`}
                      aria-current={key === month ? "true" : undefined}
                      className="rounded text-primary-soft-foreground hover:underline"
                    >
                      {MONTH_NAMES[row.month - 1]}
                    </Link>
                  )}
                  {row.isSample && (
                    <span className="ml-1 text-muted-foreground" title="Sample figures">
                      *
                    </span>
                  )}
                </th>
                {FIGURE_FIELDS.map(({ key: field }) => (
                  <td key={field} className="px-2 py-1.5 text-right tabular-nums">
                    {/* Counts for months still to come are left empty, while a planned target can be shown. */}
                    {isFuture && field !== "plannedCandidates" ? "—" : count(row[field])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t font-semibold">
            <th scope="row" className="py-2 pr-3 text-left">
              Total
            </th>
            {FIGURE_FIELDS.map(({ key }) => (
              <td key={key} className="px-2 py-2 text-right tabular-nums">
                {count(entry.totals[key])}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      {entry.isSample && <p className="mt-2 text-xs text-muted-foreground">* Sample figures, until the real numbers are entered.</p>}
    </div>
  );
}
