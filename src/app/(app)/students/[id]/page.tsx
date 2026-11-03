import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { LeadDialogsProvider } from "@/app/(app)/leads/lead-dialogs";
import { AdmissionTab } from "@/app/(app)/students/[id]/admission-tab";
import { PaymentsTab } from "@/app/(app)/students/[id]/payments-tab";
import { ProfileHeader } from "@/app/(app)/students/[id]/profile-header";
import {
  AcademicsTab,
  ActivityTab,
  DocumentsTab,
  NotesTab,
  OverviewTab,
} from "@/app/(app)/students/[id]/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { requireModuleAccess } from "@/lib/session";
import { tabsForRole } from "@/lib/students";
import { cn } from "@/lib/utils";
import { getLeadOptions } from "@/server/leads";
import { getProfile } from "@/server/students";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const querySchema = z.object({
  tab: z.string().catch("overview"),
  page: z.coerce.number().int().min(1).catch(1),
  type: z.enum(["CALL", "EMAIL", "WHATSAPP", "NOTE", "STAGE_CHANGE", "DEMO_CLASS", "FOLLOW_UP"]).optional().catch(undefined),
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await requireModuleAccess("students");
  const profile = await getProfile(user, (await params).id);
  return { title: profile?.name ?? "Not found" };
}

export default async function StudentProfilePage({ params, searchParams }: Props) {
  const user = await requireModuleAccess("students");
  const { id } = await params;
  // "Not found" rather than "forbidden", so a guessed link can't confirm that someone exists.
  const profile = await getProfile(user, id);
  if (!profile) notFound();

  const query = querySchema.parse(await searchParams);
  const tabs = tabsForRole(user.role);
  const tab = tabs.find((option) => option.id === query.tab)?.id ?? "overview";
  const canEdit = user.role !== "ACCOUNTS";
  const canManage = user.role === "ADMIN";
  const canManageFees = user.role === "ADMIN" || user.role === "ACCOUNTS";

  const content = (
    <>
      <ProfileHeader profile={profile} canEdit={canEdit} canManage={canManage} />

      <nav aria-label="Profile sections" className="mb-5 flex gap-1 overflow-x-auto border-b">
        {tabs.map((option) => (
          <Link
            key={option.id}
            href={option.id === "overview" ? `/students/${id}` : `/students/${id}?tab=${option.id}`}
            scroll={false}
            aria-current={tab === option.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              tab === option.id
                ? "border-primary text-primary-soft-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <Suspense
        key={`${tab}-${query.page}-${query.type ?? ""}`}
        fallback={
          <div role="status" aria-label="Loading" className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        }
      >
        {tab === "overview" && <OverviewTab profile={profile} canEdit={canEdit} />}
        {tab === "activity" && <ActivityTab studentId={id} page={query.page} type={query.type} />}
        {tab === "academics" && <AcademicsTab profile={profile} canEdit={canEdit} />}
        {tab === "documents" && <DocumentsTab studentId={id} canEdit={canEdit} />}
        {tab === "admission" && <AdmissionTab profile={profile} canEdit={canEdit} />}
        {tab === "payments" && <PaymentsTab studentId={id} canManage={canManageFees} />}
        {tab === "notes" && <NotesTab studentId={id} page={query.page} canEdit={canEdit} />}
      </Suspense>
    </>
  );

  // Accounts can't edit, so the forms and the data behind them aren't loaded for them.
  if (!canEdit) return content;
  return (
    <LeadDialogsProvider options={await getLeadOptions()} canManage={canManage}>
      {content}
    </LeadDialogsProvider>
  );
}
