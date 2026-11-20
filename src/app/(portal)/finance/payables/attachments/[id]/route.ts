import { DalError, getSessionContext } from "@/lib/dal/context";
import { readBillAttachment } from "@/lib/dal/finance-bills";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const INLINE = /^(image\/(png|jpeg|webp)|application\/pdf)$/;

/**
 * GET /finance/payables/attachments/<id>: a bill or reimbursement file, only for finance readers of that
 * bill (org-wide, or their program) and the claimant of a reimbursement. Everything else is a 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const { id } = await params;
  try {
    const f = await readBillAttachment(ctx, id);
    const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return new Response(new Uint8Array(f.body), {
      status: 200,
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": `${INLINE.test(f.contentType) ? "inline" : "attachment"}; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
