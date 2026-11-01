"use client";

import { Download, KanbanSquare, Loader2, Plus, Search, Table2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ImportDialog } from "@/app/(app)/leads/import-dialog";
import { LeadSheet } from "@/app/(app)/leads/lead-sheet";
import { LostReasonDialog } from "@/app/(app)/leads/lost-reason-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { hasActiveFilters, leadsQuery, type LeadFilters } from "@/lib/leads";
import { cn } from "@/lib/utils";
import type { LeadOptions } from "@/server/leads";

type LeadWorkspace = {
  options: LeadOptions;
  canManage: boolean;
  openCreate: () => void;
  openEdit: (id: string) => void;
  /** Resolves to the chosen reason, or null if the person cancelled. */
  askLostReason: (subject: string) => Promise<string | null>;
};

const LeadWorkspaceContext = createContext<LeadWorkspace | null>(null);

export function useLeadWorkspace() {
  const workspace = useContext(LeadWorkspaceContext);
  if (!workspace) throw new Error("useLeadWorkspace must be used inside LeadsWorkspace");
  return workspace;
}

export function LeadsWorkspace({
  filters,
  options,
  canManage,
  children,
}: {
  filters: LeadFilters;
  options: LeadOptions;
  canManage: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sheet, setSheet] = useState<{ open: boolean; leadId: string | null }>({ open: false, leadId: null });
  const [importOpen, setImportOpen] = useState(false);
  const [lostRequest, setLostRequest] = useState<{ subject: string; resolve: (reason: string | null) => void } | null>(
    null,
  );

  const openCreate = useCallback(() => setSheet({ open: true, leadId: null }), []);
  const openEdit = useCallback((leadId: string) => setSheet({ open: true, leadId }), []);
  const askLostReason = useCallback(
    (subject: string) => new Promise<string | null>((resolve) => setLostRequest({ subject, resolve })),
    [],
  );
  const workspace = useMemo(
    () => ({ options, canManage, openCreate, openEdit, askLostReason }),
    [options, canManage, openCreate, openEdit, askLostReason],
  );

  // Tracks the newest choice, so a second quick change builds on the first instead of undoing it.
  const latestFilters = useRef(filters);
  useEffect(() => {
    latestFilters.current = filters;
  }, [filters]);

  const navigate = useCallback(
    (changes: Partial<LeadFilters>) => {
      const next = { ...latestFilters.current, page: 1, ...changes };
      latestFilters.current = next;
      const query = leadsQuery(next);
      startTransition(() => router.push(query ? `/leads?${query}` : "/leads", { scroll: false }));
    },
    [router],
  );

  // Waits for a pause in typing, so each keystroke doesn't load a new page.
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    if (search.trim() === filters.q) return;
    const timer = setTimeout(() => navigate({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [search, filters.q, navigate]);

  const isBoard = filters.view === "board";
  const exportQuery = leadsQuery(filters, { view: "table", page: 1 });

  return (
    <LeadWorkspaceContext.Provider value={workspace}>
      <PageHeader
        title="Leads"
        description="Everyone from first enquiry until they enrol."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="lg" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden />
              Import
            </Button>
            <a
              href={`/leads/export${exportQuery ? `?${exportQuery}` : ""}`}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              <Download aria-hidden />
              Export
            </a>
            <Button size="lg" onClick={openCreate}>
              <Plus aria-hidden />
              New lead
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="View">
          {(
            [
              { view: "table", label: "Table", icon: Table2 },
              { view: "board", label: "Board", icon: KanbanSquare },
            ] as const
          ).map(({ view, label, icon: Icon }) => {
            const query = leadsQuery(filters, { view, page: 1 });
            return (
              <Link
                key={view}
                href={query ? `/leads?${query}` : "/leads"}
                aria-current={filters.view === view ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  filters.view === view
                    ? "bg-primary-soft text-primary-soft-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>

        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search leads"
            placeholder="Search name, phone or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 pl-8"
          />
        </div>

        {!isBoard && (
          <FilterSelect label="Stage" value={filters.stage} onChange={(stage) => navigate({ stage })}>
            {options.stages
              .filter((stage) => stage.type !== "WON")
              .map(({ id, name }) => (
                <NativeSelectOption key={id} value={id}>
                  {name}
                </NativeSelectOption>
              ))}
          </FilterSelect>
        )}
        <FilterSelect label="Source" value={filters.source} onChange={(source) => navigate({ source })}>
          {options.sources.map(({ id, name }) => (
            <NativeSelectOption key={id} value={id}>
              {name}
            </NativeSelectOption>
          ))}
        </FilterSelect>
        <FilterSelect label="Course" value={filters.course} onChange={(course) => navigate({ course })}>
          {options.courses.map(({ id, name }) => (
            <NativeSelectOption key={id} value={id}>
              {name}
            </NativeSelectOption>
          ))}
        </FilterSelect>
        {canManage && (
          <FilterSelect label="Counsellor" value={filters.counsellor} onChange={(counsellor) => navigate({ counsellor })}>
            {options.assignees.map(({ id, name }) => (
              <NativeSelectOption key={id} value={id}>
                {name}
              </NativeSelectOption>
            ))}
          </FilterSelect>
        )}
        <FilterSelect
          label="Follow-up"
          value={filters.followUp}
          onChange={(followUp) => navigate({ followUp: followUp as LeadFilters["followUp"] })}
        >
          <NativeSelectOption value="overdue">Overdue</NativeSelectOption>
          <NativeSelectOption value="today">Later today</NativeSelectOption>
          <NativeSelectOption value="upcoming">Upcoming</NativeSelectOption>
          <NativeSelectOption value="none">None set</NativeSelectOption>
        </FilterSelect>

        {hasActiveFilters(filters) && (
          <Button
            variant="ghost"
            className="h-9"
            onClick={() => {
              setSearch("");
              navigate({ q: "", stage: "", source: "", course: "", counsellor: "", followUp: "" });
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}
        {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
      </div>

      {children}

      <LeadSheet
        key={`${sheet.leadId ?? "new"}-${sheet.open}`}
        open={sheet.open}
        leadId={sheet.leadId}
        options={options}
        canManage={canManage}
        onClose={() => setSheet((current) => ({ ...current, open: false }))}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <LostReasonDialog
        subject={lostRequest?.subject ?? null}
        onResult={(reason) => {
          lostRequest?.resolve(reason);
          setLostRequest(null);
        }}
      />
    </LeadWorkspaceContext.Provider>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <NativeSelect
      aria-label={`Filter by ${label.toLowerCase()}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="[&>select]:h-9"
    >
      <NativeSelectOption value="">{label}: All</NativeSelectOption>
      {children}
    </NativeSelect>
  );
}
