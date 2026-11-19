import { DalError, getSessionContext } from "@/lib/dal/context";
import { exportLedgerCsv, getLedgerProgram, parseLedgerFilter } from "@/lib/dal/payments-ledger";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  // Route handlers bypass layouts: authorize here (existence hidden from non-managers).
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const { slug } = await params;
  const sp = new URL(request.url).searchParams;
  try {
    const program = await getLedgerProgram(ctx, slug);
    const filter = parseLedgerFilter({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      kind: sp.get("kind") ?? undefined,
    });
    filter.programId = program.id;
    const { csv, filename } = await exportLedgerCsv(ctx, filter, program.slug);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
