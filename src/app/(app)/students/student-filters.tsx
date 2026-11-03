"use client";

import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useTypedBeforeHydration } from "@/hooks/use-typed-before-hydration";

export function StudentFilters({
  q,
  course,
  courses,
}: {
  q: string;
  course: string;
  courses: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const searchInput = useRef<HTMLInputElement>(null);
  useTypedBeforeHydration(searchInput, search, setSearch);

  // Tracks the newest choice, so a second quick change builds on the first instead of undoing it.
  const latest = useRef({ q, course });
  useEffect(() => {
    latest.current = { q, course };
  }, [q, course]);

  function navigate(changes: Partial<{ q: string; course: string }>) {
    const next = { ...latest.current, ...changes };
    latest.current = next;
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.course) params.set("course", next.course);
    const query = params.toString();
    startTransition(() => router.push(query ? `/students?${query}` : "/students", { scroll: false }));
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
          aria-label="Search students"
          placeholder="Search name, phone or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 pl-8"
        />
      </div>
      <NativeSelect
        aria-label="Filter by course"
        value={course}
        onChange={(event) => navigate({ course: event.target.value })}
        className="[&>select]:h-9"
      >
        <NativeSelectOption value="">Course: All</NativeSelectOption>
        {courses.map(({ id, name }) => (
          <NativeSelectOption key={id} value={id}>
            {name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
    </div>
  );
}
