import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access" };

export default function ForbiddenPage() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="You don't have access to this page"
      description="Your role doesn't include this area. Ask an admin if you think you need it."
      action={
        <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
          Back to dashboard
        </Link>
      }
    />
  );
}
