"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { changePasswordSchema, type ChangePasswordValues } from "@/lib/validations/settings";
import { changeOwnPassword } from "@/server/actions/settings";

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current: "", next: "", confirm: "" },
  });

  function close() {
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>You&apos;ll be signed out everywhere, and can sign in again with the new one.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-3"
          onSubmit={handleSubmit(async (values) => {
            const result = await changeOwnPassword(values).catch(() => null);
            if (!result) {
              toast.error("Something went wrong. Please try again.");
            } else if (!result.ok) {
              setError("current", { message: result.error });
            } else {
              toast.success("Password changed. Please sign in again.");
              close();
              router.replace("/login");
              router.refresh();
            }
          })}
        >
          <FormField id="password-current" label="Current password" error={errors.current?.message}>
            <Input id="password-current" type="password" autoComplete="current-password" className="h-10" {...register("current")} />
          </FormField>
          <FormField id="password-next" label="New password" error={errors.next?.message}>
            <Input id="password-next" type="password" autoComplete="new-password" className="h-10" {...register("next")} />
          </FormField>
          <FormField id="password-confirm" label="Confirm new password" error={errors.confirm?.message}>
            <Input id="password-confirm" type="password" autoComplete="new-password" className="h-10" {...register("confirm")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
