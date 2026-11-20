"use client";

import { Loader2, PhoneIncoming, UserRoundCheck, UserRoundX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { normalizePhone } from "@/lib/phone";
import { EMPTY_CALL_ENQUIRY, type CallEnquiryFormValues } from "@/lib/validations/lead";
import { checkCaller, saveCallEnquiry, type CallerMatch } from "@/server/actions/call-enquiry";
import type { LeadOptions } from "@/server/leads";

type FieldErrors = Partial<Record<keyof CallEnquiryFormValues, string>>;

/** A short form a counsellor can fill in while still on the call. */
export function CallEnquiryDialog({
  open,
  options,
  onClose,
}: {
  open: boolean;
  options: LeadOptions;
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<CallEnquiryFormValues>(EMPTY_CALL_ENQUIRY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  // The number the match below belongs to, so an old answer never shows for a newer number.
  const [lookup, setLookup] = useState<{ phone: string; match: CallerMatch | null } | null>(null);

  const normalized = normalizePhone(values.phone);
  const match = lookup && lookup.phone === normalized ? lookup.match : null;
  const isChecking = normalized !== null && lookup?.phone !== normalized;

  useEffect(() => {
    if (!normalized) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      checkCaller(normalized)
        .then((result) => isCurrent && setLookup({ phone: normalized, match: result }))
        .catch(() => isCurrent && setLookup({ phone: normalized, match: null }));
    }, 250);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [normalized]);

  function update(field: keyof CallEnquiryFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (match && !match.canOpen) return;
    setIsSaving(true);
    try {
      const result = await saveCallEnquiry(values);
      if (result.ok) {
        if (result.isExisting) {
          toast.success(`Call logged on ${result.name}'s profile`);
          router.push(`/students/${result.id}`);
        } else {
          toast.success(`${result.name} added from a call`);
          router.refresh();
        }
        onClose();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      toast.error(result.error);
    } catch {
      toast.error("Couldn't save this call. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const isKnown = match !== null;
  const isBlocked = match !== null && !match.canOpen;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Call enquiry</DialogTitle>
          <DialogDescription>Start with the number. If they&apos;re already here, the call goes on their profile.</DialogDescription>
        </DialogHeader>

        <form id="call-enquiry" noValidate onSubmit={save} className="space-y-4">
          <Field id="call-phone" label="Phone" required error={errors.phone}>
            <Input
              id="call-phone"
              type="tel"
              autoFocus
              autoComplete="off"
              value={values.phone}
              onChange={(event) => update("phone", event.target.value)}
              className="h-10"
              aria-required
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "call-phone-error" : undefined}
            />
          </Field>

          <div aria-live="polite">
            {isChecking && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Checking the number
              </p>
            )}
            {match && (
              <div role="status" className="rounded-lg border bg-muted/50 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  {match.canOpen ? (
                    <UserRoundCheck className="size-4 text-primary" aria-hidden />
                  ) : (
                    <UserRoundX className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
                  )}
                  Already in the CRM: {match.name}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {match.stage}
                  {match.counsellor ? ` · ${match.counsellor}` : " · Unassigned"}
                </p>
                {match.canOpen ? (
                  <p className="mt-2">
                    Saving logs this call on their profile.{" "}
                    <Link href={`/students/${match.id}`} onClick={onClose} className="font-medium text-primary underline-offset-4 hover:underline">
                      Open profile
                    </Link>
                  </p>
                ) : (
                  <p className="mt-2">This lead belongs to another counsellor. Ask an admin to log this call.</p>
                )}
              </div>
            )}
          </div>

          {!isKnown && (
            <>
              <Field id="call-name" label="Caller's name" required error={errors.name}>
                <Input
                  id="call-name"
                  autoComplete="off"
                  value={values.name}
                  onChange={(event) => update("name", event.target.value)}
                  className="h-10"
                  aria-required
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "call-name-error" : undefined}
                />
              </Field>
              <Field id="call-course" label="Course of interest" error={errors.courseInterestId}>
                <NativeSelect
                  id="call-course"
                  value={values.courseInterestId}
                  onChange={(event) => update("courseInterestId", event.target.value)}
                  className="w-full [&>select]:h-10"
                >
                  <NativeSelectOption value="">Not sure yet</NativeSelectOption>
                  {options.courses.map(({ id, name }) => (
                    <NativeSelectOption key={id} value={id}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </>
          )}

          {!isBlocked && (
            <Field id="call-summary" label="What did they ask?" error={errors.summary}>
              <Textarea
                id="call-summary"
                rows={3}
                maxLength={2000}
                value={values.summary}
                onChange={(event) => update("summary", event.target.value)}
                placeholder="Fees, timings, placement support…"
              />
            </Field>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="call-enquiry" size="lg" disabled={isSaving || isChecking || isBlocked}>
            {isSaving ? <Loader2 className="animate-spin" aria-hidden /> : <PhoneIncoming aria-hidden />}
            {isKnown ? "Log call" : "Add lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
