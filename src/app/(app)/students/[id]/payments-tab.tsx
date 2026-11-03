import { Download, IndianRupee } from "lucide-react";

import {
  CancelFeePlanButton,
  CancelPaymentButton,
  CreateFeePlanButton,
  RecordPaymentButton,
} from "@/app/(app)/students/[id]/payment-forms";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { PAYMENT_METHOD_LABELS, summarisePlan } from "@/lib/fees";
import { formatRupees, formatShortDate, indiaDateKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getFeePlans } from "@/server/students";

const STATUS = {
  PAID: { label: "Paid", className: "text-emerald-700 dark:text-emerald-400" },
  PART_PAID: { label: "Part paid", className: "text-amber-700 dark:text-amber-400" },
  OVERDUE: { label: "Overdue", className: "font-medium text-destructive" },
  UPCOMING: { label: "Upcoming", className: "text-muted-foreground" },
} as const;

export async function PaymentsTab({ studentId, canManage }: { studentId: string; canManage: boolean }) {
  const [plans, awaiting] = await Promise.all([
    getFeePlans(studentId),
    db.admission.findFirst({
      where: { studentId, feePlanId: null, status: { not: "CANCELLED" } },
      select: { id: true, course: { select: { name: true, fee: true, gstRateBps: true } } },
    }),
  ]);
  const now = new Date();
  const today = indiaDateKey(now);

  return (
    <div className="space-y-5">
      {canManage && awaiting && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs">
          <p className="text-sm">
            <span className="font-medium">{awaiting.course.name}</span> needs a fee plan.
          </p>
          <CreateFeePlanButton
            admissionId={awaiting.id}
            courseFee={awaiting.course.fee}
            gstRateBps={awaiting.course.gstRateBps}
            today={today}
          />
        </div>
      )}

      {plans.length === 0 && !(canManage && awaiting) && (
        <Card>
          <EmptyState
            icon={IndianRupee}
            title="No fee plan yet"
            description="Instalments and payments appear here once there's an admission and a fee plan."
            className="py-8"
          />
        </Card>
      )}

      {plans.map((plan) => {
        const live = plan.payments.filter((payment) => !payment.deletedAt);
        const summary = summarisePlan({ ...plan, payments: live }, now);
        return (
          <div key={plan.id} className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-3" aria-label={`Fee summary for ${plan.course.name}`}>
              {(
                [
                  ["Total payable", summary.payable, `Includes ${plan.gstRateBps / 100}% GST`],
                  ["Paid", summary.paid, `${live.length} ${live.length === 1 ? "payment" : "payments"}`],
                  [
                    "Balance",
                    summary.balance,
                    plan.discountAmount > 0 ? `After ${formatRupees(plan.discountAmount)} discount` : plan.course.name,
                  ],
                ] as const
              ).map(([label, amount, note]) => (
                <div key={label} className="rounded-xl border bg-card p-4 shadow-xs">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{formatRupees(amount)}</dd>
                  <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
                </div>
              ))}
            </dl>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                {summary.balance > 0 && <RecordPaymentButton feePlanId={plan.id} balance={summary.balance} today={today} />}
                {live.length === 0 && <CancelFeePlanButton feePlanId={plan.id} />}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border bg-card p-5 shadow-xs">
                <h2 className="mb-3 text-sm font-semibold">Instalments</h2>
                <ul className="divide-y">
                  {summary.instalments.map((instalment) => (
                    <li
                      key={instalment.id}
                      data-instalment={instalment.sequence}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <div>
                        <p className="font-medium">Instalment {instalment.sequence}</p>
                        <p className="text-xs text-muted-foreground">Due {formatShortDate(instalment.dueDate)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium tabular-nums">{formatRupees(instalment.amount)}</p>
                        <p className={cn("text-xs", STATUS[instalment.status].className)}>
                          {STATUS[instalment.status].label}
                          {instalment.status === "PART_PAID" && `, ${formatRupees(instalment.outstanding)} left`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-xl border bg-card p-5 shadow-xs">
                <h2 className="mb-3 text-sm font-semibold">Payments received</h2>
                {plan.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payments yet.</p>
                ) : (
                  <ul className="divide-y">
                    {plan.payments.map((payment) => (
                      <li
                        key={payment.id}
                        className={cn("flex items-center justify-between gap-3 py-2.5 text-sm", payment.deletedAt && "opacity-60")}
                      >
                        <div className="min-w-0">
                          <p className="font-medium">
                            {formatShortDate(payment.paidAt)}
                            {payment.deletedAt && <span className="ml-1.5 text-xs text-destructive">Cancelled</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {PAYMENT_METHOD_LABELS[payment.method]}
                            {payment.receipt && ` · ${payment.receipt.number}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <p className={cn("mr-1 font-medium tabular-nums", payment.deletedAt && "line-through")}>
                            {formatRupees(payment.amount)}
                          </p>
                          {payment.receipt && (
                            <a
                              href={`/fees/receipts/${payment.id}`}
                              aria-label={`Download receipt ${payment.receipt.number}`}
                              className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
                            >
                              <Download />
                            </a>
                          )}
                          {canManage && !payment.deletedAt && (
                            <CancelPaymentButton paymentId={payment.id} label={payment.receipt?.number ?? "this payment"} />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        );
      })}
    </div>
  );
}
