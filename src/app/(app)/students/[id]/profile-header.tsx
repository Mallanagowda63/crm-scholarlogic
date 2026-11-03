"use client";

import { CalendarPlus, ChevronRight, Mail, MessageCircle, NotebookPen, PhoneCall, PhoneOutgoing } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { LeadActionsMenu } from "@/app/(app)/leads/lead-actions-menu";
import { FollowUpDialog, LogContactDialog, NoteDialog } from "@/app/(app)/students/[id]/profile-forms";
import { StageBadge } from "@/components/shared/stage-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { formatPhone, whatsappUrl } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { Profile } from "@/server/students";

type OpenDialog = "note" | "contact" | "followUp" | null;

export function ProfileHeader({
  profile,
  canEdit,
  canManage,
}: {
  profile: Profile;
  canEdit: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const isStudent = profile.stage.type === "WON";
  const linkClass = cn(buttonVariants({ variant: "outline", size: "lg" }));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={isStudent ? "/students" : "/leads"} className="rounded hover:text-foreground hover:underline">
          {isStudent ? "Students" : "Leads"}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="truncate text-foreground" aria-current="page">
          {profile.name}
        </span>
      </nav>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar size="lg" className="size-14">
            {profile.photoUrl && <AvatarImage src={profile.photoUrl} alt="" />}
            <AvatarFallback className="bg-primary-soft text-lg font-medium text-primary-soft-foreground">
              {initials(profile.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{profile.name}</h1>
              <StageBadge name={profile.stage.name} color={profile.stage.color} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[profile.courseInterest?.name, profile.assignedTo ? `Counsellor: ${profile.assignedTo.name}` : "Unassigned"]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {profile.lostReason && <p className="mt-1 text-sm text-muted-foreground">Lost: {profile.lostReason}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a href={`tel:${profile.phone}`} className={linkClass} aria-label={`Call ${formatPhone(profile.phone)}`}>
            <PhoneCall aria-hidden />
            Call
          </a>
          <a href={whatsappUrl(profile.phone)} target="_blank" rel="noreferrer" className={linkClass}>
            <MessageCircle aria-hidden />
            WhatsApp
          </a>
          {profile.email && (
            <a href={`mailto:${profile.email}`} className={linkClass}>
              <Mail aria-hidden />
              Email
            </a>
          )}
          {canEdit && (
            <>
              <Button variant="outline" size="lg" onClick={() => setDialog("note")}>
                <NotebookPen aria-hidden />
                Add note
              </Button>
              <Button variant="outline" size="lg" onClick={() => setDialog("contact")}>
                <PhoneOutgoing aria-hidden />
                Log contact
              </Button>
              <Button size="lg" onClick={() => setDialog("followUp")}>
                <CalendarPlus aria-hidden />
                Schedule follow-up
              </Button>
              <LeadActionsMenu
                lead={{ id: profile.id, name: profile.name, phone: profile.phone, stage: profile.stage }}
                onProfile
                onDeleted={() => router.push(canManage && isStudent ? "/students" : "/leads")}
              />
            </>
          )}
        </div>
      </header>

      {canEdit && (
        <>
          <NoteDialog studentId={profile.id} open={dialog === "note"} onClose={() => setDialog(null)} />
          <LogContactDialog studentId={profile.id} open={dialog === "contact"} onClose={() => setDialog(null)} />
          <FollowUpDialog studentId={profile.id} open={dialog === "followUp"} onClose={() => setDialog(null)} />
        </>
      )}
    </>
  );
}
