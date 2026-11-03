"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap, Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { admissionSchema, type AdmissionFormValues } from "@/lib/validations/fees";
import {
  addChecklistItem,
  cancelAdmission,
  createAdmission,
  enrolFromAdmission,
  setAdmissionBatch,
  setChecklistItem,
  type AdmissionResult,
} from "@/server/actions/admissions";

export type AdmissionOptions = { id: string; name: string; batches: { id: string; label: string }[] }[];

async function report(action: Promise<AdmissionResult>, success: string) {
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

export function CreateAdmissionButton({
  studentId,
  options,
  defaultCourseId,
  today,
}: {
  studentId: string;
  options: AdmissionOptions;
  defaultCourseId: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, getValues, watch, setValue, formState: { errors, isSubmitting } } = useForm<
    AdmissionFormValues,
    unknown,
    z.output<typeof admissionSchema>
  >({
    resolver: zodResolver(admissionSchema),
    defaultValues: { courseId: defaultCourseId, batchId: "", admissionDate: today },
  });
  const courseId = watch("courseId");
  const batches = options.find((course) => course.id === courseId)?.batches ?? [];

  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Create admission
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create admission</DialogTitle>
          </DialogHeader>
          <form
            noValidate
            className="space-y-3"
            onSubmit={handleSubmit(async () => {
              if (await report(createAdmission(studentId, getValues()), "Admission created")) setOpen(false);
            })}
          >
            <FormField id="admission-course" label="Course" error={errors.courseId?.message}>
              <NativeSelect
                id="admission-course"
                className="w-full [&>select]:h-10"
                {...register("courseId", { onChange: () => setValue("batchId", "") })}
              >
                <NativeSelectOption value="">Choose a course</NativeSelectOption>
                {options.map(({ id, name }) => (
                  <NativeSelectOption key={id} value={id}>
                    {name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="admission-batch" label="Batch (can be chosen later)">
              <NativeSelect id="admission-batch" className="w-full [&>select]:h-10" {...register("batchId")}>
                <NativeSelectOption value="">Not chosen yet</NativeSelectOption>
                {batches.map(({ id, label }) => (
                  <NativeSelectOption key={id} value={id}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="admission-date" label="Admission date" error={errors.admissionDate?.message}>
              <Input id="admission-date" type="date" className="h-10" {...register("admissionDate")} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdmissionActions({
  admissionId,
  status,
  batchId,
  batches,
  isEnrolled,
  hasFeePlan,
}: {
  admissionId: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  batchId: string;
  batches: { id: string; label: string }[];
  isEnrolled: boolean;
  hasFeePlan: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      {status !== "CONFIRMED" && (
        <div className="space-y-1.5">
          <Label htmlFor={`batch-${admissionId}`}>Batch</Label>
          <NativeSelect
            id={`batch-${admissionId}`}
            value={batchId}
            disabled={isPending}
            className="w-full [&>select]:h-10"
            onChange={(event) => {
              const next = event.target.value;
              startTransition(() => report(setAdmissionBatch(admissionId, next), "Batch updated").then(() => undefined));
            }}
          >
            <NativeSelectOption value="">Not chosen yet</NativeSelectOption>
            {batches.map(({ id, label }) => (
              <NativeSelectOption key={id} value={id}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!isEnrolled && (
          <Button
            size="lg"
            disabled={isPending}
            onClick={() => startTransition(() => report(enrolFromAdmission(admissionId), "Enrolled").then(() => undefined))}
          >
            <GraduationCap aria-hidden />
            Enrol student
          </Button>
        )}
        {!isEnrolled && (
          <Button
            variant="ghost"
            size="lg"
            disabled={isPending}
            onClick={() => startTransition(() => report(cancelAdmission(admissionId), "Admission cancelled").then(() => undefined))}
          >
            Cancel admission
          </Button>
        )}
      </div>
      {!isEnrolled && (!batchId || !hasFeePlan) && (
        <p className="text-xs text-muted-foreground">
          Enrolling needs {[!batchId && "a batch", !hasFeePlan && "a fee plan from accounts"].filter(Boolean).join(" and ")}.
        </p>
      )}
    </div>
  );
}

export function ChecklistToggle({
  itemId,
  name,
  isDone,
  isRequired,
  canEdit,
}: {
  itemId: string;
  name: string;
  isDone: boolean;
  isRequired: boolean;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const id = `check-${itemId}`;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox
        id={id}
        checked={isDone}
        disabled={!canEdit || isPending}
        onCheckedChange={(checked) =>
          startTransition(() => report(setChecklistItem(itemId, checked), checked ? `${name} received` : `${name} reopened`).then(() => undefined))
        }
      />
      <Label htmlFor={id} className="font-normal">
        {name}
        {!isRequired && <span className="ml-1 text-xs text-muted-foreground">Optional</span>}
      </Label>
    </div>
  );
}

export function AddChecklistItem({ admissionId }: { admissionId: string }) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          if (await report(addChecklistItem(admissionId, name), "Document added")) setName("");
        });
      }}
    >
      <Input
        aria-label="New document name"
        placeholder="Add another document"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="h-9"
      />
      <Button type="submit" variant="outline" className="h-9" disabled={name.trim().length < 2 || isPending}>
        Add
      </Button>
    </form>
  );
}
