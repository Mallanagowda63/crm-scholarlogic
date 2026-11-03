import { Mail, MessageCircle, MessageSquare, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { TemplateButton, TemplateToggle } from "@/app/(app)/communication/template-forms";
import { Pager } from "@/app/(app)/students/pager";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { requireModuleAccess, type CurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ownedBy } from "@/server/leads";

export const metadata: Metadata = { title: "Communication" };

const PAGE_SIZE = 25;
const CONTACT_STYLE = {
  CALL: { icon: Phone, label: "Call" },
  EMAIL: { icon: Mail, label: "Email" },
  WHATSAPP: { icon: MessageCircle, label: "WhatsApp" },
} as const;

const querySchema = z.object({
  view: z.enum(["templates", "log"]).catch("templates"),
  page: z.coerce.number().int().min(1).catch(1),
});

export default async function CommunicationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireModuleAccess("communication");
  const { view, page } = querySchema.parse(await searchParams);
  const canManage = user.role === "ADMIN";

  return (
    <>
      <PageHeader
        title="Communication"
        description="Message templates, and every call, email and WhatsApp logged."
        actions={canManage && view === "templates" && <TemplateButton />}
      />
      <nav aria-label="Communication sections" className="mb-5 flex gap-1 border-b">
        {(
          [
            ["templates", "Templates"],
            ["log", "Contact log"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={`/communication?view=${id}`}
            scroll={false}
            aria-current={view === id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              view === id
                ? "border-primary text-primary-soft-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      {view === "templates" ? <Templates canManage={canManage} /> : <ContactLog user={user} page={page} />}
    </>
  );
}

async function Templates({ canManage }: { canManage: boolean }) {
  const templates = await db.messageTemplate.findMany({
    where: canManage ? {} : { isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  if (templates.length === 0) {
    return (
      <Card>
        <EmptyState icon={MessageSquare} title="No templates yet" description="Templates keep your messages quick and consistent." />
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {templates.map((template) => (
          <section
            key={template.id}
            aria-label={template.name}
            className={cn("rounded-xl border bg-card p-5 shadow-xs", !template.isActive && "opacity-60")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{template.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {template.channel === "EMAIL" ? "Email" : "WhatsApp"}
                  {!template.isActive && " · Hidden"}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center">
                  <TemplateButton
                    initial={{
                      id: template.id,
                      name: template.name,
                      channel: template.channel,
                      subject: template.subject ?? "",
                      body: template.body,
                    }}
                  />
                  <TemplateToggle id={template.id} name={template.name} isActive={template.isActive} />
                </div>
              )}
            </div>
            {template.subject && <p className="mt-3 text-sm font-medium">{template.subject}</p>}
            <p className="mt-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">{template.body}</p>
          </section>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Send these from the Message button on a lead or student&apos;s profile. It opens WhatsApp or your email app with the
        message ready to review.
      </p>
    </>
  );
}

async function ContactLog({ user, page: requestedPage }: { user: CurrentUser; page: number }) {
  const where = {
    type: { in: ["CALL", "EMAIL", "WHATSAPP"] as ("CALL" | "EMAIL" | "WHATSAPP")[] },
    student: { deletedAt: null, ...ownedBy(user) },
  };
  const total = await db.activity.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const rows = await db.activity.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      type: true,
      body: true,
      occurredAt: true,
      actor: { select: { name: true } },
      student: { select: { id: true, name: true } },
    },
  });

  if (total === 0) {
    return (
      <Card>
        <EmptyState icon={Phone} title="Nothing logged yet" description="Calls, emails and WhatsApp messages logged on profiles appear here." />
      </Card>
    );
  }

  return (
    <>
      <Card className="gap-0 divide-y p-0">
        {rows.map((row) => {
          const { icon: Icon, label } = CONTACT_STYLE[row.type as keyof typeof CONTACT_STYLE];
          return (
            <div key={row.id} className="flex gap-3 p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm">
                  <Link href={`/students/${row.student.id}`} className="rounded font-medium hover:underline">
                    {row.student.name}
                  </Link>
                  <span className="text-muted-foreground"> · {label}</span>
                </p>
                <p className="text-sm break-words whitespace-pre-wrap">{row.body}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(row.occurredAt)}
                  {row.actor && ` · ${row.actor.name}`}
                </p>
              </div>
            </div>
          );
        })}
      </Card>
      <Pager
        summary={`${total.toLocaleString("en-IN")} entries`}
        page={page}
        pageCount={pageCount}
        hrefFor={(target) => `/communication?view=log${target > 1 ? `&page=${target}` : ""}`}
      />
    </>
  );
}
