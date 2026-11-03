"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArchiveRestore, Loader2, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { batchSchema, courseSchema, type BatchFormValues, type CourseFormValues } from "@/lib/validations/fees";
import { saveBatch, saveCourse, setBatchActive, setCourseActive } from "@/server/actions/courses";

export type CourseInitial = CourseFormValues & { id: string };
export type BatchInitial = BatchFormValues & { id: string };

const EMPTY_COURSE: CourseFormValues = { code: "", name: "", description: "", fee: "", durationMonths: "", gstPercent: "18" };
const EMPTY_BATCH: BatchFormValues = {
  name: "",
  timing: "",
  mode: "OFFLINE",
  branchId: "",
  startDate: "",
  endDate: "",
  capacity: "30",
};

export function CourseButton({ initial }: { initial?: CourseInitial }) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, getValues, reset, formState: { errors, isSubmitting } } = useForm<
    CourseFormValues,
    unknown,
    z.output<typeof courseSchema>
  >({ resolver: zodResolver(courseSchema), defaultValues: initial ?? EMPTY_COURSE });

  async function save() {
    const result = await saveCourse(initial?.id, getValues()).catch(() => null);
    if (result?.ok) {
      toast.success(initial ? "Course updated" : "Course added");
      if (!initial) reset();
      setOpen(false);
    } else {
      toast.error(result?.error ?? "Something went wrong. Please try again.");
    }
  }

  return (
    <>
      {initial ? (
        <Button variant="outline" size="lg" aria-label={`Edit ${initial.name}`} onClick={() => setOpen(true)}>
          <Pencil aria-hidden />
          Edit
        </Button>
      ) : (
        <Button size="lg" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          New course
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{initial ? "Edit course" : "New course"}</DialogTitle>
          </DialogHeader>
          <form noValidate onSubmit={handleSubmit(save)} className="space-y-3">
            <FormField id="course-name" label="Name" error={errors.name?.message}>
              <Input id="course-name" className="h-10" {...register("name")} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="course-code" label="Code" error={errors.code?.message}>
                <Input id="course-code" className="h-10" placeholder="JEE-2Y" {...register("code")} />
              </FormField>
              <FormField id="course-duration" label="Duration (months)" error={errors.durationMonths?.message}>
                <Input id="course-duration" className="h-10" inputMode="numeric" {...register("durationMonths")} />
              </FormField>
              <FormField id="course-fee" label="Fee before GST (₹)" error={errors.fee?.message}>
                <Input id="course-fee" className="h-10" inputMode="decimal" {...register("fee")} />
              </FormField>
              <FormField id="course-gst" label="GST (%)" error={errors.gstPercent?.message}>
                <Input id="course-gst" className="h-10" inputMode="decimal" {...register("gstPercent")} />
              </FormField>
            </div>
            <FormField id="course-description" label="Description (optional)" error={errors.description?.message}>
              <Textarea id="course-description" rows={2} {...register("description")} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                Save course
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BatchButton({
  courseId,
  courseName,
  branches,
  initial,
}: {
  courseId: string;
  courseName: string;
  branches: { id: string; name: string }[];
  initial?: BatchInitial;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, getValues, reset, formState: { errors, isSubmitting } } = useForm<
    BatchFormValues,
    unknown,
    z.output<typeof batchSchema>
  >({ resolver: zodResolver(batchSchema), defaultValues: initial ?? EMPTY_BATCH });

  async function save() {
    const result = await saveBatch(courseId, initial?.id, getValues()).catch(() => null);
    if (result?.ok) {
      toast.success(initial ? "Batch updated" : "Batch added");
      if (!initial) reset();
      setOpen(false);
    } else {
      toast.error(result?.error ?? "Something went wrong. Please try again.");
    }
  }

  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon" aria-label={`Edit ${initial.name} of ${courseName}`} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button variant="outline" size="lg" aria-label={`Add a batch to ${courseName}`} onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          Add batch
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{initial ? "Edit batch" : `New batch for ${courseName}`}</DialogTitle>
          </DialogHeader>
          <form noValidate onSubmit={handleSubmit(save)} className="space-y-3">
            <FormField id="batch-name" label="Name" error={errors.name?.message}>
              <Input id="batch-name" className="h-10" placeholder="Morning - Koramangala" {...register("name")} />
            </FormField>
            <FormField id="batch-timing" label="Timing (optional)" error={errors.timing?.message}>
              <Input id="batch-timing" className="h-10" placeholder="Mon–Fri 4–6 PM" {...register("timing")} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="batch-mode" label="Mode">
                <NativeSelect id="batch-mode" className="w-full [&>select]:h-10" {...register("mode")}>
                  <NativeSelectOption value="OFFLINE">Offline</NativeSelectOption>
                  <NativeSelectOption value="ONLINE">Online</NativeSelectOption>
                  <NativeSelectOption value="HYBRID">Hybrid</NativeSelectOption>
                </NativeSelect>
              </FormField>
              <FormField id="batch-branch" label="Branch">
                <NativeSelect id="batch-branch" className="w-full [&>select]:h-10" {...register("branchId")}>
                  <NativeSelectOption value="">No branch</NativeSelectOption>
                  {branches.map(({ id, name }) => (
                    <NativeSelectOption key={id} value={id}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="batch-start" label="Start date" error={errors.startDate?.message}>
                <Input id="batch-start" type="date" className="h-10" {...register("startDate")} />
              </FormField>
              <FormField id="batch-end" label="End date (optional)" error={errors.endDate?.message}>
                <Input id="batch-end" type="date" className="h-10" {...register("endDate")} />
              </FormField>
              <FormField id="batch-capacity" label="Capacity" error={errors.capacity?.message}>
                <Input id="batch-capacity" className="h-10" inputMode="numeric" {...register("capacity")} />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                Save batch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ArchiveToggle({
  kind,
  id,
  name,
  isActive,
  compact = false,
}: {
  kind: "course" | "batch";
  id: string;
  name: string;
  isActive: boolean;
  compact?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const Icon = isActive ? Archive : ArchiveRestore;
  const label = `${isActive ? "Archive" : "Restore"} ${name}`;

  return (
    <Button
      variant={compact ? "ghost" : "outline"}
      size={compact ? "icon" : "icon-lg"}
      disabled={isPending}
      aria-label={label}
      onClick={() =>
        startTransition(async () => {
          const action = kind === "course" ? setCourseActive : setBatchActive;
          const result = await action(id, !isActive);
          if (result.ok) toast.success(`${name} ${isActive ? "archived" : "restored"}`);
          else toast.error(result.error);
        })
      }
    >
      <Icon />
    </Button>
  );
}
