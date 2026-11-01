"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BOARD_LABELS, CLASS_OPTIONS } from "@/lib/leads";
import { EMPTY_LEAD, leadSchema, type LeadFormValues, type LeadValues } from "@/lib/validations/lead";
import { createLead, getLeadForEdit, updateLead } from "@/server/actions/leads";
import type { DuplicateMatch, LeadOptions } from "@/server/leads";

export function LeadSheet({
  open,
  leadId,
  options,
  canManage,
  onClose,
}: {
  open: boolean;
  leadId: string | null;
  options: LeadOptions;
  canManage: boolean;
  onClose: () => void;
}) {
  const isEditing = leadId !== null;
  const [isLoading, setIsLoading] = useState(isEditing && open);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues, unknown, LeadValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: EMPTY_LEAD,
  });

  useEffect(() => {
    if (!open || !leadId) return;
    let isCurrent = true;
    getLeadForEdit(leadId)
      .then((result) => {
        if (!isCurrent) return;
        if (result.ok) {
          reset(result.values);
          setIsLoading(false);
        } else {
          toast.error(result.error);
          onClose();
        }
      })
      .catch(() => {
        if (!isCurrent) return;
        toast.error("Couldn't load this lead. Please try again.");
        onClose();
      });
    return () => {
      isCurrent = false;
    };
  }, [open, leadId, reset, onClose]);

  async function save(allowDuplicates: boolean) {
    try {
      // The server validates the same raw text the form holds, so it can't be bypassed.
      const raw = getValues();
      const result = leadId ? await updateLead(leadId, raw, allowDuplicates) : await createLead(raw, allowDuplicates);

      if (result.ok) {
        toast.success(leadId ? "Lead updated" : "Lead added");
        onClose();
        return;
      }
      if (result.duplicates) {
        setDuplicates(result.duplicates);
        return;
      }
      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        setError(field as keyof LeadFormValues, { message });
      }
      toast.error(result.error);
    } catch {
      toast.error("Couldn't save this lead. Please try again.");
    }
  }

  const field = (name: keyof LeadFormValues) => ({ error: errors[name]?.message, register: register(name) });

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>{isEditing ? "Edit lead" : "New lead"}</SheetTitle>
          <SheetDescription>
            {isEditing ? "Update this person's details." : "Phone numbers can be typed in any common format."}
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div role="status" aria-label="Loading lead" className="flex-1 space-y-4 p-4">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <form
            id="lead-form"
            noValidate
            onSubmit={handleSubmit(() => {
              setDuplicates([]);
              return save(false);
            })}
            className="flex-1 space-y-6 overflow-y-auto p-4"
          >
            <FormSection title="Student">
              <TextField label="Full name" required {...field("name")} autoComplete="off" full />
              <TextField label="Phone" required {...field("phone")} type="tel" />
              <TextField label="Alternate phone" {...field("alternatePhone")} type="tel" />
              <TextField label="Email" {...field("email")} type="email" />
              <TextField label="City" {...field("city")} />
            </FormSection>

            <FormSection title="Parent">
              <TextField label="Parent's name" {...field("parentName")} />
              <TextField label="Parent's phone" {...field("parentPhone")} type="tel" />
            </FormSection>

            <FormSection title="Academics">
              <SelectField label="Current class" {...field("currentClass")}>
                {CLASS_OPTIONS.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {option}
                  </NativeSelectOption>
                ))}
              </SelectField>
              <SelectField label="Board" {...field("board")}>
                {Object.entries(BOARD_LABELS).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </SelectField>
              <TextField label="School" {...field("schoolName")} />
              <SelectField label="Target exam" {...field("targetExamId")}>
                {options.targetExams.map(({ id, name }) => (
                  <NativeSelectOption key={id} value={id}>
                    {name}
                  </NativeSelectOption>
                ))}
              </SelectField>
            </FormSection>

            <FormSection title="Enquiry">
              <SelectField label="Course of interest" {...field("courseInterestId")}>
                {options.courses.map(({ id, name }) => (
                  <NativeSelectOption key={id} value={id}>
                    {name}
                  </NativeSelectOption>
                ))}
              </SelectField>
              <SelectField label="Source" {...field("sourceId")}>
                {options.sources.map(({ id, name }) => (
                  <NativeSelectOption key={id} value={id}>
                    {name}
                  </NativeSelectOption>
                ))}
              </SelectField>
              <TextField label="Budget (₹)" {...field("budget")} inputMode="numeric" />
              <TextField label="Preferred intake" {...field("preferredIntake")} placeholder="June 2027" />
              {canManage && (
                <SelectField
                  label="Counsellor"
                  emptyLabel={isEditing ? "Unassigned" : "Assign automatically"}
                  {...field("assignedToId")}
                >
                  {options.assignees.map(({ id, name }) => (
                    <NativeSelectOption key={id} value={id}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </SelectField>
              )}
              {!isEditing && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" rows={3} {...register("notes")} />
                </div>
              )}
            </FormSection>
          </form>
        )}

        {duplicates.length > 0 && (
          <div role="alert" className="border-t bg-muted/50 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
              This might already be in the system
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {duplicates.map((match) => (
                <li key={match.id}>
                  <span className="font-medium text-foreground">{match.name}</span> has the same {match.matchedOn} (
                  {match.stage}
                  {match.counsellor ? `, ${match.counsellor}` : ""})
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">Siblings often share a parent&apos;s number, so this may be fine.</p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                disabled={isSubmitting}
                onClick={handleSubmit(() => save(true))}
              >
                Save anyway
              </Button>
              <Button variant="ghost" onClick={() => setDuplicates([])}>
                Keep editing
              </Button>
            </div>
          </div>
        )}

        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-form" size="lg" disabled={isSubmitting || isLoading}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            {isEditing ? "Save changes" : "Add lead"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

type FieldProps = { label: string; error?: string; register: UseFormRegisterReturn; required?: boolean; full?: boolean };

function TextField({
  label,
  error,
  register,
  required,
  full,
  ...input
}: FieldProps & Omit<React.ComponentProps<"input">, "required">) {
  const id = register.name;
  return (
    <div className={full ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        id={id}
        className="h-10"
        aria-required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...input}
        {...register}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function SelectField({
  label,
  error,
  register,
  emptyLabel = "Not specified",
  children,
}: FieldProps & { emptyLabel?: string; children: React.ReactNode }) {
  const id = register.name;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} className="w-full [&>select]:h-10" aria-invalid={Boolean(error)} {...register}>
        <NativeSelectOption value="">{emptyLabel}</NativeSelectOption>
        {children}
      </NativeSelect>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
