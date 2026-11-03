"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EyeOff, Eye, Loader2, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { TEMPLATE_VARIABLES, templateSchema, type TemplateValues } from "@/lib/validations/settings";
import { saveTemplate, setTemplateActive } from "@/server/actions/templates";

export function TemplateButton({ initial }: { initial?: TemplateValues & { id: string } }) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, getValues, reset, watch, formState: { errors, isSubmitting } } = useForm<
    TemplateValues,
    unknown,
    z.output<typeof templateSchema>
  >({
    resolver: zodResolver(templateSchema),
    defaultValues: initial ?? { name: "", channel: "WHATSAPP", subject: "", body: "" },
  });
  const channel = watch("channel");

  async function save() {
    const result = await saveTemplate(initial?.id, getValues()).catch(() => null);
    if (result?.ok) {
      toast.success(initial ? "Template updated" : "Template added");
      if (!initial) reset();
      setOpen(false);
    } else {
      toast.error(result?.error ?? "Something went wrong. Please try again.");
    }
  }

  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon" aria-label={`Edit ${initial.name}`} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button size="lg" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          New template
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{initial ? "Edit template" : "New template"}</DialogTitle>
            <DialogDescription>
              You can use {TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(", ")}. They&apos;re filled in for each person.
            </DialogDescription>
          </DialogHeader>
          <form noValidate onSubmit={handleSubmit(save)} className="space-y-3">
            <FormField id="template-name" label="Name" error={errors.name?.message}>
              <Input id="template-name" className="h-10" {...register("name")} />
            </FormField>
            <FormField id="template-channel" label="Channel">
              <NativeSelect id="template-channel" className="w-full [&>select]:h-10" {...register("channel")}>
                <NativeSelectOption value="WHATSAPP">WhatsApp</NativeSelectOption>
                <NativeSelectOption value="EMAIL">Email</NativeSelectOption>
              </NativeSelect>
            </FormField>
            {channel === "EMAIL" && (
              <FormField id="template-subject" label="Subject" error={errors.subject?.message}>
                <Input id="template-subject" className="h-10" {...register("subject")} />
              </FormField>
            )}
            <FormField id="template-body" label="Message" error={errors.body?.message}>
              <Textarea id="template-body" rows={5} {...register("body")} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                Save template
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TemplateToggle({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={isPending}
      aria-label={`${isActive ? "Hide" : "Show"} ${name}`}
      onClick={() =>
        startTransition(async () => {
          const result = await setTemplateActive(id, !isActive);
          if (result.ok) toast.success(`${name} ${isActive ? "hidden" : "restored"}`);
          else toast.error(result.error);
        })
      }
    >
      {isActive ? <EyeOff /> : <Eye />}
    </Button>
  );
}
