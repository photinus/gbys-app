import { DalError, getSessionContext } from "@/lib/dal/context";
import { getInvoiceAttachmentFile } from "@/lib/dal/finance-invoices";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** GET /finance/receivables/[id]/attachments/[attId]: authorized download of an invoice attachment. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const { id, attId } = await params;
  try {
    const f = await getInvoiceAttachmentFile(ctx, id, attId);
    if (!f.body) return notFound();
    const safe = f.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return new Response(new Uint8Array(f.body.body), {
      status: 200,
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": `inline; filename="${safe}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
