"use client";

import { TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title="Something went wrong"
      description="This page couldn't load. Please try again."
      action={
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
