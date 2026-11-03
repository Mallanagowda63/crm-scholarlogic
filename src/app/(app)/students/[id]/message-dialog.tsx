"use client";

import { Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { buttonVariants, Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatPhone, whatsappUrl } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { logContact } from "@/server/actions/students";
import { prepareMessage } from "@/server/actions/templates";

export type TemplateOption = { id: string; name: string; channel: "WHATSAPP" | "EMAIL" };

/** Opens WhatsApp or the email app with the message ready. Nothing is sent without the person pressing send there. */
export function MessageButton({
  student,
  templates,
}: {
  student: { id: string; name: string; phone: string; parentName: string | null; parentPhone: string | null; email: string | null };
  templates: TemplateOption[];
}) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL" | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState<"student" | "parent">("student");
  const [isPending, startTransition] = useTransition();

  function choose(id: string) {
    setTemplateId(id);
    setChannel(null);
    setBody("");
    if (!id) return;
    startTransition(async () => {
      const result = await prepareMessage(student.id, id).catch(() => null);
      if (result?.ok) {
        setChannel(result.channel);
        setSubject(result.subject);
        setBody(result.body);
      } else {
        toast.error(result?.error ?? "Couldn't prepare that message. Please try again.");
      }
    });
  }

  const phone = recipient === "parent" && student.parentPhone ? student.parentPhone : student.phone;
  const href =
    channel === "WHATSAPP"
      ? `${whatsappUrl(phone)}?text=${encodeURIComponent(body)}`
      : channel === "EMAIL" && student.email
        ? `mailto:${student.email}?subject=${encodeURIComponent(subject ?? "")}&body=${encodeURIComponent(body)}`
        : null;

  function logSend() {
    if (!channel) return;
    const to = channel === "WHATSAPP" && recipient === "parent" ? ` (to ${student.parentName ?? "parent"})` : "";
    const summary = `${subject ? `${subject}: ` : ""}${body}${to}`.slice(0, 5000);
    void logContact(student.id, { type: channel, body: summary })
      .then((result) => {
        if (result.ok) toast.success("Logged on the timeline");
        else toast.error(result.error);
      })
      .catch(() => toast.error("Couldn't log this message."));
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <Send aria-hidden />
        Message
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Message {student.name}</DialogTitle>
            <DialogDescription>Opens WhatsApp or your email app with the message ready to review and send.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <FormField id="message-template" label="Template">
              <NativeSelect
                id="message-template"
                value={templateId}
                onChange={(event) => choose(event.target.value)}
                className="w-full [&>select]:h-10"
              >
                <NativeSelectOption value="">Choose a template</NativeSelectOption>
                {templates.map(({ id, name, channel: templateChannel }) => (
                  <NativeSelectOption key={id} value={id}>
                    {name} ({templateChannel === "EMAIL" ? "Email" : "WhatsApp"})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Preparing message" />}
            {channel === "WHATSAPP" && student.parentPhone && (
              <FormField id="message-recipient" label="Send to">
                <NativeSelect
                  id="message-recipient"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value as "student" | "parent")}
                  className="w-full [&>select]:h-10"
                >
                  <NativeSelectOption value="student">
                    {student.name}, {formatPhone(student.phone)}
                  </NativeSelectOption>
                  <NativeSelectOption value="parent">
                    {student.parentName ?? "Parent"}, {formatPhone(student.parentPhone)}
                  </NativeSelectOption>
                </NativeSelect>
              </FormField>
            )}
            {channel && (
              <FormField id="message-body" label="Message">
                <Textarea id="message-body" rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
              </FormField>
            )}
            {channel === "EMAIL" && !student.email && (
              <p className="text-sm text-destructive">This person has no email address. Add one first.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {href && body.trim() && (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={logSend}
                className={cn(buttonVariants({ size: "lg" }))}
              >
                {channel === "EMAIL" ? "Open email" : "Open WhatsApp"}
              </a>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
