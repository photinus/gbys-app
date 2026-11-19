import { DalError, getSessionContext } from "@/lib/dal/context";
import { readGiftAttachment } from "@/lib/dal/finance-donations";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/** GET /finance/donations/:giftId/attachments/:attId — authorized (org-wide finance readers) download of a gift's file. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const { id, attId } = await params;
  try {
    const f = await readGiftAttachment(ctx, id, attId);
    const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return new Response(new Uint8Array(f.bytes), {
      status: 200,
      headers: {
        "Content-Type": f.contentType,
        "Content-Length": String(f.bytes.length),
        "Content-Disposition": `${INLINE.has(f.contentType) ? "inline" : "attachment"}; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
