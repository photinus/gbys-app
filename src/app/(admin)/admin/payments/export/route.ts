import { DalError, getSessionContext, isBoard } from "@/lib/dal/context";
import { exportLedgerCsv, parseLedgerFilter } from "@/lib/dal/payments-ledger";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx || !isBoard(ctx)) return notFound();
  const sp = new URL(request.url).searchParams;
  try {
    const filter = parseLedgerFilter({
      program: sp.get("program") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      kind: sp.get("kind") ?? undefined,
    });
    const { csv, filename } = await exportLedgerCsv(ctx, filter);
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
