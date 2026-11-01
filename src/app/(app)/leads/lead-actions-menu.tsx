"use client";

import { MessageCircle, MoreHorizontal, Pencil, Phone, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { useLeadWorkspace } from "@/app/(app)/leads/leads-workspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { whatsappUrl } from "@/lib/phone";
import { changeLeadStages, deleteLead, restoreLead } from "@/server/actions/leads";
import type { LeadRow } from "@/server/leads";

/** Changes a stage, asking for a reason first when the lead is being marked as lost. */
export function useStageChanger() {
  const { askLostReason, options } = useLeadWorkspace();
  const [isPending, startTransition] = useTransition();

  async function changeStage(
    ids: string[],
    stageId: string,
    subject: string,
    hooks: { beforeSave?: () => void; onSaved?: () => void } = {},
  ) {
    const stage = options.stages.find((option) => option.id === stageId);
    if (!stage) return;

    // Asked before the transition starts. React holds a transition's screen updates
    // until it ends, so a dialog opened inside one would never appear.
    let reason: string | undefined;
    if (stage.type === "LOST") {
      const answer = await askLostReason(subject);
      if (answer === null) return;
      reason = answer;
    }

    startTransition(async () => {
      hooks.beforeSave?.();
      try {
        const result = await changeLeadStages(ids, stageId, reason);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        if (stage.type === "WON") toast.success(`${subject} moved to Enrolled, and now counts as a student`);
        else toast.success(`${subject} moved to ${stage.name}`);
        hooks.onSaved?.();
      } catch {
        toast.error("Couldn't change the stage. Please try again.");
      }
    });
  }

  return { changeStage, isPending };
}

export function LeadActionsMenu({ lead }: { lead: LeadRow }) {
  const { openEdit, options, canManage } = useLeadWorkspace();
  const { changeStage } = useStageChanger();
  const [, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteLead(lead.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${lead.name} deleted`, {
        action: {
          label: "Undo",
          onClick: () => {
            startTransition(async () => {
              const undone = await restoreLead(lead.id);
              if (undone.ok) toast.success(`${lead.name} restored`);
              else toast.error(undone.error);
            });
          },
        },
      });
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Actions for ${lead.name}`} />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => openEdit(lead.id)}>
          <Pencil aria-hidden />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={`tel:${lead.phone}`} />}>
          <Phone aria-hidden />
          Call
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer" />}>
          <MessageCircle aria-hidden />
          WhatsApp
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {options.stages
            .filter((stage) => stage.id !== lead.stage.id)
            .map((stage) => (
              <DropdownMenuItem
                key={stage.id}
                onClick={() => void changeStage([lead.id], stage.id, lead.name)}
              >
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
                {stage.name}
              </DropdownMenuItem>
            ))}
        </DropdownMenuGroup>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={remove}>
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
