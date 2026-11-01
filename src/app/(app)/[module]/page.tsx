import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { getModule } from "@/lib/modules";
import { requireModuleAccess } from "@/lib/session";

type Props = { params: Promise<{ module: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const definition = getModule((await params).module);
  return { title: definition?.label ?? "Not found" };
}

/**
 * Stands in for modules that aren't built yet. Each phase adds a real route,
 * such as app/(app)/leads, which takes priority over this dynamic one.
 */
export default async function UpcomingModulePage({ params }: Props) {
  const definition = getModule((await params).module);
  if (!definition) notFound();
  await requireModuleAccess(definition.id);

  return (
    <>
      <PageHeader title={definition.label} description={definition.description} />
      <Card>
        <EmptyState
          icon={definition.icon}
          title={`${definition.label} arrives in Phase ${definition.phase}`}
          description="The navigation and access rules for this area are ready. Its features are still to be built."
        />
      </Card>
    </>
  );
}
