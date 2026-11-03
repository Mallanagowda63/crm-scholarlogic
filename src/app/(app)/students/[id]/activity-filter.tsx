"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const TYPES = [
  ["CALL", "Calls"],
  ["WHATSAPP", "WhatsApp"],
  ["EMAIL", "Emails"],
  ["NOTE", "Notes"],
  ["STAGE_CHANGE", "Stage changes"],
  ["DEMO_CLASS", "Demo classes"],
  ["FOLLOW_UP", "Follow-ups"],
] as const;

export function ActivityTypeFilter({ studentId, type }: { studentId: string; type?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mb-4">
      <NativeSelect
        aria-label="Filter activity by type"
        value={type ?? ""}
        disabled={isPending}
        className="[&>select]:h-9"
        onChange={(event) => {
          const value = event.target.value;
          const query = value ? `&type=${value}` : "";
          startTransition(() => router.push(`/students/${studentId}?tab=activity${query}`, { scroll: false }));
        }}
      >
        <NativeSelectOption value="">Type: All</NativeSelectOption>
        {TYPES.map(([value, label]) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
