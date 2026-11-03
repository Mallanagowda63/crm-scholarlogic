import { AlertTriangle, Download, IndianRupee, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { Pager } from "@/app/(app)/students/pager";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYMENT_METHOD_LABELS } from "@/lib/fees";
import { formatRupees, formatShortDate } from "@/lib/format";
import { requireModuleAccess } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getAwaitingFeePlan, getPlanSummaries, getRecentPayments, startOfIndiaMonth } from "@/server/fees";

export const metadata: Metadata = { title: "Fees" };

const PAGE_SIZE = 25;
const VIEWS = [
  { id: "overdue", label: "Overdue" },
  { id: "plans", label: "Fee plans" },
  { id: "payments", label: "Payments" },
  { id: "awaiting", label: "Awaiting plan" },
] as const;

const querySchema = z.object({
  view: z.enum(["overdue", "plans", "payments", "awaiting"]).catch("overdue"),
  page: z.coerce.number().int().min(1).catch(1),
});

export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("fees");
  const { view, page: requestedPage } = querySchema.parse(await searchParams);
  const now = new Date();
  const plans = await getPlanSummaries(now);
  const monthStart = startOfIndiaMonth(now);

  const totals = plans.reduce(
    (sum, plan) => ({
      collectedThisMonth:
        sum.collectedThisMonth +
        plan.payments.filter((payment) => payment.paidAt >= monthStart).reduce((total, payment) => total + payment.amount, 0),
      pending: sum.pending + plan.summary.balance,
      overdue: sum.overdue + plan.summary.overdueAmount,
    }),
    { collectedThisMonth: 0, pending: 0, overdue: 0 },
  );

  const overdueRows = plans
    .flatMap((plan) =>
      plan.summary.instalments
        .filter((instalment) => instalment.status === "OVERDUE")
        .map((instalment) => ({ plan, instalment })),
    )
    .sort((a, b) => a.instalment.dueDate.getTime() - b.instalment.dueDate.getTime());

  const hrefFor = (target: number) => `/fees?view=${view}${target > 1 ? `&page=${target}` : ""}`;
  const pageFor = (total: number) => Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const slice = <T,>(rows: T[]) => {
    const page = pageFor(rows.length);
    return rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  };

  return (
    <>
      <PageHeader title="Fees" description="What's been collected, what's owed and what's overdue." />

      <dl className="mb-5 grid gap-3 sm:grid-cols-3" aria-label="Fee totals">
        {(
          [
            ["Collected this month", totals.collectedThisMonth, Wallet],
            ["Total pending", totals.pending, IndianRupee],
            ["Overdue", totals.overdue, AlertTriangle],
          ] as const
        ).map(([label, amount, Icon]) => (
          <div key={label} className="rounded-xl border bg-card p-4 shadow-xs">
            <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Icon className="size-4" aria-hidden />
              {label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatRupees(amount)}</dd>
          </div>
        ))}
      </dl>

      <nav aria-label="Fee sections" className="mb-4 flex gap-1 overflow-x-auto border-b">
        {VIEWS.map(({ id, label }) => (
          <Link
            key={id}
            href={`/fees?view=${id}`}
            scroll={false}
            aria-current={view === id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              view === id
                ? "border-primary text-primary-soft-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {view === "overdue" &&
        (overdueRows.length === 0 ? (
          <Card>
            <EmptyState icon={IndianRupee} title="Nothing overdue" description="Every instalment that's due has been paid." />
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Overdue</TableHead>
                    <TableHead className="hidden sm:table-cell">Due</TableHead>
                    <TableHead className="hidden md:table-cell">Instalment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slice(overdueRows).map(({ plan, instalment }) => (
                    <TableRow key={instalment.id}>
                      <TableCell className="max-w-48 whitespace-normal sm:max-w-none">
                        <Link href={`/students/${plan.student.id}?tab=payments`} className="rounded font-medium hover:underline">
                          {plan.student.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{plan.course.name}</span>
                      </TableCell>
                      <TableCell className="font-medium text-destructive tabular-nums">
                        {formatRupees(instalment.outstanding)}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatShortDate(instalment.dueDate)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {instalment.sequence} of {plan.instalments.length}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <Pager
              summary={`${overdueRows.length.toLocaleString("en-IN")} overdue`}
              page={pageFor(overdueRows.length)}
              pageCount={Math.max(1, Math.ceil(overdueRows.length / PAGE_SIZE))}
              hrefFor={hrefFor}
            />
          </>
        ))}

      {view === "plans" &&
        (plans.length === 0 ? (
          <Card>
            <EmptyState icon={IndianRupee} title="No fee plans yet" description="Set up a plan from a student's Payments tab." />
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="hidden md:table-cell">Total</TableHead>
                    <TableHead className="hidden sm:table-cell">Paid</TableHead>
                    <TableHead>Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slice(plans).map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="max-w-48 whitespace-normal sm:max-w-none">
                        <Link href={`/students/${plan.student.id}?tab=payments`} className="rounded font-medium hover:underline">
                          {plan.student.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{plan.course.name}</span>
                      </TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">{formatRupees(plan.summary.payable)}</TableCell>
                      <TableCell className="hidden tabular-nums sm:table-cell">{formatRupees(plan.summary.paid)}</TableCell>
                      <TableCell className={cn("tabular-nums", plan.summary.overdueAmount > 0 && "font-medium text-destructive")}>
                        {formatRupees(plan.summary.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <Pager
              summary={`${plans.length.toLocaleString("en-IN")} plans`}
              page={pageFor(plans.length)}
              pageCount={Math.max(1, Math.ceil(plans.length / PAGE_SIZE))}
              hrefFor={hrefFor}
            />
          </>
        ))}

      {view === "payments" && <PaymentsView page={requestedPage} hrefFor={hrefFor} />}
      {view === "awaiting" && <AwaitingView />}
    </>
  );
}

async function PaymentsView({ page, hrefFor }: { page: number; hrefFor: (page: number) => string }) {
  const [total, rows] = await getRecentPayments((page - 1) * PAGE_SIZE, PAGE_SIZE);
  if (total === 0) {
    return (
      <Card>
        <EmptyState icon={Wallet} title="No payments yet" description="Payments appear here once they're recorded." />
      </Card>
    );
  }
  return (
    <>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden sm:table-cell">Paid on</TableHead>
              <TableHead className="hidden md:table-cell">Method</TableHead>
              <TableHead className="hidden lg:table-cell">Receipt</TableHead>
              <TableHead>
                <span className="sr-only">Download</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className="max-w-48 whitespace-normal sm:max-w-none">
                  <Link href={`/students/${payment.feePlan.student.id}?tab=payments`} className="rounded font-medium hover:underline">
                    {payment.feePlan.student.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{payment.feePlan.course.name}</span>
                </TableCell>
                <TableCell className="tabular-nums">{formatRupees(payment.amount)}</TableCell>
                <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatShortDate(payment.paidAt)}</TableCell>
                <TableCell className="hidden md:table-cell">{PAYMENT_METHOD_LABELS[payment.method]}</TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">{payment.receipt?.number ?? "—"}</TableCell>
                <TableCell className="w-10">
                  {payment.receipt && (
                    <a
                      href={`/fees/receipts/${payment.id}`}
                      aria-label={`Download receipt ${payment.receipt.number}`}
                      className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
                    >
                      <Download />
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pager
        summary={`${total.toLocaleString("en-IN")} payments`}
        page={Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)))}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        hrefFor={hrefFor}
      />
    </>
  );
}

async function AwaitingView() {
  const admissions = await getAwaitingFeePlan();
  if (admissions.length === 0) {
    return (
      <Card>
        <EmptyState icon={IndianRupee} title="Nobody is waiting" description="Every admission has a fee plan." />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Course fee</TableHead>
            <TableHead className="hidden sm:table-cell">Admitted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {admissions.map((admission) => (
            <TableRow key={admission.id}>
              <TableCell className="max-w-48 whitespace-normal sm:max-w-none">
                <Link href={`/students/${admission.student.id}?tab=payments`} className="rounded font-medium hover:underline">
                  {admission.student.name}
                </Link>
                <span className="block text-xs text-muted-foreground">{admission.course.name}</span>
              </TableCell>
              <TableCell className="tabular-nums">{formatRupees(admission.course.fee)}</TableCell>
              <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatShortDate(admission.admissionDate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
