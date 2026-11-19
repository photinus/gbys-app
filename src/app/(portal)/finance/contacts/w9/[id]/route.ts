import { DalError, getSessionContext } from "@/lib/dal/context";
import { readW9 } from "@/lib/dal/finance-contact-docs";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** GET /finance/contacts/w9/<attachmentId>: a W-9 file, finance editors and admins only (audited). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const { id } = await params;
  try {
    const f = await readW9(ctx, id);
    const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return new Response(new Uint8Array(f.body), {
      status: 200,
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
