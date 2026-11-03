import { db } from "@/lib/db";
import { requireModuleAccess } from "@/lib/session";
import { recordAudit } from "@/server/audit";
import { buildReceiptPdf } from "@/server/receipt-pdf";
import { viewableWhere } from "@/server/students";

type Props = { params: Promise<{ paymentId: string }> };

export async function GET(_request: Request, { params }: Props) {
  const user = await requireModuleAccess("students");
  const { paymentId } = await params;

  // Asked for directly because a cancelled payment's receipt must still open.
  const receipt = await db.receipt.findFirst({
    where: {
      paymentId,
      payment: { feePlan: { student: { deletedAt: null, ...viewableWhere(user) } } },
    },
    include: { payment: { select: { method: true, reference: true, paidAt: true, deletedAt: true } } },
  });
  if (!receipt) return new Response("Not found", { status: 404 });

  const bytes = await buildReceiptPdf(receipt);
  await recordAudit(db, {
    actorId: user.id,
    action: "receipt.downloaded",
    entityType: "Receipt",
    entityId: receipt.id,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${receipt.number.replace(/[^\w-]/g, "-")}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
