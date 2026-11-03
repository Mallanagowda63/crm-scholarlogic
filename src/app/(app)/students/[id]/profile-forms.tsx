"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/students";
import {
  academicSchema,
  contactSchema,
  followUpSchema,
  noteSchema,
  type AcademicFormValues,
} from "@/lib/validations/student";
import {
  addNote,
  completeFollowUp,
  logContact,
  removeAcademicRecord,
  removeDocument,
  restoreDocument,
  saveAcademicRecord,
  scheduleFollowUp,
  setDocumentStatus,
  uploadDocument,
  type ProfileResult,
} from "@/server/actions/students";

/** Shows the outcome of an action as a toast, and reports whether it worked. */
async function report(action: Promise<ProfileResult>, success: string) {
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

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}

function FormDialog({
  open,
  onClose,
  title,
  description,
  isSubmitting,
  submitLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  isSubmitting: boolean;
  submitLabel: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="space-y-3">
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NoteDialog({ studentId, open, onClose }: { studentId: string; open: boolean; onClose: () => void }) {
  const { register, handleSubmit, reset, formState } = useForm<z.input<typeof noteSchema>>({
    resolver: zodResolver(noteSchema),
    defaultValues: { body: "" },
  });
  const close = () => {
    reset();
    onClose();
  };

  return (
    <FormDialog
      open={open}
      onClose={close}
      title="Add a note"
      description="Notes appear on the timeline and can't be edited later."
      isSubmitting={formState.isSubmitting}
      submitLabel="Save note"
      onSubmit={handleSubmit(async (values) => {
        if (await report(addNote(studentId, values), "Note added")) close();
      })}
    >
      <div className="space-y-1.5">
        <Label htmlFor="note-body">Note</Label>
        <Textarea
          id="note-body"
          rows={4}
          aria-invalid={Boolean(formState.errors.body)}
          aria-describedby="note-body-error"
          {...register("body")}
        />
        <FieldError id="note-body-error" message={formState.errors.body?.message} />
      </div>
    </FormDialog>
  );
}

export function LogContactDialog({ studentId, open, onClose }: { studentId: string; open: boolean; onClose: () => void }) {
  const { register, handleSubmit, reset, formState } = useForm<z.input<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: { type: "CALL", body: "" },
  });
  const close = () => {
    reset();
    onClose();
  };

  return (
    <FormDialog
      open={open}
      onClose={close}
      title="Log a contact"
      description="Record a call, email or WhatsApp message that just happened."
      isSubmitting={formState.isSubmitting}
      submitLabel="Save"
      onSubmit={handleSubmit(async (values) => {
        if (await report(logContact(studentId, values), "Contact logged")) close();
      })}
    >
      <div className="space-y-1.5">
        <Label htmlFor="contact-type">Type</Label>
        <NativeSelect id="contact-type" className="w-full [&>select]:h-10" {...register("type")}>
          <NativeSelectOption value="CALL">Call</NativeSelectOption>
          <NativeSelectOption value="WHATSAPP">WhatsApp</NativeSelectOption>
          <NativeSelectOption value="EMAIL">Email</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-body">Summary</Label>
        <Textarea
          id="contact-body"
          rows={3}
          aria-invalid={Boolean(formState.errors.body)}
          aria-describedby="contact-body-error"
          {...register("body")}
        />
        <FieldError id="contact-body-error" message={formState.errors.body?.message} />
      </div>
    </FormDialog>
  );
}

export function FollowUpDialog({ studentId, open, onClose }: { studentId: string; open: boolean; onClose: () => void }) {
  const { register, handleSubmit, reset, formState } = useForm<z.input<typeof followUpSchema>>({
    resolver: zodResolver(followUpSchema),
    defaultValues: { title: "", dueAt: "", priority: "MEDIUM" },
  });
  const close = () => {
    reset();
    onClose();
  };

  return (
    <FormDialog
      open={open}
      onClose={close}
      title="Schedule a follow-up"
      isSubmitting={formState.isSubmitting}
      submitLabel="Schedule"
      onSubmit={handleSubmit(async (values) => {
        // Converted here, because only the browser knows which time zone the person typed in.
        const input = { ...values, dueAt: new Date(values.dueAt).toISOString() };
        if (await report(scheduleFollowUp(studentId, input), "Follow-up scheduled")) close();
      })}
    >
      <div className="space-y-1.5">
        <Label htmlFor="follow-up-due">When</Label>
        <Input
          id="follow-up-due"
          type="datetime-local"
          className="h-10"
          aria-invalid={Boolean(formState.errors.dueAt)}
          aria-describedby="follow-up-due-error"
          {...register("dueAt")}
        />
        <FieldError id="follow-up-due-error" message={formState.errors.dueAt?.message} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="follow-up-title">What for (optional)</Label>
        <Input id="follow-up-title" className="h-10" placeholder="Call about the fee plan" {...register("title")} />
        <FieldError id="follow-up-title-error" message={formState.errors.title?.message} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="follow-up-priority">Priority</Label>
        <NativeSelect id="follow-up-priority" className="w-full [&>select]:h-10" {...register("priority")}>
          <NativeSelectOption value="LOW">Low</NativeSelectOption>
          <NativeSelectOption value="MEDIUM">Medium</NativeSelectOption>
          <NativeSelectOption value="HIGH">High</NativeSelectOption>
        </NativeSelect>
      </div>
    </FormDialog>
  );
}

export function CompleteFollowUpButton({ taskId, title }: { taskId: string; title: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={isPending}
      aria-label={`Mark "${title}" as done`}
      onClick={() => startTransition(() => report(completeFollowUp(taskId), "Follow-up completed").then(() => undefined))}
    >
      {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
      Done
    </Button>
  );
}

export function InlineNoteForm({ studentId }: { studentId: string }) {
  const { register, handleSubmit, reset, formState } = useForm<z.input<typeof noteSchema>>({
    resolver: zodResolver(noteSchema),
    defaultValues: { body: "" },
  });
  return (
    <form
      noValidate
      className="mb-4 rounded-xl border bg-card p-4"
      onSubmit={handleSubmit(async (values) => {
        if (await report(addNote(studentId, values), "Note added")) reset();
      })}
    >
      <Label htmlFor="inline-note">Add a note</Label>
      <Textarea
        id="inline-note"
        rows={3}
        className="mt-1.5"
        aria-invalid={Boolean(formState.errors.body)}
        aria-describedby="inline-note-error"
        {...register("body")}
      />
      <FieldError id="inline-note-error" message={formState.errors.body?.message} />
      <div className="mt-2 flex justify-end">
        <Button type="submit" size="lg" disabled={formState.isSubmitting}>
          {formState.isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          Save note
        </Button>
      </div>
    </form>
  );
}

type AcademicRecord = {
  id: string;
  qualification: string;
  institution: string;
  year: number;
  score: string | null;
};

export function AcademicRecordButton({ studentId, record }: { studentId: string; record?: AcademicRecord }) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, getValues, reset, formState } = useForm<AcademicFormValues, unknown, z.output<typeof academicSchema>>({
    resolver: zodResolver(academicSchema),
    defaultValues: {
      qualification: record?.qualification ?? "",
      institution: record?.institution ?? "",
      year: record ? String(record.year) : "",
      score: record?.score ?? "",
    },
  });

  return (
    <>
      {record ? (
        <Button variant="ghost" size="icon" aria-label={`Edit ${record.qualification}`} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button size="lg" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          Add record
        </Button>
      )}
      <FormDialog
        open={open}
        onClose={() => {
          reset();
          setOpen(false);
        }}
        title={record ? "Edit academic record" : "Add academic record"}
        isSubmitting={formState.isSubmitting}
        submitLabel="Save"
        onSubmit={handleSubmit(async () => {
          // The server checks the same raw text the form holds.
          const saved = await report(saveAcademicRecord(studentId, record?.id, getValues()), "Academic record saved");
          if (saved) {
            if (!record) reset();
            setOpen(false);
          }
        })}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="academic-qualification">Qualification</Label>
            <Input id="academic-qualification" className="h-10" placeholder="Class 10" {...register("qualification")} />
            <FieldError id="academic-qualification-error" message={formState.errors.qualification?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="academic-institution">School or institution</Label>
            <Input id="academic-institution" className="h-10" {...register("institution")} />
            <FieldError id="academic-institution-error" message={formState.errors.institution?.message} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="academic-year">Year</Label>
              <Input id="academic-year" className="h-10" inputMode="numeric" {...register("year")} />
              <FieldError id="academic-year-error" message={formState.errors.year?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="academic-score">Score (optional)</Label>
              <Input id="academic-score" className="h-10" placeholder="92% or 9.4 CGPA" {...register("score")} />
              <FieldError id="academic-score-error" message={formState.errors.score?.message} />
            </div>
          </div>
        </div>
      </FormDialog>
    </>
  );
}

export function RemoveAcademicButton({ recordId, label }: { recordId: string; label: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={isPending}
      aria-label={`Remove ${label}`}
      onClick={() => startTransition(() => report(removeAcademicRecord(recordId), `${label} removed`).then(() => undefined))}
    >
      <Trash2 />
    </Button>
  );
}

export function DocumentUploadForm({ studentId }: { studentId: string }) {
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      toast.error("Choose a file smaller than 5 MB.");
      return;
    }
    const formData = new FormData();
    formData.set("studentId", studentId);
    formData.set("type", type);
    formData.set("file", file);
    startTransition(async () => {
      if (await report(uploadDocument(formData), "Document uploaded")) setType("");
      if (fileInput.current) fileInput.current.value = "";
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <div className="space-y-1.5">
        <Label htmlFor="document-type">Document type</Label>
        <NativeSelect
          id="document-type"
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="[&>select]:h-10"
        >
          <NativeSelectOption value="">Choose a type</NativeSelectOption>
          {DOCUMENT_TYPES.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {option}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <input
        ref={fileInput}
        id="document-file"
        type="file"
        aria-label="Document file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="sr-only"
        onChange={(event) => upload(event.target.files?.[0])}
      />
      <Button
        size="lg"
        disabled={!type || isPending}
        className="h-10"
        onClick={() => fileInput.current?.click()}
      >
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
        {isPending ? "Uploading..." : "Choose file"}
      </Button>
      <p className="w-full text-xs text-muted-foreground">PDF, JPG, PNG or WebP, up to 5 MB.</p>
    </div>
  );
}

export function DocumentStatusSelect({ documentId, status, label }: { documentId: string; status: string; label: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <NativeSelect
      aria-label={`Status of ${label}`}
      value={status}
      disabled={isPending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(() => report(setDocumentStatus(documentId, next), "Document status updated").then(() => undefined));
      }}
    >
      <NativeSelectOption value="PENDING">Pending</NativeSelectOption>
      <NativeSelectOption value="VERIFIED">Verified</NativeSelectOption>
      <NativeSelectOption value="REJECTED">Rejected</NativeSelectOption>
    </NativeSelect>
  );
}

export function RemoveDocumentButton({ documentId, label }: { documentId: string; label: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={isPending}
      aria-label={`Remove ${label}`}
      onClick={() =>
        startTransition(async () => {
          const result = await removeDocument(documentId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`${label} removed`, {
            action: {
              label: "Undo",
              onClick: () => void report(restoreDocument(documentId), `${label} restored`),
            },
          });
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
