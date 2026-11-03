"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, EyeOff, Eye, KeyRound, Loader2, Pencil, Plus, Trash2, UserCheck, UserX } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { FormField } from "@/components/shared/form-field";
import { StageBadge } from "@/components/shared/stage-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { newUserSchema, orgSchema, type NewUserValues, type OrgValues } from "@/lib/validations/settings";
import {
  createUser,
  deleteStage,
  moveStage,
  removeLogo,
  resetUserPassword,
  saveListItem,
  saveOrganisation,
  saveStage,
  setListItemActive,
  setUserActive,
  updateUser,
  uploadLogo,
  type SettingsResult,
} from "@/server/actions/settings";

async function report(action: Promise<SettingsResult>, success: string) {
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

function RoleSelect({ id, value, onChange }: { id: string; value: Role; onChange: (role: Role) => void }) {
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value as Role)} className="w-full [&>select]:h-10">
      {Object.entries(ROLE_LABELS).map(([role, label]) => (
        <NativeSelectOption key={role} value={role}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

// ---------- Users ----------

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  _count: { assignedStudents: number };
};

export function UserManager({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  return (
    <>
      <div className="mb-3 flex justify-end">
        <NewUserButton />
      </div>
      <Card className="gap-0 divide-y p-0">
        {users.map((user) => (
          <UserItem key={user.id} user={user} isSelf={user.id === currentUserId} />
        ))}
      </Card>
    </>
  );
}

function NewUserButton() {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, getValues, reset, formState: { errors, isSubmitting } } = useForm<
    NewUserValues,
    unknown,
    z.output<typeof newUserSchema>
  >({
    resolver: zodResolver(newUserSchema),
    defaultValues: { name: "", email: "", role: "COUNSELLOR", password: "" },
  });

  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        New user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>Share the password with them privately. They can change it after signing in.</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-3"
            onSubmit={handleSubmit(async () => {
              if (await report(createUser(getValues()), "User added")) {
                reset();
                setOpen(false);
              }
            })}
          >
            <FormField id="user-name" label="Full name" error={errors.name?.message}>
              <Input id="user-name" className="h-10" {...register("name")} />
            </FormField>
            <FormField id="user-email" label="Email" error={errors.email?.message}>
              <Input id="user-email" type="email" className="h-10" autoComplete="off" {...register("email")} />
            </FormField>
            <FormField id="user-role" label="Role">
              <NativeSelect id="user-role" className="w-full [&>select]:h-10" {...register("role")}>
                {Object.entries(ROLE_LABELS).map(([role, label]) => (
                  <NativeSelectOption key={role} value={role}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="user-password" label="Password (at least 12 characters)" error={errors.password?.message}>
              <Input id="user-password" type="password" className="h-10" autoComplete="new-password" {...register("password")} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                Add user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserItem({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const [dialog, setDialog] = useState<"edit" | "password" | null>(null);
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div data-user={user.email} className={cn("flex flex-wrap items-center gap-3 p-4", !user.isActive && "opacity-60")}>
      <UserAvatar name={user.name} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {user.name}
          {isSelf && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
          {!user.isActive && <Badge variant="outline">Deactivated</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {user.email}
          {user.role === "COUNSELLOR" && ` · ${user._count.assignedStudents} people assigned`}
        </p>
      </div>
      <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
      <div className="flex items-center">
        <Button variant="ghost" size="icon" aria-label={`Edit ${user.name}`} onClick={() => setDialog("edit")}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Reset password for ${user.name}`} onClick={() => setDialog("password")}>
          <KeyRound />
        </Button>
        {!isSelf && (
          <Button
            variant="ghost"
            size="icon"
            disabled={isPending}
            aria-label={`${user.isActive ? "Deactivate" : "Reactivate"} ${user.name}`}
            onClick={() =>
              startTransition(() =>
                report(setUserActive(user.id, !user.isActive), `${user.name} ${user.isActive ? "deactivated" : "reactivated"}`).then(() => undefined),
              )
            }
          >
            {user.isActive ? <UserX /> : <UserCheck />}
          </Button>
        )}
      </div>

      <Dialog open={dialog === "edit"} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {user.name}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                if (await report(updateUser(user.id, { name, role }), "User updated")) setDialog(null);
              });
            }}
          >
            <FormField id={`edit-name-${user.id}`} label="Full name">
              <Input id={`edit-name-${user.id}`} className="h-10" value={name} onChange={(event) => setName(event.target.value)} />
            </FormField>
            <FormField id={`edit-role-${user.id}`} label="Role">
              <RoleSelect id={`edit-role-${user.id}`} value={role} onChange={setRole} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "password"} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {user.name}</DialogTitle>
            <DialogDescription>This signs them out everywhere. Share the new password with them privately.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                if (await report(resetUserPassword(user.id, password), "Password reset")) {
                  setPassword("");
                  setDialog(null);
                }
              });
            }}
          >
            <FormField id={`reset-${user.id}`} label="New password (at least 12 characters)">
              <Input
                id={`reset-${user.id}`}
                type="password"
                autoComplete="new-password"
                className="h-10"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isPending}>
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Pipeline ----------

type StageRow = {
  id: string;
  name: string;
  color: string;
  type: "OPEN" | "WON" | "LOST";
  key: string | null;
  _count: { students: number };
};

export function StageManager({ stages }: { stages: StageRow[] }) {
  const openStages = stages.filter((stage) => stage.type === "OPEN");
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Enrolled and Lost always stay at the end of the pipeline.</p>
        <StageDialogButton />
      </div>
      <Card className="gap-0 divide-y p-0">
        {stages.map((stage) => {
          const openIndex = openStages.findIndex((item) => item.id === stage.id);
          return (
            <StageItem
              key={stage.id}
              stage={stage}
              canMoveUp={openIndex > 0}
              canMoveDown={openIndex >= 0 && openIndex < openStages.length - 1}
            />
          );
        })}
      </Card>
    </>
  );
}

function StageDialogButton({ stage }: { stage?: StageRow }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(stage?.name ?? "");
  const [color, setColor] = useState(stage?.color ?? "#6366F1");
  const [isPending, startTransition] = useTransition();

  return (
    <>
      {stage ? (
        <Button variant="ghost" size="icon" aria-label={`Edit ${stage.name}`} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button size="lg" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          New stage
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{stage ? `Edit ${stage.name}` : "New stage"}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                if (await report(saveStage(stage?.id, { name, color }), stage ? "Stage updated" : "Stage added")) {
                  if (!stage) setName("");
                  setOpen(false);
                }
              });
            }}
          >
            <FormField id={`stage-name-${stage?.id ?? "new"}`} label="Name">
              <Input id={`stage-name-${stage?.id ?? "new"}`} className="h-10" value={name} onChange={(event) => setName(event.target.value)} />
            </FormField>
            <FormField id={`stage-color-${stage?.id ?? "new"}`} label="Colour">
              <Input
                id={`stage-color-${stage?.id ?? "new"}`}
                type="color"
                className="h-10 w-20 p-1"
                value={color.toLowerCase()}
                onChange={(event) => setColor(event.target.value)}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isPending}>
                Save stage
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StageItem({ stage, canMoveUp, canMoveDown }: { stage: StageRow; canMoveUp: boolean; canMoveDown: boolean }) {
  const [isPending, startTransition] = useTransition();
  const canDelete = !stage.key && stage.type === "OPEN";
  const move = (direction: -1 | 1) =>
    startTransition(() => report(moveStage(stage.id, direction), `${stage.name} moved`).then(() => undefined));

  return (
    <div data-stage-row={stage.name} className="flex flex-wrap items-center gap-3 p-4">
      <StageBadge name={stage.name} color={stage.color} />
      <span className="flex-1 text-xs text-muted-foreground">
        {stage._count.students} {stage._count.students === 1 ? "person" : "people"}
        {stage.key && " · Built in"}
      </span>
      <div className="flex items-center">
        <Button variant="ghost" size="icon" disabled={!canMoveUp || isPending} aria-label={`Move ${stage.name} up`} onClick={() => move(-1)}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon" disabled={!canMoveDown || isPending} aria-label={`Move ${stage.name} down`} onClick={() => move(1)}>
          <ArrowDown />
        </Button>
        <StageDialogButton stage={stage} />
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            disabled={isPending}
            aria-label={`Delete ${stage.name}`}
            onClick={() => startTransition(() => report(deleteStage(stage.id), `${stage.name} deleted`).then(() => undefined))}
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------- Simple lists ----------

export function ListManager({
  kind,
  singular,
  items,
}: {
  kind: "source" | "exam" | "branch";
  singular: string;
  items: { id: string; name: string; isActive: boolean }[];
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            if (await report(saveListItem(kind, null, { name }), `${name.trim()} added`)) setName("");
          });
        }}
      >
        <FormField id={`new-${kind}`} label={`Add a ${singular}`} className="min-w-52 flex-1 space-y-1.5 sm:max-w-xs">
          <Input id={`new-${kind}`} className="h-10" value={name} onChange={(event) => setName(event.target.value)} />
        </FormField>
        <Button type="submit" size="lg" className="h-10" disabled={name.trim().length < 2 || isPending}>
          Add
        </Button>
      </form>
      <Card className="gap-0 divide-y p-0">
        {items.map((item) => (
          <ListItem key={item.id} kind={kind} item={item} />
        ))}
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">Hiding removes it from new forms. Past records keep it.</p>
    </>
  );
}

function ListItem({
  kind,
  item,
}: {
  kind: "source" | "exam" | "branch";
  item: { id: string; name: string; isActive: boolean };
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [isPending, startTransition] = useTransition();

  if (isEditing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            if (await report(saveListItem(kind, item.id, { name }), "Saved")) setIsEditing(false);
          });
        }}
      >
        <Input aria-label={`New name for ${item.name}`} className="h-9 min-w-40 flex-1" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" className="h-9" disabled={isPending}>
          Save
        </Button>
        <Button type="button" variant="ghost" className="h-9" onClick={() => setIsEditing(false)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div data-list-item={item.name} className={cn("flex items-center gap-2 p-3 text-sm", !item.isActive && "opacity-60")}>
      <span className="min-w-0 flex-1 truncate">
        {item.name}
        {!item.isActive && <span className="ml-2 text-xs text-muted-foreground">Hidden</span>}
      </span>
      <Button variant="ghost" size="icon" aria-label={`Rename ${item.name}`} onClick={() => setIsEditing(true)}>
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={isPending}
        aria-label={`${item.isActive ? "Hide" : "Show"} ${item.name}`}
        onClick={() =>
          startTransition(() =>
            report(setListItemActive(kind, item.id, !item.isActive), `${item.name} ${item.isActive ? "hidden" : "restored"}`).then(() => undefined),
          )
        }
      >
        {item.isActive ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

// ---------- Organisation ----------

type Org = {
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  receiptPrefix: string;
} | null;

export function OrganisationForm({ org }: { org: Org }) {
  const { register, handleSubmit, getValues, setValue, watch, formState: { errors, isSubmitting } } = useForm<
    OrgValues,
    unknown,
    z.output<typeof orgSchema>
  >({
    resolver: zodResolver(orgSchema),
    defaultValues: {
      name: org?.name ?? "",
      legalName: org?.legalName ?? "",
      address: org?.address ?? "",
      phone: org?.phone ?? "",
      email: org?.email ?? "",
      gstin: org?.gstin ?? "",
      receiptPrefix: org?.receiptPrefix ?? "RCPT",
      primaryColor: org?.primaryColor ?? "#4F46E5",
      accentColor: org?.accentColor ?? "#8B5CF6",
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <form
        noValidate
        className="space-y-3 rounded-xl border bg-card p-5 shadow-xs"
        onSubmit={handleSubmit(() => report(saveOrganisation(getValues()), "Organisation saved").then(() => undefined))}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="org-name" label="Display name" error={errors.name?.message}>
            <Input id="org-name" className="h-10" {...register("name")} />
          </FormField>
          <FormField id="org-legal" label="Legal name (shown on receipts)" error={errors.legalName?.message}>
            <Input id="org-legal" className="h-10" {...register("legalName")} />
          </FormField>
          <FormField id="org-gstin" label="GSTIN" error={errors.gstin?.message}>
            <Input id="org-gstin" className="h-10" {...register("gstin")} />
          </FormField>
          <FormField id="org-prefix" label="Receipt prefix" error={errors.receiptPrefix?.message}>
            <Input id="org-prefix" className="h-10" {...register("receiptPrefix")} />
          </FormField>
          <FormField id="org-phone" label="Phone" error={errors.phone?.message}>
            <Input id="org-phone" className="h-10" {...register("phone")} />
          </FormField>
          <FormField id="org-email" label="Email" error={errors.email?.message}>
            <Input id="org-email" type="email" className="h-10" {...register("email")} />
          </FormField>
        </div>
        <FormField id="org-address" label="Address" error={errors.address?.message}>
          <Textarea id="org-address" rows={2} {...register("address")} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="org-primary" label="Primary colour" error={errors.primaryColor?.message}>
            {/* Bound directly, as colour inputs otherwise fall back to black and save that. */}
            <Input
              id="org-primary"
              type="color"
              className="h-10 w-20 p-1"
              value={watch("primaryColor").toLowerCase()}
              onChange={(event) => setValue("primaryColor", event.target.value, { shouldValidate: true })}
            />
          </FormField>
          <FormField id="org-accent" label="Accent colour" error={errors.accentColor?.message}>
            <Input
              id="org-accent"
              type="color"
              className="h-10 w-20 p-1"
              value={watch("accentColor").toLowerCase()}
              onChange={(event) => setValue("accentColor", event.target.value, { shouldValidate: true })}
            />
          </FormField>
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            Save changes
          </Button>
        </div>
      </form>
      <LogoCard hasLogo={Boolean(org?.logoUrl)} />
    </div>
  );
}

function LogoCard({ hasLogo }: { hasLogo: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <section className="h-fit rounded-xl border bg-card p-5 shadow-xs">
      <h2 className="text-sm font-semibold">Logo</h2>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">PNG, JPG or WebP, up to 1 MB. Square images look best.</p>
      {hasLogo && (
        // eslint-disable-next-line @next/next/no-img-element -- an uploaded file served by our own route
        <img src="/branding/logo" alt="Current logo" className="mb-3 size-16 rounded-lg border object-contain" />
      )}
      <input
        ref={input}
        type="file"
        aria-label="Logo image"
        accept=".png,.jpg,.jpeg,.webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const formData = new FormData();
          formData.set("file", file);
          startTransition(async () => {
            await report(uploadLogo(formData), "Logo updated");
            if (input.current) input.current.value = "";
          });
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="lg" disabled={isPending} onClick={() => input.current?.click()}>
          {isPending && <Loader2 className="animate-spin" aria-hidden />}
          {hasLogo ? "Replace logo" : "Upload logo"}
        </Button>
        {hasLogo && (
          <Button
            variant="ghost"
            size="lg"
            disabled={isPending}
            onClick={() => startTransition(() => report(removeLogo(), "Logo removed").then(() => undefined))}
          >
            Remove
          </Button>
        )}
      </div>
    </section>
  );
}
