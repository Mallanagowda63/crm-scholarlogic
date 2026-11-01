import { Compass } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="This page doesn't exist or may have moved."
        action={
          <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
            Back to dashboard
          </Link>
        }
      />
    </main>
  );
}
