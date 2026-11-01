"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, MessageCircle, Phone } from "lucide-react";
import { useOptimistic, useState } from "react";

import { LeadActionsMenu, useStageChanger } from "@/app/(app)/leads/lead-actions-menu";
import { useLeadWorkspace } from "@/app/(app)/leads/leads-workspace";
import { StageBadge } from "@/components/shared/stage-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatShortDate } from "@/lib/format";
import { BOARD_COLUMN_LIMIT } from "@/lib/leads";
import { formatPhone, whatsappUrl } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { BoardColumn, LeadRow } from "@/server/leads";

type Move = { leadId: string; toStageId: string };

/** Moves the card at once. React discards this when the transition ends and real data arrives. */
function applyMove(columns: BoardColumn[], { leadId, toStageId }: Move) {
  const moved = columns.flatMap((column) => column.leads).find((lead) => lead.id === leadId);
  if (!moved) return columns;

  return columns.map((column) => {
    if (column.stage.id === toStageId) {
      const { id, name, color, type } = column.stage;
      return {
        ...column,
        total: column.total + 1,
        leads: [{ ...moved, stage: { id, name, color, type } }, ...column.leads],
      };
    }
    if (column.leads.some((lead) => lead.id === leadId)) {
      return { ...column, total: column.total - 1, leads: column.leads.filter((lead) => lead.id !== leadId) };
    }
    return column;
  });
}

export function LeadsBoard({ columns, now }: { columns: BoardColumn[]; now: Date }) {
  const { changeStage } = useStageChanger();
  const [optimisticColumns, addMove] = useOptimistic(columns, applyMove);
  const [activeLead, setActiveLead] = useState<LeadRow | null>(null);

  const sensors = useSensors(
    // A small distance lets a plain tap on the handle do nothing instead of starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const stageName = (id: unknown) => columns.find((column) => column.stage.id === id)?.stage.name ?? "";
  const leadName = (id: unknown) =>
    columns.flatMap((column) => column.leads).find((lead) => lead.id === id)?.name ?? "this lead";

  function onDragStart({ active }: DragStartEvent) {
    setActiveLead(optimisticColumns.flatMap((column) => column.leads).find((lead) => lead.id === active.id) ?? null);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveLead(null);
    if (!over) return;
    const leadId = String(active.id);
    const toStageId = String(over.id);
    const current = optimisticColumns.find((column) => column.leads.some((lead) => lead.id === leadId));
    if (!current || current.stage.id === toStageId) return;

    void changeStage([leadId], toStageId, leadName(leadId), {
      beforeSave: () => addMove({ leadId, toStageId }),
    });
  }

  return (
    <DndContext
      id="leads-board"
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveLead(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${leadName(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${leadName(active.id)} is over ${stageName(over.id)}.` : `${leadName(active.id)} is not over a stage.`,
          onDragEnd: ({ active, over }) =>
            over ? `${leadName(active.id)} moved to ${stageName(over.id)}.` : `${leadName(active.id)} was dropped.`,
          onDragCancel: ({ active }) => `Move cancelled. ${leadName(active.id)} stays where it was.`,
        },
        screenReaderInstructions: {
          draggable:
            "To pick up a lead, press Space or Enter. Use the arrow keys to move it over a stage, then press Space or Enter to drop it, or Escape to cancel.",
        },
      }}
    >
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {optimisticColumns.map((column) => (
          <Column key={column.stage.id} column={column} now={now} />
        ))}
      </div>
      <DragOverlay>{activeLead && <LeadCard lead={activeLead} now={now} isOverlay />}</DragOverlay>
    </DndContext>
  );
}

function Column({ column, now }: { column: BoardColumn; now: Date }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });
  const hidden = column.total - column.leads.length;
  const isClosed = column.stage.type !== "OPEN";

  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.stage.name}, ${column.total} ${column.total === 1 ? "lead" : "leads"}`}
      data-stage={column.stage.name}
      className={cn(
        "flex max-h-[calc(100dvh-16rem)] min-h-64 w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors",
        isOver && "border-primary bg-primary-soft",
      )}
    >
      <header className="flex items-center justify-between gap-2 p-3">
        <StageBadge name={column.stage.name} color={column.stage.color} />
        <span className="text-xs font-medium text-muted-foreground">{column.total}</span>
      </header>
      {isClosed && <p className="-mt-1 px-3 pb-2 text-xs text-muted-foreground">Last 30 days</p>}
      <ul className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {column.leads.map((lead) => (
          <li key={lead.id}>
            <DraggableCard lead={lead} now={now} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="border-t p-2 text-center text-xs text-muted-foreground">
          Showing the latest {BOARD_COLUMN_LIMIT}. Use the table to see all {column.total}.
        </p>
      )}
    </section>
  );
}

function DraggableCard({ lead, now }: { lead: LeadRow; now: Date }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: lead.id });

  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <LeadCard
        lead={lead}
        now={now}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label={`Move ${lead.name}`}
            className="-ml-1 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        }
      />
    </div>
  );
}

function LeadCard({
  lead,
  now,
  handle,
  isOverlay,
}: {
  lead: LeadRow;
  now: Date;
  handle?: React.ReactNode;
  isOverlay?: boolean;
}) {
  const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;

  return (
    <article className={cn("rounded-lg border bg-card p-3 text-sm shadow-xs", isOverlay && "rotate-1 shadow-lg")}>
      <div className="flex items-start gap-1">
        {handle ?? <GripVertical className="mt-2 -ml-1 size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <CardTitle lead={lead} isOverlay={isOverlay} />
        {!isOverlay && <LeadActionsMenu lead={lead} />}
      </div>

      {lead.courseInterest && <p className="mt-1 truncate text-xs text-muted-foreground">{lead.courseInterest.name}</p>}
      {lead.lostReason && <p className="mt-1 truncate text-xs text-muted-foreground">{lead.lostReason}</p>}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lead.assignedTo && <UserAvatar name={lead.assignedTo.name} size="sm" />}
          {followUp && (
            <span className={cn(followUp < now && "font-medium text-destructive")}>
              {followUp < now ? "Overdue " : ""}
              {formatShortDate(followUp)}
            </span>
          )}
        </div>
        {!isOverlay && (
          <div className="flex items-center">
            <a
              href={`tel:${lead.phone}`}
              aria-label={`Call ${lead.name}, ${formatPhone(lead.phone)}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Phone className="size-3.5" aria-hidden />
            </a>
            <a
              href={whatsappUrl(lead.phone)}
              target="_blank"
              rel="noreferrer"
              aria-label={`WhatsApp ${lead.name}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <MessageCircle className="size-3.5" aria-hidden />
            </a>
          </div>
        )}
      </div>
    </article>
  );
}

function CardTitle({ lead, isOverlay }: { lead: LeadRow; isOverlay?: boolean }) {
  const { openEdit } = useLeadWorkspace();
  if (isOverlay) return <p className="min-w-0 flex-1 truncate py-1.5 font-medium">{lead.name}</p>;
  return (
    <button
      type="button"
      onClick={() => openEdit(lead.id)}
      className="min-w-0 flex-1 truncate rounded py-1.5 text-left font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {lead.name}
    </button>
  );
}
