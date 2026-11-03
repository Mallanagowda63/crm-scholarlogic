import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  IndianRupee,
  Percent,
  UserPlus,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { BarChart, ChartTable } from "@/components/shared/bar-chart";
import { ChartCard, StatTile } from "@/components/shared/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { addDaysToKey, formatDateTime, formatLongDate, formatRupees, greeting, indiaDateKey } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { requireModuleAccess, type CurrentUser } from "@/lib/session";
import {
  getAdmissionsTrend,
  getCollectionsTrend,
  getCounsellorPerformance,
  getFunnel,
  getLeadKpis,
  getLeadsBySource,
  getRecentActivity,
  getTodaysFollowUps,
} from "@/server/analytics";
import { getPlanSummaries, startOfIndiaMonth } from "@/server/fees";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireModuleAccess("dashboard");
  const now = new Date();

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${user.name.split(" ")[0]}`}
        description={formatLongDate(now)}
        actions={<Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>}
      />
      <Suspense fallback={<DashboardSkeleton />}>
        {user.role === "ACCOUNTS" ? <AccountsDashboard now={now} /> : <LeadsDashboard user={user} now={now} />}
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function feeTotals(plans: Awaited<ReturnType<typeof getPlanSummaries>>, now: Date) {
  const monthStart = startOfIndiaMonth(now);
  return plans.reduce(
    (sum, plan) => ({
      collected:
        sum.collected +
        plan.payments.filter((payment) => payment.paidAt >= monthStart).reduce((total, payment) => total + payment.amount, 0),
      pending: sum.pending + plan.summary.balance,
      overdue: sum.overdue + plan.summary.overdueAmount,
    }),
    { collected: 0, pending: 0, overdue: 0 },
  );
}

async function LeadsDashboard({ user, now }: { user: CurrentUser; now: Date }) {
  const isCounsellor = user.role === "COUNSELLOR";
  const canSeeFees = user.role === "ADMIN" || user.role === "VIEWER";
  // The viewer role gets totals and charts, not lists naming students.
  const canSeeNames = user.role === "ADMIN" || isCounsellor;
  const range = { from: addDaysToKey(indiaDateKey(now), -90), to: indiaDateKey(now) };

  const [kpis, funnel, sources, admissions, performance, plans, followUps, activity] = await Promise.all([
    getLeadKpis(user, now),
    getFunnel(user),
    getLeadsBySource(user, range),
    getAdmissionsTrend(user, now),
    isCounsellor ? [] : getCounsellorPerformance(range, now),
    canSeeFees ? getPlanSummaries(now) : [],
    canSeeNames ? getTodaysFollowUps(user, now) : [],
    canSeeNames ? getRecentActivity(user) : [],
  ]);
  const fees = feeTotals(plans, now);
  const sourceChart = sources.map(({ source, leads }) => ({ label: source, value: leads }));
  const leaderboard = performance.map(({ name, enrolled }) => ({ label: name, value: enrolled }));

  return (
    <>
      <dl aria-label="Key numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="New leads this month"
          value={kpis.newThisMonth.toLocaleString("en-IN")}
          note={`${kpis.newToday} today, ${kpis.newThisWeek} this week`}
          icon={UserPlus}
          href={canSeeNames ? "/leads" : undefined}
        />
        <StatTile
          label="Conversion rate"
          value={`${kpis.conversionRate.toFixed(1)}%`}
          note="Enrolled, of enquiries in the last 12 months"
          icon={Percent}
        />
        <StatTile
          label="Admissions this month"
          value={kpis.admissionsThisMonth.toLocaleString("en-IN")}
          icon={GraduationCap}
          href={canSeeNames ? "/admissions" : undefined}
        />
        {canSeeFees && (
          <>
            <StatTile label="Fees collected this month" value={formatRupees(fees.collected)} icon={Wallet} />
            <StatTile
              label="Fees pending"
              value={formatRupees(fees.pending)}
              note={`${formatRupees(fees.overdue)} overdue`}
              icon={IndianRupee}
            />
          </>
        )}
        <StatTile
          label="Overdue follow-ups"
          value={kpis.overdueFollowUps.toLocaleString("en-IN")}
          icon={AlertTriangle}
          href={canSeeNames ? "/tasks?due=overdue" : undefined}
        />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Lead funnel" description="How many people have reached each stage">
          <BarChart data={funnel} label="Lead funnel" horizontal />
          <ChartTable data={funnel} labelHeading="Stage" valueHeading="People" />
        </ChartCard>
        <ChartCard title="Monthly admissions" description="Last 6 months">
          <BarChart data={admissions} label="Monthly admissions" />
          <ChartTable data={admissions} labelHeading="Month" valueHeading="Admissions" />
        </ChartCard>
        <ChartCard title="Leads by source" description="Enquiries in the last 90 days">
          {sourceChart.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enquiries in the last 90 days.</p>
          ) : (
            <>
              <BarChart data={sourceChart} label="Leads by source" horizontal />
              <ChartTable data={sourceChart} labelHeading="Source" valueHeading="Leads" />
            </>
          )}
        </ChartCard>
        {!isCounsellor && (
          <ChartCard title="Counsellor leaderboard" description="Enrolled, of enquiries in the last 90 days">
            <BarChart data={leaderboard} label="Counsellor leaderboard" horizontal />
            <ChartTable data={leaderboard} labelHeading="Counsellor" valueHeading="Enrolled" />
          </ChartCard>
        )}

        {canSeeNames && (
          <ChartCard
            title="Today's follow-ups"
            description="Due today, or overdue"
            action={
              <Link href="/tasks" className="text-sm text-primary-soft-foreground hover:underline">
                All tasks
              </Link>
            }
          >
            {followUps.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4" aria-hidden />
                Nothing due today.
              </p>
            ) : (
              <ul className="divide-y">
                {followUps.map((task) => {
                  const isOverdue = task.dueAt < now;
                  return (
                    <li key={task.id} className="py-2 text-sm">
                      {task.student ? (
                        <Link href={`/students/${task.student.id}`} className="rounded font-medium hover:underline">
                          {task.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{task.title}</span>
                      )}
                      <p className={isOverdue ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                        {isOverdue && "Overdue · "}
                        {formatDateTime(task.dueAt)}
                        {!isCounsellor && ` · ${task.assignee.name}`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </ChartCard>
        )}

        {canSeeNames && (
          <ChartCard title="Recent activity">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2 py-2 text-sm">
                    <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate">
                        <Link href={`/students/${entry.student.id}`} className="rounded font-medium hover:underline">
                          {entry.student.name}
                        </Link>
                        <span className="text-muted-foreground"> · {entry.body}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.occurredAt)}
                        {entry.actor && ` · ${entry.actor.name}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        )}
      </div>
    </>
  );
}

async function AccountsDashboard({ now }: { now: Date }) {
  const [plans, collections] = await Promise.all([getPlanSummaries(now), getCollectionsTrend(now)]);
  const fees = feeTotals(plans, now);
  const overdue = plans
    .flatMap((plan) =>
      plan.summary.instalments
        .filter((instalment) => instalment.status === "OVERDUE")
        .map((instalment) => ({ plan, instalment })),
    )
    .sort((a, b) => a.instalment.dueDate.getTime() - b.instalment.dueDate.getTime());

  return (
    <>
      <dl aria-label="Key numbers" className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Fees collected this month" value={formatRupees(fees.collected)} icon={Wallet} href="/fees?view=payments" />
        <StatTile label="Fees pending" value={formatRupees(fees.pending)} icon={IndianRupee} href="/fees?view=plans" />
        <StatTile
          label="Overdue"
          value={formatRupees(fees.overdue)}
          note={`${overdue.length} ${overdue.length === 1 ? "instalment" : "instalments"}`}
          icon={AlertTriangle}
          href="/fees"
        />
      </dl>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Monthly collections" description="Last 6 months">
          <BarChart data={collections} label="Monthly collections" format="rupees" />
          <ChartTable data={collections} labelHeading="Month" valueHeading="Collected" format="rupees" />
        </ChartCard>
        <ChartCard
          title="Most overdue"
          action={
            <Link href="/fees" className="text-sm text-primary-soft-foreground hover:underline">
              View all
            </Link>
          }
        >
          {overdue.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4" aria-hidden />
              Nothing overdue.
            </p>
          ) : (
            <ul className="divide-y">
              {overdue.slice(0, 8).map(({ plan, instalment }) => (
                <li key={instalment.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/students/${plan.student.id}?tab=payments`} className="rounded font-medium hover:underline">
                      {plan.student.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{plan.course.name}</p>
                  </div>
                  <p className="shrink-0 font-medium text-destructive tabular-nums">{formatRupees(instalment.outstanding)}</p>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </>
  );
}
