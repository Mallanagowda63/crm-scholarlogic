import { db } from "@/lib/db";
import { readUpload } from "@/server/storage";

/** Public, because the sign-in page shows the logo before anyone has signed in. */
export async function GET() {
  const org = await db.orgSettings.findUnique({ where: { id: "default" }, select: { logoUrl: true } });
  if (!org?.logoUrl) return new Response("Not found", { status: 404 });

  try {
    const { bytes, contentType } = await readUpload(org.logoUrl);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
