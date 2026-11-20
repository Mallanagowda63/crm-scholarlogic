import { db } from "@/lib/db";
import { requireModuleAccess } from "@/lib/session";
import { recordAudit } from "@/server/audit";
import { ownedBy } from "@/server/leads";
import { readUpload } from "@/server/storage";

type Props = { params: Promise<{ id: string; documentId: string }> };

export async function GET(_request: Request, { params }: Props) {
  const user = await requireModuleAccess("students");
  // Accounts doesn't need ID proofs or marks cards to handle fees.
  if (user.role === "ACCOUNTS") return new Response("Forbidden", { status: 403 });

  const { id, documentId } = await params;
  const document = await db.document.findFirst({
    where: { id: documentId, studentId: id, student: { deletedAt: null, ...ownedBy(user) } },
  });
  // The same answer for "doesn't exist" and "not yours", so neither can be told apart.
  if (!document) return new Response("Not found", { status: 404 });

  const { bytes, contentType } = await readUpload(document.fileUrl);
  await recordAudit(db, {
    actorId: user.id,
    action: "document.downloaded",
    entityType: "Document",
    entityId: document.id,
  });

  // A plain fallback name, plus the real one encoded for browsers that support it.
  const asciiName = document.fileName.replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
