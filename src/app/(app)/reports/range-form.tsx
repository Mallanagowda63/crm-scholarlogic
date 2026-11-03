"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ReportRangeForm({ from, to, today }: { from: string; to: string; today: string }) {
  const router = useRouter();
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => router.push(`/reports?from=${start}&to=${end}`, { scroll: false }));
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="report-from">From</Label>
        <Input id="report-from" type="date" max={end} value={start} onChange={(event) => setStart(event.target.value)} className="h-9" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="report-to">To</Label>
        <Input id="report-to" type="date" max={today} value={end} onChange={(event) => setEnd(event.target.value)} className="h-9" />
      </div>
      <Button type="submit" variant="outline" className="h-9" disabled={!start || !end || isPending}>
        Apply
      </Button>
    </form>
  );
}
