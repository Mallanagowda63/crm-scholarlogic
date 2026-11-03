"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { LeadSheet } from "@/app/(app)/leads/lead-sheet";
import { LostReasonDialog } from "@/app/(app)/leads/lost-reason-dialog";
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
  if (!workspace) throw new Error("useLeadWorkspace must be used inside LeadDialogsProvider");
  return workspace;
}

/** The lead form and lost-reason dialog, shared by the Leads pages and the student profile. */
export function LeadDialogsProvider({
  options,
  canManage,
  children,
}: {
  options: LeadOptions;
  canManage: boolean;
  children: React.ReactNode;
}) {
  const [sheet, setSheet] = useState<{ open: boolean; leadId: string | null }>({ open: false, leadId: null });
  const [lostRequest, setLostRequest] = useState<{ subject: string; resolve: (reason: string | null) => void } | null>(
    null,
  );

  const openCreate = useCallback(() => setSheet({ open: true, leadId: null }), []);
  const openEdit = useCallback((leadId: string) => setSheet({ open: true, leadId }), []);
  const closeSheet = useCallback(() => setSheet((current) => ({ ...current, open: false })), []);
  const askLostReason = useCallback(
    (subject: string) => new Promise<string | null>((resolve) => setLostRequest({ subject, resolve })),
    [],
  );
  const workspace = useMemo(
    () => ({ options, canManage, openCreate, openEdit, askLostReason }),
    [options, canManage, openCreate, openEdit, askLostReason],
  );

  return (
    <LeadWorkspaceContext.Provider value={workspace}>
      {children}
      <LeadSheet
        key={`${sheet.leadId ?? "new"}-${sheet.open}`}
        open={sheet.open}
        leadId={sheet.leadId}
        options={options}
        canManage={canManage}
        onClose={closeSheet}
      />
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
