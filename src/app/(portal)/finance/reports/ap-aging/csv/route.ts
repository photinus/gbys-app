import { DalError, getSessionContext } from "@/lib/dal/context";
import { exportApAgingCsv } from "@/lib/dal/finance-payables-reports";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** GET /finance/reports/ap-aging/csv?asOf=YYYY-MM-DD: audited CSV download (org-wide readers). */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const asOf = new URL(request.url).searchParams.get("asOf") ?? undefined;
  try {
    const { csv, filename } = await exportApAgingCsv(ctx, { asOf });
    return new Response(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
