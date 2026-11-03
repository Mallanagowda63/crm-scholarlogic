"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Loader2, Plus, Wallet } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { payableAmount, PAYMENT_METHOD_LABELS, splitIntoInstalments } from "@/lib/fees";
import { addDaysToKey, formatKey, formatRupees } from "@/lib/format";
import {
  feePlanSchema,
  paymentSchema,
  type FeePlanFormValues,
  type PaymentFormValues,
} from "@/lib/validations/fees";
import { cancelFeePlan, cancelPayment, createFeePlan, recordPayment, type FeeResult } from "@/server/actions/fees";

async function report(action: Promise<FeeResult>, success: string) {
  try {
    const result = await action;
    if (result.ok) toast.success(success);
    else toast.error(result.error);
    return result.ok;
  } catch {
    toast.error("Something went wrong. Please try again.");
    return false;
  }
}

export function CreateFeePlanButton({
  admissionId,
  courseFee,
  gstRateBps,
  today,
}: {
  admissionId: string;
  courseFee: number;
  gstRateBps: number;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, getValues, watch, formState: { errors, isSubmitting } } = useForm<
    FeePlanFormValues,
    unknown,
    z.output<typeof feePlanSchema>
  >({
    resolver: zodResolver(feePlanSchema),
    defaultValues: { discount: "0", instalmentCount: "3", firstDueDate: today, intervalDays: "30" },
  });

  // A live preview, so the amounts and dates are clear before saving.
  const values = watch();
  const discount = Math.round(Number(values.discount.replace(/[₹,\s]/g, "")) * 100) || 0;
  const count = Math.min(24, Math.max(1, Number(values.instalmentCount) || 1));
  const interval = Math.max(1, Number(values.intervalDays) || 30);
  const payable = payableAmount({ totalAmount: courseFee, discountAmount: Math.min(discount, courseFee), gstRateBps });
  const amounts = splitIntoInstalments(payable, count);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(values.firstDueDate);

  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Set up fee plan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set up a fee plan</DialogTitle>
            <DialogDescription>
              Course fee {formatRupees(courseFee)} plus {gstRateBps / 100}% GST.
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-3"
            onSubmit={handleSubmit(async () => {
              if (await report(createFeePlan(admissionId, getValues()), "Fee plan created")) setOpen(false);
            })}
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField id="plan-discount" label="Discount (₹)" error={errors.discount?.message}>
                <Input id="plan-discount" className="h-10" inputMode="decimal" {...register("discount")} />
              </FormField>
              <FormField id="plan-count" label="Instalments" error={errors.instalmentCount?.message}>
                <Input id="plan-count" className="h-10" inputMode="numeric" {...register("instalmentCount")} />
              </FormField>
              <FormField id="plan-first" label="First due date" error={errors.firstDueDate?.message}>
                <Input id="plan-first" type="date" className="h-10" {...register("firstDueDate")} />
              </FormField>
              <FormField id="plan-interval" label="Days between" error={errors.intervalDays?.message}>
                <Input id="plan-interval" className="h-10" inputMode="numeric" {...register("intervalDays")} />
              </FormField>
            </div>
            <div className="rounded-lg border p-3 text-sm" aria-label="Instalment preview">
              <p className="mb-2 flex justify-between font-medium">
                <span>Total payable</span>
                <span className="tabular-nums">{formatRupees(payable)}</span>
              </p>
              <ul className="max-h-36 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {amounts.map((amount, index) => (
                  <li key={index} className="flex justify-between">
                    <span>
                      {index + 1}.{" "}
                      {validDate &&
                        formatKey(addDaysToKey(values.firstDueDate, index * interval), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                    </span>
                    <span className="tabular-nums">{formatRupees(amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                Create plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RecordPaymentButton({ feePlanId, balance, today }: { feePlanId: string; balance: number; today: string }) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, getValues, reset, formState: { errors, isSubmitting } } = useForm<
    PaymentFormValues,
    unknown,
    z.output<typeof paymentSchema>
  >({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: String(balance / 100), method: "UPI", reference: "", paidOn: today, notes: "" },
  });

  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Wallet aria-hidden />
        Record payment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>{formatRupees(balance)} is still owed. A receipt is created automatically.</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-3"
            onSubmit={handleSubmit(async () => {
              if (await report(recordPayment(feePlanId, getValues()), "Payment recorded")) {
                reset();
                setOpen(false);
              }
            })}
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField id="payment-amount" label="Amount (₹)" error={errors.amount?.message}>
                <Input id="payment-amount" className="h-10" inputMode="decimal" {...register("amount")} />
              </FormField>
              <FormField id="payment-method" label="Method">
                <NativeSelect id="payment-method" className="w-full [&>select]:h-10" {...register("method")}>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="payment-reference" label="Reference" error={errors.reference?.message}>
                <Input id="payment-reference" className="h-10" placeholder="UPI or bank reference" {...register("reference")} />
              </FormField>
              <FormField id="payment-date" label="Paid on" error={errors.paidOn?.message}>
                <Input id="payment-date" type="date" max={today} className="h-10" {...register("paidOn")} />
              </FormField>
            </div>
            <FormField id="payment-notes" label="Notes (optional)" error={errors.notes?.message}>
              <Input id="payment-notes" className="h-10" {...register("notes")} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                Save payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelFeePlanButton({ feePlanId }: { feePlanId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="lg"
      disabled={isPending}
      onClick={() => startTransition(() => report(cancelFeePlan(feePlanId), "Fee plan cancelled").then(() => undefined))}
    >
      Cancel fee plan
    </Button>
  );
}

export function CancelPaymentButton({ paymentId, label }: { paymentId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button variant="ghost" size="icon" aria-label={`Cancel payment ${label}`} onClick={() => setOpen(true)}>
        <Ban />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this payment?</DialogTitle>
            <DialogDescription>
              It stops counting toward the balance. Receipt {label} stays on record, marked as cancelled, and its number
              isn&apos;t reused.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                if (await report(cancelPayment(paymentId, reason), "Payment cancelled")) setOpen(false);
              });
            }}
          >
            <FormField id={`cancel-reason-${paymentId}`} label="Reason">
              <Input
                id={`cancel-reason-${paymentId}`}
                className="h-10"
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Keep payment
              </Button>
              <Button type="submit" size="lg" disabled={reason.trim().length < 3 || isPending}>
                Cancel payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
