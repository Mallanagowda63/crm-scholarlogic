"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useTypedBeforeHydration } from "@/hooks/use-typed-before-hydration";

export function AdmissionFilters({ q, status }: { q: string; status: string }) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const searchInput = useRef<HTMLInputElement>(null);
  useTypedBeforeHydration(searchInput, search, setSearch);

  const latest = useRef({ q, status });
  useEffect(() => {
    latest.current = { q, status };
  }, [q, status]);

  function navigate(changes: Partial<{ q: string; status: string }>) {
    const next = { ...latest.current, ...changes };
    latest.current = next;
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.status) params.set("status", next.status);
    const query = params.toString();
    router.push(query ? `/admissions?${query}` : "/admissions", { scroll: false });
  }

  useEffect(() => {
    if (search.trim() === q) return;
    const timer = setTimeout(() => navigate({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate only reads refs and stable values
  }, [search, q]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={searchInput}
          type="search"
          aria-label="Search admissions"
          placeholder="Search by student name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 pl-8"
        />
      </div>
      <NativeSelect
        aria-label="Filter by status"
        value={status}
        onChange={(event) => navigate({ status: event.target.value })}
        className="[&>select]:h-9"
      >
        <NativeSelectOption value="">Status: All</NativeSelectOption>
        <NativeSelectOption value="PENDING">Pending</NativeSelectOption>
        <NativeSelectOption value="CONFIRMED">Confirmed</NativeSelectOption>
        <NativeSelectOption value="CANCELLED">Cancelled</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}
