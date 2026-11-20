import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import {
  ListManager,
  OrganisationForm,
  StageManager,
  UserManager,
} from "@/app/(app)/settings/settings-forms";
import { PageHeader } from "@/components/shared/page-header";
import { db } from "@/lib/db";
import { requireModuleAccess } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { id: "users", label: "Users & roles" },
  { id: "pipeline", label: "Pipeline stages" },
  { id: "sources", label: "Lead sources" },
  { id: "branches", label: "Branches" },
  { id: "organisation", label: "Organisation & branding" },
] as const;

const querySchema = z.object({
  section: z.enum(["users", "pipeline", "sources", "branches", "organisation"]).catch("users"),
});

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireModuleAccess("settings");
  const { section } = querySchema.parse(await searchParams);

  return (
    <>
      <PageHeader title="Settings" description="Courses and batches are managed on the Courses page." />
      <nav aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto border-b">
        {SECTIONS.map(({ id, label }) => (
          <Link
            key={id}
            href={`/settings?section=${id}`}
            scroll={false}
            aria-current={section === id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              section === id
                ? "border-primary text-primary-soft-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {section === "users" && (
        <UserManager
          currentUserId={user.id}
          users={await db.user.findMany({
            orderBy: [{ isActive: "desc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              isActive: true,
              _count: { select: { assignedStudents: { where: { deletedAt: null } } } },
            },
          })}
        />
      )}
      {section === "pipeline" && (
        <StageManager
          stages={await db.pipelineStage.findMany({
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              color: true,
              type: true,
              key: true,
              _count: { select: { students: { where: { deletedAt: null } } } },
            },
          })}
        />
      )}
      {section === "sources" && (
        <ListManager
          kind="source"
          singular="source"
          items={await db.leadSource.findMany({
            orderBy: [{ isActive: "desc" }, { name: "asc" }],
            select: { id: true, name: true, isActive: true },
          })}
        />
      )}
      {section === "branches" && (
        <ListManager
          kind="branch"
          singular="branch"
          items={await db.branch.findMany({
            orderBy: [{ isActive: "desc" }, { name: "asc" }],
            select: { id: true, name: true, isActive: true },
          })}
        />
      )}
      {section === "organisation" && (
        <OrganisationForm
          org={await db.orgSettings.findUnique({ where: { id: "default" } })}
        />
      )}
    </>
  );
}
