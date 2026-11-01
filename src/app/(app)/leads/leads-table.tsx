"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { LeadActionsMenu, useStageChanger } from "@/app/(app)/leads/lead-actions-menu";
import { useLeadWorkspace } from "@/app/(app)/leads/leads-workspace";
import { StageBadge } from "@/components/shared/stage-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatShortDate } from "@/lib/format";
import { leadsQuery, PAGE_SIZE, type LeadFilters } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { assignLeads } from "@/server/actions/leads";
import type { LeadRow } from "@/server/leads";

type SortKey = LeadFilters["sort"];

function SortableHeader({ filters, sortKey, label }: { filters: LeadFilters; sortKey: SortKey; label: string }) {
  const isActive = filters.sort === sortKey;
  const nextDir = isActive && filters.dir === "asc" ? "desc" : "asc";
  const Icon = !isActive ? ArrowUpDown : filters.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link
      href={`/leads?${leadsQuery(filters, { sort: sortKey, dir: nextDir, page: 1 })}`}
      scroll={false}
      className="inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {label}
      <Icon className={cn("size-3.5", !isActive && "opacity-50")} aria-hidden />
    </Link>
  );
}

export function LeadsTable({
  rows,
  total,
  page,
  pageCount,
  filters,
  now,
}: {
  rows: LeadRow[];
  total: number;
  page: number;
  pageCount: number;
  filters: LeadFilters;
  now: Date;
}) {
  const { openEdit } = useLeadWorkspace();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Fresh data means the selection may point at rows no longer on this page.
  useEffect(() => setRowSelection({}), [rows]);

  const columns = useMemo<ColumnDef<LeadRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all leads on this page"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked)}
          />
        ),
        meta: { className: "w-10" },
      },
      {
        id: "name",
        header: () => <SortableHeader filters={filters} sortKey="name" label="Name" />,
        cell: ({ row: { original: lead } }) => (
          <div className="min-w-36">
            <button
              type="button"
              onClick={() => openEdit(lead.id)}
              className="rounded text-left font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {lead.name}
            </button>
            <a href={`tel:${lead.phone}`} className="block text-xs text-muted-foreground hover:underline">
              {formatPhone(lead.phone)}
            </a>
          </div>
        ),
      },
      {
        id: "stage",
        header: "Stage",
        cell: ({ row: { original: lead } }) => (
          <div>
            <StageBadge name={lead.stage.name} color={lead.stage.color} />
            {lead.lostReason && <p className="mt-1 max-w-40 truncate text-xs text-muted-foreground">{lead.lostReason}</p>}
          </div>
        ),
      },
      {
        id: "course",
        header: "Course",
        cell: ({ row: { original: lead } }) => (
          <div className="max-w-52">
            <p className="truncate">{lead.courseInterest?.name ?? "—"}</p>
            {lead.currentClass && <p className="text-xs text-muted-foreground">{lead.currentClass}</p>}
          </div>
        ),
        meta: { className: "hidden lg:table-cell" },
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row: { original: lead } }) => lead.source?.name ?? "—",
        meta: { className: "hidden xl:table-cell" },
      },
      {
        id: "counsellor",
        header: "Counsellor",
        cell: ({ row: { original: lead } }) =>
          lead.assignedTo ? (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <UserAvatar name={lead.assignedTo.name} size="sm" />
              {lead.assignedTo.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          ),
        meta: { className: "hidden md:table-cell" },
      },
      {
        id: "followUp",
        header: () => <SortableHeader filters={filters} sortKey="nextFollowUpAt" label="Follow-up" />,
        cell: ({ row: { original: lead } }) => {
          if (!lead.nextFollowUpAt) return <span className="text-muted-foreground">—</span>;
          const isOverdue = new Date(lead.nextFollowUpAt) < now;
          return (
            <span className={cn("whitespace-nowrap", isOverdue && "font-medium text-destructive")}>
              {formatShortDate(new Date(lead.nextFollowUpAt))}
              {isOverdue && <span className="block text-xs font-normal">Overdue</span>}
            </span>
          );
        },
        meta: { className: "hidden sm:table-cell" },
      },
      {
        id: "createdAt",
        header: () => <SortableHeader filters={filters} sortKey="createdAt" label="Enquired" />,
        cell: ({ row: { original: lead } }) => (
          <span className="whitespace-nowrap text-muted-foreground">{formatShortDate(new Date(lead.createdAt))}</span>
        ),
        meta: { className: "hidden xl:table-cell" },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: lead } }) => <LeadActionsMenu lead={lead} />,
        meta: { className: "w-10" },
      },
    ],
    [filters, now, openEdit],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { rowSelection },
    getRowId: (row) => row.id,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const metaClass = (meta: unknown) => (meta as { className?: string } | undefined)?.className;

  return (
    <>
      {selectedIds.length > 0 && (
        <BulkBar selectedIds={selectedIds} onDone={() => setRowSelection({})} />
      )}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const isSorted = filters.sort === header.column.id;
                  return (
                    <TableHead
                      key={header.id}
                      className={metaClass(header.column.columnDef.meta)}
                      aria-sort={isSorted ? (filters.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={metaClass(cell.column.columnDef.meta)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          {first}–{last} of {total.toLocaleString("en-IN")}
        </p>
        <div className="flex items-center gap-2">
          <PageLink filters={filters} page={page - 1} disabled={page <= 1} label="Previous page" icon={ChevronLeft} />
          <span>
            Page {page} of {pageCount}
          </span>
          <PageLink filters={filters} page={page + 1} disabled={page >= pageCount} label="Next page" icon={ChevronRight} />
        </div>
      </nav>
    </>
  );
}

function PageLink({
  filters,
  page,
  disabled,
  label,
  icon: Icon,
}: {
  filters: LeadFilters;
  page: number;
  disabled: boolean;
  label: string;
  icon: typeof ChevronLeft;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="icon-lg" disabled aria-label={label}>
        <Icon />
      </Button>
    );
  }
  const query = leadsQuery(filters, { page });
  return (
    <Link
      href={query ? `/leads?${query}` : "/leads"}
      scroll={false}
      aria-label={label}
      className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }))}
    >
      <Icon />
    </Link>
  );
}

function BulkBar({ selectedIds, onDone }: { selectedIds: string[]; onDone: () => void }) {
  const { options, canManage } = useLeadWorkspace();
  const { changeStage, isPending: isChangingStage } = useStageChanger();
  const [isAssigning, startTransition] = useTransition();
  const isPending = isChangingStage || isAssigning;
  const count = selectedIds.length;
  const subject = `${count} ${count === 1 ? "lead" : "leads"}`;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-primary-soft px-3 py-2 text-sm"
    >
      <span className="font-medium text-primary-soft-foreground">{subject} selected</span>
      <NativeSelect
        aria-label="Change stage of selected leads"
        value=""
        disabled={isPending}
        className="[&>select]:bg-card"
        onChange={(event) => void changeStage(selectedIds, event.target.value, subject, { onSaved: onDone })}
      >
        <NativeSelectOption value="">Change stage</NativeSelectOption>
        {options.stages.map(({ id, name }) => (
          <NativeSelectOption key={id} value={id}>
            {name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {canManage && (
        <NativeSelect
          aria-label="Assign selected leads"
          value=""
          disabled={isPending}
          className="[&>select]:bg-card"
          onChange={(event) => {
            const counsellorId = event.target.value;
            const counsellor = options.assignees.find(({ id }) => id === counsellorId);
            startTransition(async () => {
              const result = await assignLeads(selectedIds, counsellorId);
              if (result.ok) {
                toast.success(`${subject} assigned to ${counsellor?.name}`);
                onDone();
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          <NativeSelectOption value="">Assign to</NativeSelectOption>
          {options.assignees.map(({ id, name }) => (
            <NativeSelectOption key={id} value={id}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      <Button variant="ghost" onClick={onDone} className="ml-auto">
        <X aria-hidden />
        Clear selection
      </Button>
    </div>
  );
}
