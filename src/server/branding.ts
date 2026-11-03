import { cache } from "react";

import { db } from "@/lib/db";

export const getBranding = cache(async () => {
  const org = await db.orgSettings.findUnique({
    where: { id: "default" },
    select: { name: true, logoUrl: true, primaryColor: true, accentColor: true },
  });
  return {
    name: org?.name ?? "Theta",
    logoUrl: org?.logoUrl ? "/branding/logo" : null,
    primaryColor: org?.primaryColor ?? "#4F46E5",
    accentColor: org?.accentColor ?? "#8B5CF6",
  };
});

export type Branding = Awaited<ReturnType<typeof getBranding>>;
